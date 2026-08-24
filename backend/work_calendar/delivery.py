"""Durable, one-way manual calendar delivery with fresh source authorization."""

from __future__ import annotations

import asyncio
import json
import os
import time

from backend.auth.auth_helper import SessionRole
from backend.db.id_utils import generate_record_id
from backend.shared.access_policy import can_read_record
from backend.shared.async_io import BlockingIOBusyError, run_blocking_io
from backend.shared.idle_backoff import idle_poll_backoff_from_env
from backend.shared.logging_utils import log_audit, log_error
from backend.procurement_cases.repository import ProcurementCaseRepository

from .connections import CalendarConnectionError, TokenVault
from .providers import (
    CalendarHttpClient,
    CalendarProviderError,
    GoogleCalendarProvider,
    MicrosoftCalendarProvider,
)
from .service import WorkCalendar, WorkCalendarError


MAX_DELIVERY_ATTEMPTS = 5


class CalendarDeliveryError(ValueError):
    def __init__(self, code, *, status_code=400):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def calendar_delivery_worker_enabled(environ=None):
    environment = os.environ if environ is None else environ
    if str(environment.get(
        "WORK_CALENDAR_CONNECTORS_ENABLED", "false"
    )).strip().casefold() != "true":
        return False
    return any(
        str(environment.get(
            f"WORK_CALENDAR_{provider}_ENABLED", "false"
        )).strip().casefold() == "true"
        for provider in ("GOOGLE", "MICROSOFT")
    )


def _source_package_id(cursor, organization_id, source_type, source_id):
    if source_type == "PACKAGE_TIMELINE":
        return source_id
    if source_type == "CASE_DEADLINE":
        case = ProcurementCaseRepository(cursor).get_case(organization_id, source_id)
        return case["currentPackageVersionId"] if case else ""
    return ""


def authorize_calendar_source(cursor, role, organization_id, source_type, source_id):
    package_id = _source_package_id(
        cursor, organization_id, str(source_type), str(source_id)
    )
    return bool(package_id) and can_read_record(
        cursor,
        role,
        role.user_id,
        organization_id,
        "goithau",
        "goi_thau",
        package_id,
    )


class CalendarDeliveryService:
    def __init__(self, environ=None, *, clock=None, http_client=None):
        self.environ = os.environ if environ is None else environ
        self.clock = time.time if clock is None else clock
        self.vault = TokenVault(self.environ)
        self.http = CalendarHttpClient() if http_client is None else http_client

    def enqueue(self, cursor, *, organization_id, user_id, role,
                connection_id, source_items):
        connection = cursor.execute(
            """SELECT id, status, provider FROM calendar_connection
                WHERE organization_id = ? AND id = ? AND user_id = ? FOR UPDATE""",
            (organization_id, connection_id, user_id),
        ).fetchone()
        if connection is None:
            raise CalendarDeliveryError("CALENDAR_CONNECTION_NOT_FOUND", status_code=404)
        if str(connection[1]) != "ACTIVE":
            raise CalendarDeliveryError("CALENDAR_CONNECTION_NOT_ACTIVE", status_code=409)
        if (
            str(self.environ.get(
                "WORK_CALENDAR_CONNECTORS_ENABLED", ""
            )).strip().casefold() == "true"
            and str(self.environ.get(
                f"WORK_CALENDAR_{str(connection[2]).upper()}_ENABLED", "false"
            )).strip().casefold() != "true"
        ):
            raise CalendarDeliveryError("CALENDAR_PROVIDER_DISABLED", status_code=404)
        if not isinstance(source_items, list) or not source_items:
            raise CalendarDeliveryError("WORK_CALENDAR_SELECTION_REQUIRED")
        for source in source_items:
            if not isinstance(source, dict) or set(source) != {"sourceType", "sourceId"}:
                raise CalendarDeliveryError("WORK_CALENDAR_SOURCE_INVALID")
            if not authorize_calendar_source(
                cursor, role, organization_id,
                source["sourceType"], source["sourceId"],
            ):
                raise CalendarDeliveryError(
                    "WORK_CALENDAR_SELECTION_DENIED", status_code=403
                )
        try:
            events = WorkCalendar(cursor).project(organization_id, source_items)
        except WorkCalendarError as exc:
            raise CalendarDeliveryError(exc.code, status_code=exc.status_code) from exc
        now = int(self.clock())
        queued = 0
        for event in events:
            payload = WorkCalendar.preview([event])[0]
            payload["status"] = event["event"].status
            action = "CANCEL" if payload["status"] == "CANCELLED" else "UPSERT"
            inserted = cursor.execute(
                """INSERT INTO calendar_delivery_outbox
                     (organization_id, id, connection_id, event_head_id,
                      action, event_sequence, payload_hash, payload_json,
                      status, available_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
                   ON CONFLICT (organization_id, connection_id, event_head_id,
                                action, event_sequence, payload_hash) DO NOTHING""",
                (
                    organization_id,
                    generate_record_id("calendar-delivery"),
                    connection_id,
                    event["eventHeadId"],
                    action,
                    int(event["sequence"]),
                    event["significantPayloadHash"],
                    json.dumps(
                        payload, ensure_ascii=False, sort_keys=True,
                        separators=(",", ":"),
                    ),
                    now,
                    now,
                    now,
                ),
            )
            queued += max(0, int(inserted.rowcount or 0))
        return {"connectionId": connection_id, "queuedCount": queued}

    def list_deliveries(self, cursor, *, organization_id, user_id,
                        connection_id=None):
        selected_connection = str(connection_id or "").strip()
        rows = cursor.execute(
            """SELECT delivery.id, delivery.connection_id,
                       connection.provider, delivery.action, delivery.status,
                       delivery.attempt_count, delivery.last_error_code,
                       delivery.event_sequence, delivery.created_at,
                       delivery.updated_at
                  FROM calendar_delivery_outbox AS delivery
                  JOIN calendar_connection AS connection
                    ON connection.organization_id = delivery.organization_id
                   AND connection.id = delivery.connection_id
                 WHERE delivery.organization_id = ? AND connection.user_id = ?
                   AND (? = '' OR delivery.connection_id = ?)
                 ORDER BY delivery.updated_at DESC, delivery.id DESC
                 LIMIT 100""",
            (
                organization_id, user_id,
                selected_connection, selected_connection,
            ),
        ).fetchall()
        return [self._public_delivery(row) for row in rows]

    def retry(self, cursor, *, organization_id, user_id, role, delivery_id):
        row = cursor.execute(
            """SELECT delivery.connection_id, delivery.status,
                      connection.status, connection.provider,
                      head.source_type, head.source_id
                 FROM calendar_delivery_outbox AS delivery
                 JOIN calendar_connection AS connection
                   ON connection.organization_id = delivery.organization_id
                  AND connection.id = delivery.connection_id
                 JOIN calendar_event_head AS head
                   ON head.organization_id = delivery.organization_id
                  AND head.id = delivery.event_head_id
                WHERE delivery.organization_id = ? AND delivery.id = ?
                  AND connection.user_id = ? FOR UPDATE OF delivery, connection""",
            (organization_id, delivery_id, user_id),
        ).fetchone()
        if row is None:
            raise CalendarDeliveryError("CALENDAR_DELIVERY_NOT_FOUND", status_code=404)
        if str(row[1]) != "FAILED":
            raise CalendarDeliveryError("CALENDAR_DELIVERY_RETRY_INVALID", status_code=409)
        if str(row[2]) != "ACTIVE":
            raise CalendarDeliveryError("CALENDAR_CONNECTION_NOT_ACTIVE", status_code=409)
        if not authorize_calendar_source(
            cursor, role, organization_id, row[4], row[5]
        ):
            raise CalendarDeliveryError(
                "WORK_CALENDAR_SELECTION_DENIED", status_code=403
            )
        now = int(self.clock())
        cursor.execute(
            """UPDATE calendar_delivery_outbox
                  SET status = 'RETRY', attempt_count = 0, available_at = ?,
                      locked_at = NULL, last_error_code = NULL, updated_at = ?
                WHERE organization_id = ? AND id = ?""",
            (now, now, organization_id, delivery_id),
        )
        public = cursor.execute(
            """SELECT delivery.id, delivery.connection_id,
                      connection.provider, delivery.action, delivery.status,
                      delivery.attempt_count, delivery.last_error_code,
                      delivery.event_sequence, delivery.created_at,
                      delivery.updated_at
                 FROM calendar_delivery_outbox AS delivery
                 JOIN calendar_connection AS connection
                   ON connection.organization_id = delivery.organization_id
                  AND connection.id = delivery.connection_id
                WHERE delivery.organization_id = ? AND delivery.id = ?""",
            (organization_id, delivery_id),
        ).fetchone()
        return self._public_delivery(public)

    @staticmethod
    def _public_delivery(row):
        return {
            "id": row[0],
            "connectionId": row[1],
            "provider": row[2],
            "action": row[3],
            "status": row[4],
            "attemptCount": int(row[5]),
            "lastErrorCode": row[6],
            "eventSequence": int(row[7]),
            "createdAt": int(row[8]),
            "updatedAt": int(row[9]),
        }

    def process_next(self, cursor, *, enabled_providers=None):
        now = int(self.clock())
        if enabled_providers is None:
            allow_all, google_enabled, microsoft_enabled = 1, 0, 0
        else:
            providers = {str(value).upper() for value in enabled_providers}
            if not providers:
                return False
            allow_all = 0
            google_enabled = int("GOOGLE" in providers)
            microsoft_enabled = int("MICROSOFT" in providers)
        row = cursor.execute(
            """SELECT delivery.organization_id, delivery.id,
                      delivery.connection_id, delivery.event_head_id,
                      delivery.action, delivery.event_sequence,
                      delivery.payload_hash, delivery.payload_json,
                      delivery.attempt_count,
                      connection.user_id, connection.provider,
                      connection.calendar_id, connection.active_role,
                      connection.token_ciphertext, connection.token_expires_at,
                      connection.status,
                      head.source_type, head.source_id
                 FROM calendar_delivery_outbox AS delivery
                 JOIN calendar_connection AS connection
                   ON connection.organization_id = delivery.organization_id
                  AND connection.id = delivery.connection_id
                 JOIN calendar_event_head AS head
                   ON head.organization_id = delivery.organization_id
                  AND head.id = delivery.event_head_id
                WHERE delivery.status IN ('PENDING', 'RETRY')
                  AND delivery.available_at <= ?
                  AND (
                    ? = 1
                    OR (? = 1 AND connection.provider = 'GOOGLE')
                    OR (? = 1 AND connection.provider = 'MICROSOFT')
                  )
                ORDER BY delivery.created_at, delivery.id
                LIMIT 1 FOR UPDATE OF delivery SKIP LOCKED""",
            (now, allow_all, google_enabled, microsoft_enabled),
        ).fetchone()
        if row is None:
            return False
        organization_id, delivery_id = str(row[0]), str(row[1])
        attempt = int(row[8]) + 1
        cursor.execute(
            """UPDATE calendar_delivery_outbox
                  SET status = 'PROCESSING', attempt_count = ?, locked_at = ?,
                      updated_at = ?
                WHERE organization_id = ? AND id = ?""",
            (attempt, now, now, organization_id, delivery_id),
        )
        if str(row[15]) != "ACTIVE":
            self._fail(cursor, organization_id, delivery_id, "CONSENT_REVOKED", now)
            return True
        role = self._fresh_role(
            cursor, organization_id, str(row[9]), str(row[12] or "")
        )
        if role is None or not authorize_calendar_source(
            cursor, role, organization_id, row[16], row[17]
        ):
            self._fail(
                cursor, organization_id, delivery_id,
                "SOURCE_ACCESS_REVOKED", now,
            )
            return True
        try:
            token = self.vault.decrypt_json(row[13])
            provider = self._provider(str(row[10]))
            if int(token.get("expires_at") or row[14] or 0) <= now + 60:
                refreshed = provider.refresh_token(token)
                access_token = str(refreshed.get("access_token") or "").strip()
                if not access_token:
                    raise CalendarConnectionError("CALENDAR_OAUTH_TOKEN_INVALID")
                try:
                    expires_at = now + max(
                        1, min(86400, int(refreshed.get("expires_in") or 3600))
                    )
                except (TypeError, ValueError) as exc:
                    raise CalendarConnectionError(
                        "CALENDAR_OAUTH_TOKEN_INVALID"
                    ) from exc
                refreshed_scopes = str(refreshed.get("scope") or "").split()
                token = {
                    **token,
                    "access_token": access_token,
                    "refresh_token": str(
                        refreshed.get("refresh_token")
                        or token.get("refresh_token")
                        or ""
                    ),
                    "token_type": str(
                        refreshed.get("token_type") or token.get("token_type") or "Bearer"
                    ),
                    "expires_at": expires_at,
                    "scope": sorted(set(refreshed_scopes or token.get("scope") or [])),
                }
                if not token["refresh_token"]:
                    raise CalendarConnectionError(
                        "CALENDAR_OAUTH_REFRESH_TOKEN_REQUIRED"
                    )
                cursor.execute(
                    """UPDATE calendar_connection
                          SET token_ciphertext = ?, token_expires_at = ?,
                              row_version = row_version + 1,
                              updated_at = CURRENT_TIMESTAMP
                        WHERE organization_id = ? AND id = ? AND status = 'ACTIVE'""",
                    (
                        self.vault.encrypt_json(token),
                        expires_at,
                        organization_id,
                        row[2],
                    ),
                )
            binding_row = cursor.execute(
                """SELECT id, remote_event_id, remote_etag,
                          last_delivered_sequence, last_delivered_hash, status
                     FROM calendar_event_binding
                    WHERE organization_id = ? AND connection_id = ?
                      AND event_head_id = ? FOR UPDATE""",
                (organization_id, row[2], row[3]),
            ).fetchone()
            binding = None if binding_row is None else {
                "id": binding_row[0],
                "remoteEventId": binding_row[1],
                "remoteEtag": binding_row[2],
                "lastDeliveredSequence": int(binding_row[3]),
                "lastDeliveredHash": binding_row[4],
                "status": binding_row[5],
            }
            if binding and (
                binding["lastDeliveredSequence"] > int(row[5])
                or (
                    binding["lastDeliveredSequence"] == int(row[5])
                    and binding["lastDeliveredHash"] == str(row[6])
                )
            ):
                self._deliver(cursor, organization_id, delivery_id, now)
                return True
            payload = json.loads(row[7])
            if str(row[4]) == "CANCEL":
                if binding is None:
                    self._deliver(cursor, organization_id, delivery_id, now)
                    return True
                result = provider.cancel_event(token, str(row[11]), binding)
            else:
                result = provider.upsert_event(
                    token, str(row[11]), payload, binding=binding
                )
            self._save_binding(
                cursor,
                organization_id=organization_id,
                connection_id=str(row[2]),
                event_head_id=str(row[3]),
                result=result,
                sequence=int(row[5]),
                payload_hash=str(row[6]),
                action=str(row[4]),
            )
            self._deliver(cursor, organization_id, delivery_id, now)
            log_audit(
                "work_calendar.delivery_delivered",
                actor_user_id=row[9],
                organization_id=organization_id,
                target_type="calendar_connection",
                target_id=row[2],
                metadata={
                    "provider": row[10],
                    "action": row[4],
                    "eventHeadId": row[3],
                    "eventSequence": int(row[5]),
                },
                cursor=cursor,
                required=True,
            )
        except CalendarProviderError as exc:
            if exc.reauth_required:
                cursor.execute(
                    """UPDATE calendar_connection
                          SET status = 'REAUTH_REQUIRED', row_version = row_version + 1,
                              updated_at = CURRENT_TIMESTAMP
                        WHERE organization_id = ? AND id = ?""",
                    (organization_id, row[2]),
                )
                self._fail(cursor, organization_id, delivery_id, "REAUTH_REQUIRED", now)
            elif exc.retryable and attempt < MAX_DELIVERY_ATTEMPTS:
                cursor.execute(
                    """UPDATE calendar_delivery_outbox
                          SET status = 'RETRY', available_at = ?, locked_at = NULL,
                              last_error_code = ?, updated_at = ?
                        WHERE organization_id = ? AND id = ?""",
                    (
                        now + min(300, 2 ** max(0, attempt - 1)),
                        exc.code,
                        now,
                        organization_id,
                        delivery_id,
                    ),
                )
            else:
                self._fail(cursor, organization_id, delivery_id, exc.code, now)
        except (CalendarConnectionError, json.JSONDecodeError, KeyError, TypeError, ValueError):
            self._fail(
                cursor, organization_id, delivery_id,
                "CALENDAR_DELIVERY_PAYLOAD_INVALID", now,
            )
        return True

    def _provider(self, provider):
        if provider == "GOOGLE":
            return GoogleCalendarProvider(self.environ, self.http)
        if provider == "MICROSOFT":
            return MicrosoftCalendarProvider(self.environ, self.http)
        raise CalendarDeliveryError("CALENDAR_PROVIDER_UNSUPPORTED")

    @staticmethod
    def _fresh_role(cursor, organization_id, user_id, requested_active_role):
        account = cursor.execute(
            "SELECT trang_thai, vai_tro FROM tai_khoan WHERE id = ?",
            (user_id,),
        ).fetchone()
        if account is None or str(account[0] or "").strip().casefold() != "active":
            return None
        membership = cursor.execute(
            """SELECT membership.vai_tro_trong_to_chuc,
                      membership.trang_thai_thanh_vien, organization.trang_thai
                 FROM thanh_vien_to_chuc AS membership
                 JOIN to_chuc AS organization
                   ON organization.id = membership.organization_id
                WHERE membership.user_id = ? AND membership.organization_id = ?""",
            (user_id, organization_id),
        ).fetchone()
        if (
            membership is None
            or str(membership[1] or "").casefold() != "active"
            or str(membership[2] or "").casefold() != "active"
        ):
            return None
        platform_role = str(account[1] or "user").strip().casefold()
        membership_role = str(membership[0] or "employee").strip().casefold()
        active_role = str(requested_active_role or "").strip().casefold()
        if active_role == "super_admin" and platform_role != "super_admin":
            return None
        if active_role == "manager" and (
            platform_role != "super_admin" and membership_role != "manager"
        ):
            return None
        if active_role not in {"super_admin", "manager", "employee"}:
            active_role = membership_role
        return SessionRole(
            active_role,
            user_id,
            platform_role=platform_role,
            active_role=active_role,
            active_role_organization_id=organization_id,
        )

    @staticmethod
    def _save_binding(cursor, *, organization_id, connection_id,
                      event_head_id, result, sequence, payload_hash, action):
        cursor.execute(
            """INSERT INTO calendar_event_binding
                 (organization_id, id, connection_id, event_head_id,
                  remote_event_id, remote_etag, last_delivered_sequence,
                  last_delivered_hash, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (organization_id, connection_id, event_head_id)
               DO UPDATE SET remote_event_id = excluded.remote_event_id,
                             remote_etag = excluded.remote_etag,
                             last_delivered_sequence = excluded.last_delivered_sequence,
                             last_delivered_hash = excluded.last_delivered_hash,
                             status = excluded.status,
                             updated_at = CURRENT_TIMESTAMP""",
            (
                organization_id,
                generate_record_id("calendar-binding"),
                connection_id,
                event_head_id,
                result.remote_event_id,
                result.etag,
                sequence,
                payload_hash,
                "CANCELLED" if action == "CANCEL" else "ACTIVE",
            ),
        )

    @staticmethod
    def _deliver(cursor, organization_id, delivery_id, now):
        cursor.execute(
            """UPDATE calendar_delivery_outbox
                  SET status = 'DELIVERED', locked_at = NULL,
                      last_error_code = NULL, updated_at = ?
                WHERE organization_id = ? AND id = ?""",
            (now, organization_id, delivery_id),
        )

    @staticmethod
    def _fail(cursor, organization_id, delivery_id, code, now):
        cursor.execute(
            """UPDATE calendar_delivery_outbox
                  SET status = 'FAILED', locked_at = NULL,
                      last_error_code = ?, updated_at = ?
                WHERE organization_id = ? AND id = ?""",
            (str(code)[:80], now, organization_id, delivery_id),
        )


def process_next_calendar_delivery(database):
    if not calendar_delivery_worker_enabled():
        return False
    enabled_providers = {
        provider
        for provider in ("GOOGLE", "MICROSOFT")
        if str(os.environ.get(
            f"WORK_CALENDAR_{provider}_ENABLED", "false"
        )).strip().casefold() == "true"
    }
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        processed = CalendarDeliveryService().process_next(
            connection.cursor(), enabled_providers=enabled_providers
        )
        connection.commit()
        return processed
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


async def run_calendar_delivery_worker(database):
    backoff = idle_poll_backoff_from_env(
        "WORK_CALENDAR_DELIVERY_POLL_SECONDS",
        "WORK_CALENDAR_DELIVERY_MAX_POLL_SECONDS",
        default_initial=2.0,
    )
    while True:
        try:
            processed = await run_blocking_io(
                process_next_calendar_delivery,
                database,
                timeout_seconds=30.0,
            )
        except BlockingIOBusyError:
            processed = False
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log_error(exc, "work_calendar_delivery_worker", level="WARN")
            processed = False
        if processed:
            backoff.reset()
        await asyncio.sleep(0.05 if processed else backoff.next_delay())
