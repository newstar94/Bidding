import base64
import hashlib
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import uuid

from cryptography.fernet import Fernet
import psycopg
import pytest

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.auth.auth_helper import SessionRole
from backend.work_calendar.connections import (
    CalendarConnectionError,
    CalendarConnectionService,
    TokenVault,
)
from backend.work_calendar.delivery import CalendarDeliveryService
from backend.work_calendar.providers.google import GoogleCalendarProvider
from backend.work_calendar.providers.microsoft import MicrosoftCalendarProvider


class RecordingHttpClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def request(self, method, url, *, headers=None, form=None, json_body=None):
        self.requests.append({
            "method": method,
            "url": url,
            "headers": dict(headers or {}),
            "form": dict(form or {}),
            "json": json_body,
        })
        return self.responses.pop(0)


def _database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    path = Path(__file__).resolve().parents[1] / ".env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == "TEST_DATABASE_URL":
                return value.strip().strip('"').strip("'")
    return ""


@pytest.fixture
def calendar_database():
    url = _database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    connection = psycopg.connect(url, connect_timeout=5, row_factory=compat_row_factory)
    cursor = PostgresCursor(connection.cursor())
    token = uuid.uuid4().hex
    values = {
        "user": f"calendar-user-{token}",
        "org": f"calendar-org-{token}",
        "investor": f"calendar-investor-{token}",
        "plan": f"calendar-plan-{token}",
        "package": f"calendar-package-{token}",
        "case": f"calendar-case-{token}",
    }
    cursor.execute(
        """INSERT INTO tai_khoan
             (id, ten_dang_nhap, username_norm, mat_khau, ho_ten, email,
              email_norm, vai_tro, da_xac_minh)
           VALUES (?, ?, ?, 'hash', 'Calendar User', ?, ?, 'user', 1)""",
        (values["user"], f"calendar-{token}", f"calendar-{token}",
         f"calendar-{token}@example.test", f"calendar-{token}@example.test"),
    )
    cursor.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, 'Calendar Org')",
        (values["org"],),
    )
    cursor.execute(
        """INSERT INTO thanh_vien_to_chuc
             (user_id, organization_id, vai_tro_trong_to_chuc)
           VALUES (?, ?, 'manager')""",
        (values["user"], values["org"]),
    )
    cursor.execute(
        """INSERT INTO chu_dau_tu
             (id, organization_id, id_goc, ma_chu_dau_tu, ma_so_thue, ten_chu_dau_tu)
           VALUES (?, ?, ?, 'CDT-CALENDAR', 'MST-CALENDAR', 'Chủ đầu tư lịch')""",
        (values["investor"], values["org"], values["investor"]),
    )
    cursor.execute(
        """INSERT INTO ke_hoach_lcnt
             (id, organization_id, id_goc, ma_ke_hoach, ten_ke_hoach,
              ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
              ngay_phe_duyet, quyet_dinh_phe_duyet)
           VALUES (?, ?, ?, 'KH-CALENDAR', 'Kế hoạch lịch', 'Dự án lịch',
                   'Mua sắm hàng hóa', ?, '2026-08-01', 'QD-CALENDAR')""",
        (values["plan"], values["org"], values["plan"], values["investor"]),
    )
    cursor.execute(
        """INSERT INTO goi_thau
             (id, organization_id, id_goc, ma_goi_thau, ke_hoach_id,
              ten_goi_thau, gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
              thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc)
           VALUES (?, ?, ?, 'GT-CALENDAR', ?, 'Gói thầu lịch', 1000000,
                   '30 ngày', 'Ngân sách', '30 ngày', '2026-08-01')""",
        (values["package"], values["org"], values["package"], values["plan"]),
    )
    cursor.execute(
        """INSERT INTO procurement_case
             (id, organization_id, case_no, case_type, direction, subject,
              state, policy_version, due_at, due_provenance, created_by_id)
           VALUES (?, ?, ?, 'CLARIFICATION', 'INBOUND', 'Làm rõ lịch',
                   'DRAFT', 'CLARIFICATION_V1', '2026-09-15', 'MANUAL', ?)""",
        (values["case"], values["org"], f"LR-{token}", values["user"]),
    )
    cursor.execute(
        """INSERT INTO procurement_case_package_target
             (id, organization_id, case_id, package_lineage_root_id,
              current_package_version_id)
           VALUES (?, ?, ?, ?, ?)""",
        (f"target-{token}", values["org"], values["case"],
         values["package"], values["package"]),
    )
    try:
        yield cursor, values
    finally:
        connection.rollback()
        connection.close()


def _connector_environment():
    return {
        "WORK_CALENDAR_TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
        "WORK_CALENDAR_GOOGLE_CLIENT_ID": "calendar-client",
        "WORK_CALENDAR_GOOGLE_CLIENT_SECRET": "calendar-secret",
        "WORK_CALENDAR_GOOGLE_REDIRECT_URI": (
            "https://app.example.test/api/work-calendar/connections/google/callback"
        ),
    }


def test_google_connect_start_persists_hashed_state_and_encrypted_pkce(calendar_database):
    cursor, values = calendar_database
    environment = _connector_environment()
    service = CalendarConnectionService(environment, clock=lambda: 1_800_000_000)

    started = service.start(
        cursor,
        organization_id=values["org"],
        user_id=values["user"],
        active_role="employee",
        provider="GOOGLE",
        calendar_id="primary",
    )

    query = parse_qs(urlparse(started["authorizationUrl"]).query)
    state = query["state"][0]
    row = cursor.execute(
        """SELECT state_hash, code_verifier_ciphertext, redirect_uri, calendar_id
             FROM calendar_oauth_state WHERE state_hash = ?""",
        (hashlib.sha256(state.encode("utf-8")).hexdigest(),),
    ).fetchone()
    assert row is not None
    assert row[0] != state
    assert state not in row[1]
    verifier = TokenVault(environment).decrypt_text(row[1])
    expected_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    assert query["code_challenge"] == [expected_challenge]
    assert query["code_challenge_method"] == ["S256"]
    assert query["scope"] == ["https://www.googleapis.com/auth/calendar.events"]
    assert query["access_type"] == ["offline"]
    assert row[2] == environment["WORK_CALENDAR_GOOGLE_REDIRECT_URI"]
    assert row[3] == "primary"


def test_oauth_callback_rejects_account_mixup_replay_and_encrypts_tokens(calendar_database):
    cursor, values = calendar_database
    environment = _connector_environment()
    http = RecordingHttpClient([{
        "status": 200,
        "json": {
            "access_token": "access-token-plain",
            "refresh_token": "refresh-token-plain",
            "expires_in": 3600,
            "token_type": "Bearer",
            "scope": "https://www.googleapis.com/auth/calendar.events",
        },
        "headers": {},
    }])
    service = CalendarConnectionService(
        environment, clock=lambda: 1_800_000_000, http_client=http
    )
    started = service.start(
        cursor, organization_id=values["org"], user_id=values["user"],
        active_role="employee", provider="GOOGLE", calendar_id="primary",
    )
    state = parse_qs(urlparse(started["authorizationUrl"]).query)["state"][0]

    with pytest.raises(CalendarConnectionError, match="CALENDAR_OAUTH_ACCOUNT_MISMATCH"):
        service.complete(
            cursor, provider="GOOGLE", state=state, code="authorization-code",
            current_user_id="different-user",
        )
    connection = service.complete(
        cursor, provider="GOOGLE", state=state, code="authorization-code",
        current_user_id=values["user"],
    )

    assert set(connection) == {
        "id", "provider", "calendarId", "accountLabel", "status",
        "scopes", "outboundProfileVersion", "tokenExpiresAt", "consentedAt",
    }
    row = cursor.execute(
        "SELECT token_ciphertext FROM calendar_connection WHERE organization_id = ? AND id = ?",
        (values["org"], connection["id"]),
    ).fetchone()
    assert "access-token-plain" not in row[0]
    assert "refresh-token-plain" not in row[0]
    stored = TokenVault(environment).decrypt_json(row[0])
    assert stored["access_token"] == "access-token-plain"
    assert stored["refresh_token"] == "refresh-token-plain"
    assert http.requests[0]["form"]["code_verifier"]
    assert http.requests[0]["form"]["client_secret"] == "calendar-secret"
    with pytest.raises(CalendarConnectionError, match="CALENDAR_OAUTH_STATE_USED"):
        service.complete(
            cursor, provider="GOOGLE", state=state, code="authorization-code",
            current_user_id=values["user"],
        )


def test_provider_payloads_use_google_base32hex_id_and_microsoft_transaction_id():
    event = {
        "uid": "11111111-2222-3333-4444-555555555555@calendar.biddingflow.local",
        "sequence": 2,
        "significantPayloadHash": "a" * 64,
        "summary": "GT-01 · Đóng thầu",
        "description": "Kế hoạch A · Gói A · /goi-thau/pkg-1",
        "location": "",
        "start": "2026-09-01",
        "end": "2026-09-02",
        "valueType": "DATE",
        "timezone": None,
        "status": "CONFIRMED",
    }
    google = GoogleCalendarProvider({}, RecordingHttpClient([]))
    microsoft = MicrosoftCalendarProvider({}, RecordingHttpClient([]))

    google_payload = google.build_event_payload(event)
    assert google_payload == {
        "id": "77906mhiiavmt1omg5n1frf8iqpa2psqjtrsjho7hvkjj5r1tkig",
        "summary": "GT-01 · Đóng thầu",
        "description": "Kế hoạch A · Gói A · /goi-thau/pkg-1",
        "location": "",
        "start": {"date": "2026-09-01"},
        "end": {"date": "2026-09-02"},
        "status": "confirmed",
    }
    assert google_payload["id"] != event["uid"]
    assert set(google_payload["id"]) <= set("0123456789abcdefghijklmnopqrstuv")

    microsoft_payload = microsoft.build_event_payload(event)
    assert microsoft_payload == {
        "subject": "GT-01 · Đóng thầu",
        "body": {
            "contentType": "text",
            "content": "Kế hoạch A · Gói A · /goi-thau/pkg-1",
        },
        "location": {"displayName": ""},
        "start": {"dateTime": "2026-09-01T00:00:00", "timeZone": "UTC"},
        "end": {"dateTime": "2026-09-02T00:00:00", "timeZone": "UTC"},
        "isAllDay": True,
        "transactionId": "39d2035a3292bf6e8716816e17ede896b2a1679a9f77c9c7078fe9399761ed25",
        "showAs": "busy",
    }


def test_provider_upsert_is_retry_safe_and_uses_selected_calendar_endpoint():
    event = {
        "uid": "11111111-2222-3333-4444-555555555555@calendar.biddingflow.local",
        "sequence": 2,
        "significantPayloadHash": "a" * 64,
        "summary": "GT-01 · Đóng thầu",
        "description": "Kế hoạch A · Gói A · /goi-thau/pkg-1",
        "location": "",
        "start": "2026-09-01",
        "end": "2026-09-02",
        "valueType": "DATE",
        "timezone": None,
        "status": "CONFIRMED",
    }
    google_http = RecordingHttpClient([
        {"status": 409, "json": {"error": {"code": 409}}, "headers": {}},
        {"status": 200, "json": {"id": "remote-google", "etag": "etag-g"}, "headers": {}},
    ])
    google = GoogleCalendarProvider({}, google_http)
    google_result = google.upsert_event(
        {"access_token": "secret-access"}, "primary", event, binding=None
    )
    assert google_result.remote_event_id == "remote-google"
    assert [item["method"] for item in google_http.requests] == ["POST", "PUT"]
    expected_google_id = "77906mhiiavmt1omg5n1frf8iqpa2psqjtrsjho7hvkjj5r1tkig"
    assert google_http.requests[0]["url"].endswith("/calendars/primary/events")
    assert google_http.requests[1]["url"].endswith(f"/events/{expected_google_id}")

    microsoft_http = RecordingHttpClient([
        {"status": 201, "json": {"id": "remote-ms", "@odata.etag": "etag-ms"}, "headers": {}},
    ])
    microsoft = MicrosoftCalendarProvider({}, microsoft_http)
    microsoft_result = microsoft.upsert_event(
        {"access_token": "secret-access"}, "calendar/A", event, binding=None
    )
    assert microsoft_result.remote_event_id == "remote-ms"
    assert microsoft_http.requests[0]["url"].endswith(
        "/me/calendars/calendar%2FA/events"
    )
    assert microsoft_http.requests[0]["json"]["transactionId"] == (
        "39d2035a3292bf6e8716816e17ede896b2a1679a9f77c9c7078fe9399761ed25"
    )
    assert "secret-access" not in str(microsoft_http.requests[0]["json"])


def test_provider_update_recovers_etag_conflict_without_reading_remote_into_domain():
    event = {
        "uid": "11111111-2222-3333-4444-555555555555@calendar.biddingflow.local",
        "sequence": 3,
        "significantPayloadHash": "b" * 64,
        "summary": "GT-01 · Đóng thầu mới",
        "description": "Kế hoạch A · Gói A · /goi-thau/pkg-1",
        "location": "",
        "start": "2026-09-03",
        "end": "2026-09-04",
        "valueType": "DATE",
        "timezone": None,
        "status": "CONFIRMED",
    }
    http = RecordingHttpClient([
        {"status": 412, "json": {"error": {"code": 412}}, "headers": {}},
        {"status": 200, "json": {"id": "remote-1", "etag": "etag-current", "summary": "remote edit"}, "headers": {}},
        {"status": 200, "json": {"id": "remote-1", "etag": "etag-final"}, "headers": {}},
    ])
    provider = GoogleCalendarProvider({}, http)
    result = provider.upsert_event(
        {"access_token": "secret-access"}, "primary", event,
        binding={"remoteEventId": "remote-1", "remoteEtag": "etag-old"},
    )

    assert result.etag == "etag-final"
    assert [request["method"] for request in http.requests] == ["PUT", "GET", "PUT"]
    assert http.requests[2]["headers"]["If-Match"] == "etag-current"
    assert http.requests[2]["json"]["summary"] == event["summary"]
    assert "remote edit" not in str(http.requests[2]["json"])


def test_delivery_reauthorizes_source_immediately_before_send(calendar_database):
    cursor, values = calendar_database
    environment = _connector_environment()
    vault = TokenVault(environment)
    cursor.execute(
        """INSERT INTO calendar_connection
             (organization_id, id, user_id, provider, calendar_id,
              account_label, active_role, token_ciphertext, scopes_json,
              outbound_profile_version, status, token_expires_at, consented_at)
           VALUES (?, 'connection-1', ?, 'GOOGLE', 'primary', 'primary',
                   'manager', ?, ?, 'WORK_CALENDAR_OUTBOUND_V1', 'ACTIVE',
                   1800003600, 1800000000)""",
        (
            values["org"], values["user"],
            vault.encrypt_json({
                "access_token": "secret-access",
                "refresh_token": "secret-refresh",
                "expires_at": 1800003600,
                "scope": ["https://www.googleapis.com/auth/calendar.events"],
                "token_type": "Bearer",
            }),
            '["https://www.googleapis.com/auth/calendar.events"]',
        ),
    )
    role = SessionRole(
        "manager", values["user"], platform_role="user", active_role="manager",
        active_role_organization_id=values["org"],
    )
    delivery = CalendarDeliveryService(
        environment, clock=lambda: 1_800_000_000,
        http_client=RecordingHttpClient([]),
    )
    result = delivery.enqueue(
        cursor, organization_id=values["org"], user_id=values["user"], role=role,
        connection_id="connection-1",
        source_items=[{"sourceType": "CASE_DEADLINE", "sourceId": values["case"]}],
    )
    assert result["queuedCount"] > 0

    cursor.execute(
        """UPDATE thanh_vien_to_chuc SET trang_thai_thanh_vien = 'left'
            WHERE user_id = ? AND organization_id = ?""",
        (values["user"], values["org"]),
    )
    assert delivery.process_next(cursor) is True
    status = cursor.execute(
        """SELECT status, last_error_code FROM calendar_delivery_outbox
            WHERE organization_id = ? ORDER BY created_at LIMIT 1""",
        (values["org"],),
    ).fetchone()
    assert (status[0], status[1]) == ("FAILED", "SOURCE_ACCESS_REVOKED")
    assert delivery.http.requests == []


def test_delivery_retry_reuses_provider_identity_without_duplicate_binding(calendar_database):
    cursor, values = calendar_database
    environment = _connector_environment()
    vault = TokenVault(environment)
    cursor.execute(
        """INSERT INTO calendar_connection
             (organization_id, id, user_id, provider, calendar_id,
              account_label, active_role, token_ciphertext, scopes_json,
              outbound_profile_version, status, token_expires_at, consented_at)
           VALUES (?, 'connection-retry', ?, 'GOOGLE', 'primary', 'primary',
                   'manager', ?, ?, 'WORK_CALENDAR_OUTBOUND_V1', 'ACTIVE',
                   1800003600, 1800000000)""",
        (
            values["org"], values["user"],
            vault.encrypt_json({
                "access_token": "secret-access", "refresh_token": "secret-refresh",
                "expires_at": 1800003600,
                "scope": ["https://www.googleapis.com/auth/calendar.events"],
                "token_type": "Bearer",
            }),
            '["https://www.googleapis.com/auth/calendar.events"]',
        ),
    )
    role = SessionRole(
        "manager", values["user"], platform_role="user", active_role="manager",
        active_role_organization_id=values["org"],
    )
    now = [1_800_000_000]
    http = RecordingHttpClient([
        {"status": 503, "json": {"error": "busy"}, "headers": {}},
        {"status": 201, "json": {"id": "remote-event", "etag": "etag-1"}, "headers": {}},
    ])
    delivery = CalendarDeliveryService(
        environment, clock=lambda: now[0], http_client=http
    )
    delivery.enqueue(
        cursor, organization_id=values["org"], user_id=values["user"], role=role,
        connection_id="connection-retry",
        source_items=[{"sourceType": "CASE_DEADLINE", "sourceId": values["case"]}],
    )

    assert delivery.process_next(cursor) is True
    first = cursor.execute(
        "SELECT status, attempt_count FROM calendar_delivery_outbox WHERE connection_id = 'connection-retry'"
    ).fetchone()
    assert (first[0], first[1]) == ("RETRY", 1)
    now[0] += 2
    assert delivery.process_next(cursor) is True
    final = cursor.execute(
        "SELECT status, attempt_count FROM calendar_delivery_outbox WHERE connection_id = 'connection-retry'"
    ).fetchone()
    assert (final[0], final[1]) == ("DELIVERED", 2)
    assert [request["method"] for request in http.requests] == ["POST", "POST"]
    assert http.requests[0]["json"]["id"] == http.requests[1]["json"]["id"]
    assert cursor.execute(
        "SELECT COUNT(*) FROM calendar_event_binding WHERE connection_id = 'connection-retry'"
    ).fetchone()[0] == 1


def test_delivery_refreshes_expired_token_without_exposing_secret(calendar_database):
    cursor, values = calendar_database
    environment = _connector_environment()
    vault = TokenVault(environment)
    cursor.execute(
        """INSERT INTO calendar_connection
             (organization_id, id, user_id, provider, calendar_id,
              account_label, active_role, token_ciphertext, scopes_json,
              outbound_profile_version, status, token_expires_at, consented_at)
           VALUES (?, 'connection-refresh', ?, 'GOOGLE', 'primary', 'primary',
                   'manager', ?, ?, 'WORK_CALENDAR_OUTBOUND_V1', 'ACTIVE',
                   1800000000, 1799990000)""",
        (
            values["org"], values["user"],
            vault.encrypt_json({
                "access_token": "expired-access", "refresh_token": "secret-refresh",
                "expires_at": 1800000000,
                "scope": ["https://www.googleapis.com/auth/calendar.events"],
                "token_type": "Bearer",
            }),
            '["https://www.googleapis.com/auth/calendar.events"]',
        ),
    )
    role = SessionRole(
        "manager", values["user"], platform_role="user", active_role="manager",
        active_role_organization_id=values["org"],
    )
    http = RecordingHttpClient([
        {"status": 200, "json": {
            "access_token": "fresh-access", "expires_in": 3600,
            "token_type": "Bearer",
            "scope": "https://www.googleapis.com/auth/calendar.events",
        }, "headers": {}},
        {"status": 201, "json": {"id": "remote-refreshed", "etag": "etag-r"}, "headers": {}},
    ])
    delivery = CalendarDeliveryService(
        environment, clock=lambda: 1_800_000_000, http_client=http
    )
    delivery.enqueue(
        cursor, organization_id=values["org"], user_id=values["user"], role=role,
        connection_id="connection-refresh",
        source_items=[{"sourceType": "CASE_DEADLINE", "sourceId": values["case"]}],
    )
    assert delivery.process_next(cursor) is True

    assert http.requests[0]["url"] == "https://oauth2.googleapis.com/token"
    assert http.requests[0]["form"]["refresh_token"] == "secret-refresh"
    assert http.requests[1]["headers"]["Authorization"] == "Bearer fresh-access"
    encrypted = cursor.execute(
        "SELECT token_ciphertext FROM calendar_connection WHERE id = 'connection-refresh'"
    ).fetchone()[0]
    assert "fresh-access" not in encrypted
    refreshed = vault.decrypt_json(encrypted)
    assert refreshed["access_token"] == "fresh-access"
    assert refreshed["refresh_token"] == "secret-refresh"


def test_revoke_stops_pending_delivery_without_deleting_remote_events(calendar_database):
    cursor, values = calendar_database
    environment = _connector_environment()
    vault = TokenVault(environment)
    cursor.execute(
        """INSERT INTO calendar_connection
             (organization_id, id, user_id, provider, calendar_id,
              account_label, active_role, token_ciphertext, scopes_json,
              outbound_profile_version, status, token_expires_at, consented_at)
           VALUES (?, 'connection-revoke', ?, 'GOOGLE', 'primary', 'primary',
                   'manager', ?, ?, 'WORK_CALENDAR_OUTBOUND_V1', 'ACTIVE',
                   1800003600, 1800000000)""",
        (
            values["org"], values["user"],
            vault.encrypt_json({
                "access_token": "secret-access", "refresh_token": "secret-refresh",
                "expires_at": 1800003600,
                "scope": ["https://www.googleapis.com/auth/calendar.events"],
                "token_type": "Bearer",
            }),
            '["https://www.googleapis.com/auth/calendar.events"]',
        ),
    )
    role = SessionRole(
        "manager", values["user"], platform_role="user", active_role="manager",
        active_role_organization_id=values["org"],
    )
    CalendarDeliveryService(
        environment, clock=lambda: 1_800_000_000,
        http_client=RecordingHttpClient([]),
    ).enqueue(
        cursor, organization_id=values["org"], user_id=values["user"], role=role,
        connection_id="connection-revoke",
        source_items=[{"sourceType": "CASE_DEADLINE", "sourceId": values["case"]}],
    )
    http = RecordingHttpClient([
        {"status": 200, "json": {}, "headers": {}},
    ])
    service = CalendarConnectionService(
        environment, clock=lambda: 1_800_000_100, http_client=http
    )
    revoked = service.revoke(
        cursor, organization_id=values["org"], user_id=values["user"],
        connection_id="connection-revoke",
    )

    assert revoked["status"] == "REVOKED"
    assert cursor.execute(
        "SELECT status, last_error_code FROM calendar_delivery_outbox WHERE connection_id = 'connection-revoke'"
    ).fetchone() == {"status": "FAILED", "last_error_code": "CONSENT_REVOKED"}
    assert [request["url"] for request in http.requests] == [
        "https://oauth2.googleapis.com/revoke"
    ]
    assert all(request["method"] != "DELETE" for request in http.requests)


def test_owner_can_list_and_retry_failed_delivery_after_fresh_authorization(calendar_database):
    cursor, values = calendar_database
    environment = _connector_environment()
    vault = TokenVault(environment)
    cursor.execute(
        """INSERT INTO calendar_connection
             (organization_id, id, user_id, provider, calendar_id,
              account_label, active_role, token_ciphertext, scopes_json,
              outbound_profile_version, status, token_expires_at, consented_at)
           VALUES (?, 'connection-manual-retry', ?, 'GOOGLE', 'primary', 'primary',
                   'manager', ?, ?, 'WORK_CALENDAR_OUTBOUND_V1', 'ACTIVE',
                   1800003600, 1800000000)""",
        (
            values["org"], values["user"],
            vault.encrypt_json({
                "access_token": "secret-access", "refresh_token": "secret-refresh",
                "expires_at": 1800003600,
                "scope": ["https://www.googleapis.com/auth/calendar.events"],
                "token_type": "Bearer",
            }),
            '["https://www.googleapis.com/auth/calendar.events"]',
        ),
    )
    role = SessionRole(
        "manager", values["user"], platform_role="user", active_role="manager",
        active_role_organization_id=values["org"],
    )
    delivery = CalendarDeliveryService(
        environment, clock=lambda: 1_800_000_000,
        http_client=RecordingHttpClient([]),
    )
    delivery.enqueue(
        cursor, organization_id=values["org"], user_id=values["user"], role=role,
        connection_id="connection-manual-retry",
        source_items=[{"sourceType": "CASE_DEADLINE", "sourceId": values["case"]}],
    )
    delivery_id = cursor.execute(
        "SELECT id FROM calendar_delivery_outbox WHERE connection_id = 'connection-manual-retry'"
    ).fetchone()[0]
    cursor.execute(
        """UPDATE calendar_delivery_outbox
              SET status = 'FAILED', last_error_code = 'CALENDAR_PROVIDER_EVENT_UPSERT_FAILED'
            WHERE id = ?""",
        (delivery_id,),
    )

    listed = delivery.list_deliveries(
        cursor, organization_id=values["org"], user_id=values["user"],
        connection_id="connection-manual-retry",
    )
    assert listed == [{
        "id": delivery_id,
        "connectionId": "connection-manual-retry",
        "provider": "GOOGLE",
        "action": "UPSERT",
        "status": "FAILED",
        "attemptCount": 0,
        "lastErrorCode": "CALENDAR_PROVIDER_EVENT_UPSERT_FAILED",
        "eventSequence": 0,
        "createdAt": 1800000000,
        "updatedAt": 1800000000,
    }]
    retried = delivery.retry(
        cursor, organization_id=values["org"], user_id=values["user"], role=role,
        delivery_id=delivery_id,
    )
    assert retried["status"] == "RETRY"
    assert retried["lastErrorCode"] is None
