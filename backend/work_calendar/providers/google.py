"""Google Calendar OAuth and event adapter."""

import base64
import hashlib
from datetime import datetime, timezone
from urllib.parse import quote

from .base import CalendarProviderError, ProviderEventResult, require_success


class GoogleCalendarProvider:
    provider = "GOOGLE"
    token_url = "https://oauth2.googleapis.com/token"

    def __init__(self, environ, http_client):
        self.environ = environ
        self.http = http_client

    def exchange_code(self, *, code, verifier, redirect_uri):
        response = self.http.request(
            "POST",
            self.token_url,
            form={
                "client_id": self.environ["WORK_CALENDAR_GOOGLE_CLIENT_ID"],
                "client_secret": self.environ["WORK_CALENDAR_GOOGLE_CLIENT_SECRET"],
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        return require_success(response, operation="TOKEN_EXCHANGE")

    def refresh_token(self, token):
        response = self.http.request(
            "POST",
            self.token_url,
            form={
                "client_id": self.environ["WORK_CALENDAR_GOOGLE_CLIENT_ID"],
                "client_secret": self.environ["WORK_CALENDAR_GOOGLE_CLIENT_SECRET"],
                "refresh_token": token["refresh_token"],
                "grant_type": "refresh_token",
            },
        )
        return require_success(response, operation="TOKEN_REFRESH")

    def revoke_token(self, token):
        value = str(token.get("refresh_token") or token.get("access_token") or "")
        response = self.http.request(
            "POST",
            "https://oauth2.googleapis.com/revoke",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            form={"token": value},
        )
        if int(response.get("status", 0)) not in {200, 204, 400}:
            require_success(response, operation="TOKEN_REVOKE")
        return True

    @staticmethod
    def provider_event_id(uid):
        digest = hashlib.sha256(str(uid).encode("utf-8")).digest()
        return base64.b32hexencode(digest).decode("ascii").lower().rstrip("=")

    def build_event_payload(self, event):
        value_type = str(event.get("valueType") or "")
        if value_type == "DATE":
            start = {"date": str(event["start"])}
            end = {"date": str(event["end"])}
        elif value_type == "DATE_TIME":
            start = {"dateTime": self._rfc3339_utc(event["start"])}
            end = {"dateTime": self._rfc3339_utc(event["end"])}
        else:
            raise ValueError("Calendar event valueType must be DATE or DATE_TIME.")
        status = str(event.get("status") or "").strip().casefold()
        if status not in {"confirmed", "tentative", "cancelled"}:
            raise ValueError("Calendar event status is invalid.")
        return {
            "id": self.provider_event_id(event["uid"]),
            "summary": str(event.get("summary") or ""),
            "description": str(event.get("description") or ""),
            "location": str(event.get("location") or ""),
            "start": start,
            "end": end,
            "status": status,
        }

    def upsert_event(self, token, calendar_id, event, binding=None):
        payload = self.build_event_payload(event)
        event_id = (
            str((binding or {}).get("remoteEventId") or "").strip()
            or payload["id"]
        )
        root = (
            "https://www.googleapis.com/calendar/v3/calendars/"
            f"{quote(str(calendar_id), safe='')}/events"
        )
        headers = {"Authorization": f"Bearer {token['access_token']}"}
        if binding:
            method, url = "PUT", f"{root}/{quote(event_id, safe='')}"
            if (binding or {}).get("remoteEtag"):
                headers["If-Match"] = str(binding["remoteEtag"])
        else:
            method, url = "POST", root
        response = self.http.request(
            method, url, headers=headers, json_body=payload
        )
        if not binding and int(response.get("status", 0)) == 409:
            response = self.http.request(
                "PUT",
                f"{root}/{quote(event_id, safe='')}",
                headers=headers,
                json_body=payload,
            )
        elif binding and int(response.get("status", 0)) == 412:
            current_response = self.http.request(
                "GET", url,
                headers={"Authorization": headers["Authorization"]},
            )
            current = require_success(
                current_response, operation="EVENT_ETAG_REFRESH"
            )
            current_etag = str(
                current.get("etag")
                or current_response.get("headers", {}).get("ETag")
                or ""
            ).strip()
            if not current_etag:
                raise CalendarProviderError("CALENDAR_PROVIDER_ETAG_MISSING")
            retry_headers = {
                "Authorization": headers["Authorization"],
                "If-Match": current_etag,
            }
            response = self.http.request(
                "PUT", url, headers=retry_headers, json_body=payload
            )
        result = require_success(response, operation="EVENT_UPSERT")
        remote_id = str(result.get("id") or event_id).strip()
        if not remote_id:
            raise CalendarProviderError("CALENDAR_PROVIDER_RESPONSE_INVALID")
        return ProviderEventResult(
            remote_event_id=remote_id,
            etag=str(result.get("etag") or "").strip() or None,
        )

    def cancel_event(self, token, calendar_id, binding):
        event_id = str((binding or {}).get("remoteEventId") or "").strip()
        if not event_id:
            raise CalendarProviderError("CALENDAR_BINDING_INVALID")
        url = (
            "https://www.googleapis.com/calendar/v3/calendars/"
            f"{quote(str(calendar_id), safe='')}/events/{quote(event_id, safe='')}"
        )
        response = self.http.request(
            "DELETE", url,
            headers={"Authorization": f"Bearer {token['access_token']}"},
        )
        if int(response.get("status", 0)) not in {204, 404, 410}:
            require_success(response, operation="EVENT_CANCEL")
        return ProviderEventResult(remote_event_id=event_id, cancelled=True)

    @staticmethod
    def _rfc3339_utc(value):
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
            raise ValueError("Timed calendar events must be UTC-aware.")
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
