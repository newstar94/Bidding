"""Consent and encrypted credential lifecycle for outbound calendar connectors."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
from urllib.parse import urlencode

from cryptography.fernet import Fernet, InvalidToken

from backend.db.id_utils import generate_record_id
from .providers import (
    CalendarHttpClient,
    CalendarProviderError,
    GoogleCalendarProvider,
    MicrosoftCalendarProvider,
)


GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events"
MICROSOFT_SCOPE = "offline_access Calendars.ReadWrite"
OAUTH_STATE_TTL_SECONDS = 600


class CalendarConnectionError(ValueError):
    def __init__(self, code, *, status_code=400):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class TokenVault:
    """Use the connector-specific Fernet key for OAuth state and token material."""

    def __init__(self, environ=None):
        self.environ = os.environ if environ is None else environ
        try:
            self._fernet = Fernet(
                str(self.environ.get("WORK_CALENDAR_TOKEN_ENCRYPTION_KEY", ""))
                .encode("ascii")
            )
        except (TypeError, ValueError) as exc:
            raise CalendarConnectionError("CALENDAR_TOKEN_VAULT_INVALID") from exc

    def encrypt_text(self, value):
        return self._fernet.encrypt(str(value).encode("utf-8")).decode("ascii")

    def decrypt_text(self, ciphertext):
        try:
            return self._fernet.decrypt(str(ciphertext).encode("ascii")).decode("utf-8")
        except (InvalidToken, UnicodeError, ValueError) as exc:
            raise CalendarConnectionError("CALENDAR_TOKEN_CIPHERTEXT_INVALID") from exc

    def encrypt_json(self, value):
        return self.encrypt_text(json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ))

    def decrypt_json(self, ciphertext):
        try:
            value = json.loads(self.decrypt_text(ciphertext))
        except (TypeError, json.JSONDecodeError) as exc:
            raise CalendarConnectionError("CALENDAR_TOKEN_CIPHERTEXT_INVALID") from exc
        if not isinstance(value, dict):
            raise CalendarConnectionError("CALENDAR_TOKEN_CIPHERTEXT_INVALID")
        return value


class CalendarConnectionService:
    def __init__(self, environ=None, *, clock=None, http_client=None):
        self.environ = os.environ if environ is None else environ
        self.clock = time.time if clock is None else clock
        self.vault = TokenVault(self.environ)
        self.http = CalendarHttpClient() if http_client is None else http_client

    def start(self, cursor, *, organization_id, user_id, active_role,
              provider, calendar_id):
        provider = str(provider or "").strip().upper()
        calendar_id = str(calendar_id or "").strip()
        if provider not in {"GOOGLE", "MICROSOFT"}:
            raise CalendarConnectionError("CALENDAR_PROVIDER_UNSUPPORTED")
        if not calendar_id or len(calendar_id) > 1024:
            raise CalendarConnectionError("CALENDAR_TARGET_INVALID")

        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        now = int(self.clock())
        redirect_uri = self._required(provider, "REDIRECT_URI")
        cursor.execute(
            """INSERT INTO calendar_oauth_state
                 (state_hash, organization_id, user_id, provider,
                  code_verifier_ciphertext, redirect_uri, calendar_id,
                  active_role, expires_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                hashlib.sha256(state.encode("utf-8")).hexdigest(),
                organization_id,
                user_id,
                provider,
                self.vault.encrypt_text(verifier),
                redirect_uri,
                calendar_id,
                str(active_role or "").strip() or None,
                now + OAUTH_STATE_TTL_SECONDS,
                now,
            ),
        )
        return {
            "provider": provider,
            "authorizationUrl": self._authorization_url(
                provider, state, challenge, redirect_uri
            ),
            "expiresAt": now + OAUTH_STATE_TTL_SECONDS,
        }

    def complete(self, cursor, *, provider, state, code, current_user_id):
        provider = str(provider or "").strip().upper()
        state = str(state or "").strip()
        code = str(code or "").strip()
        if provider not in {"GOOGLE", "MICROSOFT"} or not state or not code:
            raise CalendarConnectionError("CALENDAR_OAUTH_CALLBACK_INVALID")
        state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
        row = cursor.execute(
            """SELECT organization_id, user_id, provider,
                      code_verifier_ciphertext, redirect_uri, calendar_id,
                      active_role, expires_at, used_at
                 FROM calendar_oauth_state
                WHERE state_hash = ? FOR UPDATE""",
            (state_hash,),
        ).fetchone()
        if row is None:
            raise CalendarConnectionError("CALENDAR_OAUTH_STATE_INVALID")
        if str(row[1]) != str(current_user_id):
            raise CalendarConnectionError(
                "CALENDAR_OAUTH_ACCOUNT_MISMATCH", status_code=403
            )
        if str(row[2]) != provider:
            raise CalendarConnectionError("CALENDAR_OAUTH_PROVIDER_MISMATCH")
        if row[8] is not None:
            raise CalendarConnectionError("CALENDAR_OAUTH_STATE_USED", status_code=409)
        now = int(self.clock())
        if int(row[7]) <= now:
            raise CalendarConnectionError("CALENDAR_OAUTH_STATE_EXPIRED", status_code=410)

        cursor.execute(
            "UPDATE calendar_oauth_state SET used_at = ? WHERE state_hash = ? AND used_at IS NULL",
            (now, state_hash),
        )
        adapter = self._provider(provider)
        token = adapter.exchange_code(
            code=code,
            verifier=self.vault.decrypt_text(row[3]),
            redirect_uri=str(row[4]),
        )
        access_token = str(token.get("access_token") or "").strip()
        refresh_token = str(token.get("refresh_token") or "").strip()
        if not access_token:
            raise CalendarConnectionError("CALENDAR_OAUTH_TOKEN_INVALID")
        scopes = sorted(set(str(token.get("scope") or "").split()))
        required_scope = GOOGLE_SCOPE if provider == "GOOGLE" else "Calendars.ReadWrite"
        if required_scope not in scopes:
            raise CalendarConnectionError("CALENDAR_OAUTH_SCOPE_INSUFFICIENT")

        organization_id = str(row[0])
        user_id = str(row[1])
        calendar_id = str(row[5])
        existing = cursor.execute(
            """SELECT id, token_ciphertext FROM calendar_connection
                WHERE organization_id = ? AND user_id = ?
                  AND provider = ? AND calendar_id = ? FOR UPDATE""",
            (organization_id, user_id, provider, calendar_id),
        ).fetchone()
        if not refresh_token and existing is not None:
            refresh_token = str(
                self.vault.decrypt_json(existing[1]).get("refresh_token") or ""
            ).strip()
        if not refresh_token:
            raise CalendarConnectionError("CALENDAR_OAUTH_REFRESH_TOKEN_REQUIRED")
        try:
            expires_in = max(1, min(86400, int(token.get("expires_in") or 3600)))
        except (TypeError, ValueError) as exc:
            raise CalendarConnectionError("CALENDAR_OAUTH_TOKEN_INVALID") from exc
        expires_at = now + expires_in
        token_payload = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": str(token.get("token_type") or "Bearer"),
            "expires_at": expires_at,
            "scope": scopes,
        }
        connection_id = str(existing[0]) if existing else generate_record_id(
            "calendar-connection"
        )
        if existing:
            cursor.execute(
                """UPDATE calendar_connection
                      SET active_role = ?, token_ciphertext = ?, scopes_json = ?,
                          outbound_profile_version = 'WORK_CALENDAR_OUTBOUND_V1',
                          status = 'ACTIVE', token_expires_at = ?,
                          row_version = row_version + 1, consented_at = ?,
                          revoked_at = NULL, updated_at = CURRENT_TIMESTAMP
                    WHERE organization_id = ? AND id = ?""",
                (
                    str(row[6] or "").strip() or None,
                    self.vault.encrypt_json(token_payload),
                    json.dumps(scopes, separators=(",", ":")),
                    expires_at,
                    now,
                    organization_id,
                    connection_id,
                ),
            )
        else:
            cursor.execute(
                """INSERT INTO calendar_connection
                     (organization_id, id, user_id, provider, calendar_id,
                      account_label, active_role, token_ciphertext, scopes_json,
                      outbound_profile_version, status, token_expires_at,
                      consented_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
                           'WORK_CALENDAR_OUTBOUND_V1', 'ACTIVE', ?, ?)""",
                (
                    organization_id,
                    connection_id,
                    user_id,
                    provider,
                    calendar_id,
                    calendar_id,
                    str(row[6] or "").strip() or None,
                    self.vault.encrypt_json(token_payload),
                    json.dumps(scopes, separators=(",", ":")),
                    expires_at,
                    now,
                ),
            )
        return self._public_connection(cursor, organization_id, connection_id)

    def list_connections(self, cursor, *, organization_id, user_id):
        rows = cursor.execute(
            """SELECT id FROM calendar_connection
                WHERE organization_id = ? AND user_id = ?
                ORDER BY provider, account_label, id""",
            (organization_id, user_id),
        ).fetchall()
        return [
            self._public_connection(cursor, organization_id, row[0])
            for row in rows
        ]

    def revoke(self, cursor, *, organization_id, user_id, connection_id):
        row = cursor.execute(
            """SELECT provider, token_ciphertext, status
                 FROM calendar_connection
                WHERE organization_id = ? AND id = ? AND user_id = ?
                FOR UPDATE""",
            (organization_id, connection_id, user_id),
        ).fetchone()
        if row is None:
            raise CalendarConnectionError(
                "CALENDAR_CONNECTION_NOT_FOUND", status_code=404
            )
        now = int(self.clock())
        if str(row[2]) != "REVOKED":
            token = self.vault.decrypt_json(row[1])
            cursor.execute(
                """UPDATE calendar_connection
                      SET status = 'REVOKED', revoked_at = ?,
                          row_version = row_version + 1,
                          updated_at = CURRENT_TIMESTAMP
                    WHERE organization_id = ? AND id = ?""",
                (now, organization_id, connection_id),
            )
            cursor.execute(
                """UPDATE calendar_delivery_outbox
                      SET status = 'FAILED', last_error_code = 'CONSENT_REVOKED',
                          locked_at = NULL, updated_at = ?
                    WHERE organization_id = ? AND connection_id = ?
                      AND status IN ('PENDING', 'RETRY')""",
                (now, organization_id, connection_id),
            )
            try:
                self._provider(str(row[0])).revoke_token(token)
            except CalendarProviderError:
                pass
            cursor.execute(
                """UPDATE calendar_connection SET token_ciphertext = ?
                    WHERE organization_id = ? AND id = ?""",
                (
                    self.vault.encrypt_json({"revoked": True}),
                    organization_id,
                    connection_id,
                ),
            )
        return self._public_connection(cursor, organization_id, connection_id)

    def _provider(self, provider):
        if provider == "GOOGLE":
            return GoogleCalendarProvider(self.environ, self.http)
        if provider == "MICROSOFT":
            return MicrosoftCalendarProvider(self.environ, self.http)
        raise CalendarConnectionError("CALENDAR_PROVIDER_UNSUPPORTED")

    @staticmethod
    def _public_connection(cursor, organization_id, connection_id):
        row = cursor.execute(
            """SELECT id, provider, calendar_id, account_label, status,
                      scopes_json, outbound_profile_version, token_expires_at,
                      consented_at
                 FROM calendar_connection
                WHERE organization_id = ? AND id = ?""",
            (organization_id, connection_id),
        ).fetchone()
        return {
            "id": row[0],
            "provider": row[1],
            "calendarId": row[2],
            "accountLabel": row[3],
            "status": row[4],
            "scopes": json.loads(row[5]),
            "outboundProfileVersion": row[6],
            "tokenExpiresAt": int(row[7]) if row[7] is not None else None,
            "consentedAt": int(row[8]),
        }

    def _required(self, provider, suffix):
        name = f"WORK_CALENDAR_{provider}_{suffix}"
        value = str(self.environ.get(name, "")).strip()
        if not value:
            raise CalendarConnectionError("CALENDAR_PROVIDER_NOT_CONFIGURED")
        return value

    def _authorization_url(self, provider, state, challenge, redirect_uri):
        if provider == "GOOGLE":
            endpoint = "https://accounts.google.com/o/oauth2/v2/auth"
            parameters = {
                "client_id": self._required(provider, "CLIENT_ID"),
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": GOOGLE_SCOPE,
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "access_type": "offline",
                "prompt": "consent",
                "include_granted_scopes": "true",
            }
        else:
            tenant = str(
                self.environ.get("WORK_CALENDAR_MICROSOFT_TENANT", "common")
            ).strip() or "common"
            endpoint = (
                "https://login.microsoftonline.com/"
                f"{tenant}/oauth2/v2.0/authorize"
            )
            parameters = {
                "client_id": self._required(provider, "CLIENT_ID"),
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "response_mode": "query",
                "scope": MICROSOFT_SCOPE,
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        return f"{endpoint}?{urlencode(parameters)}"
