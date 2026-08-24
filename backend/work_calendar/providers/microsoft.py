"""Microsoft Graph OAuth and event adapter."""

import hashlib
from datetime import datetime, timezone
from urllib.parse import quote

from .base import CalendarProviderError, ProviderEventResult, require_success


class MicrosoftCalendarProvider:
    provider = "MICROSOFT"

    def __init__(self, environ, http_client):
        self.environ = environ
        self.http = http_client

    @property
    def token_url(self):
        tenant = str(
            self.environ.get("WORK_CALENDAR_MICROSOFT_TENANT", "common")
        ).strip() or "common"
        return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

    def exchange_code(self, *, code, verifier, redirect_uri):
        response = self.http.request(
            "POST",
            self.token_url,
            form={
                "client_id": self.environ["WORK_CALENDAR_MICROSOFT_CLIENT_ID"],
                "client_secret": self.environ["WORK_CALENDAR_MICROSOFT_CLIENT_SECRET"],
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "scope": "offline_access Calendars.ReadWrite",
            },
        )
        return require_success(response, operation="TOKEN_EXCHANGE")

    def refresh_token(self, token):
        response = self.http.request(
            "POST",
            self.token_url,
            form={
                "client_id": self.environ["WORK_CALENDAR_MICROSOFT_CLIENT_ID"],
                "client_secret": self.environ["WORK_CALENDAR_MICROSOFT_CLIENT_SECRET"],
                "refresh_token": token["refresh_token"],
                "grant_type": "refresh_token",
                "scope": "offline_access Calendars.ReadWrite",
            },
        )
        return require_success(response, operation="TOKEN_REFRESH")

    def revoke_token(self, _token):
        # Microsoft does not expose a general delegated-token revocation REST
        # endpoint. Local revoke is authoritative for stopping this connector.
        return True

    def build_event_payload(self, event):
        value_type = str(event.get("valueType") or "")
        if value_type == "DATE":
            start = {"dateTime": f"{event['start']}T00:00:00", "timeZone": "UTC"}
            end = {"dateTime": f"{event['end']}T00:00:00", "timeZone": "UTC"}
            all_day = True
        elif value_type == "DATE_TIME":
            start = {"dateTime": self._graph_utc(event["start"]), "timeZone": "UTC"}
            end = {"dateTime": self._graph_utc(event["end"]), "timeZone": "UTC"}
            all_day = False
        else:
            raise ValueError("Calendar event valueType must be DATE or DATE_TIME.")
        status = str(event.get("status") or "").strip().upper()
        if status not in {"CONFIRMED", "TENTATIVE", "CANCELLED"}:
            raise ValueError("Calendar event status is invalid.")
        return {
            "subject": str(event.get("summary") or ""),
            "body": {
                "contentType": "text",
                "content": str(event.get("description") or ""),
            },
            "location": {"displayName": str(event.get("location") or "")},
            "start": start,
            "end": end,
            "isAllDay": all_day,
            "transactionId": hashlib.sha256(
                str(event["uid"]).encode("utf-8")
            ).hexdigest(),
            "showAs": "tentative" if status == "TENTATIVE" else "busy",
        }

    @staticmethod
    def _collection_url(calendar_id):
        if str(calendar_id).strip().casefold() == "primary":
            return "https://graph.microsoft.com/v1.0/me/calendar/events"
        return (
            "https://graph.microsoft.com/v1.0/me/calendars/"
            f"{quote(str(calendar_id), safe='')}/events"
        )

    def upsert_event(self, token, calendar_id, event, binding=None):
        payload = self.build_event_payload(event)
        headers = {"Authorization": f"Bearer {token['access_token']}"}
        if binding:
            remote_id = str(binding.get("remoteEventId") or "").strip()
            if not remote_id:
                raise CalendarProviderError("CALENDAR_BINDING_INVALID")
            url = f"https://graph.microsoft.com/v1.0/me/events/{quote(remote_id, safe='')}"
            if binding.get("remoteEtag"):
                headers["If-Match"] = str(binding["remoteEtag"])
            method = "PATCH"
            payload.pop("transactionId", None)
        else:
            remote_id = ""
            url = self._collection_url(calendar_id)
            method = "POST"
        response = self.http.request(
            method, url, headers=headers, json_body=payload
        )
        if binding and int(response.get("status", 0)) == 412:
            current_response = self.http.request(
                "GET", url,
                headers={"Authorization": headers["Authorization"]},
            )
            current = require_success(
                current_response, operation="EVENT_ETAG_REFRESH"
            )
            current_etag = str(
                current.get("@odata.etag")
                or current_response.get("headers", {}).get("ETag")
                or ""
            ).strip()
            if not current_etag:
                raise CalendarProviderError("CALENDAR_PROVIDER_ETAG_MISSING")
            response = self.http.request(
                "PATCH",
                url,
                headers={
                    "Authorization": headers["Authorization"],
                    "If-Match": current_etag,
                },
                json_body=payload,
            )
        result = require_success(response, operation="EVENT_UPSERT")
        remote_id = str(result.get("id") or remote_id).strip()
        if not remote_id:
            raise CalendarProviderError("CALENDAR_PROVIDER_RESPONSE_INVALID")
        return ProviderEventResult(
            remote_event_id=remote_id,
            etag=str(result.get("@odata.etag") or "").strip() or None,
        )

    def cancel_event(self, token, _calendar_id, binding):
        event_id = str((binding or {}).get("remoteEventId") or "").strip()
        if not event_id:
            raise CalendarProviderError("CALENDAR_BINDING_INVALID")
        response = self.http.request(
            "DELETE",
            f"https://graph.microsoft.com/v1.0/me/events/{quote(event_id, safe='')}",
            headers={"Authorization": f"Bearer {token['access_token']}"},
        )
        if int(response.get("status", 0)) not in {204, 404, 410}:
            require_success(response, operation="EVENT_CANCEL")
        return ProviderEventResult(remote_event_id=event_id, cancelled=True)

    @staticmethod
    def _graph_utc(value):
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
            raise ValueError("Timed calendar events must be UTC-aware.")
        return parsed.astimezone(timezone.utc).replace(tzinfo=None).isoformat(
            timespec="seconds"
        )
