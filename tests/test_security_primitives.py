import asyncio
import base64
import hashlib
import io
import json
import time
import urllib.request
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image, PngImagePlugin

from backend.auth.auth_helper import (
    hash_password,
    password_needs_rehash,
    verify_super_admin_controls,
    verify_password,
)
from backend.auth.mfa_service import MfaConfigurationError, validate_mfa_configuration
from backend.auth.password_policy import validate_new_password
from backend.auth.profile_validation import validate_profile_fields
from backend.http_middleware import (
    ProxyHeaderTrustMiddleware,
    SecurityHeadersMiddleware,
)
from backend.shared.logging_utils import redact_log_value
from backend.startup import (
    StartupValidationError,
    calculate_database_connection_budget,
    validate_database_connection_budget,
    validate_runtime_role_snapshot,
    validate_secret_separation,
)
from backend.shared import media_helper
from backend.shared.safe_http import UnsafeOutboundUrl, open_allowlisted_https
from backend.observability.metrics import _restore_drill_timestamp


def _image_data_url(
    *,
    image_format="PNG",
    size=(32, 32),
    color=(20, 80, 140, 255),
    metadata=None,
):
    image = Image.new("RGBA", size, color)
    output = io.BytesIO()
    kwargs = {}
    if image_format == "PNG" and metadata:
        png_info = PngImagePlugin.PngInfo()
        for key, value in metadata.items():
            png_info.add_text(key, value)
        kwargs["pnginfo"] = png_info
    if image_format == "JPEG":
        image = image.convert("RGB")
    image.save(output, format=image_format, **kwargs)
    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[image_format]
    return f"data:{mime};base64,{base64.b64encode(output.getvalue()).decode('ascii')}"


def test_argon2id_is_used_for_new_passwords():
    password = "Mot mat khau rat dai 2026!"
    encoded = hash_password(password)

    assert encoded.startswith("$argon2id$")
    assert verify_password(encoded, password)
    assert not verify_password(encoded, password + "x")
    assert not password_needs_rehash(encoded)


def test_database_connection_budget_is_cluster_wide_and_fail_closed():
    environment = {
        "APP_INSTANCE_COUNT": "2",
        "UVICORN_WORKERS": "4",
        "DATABASE_POOL_MAX_SIZE": "8",
        "DATABASE_DEDICATED_CONNECTIONS_PER_WORKER": "1",
        "DATABASE_RESERVED_CONNECTIONS": "20",
    }
    budget = calculate_database_connection_budget(environment)
    assert budget["application"] == 72
    assert budget["total"] == 92
    assert validate_database_connection_budget(100, environment) == budget
    with pytest.raises(StartupValidationError, match="budget"):
        validate_database_connection_budget(92, environment)


def test_production_secrets_must_be_independently_rotatable():
    shared = "same-secret-material-that-must-not-be-reused"
    with pytest.raises(StartupValidationError, match="reused"):
        validate_secret_separation(
            {
                "DATABASE_URL": (
                    "postgresql://runtime:"
                    + shared
                    + "@db.example.test/biddingflow"
                ),
                "SMTP_PASSWORD": shared,
            }
        )
    validate_secret_separation(
        {
            "DATABASE_URL": (
                "postgresql://runtime:database-secret"
                "@db.example.test/biddingflow"
            ),
            "SMTP_PASSWORD": "smtp-secret",
            "MFA_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
            "EMAIL_OUTBOX_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
        }
    )


def test_restore_drill_marker_uses_public_key_verification(
    tmp_path,
    monkeypatch,
):
    snapshot = tmp_path / "biddingflow-backup-test"
    snapshot.mkdir()
    (snapshot / "manifest.json").write_text("{}", encoding="utf-8")
    private_key = Ed25519PrivateKey.generate()
    public_bytes = private_key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    payload = {
        "format": "biddingflow-restore-drill",
        "version": 2,
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "snapshot": str(snapshot),
        "databaseVerified": True,
        "filesVerified": True,
        "schemaVersion": 1,
        "rpoSeconds": 10.0,
        "rtoSeconds": 2.0,
    }
    material = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    payload["integrity"] = {
        "algorithm": "Ed25519",
        "signature": base64.urlsafe_b64encode(
            private_key.sign(material)
        ).decode("ascii"),
    }
    state_file = tmp_path / "last-restore-drill.json"
    state_file.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv(
        "BIDDING_RESTORE_DRILL_PUBLIC_KEY",
        base64.urlsafe_b64encode(public_bytes).decode("ascii"),
    )
    monkeypatch.setenv("BIDDING_RESTORE_DRILL_STATE_FILE", str(state_file))
    assert _restore_drill_timestamp(tmp_path) is not None

    payload["rtoSeconds"] = 3.0
    state_file.write_text(json.dumps(payload), encoding="utf-8")
    assert _restore_drill_timestamp(tmp_path) is None


def test_legacy_pbkdf2_password_is_verified_and_marked_for_upgrade():
    password = "Mot mat khau cu rat dai!"
    salt = "legacy-test-salt"
    iterations = 310_000
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations
    ).hex()
    encoded = f"pbkdf2_sha256${iterations}${salt}${digest}"

    assert verify_password(encoded, password)
    assert not verify_password(encoded, password + "x")
    assert password_needs_rehash(encoded)


def test_password_policy_requires_8_characters_and_blocks_common_values():
    assert validate_new_password("a" * 7)[0] is False
    assert validate_new_password("a" * 8)[0] is True
    assert validate_new_password("Một mật khẩu đủ dài!")[0] is True
    assert validate_new_password("passwordpassword")[0] is False


def test_super_admin_controls_make_mfa_optional_by_default_and_enforce_policy(
    monkeypatch,
):
    request = SimpleNamespace(
        method="POST",
        client=SimpleNamespace(host="127.0.0.1"),
        headers={},
    )
    user_without_mfa = {
        "mfa_enabled": 0,
        "mfa_verified_at": None,
        "privileged_reauth_at": int(time.time()),
    }
    monkeypatch.delenv("REQUIRE_SUPER_ADMIN_MFA", raising=False)
    allowed, message = verify_super_admin_controls(request, user_without_mfa)
    assert allowed
    assert message is None

    monkeypatch.setenv("REQUIRE_SUPER_ADMIN_MFA", "true")
    allowed, message = verify_super_admin_controls(request, user_without_mfa)
    assert not allowed
    assert "MFA" in message

    allowed, message = verify_super_admin_controls(
        request,
        {
            "mfa_enabled": 1,
            "mfa_verified_at": int(time.time()),
            "privileged_reauth_at": int(time.time()),
        },
    )
    assert allowed
    assert message is None


def test_production_mfa_key_validation_is_fail_closed():
    validate_mfa_configuration(
        {"MFA_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii")},
        required=True,
    )
    with pytest.raises(MfaConfigurationError):
        validate_mfa_configuration({"MFA_ENCRYPTION_KEY": "invalid"}, required=True)


def test_csp_enforces_explicit_trusted_types_policy_without_default_policy():
    async def app(_scope, _receive, send):
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"text/plain")],
            }
        )
        await send({"type": "http.response.body", "body": b"ok"})

    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    asyncio.run(
        SecurityHeadersMiddleware(app)(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "GET",
                "scheme": "http",
                "path": "/",
                "raw_path": b"/",
                "query_string": b"",
                "root_path": "",
                "headers": [],
                "client": ("127.0.0.1", 12345),
                "server": ("testserver", 80),
            },
            receive,
            send,
        )
    )
    response_start = next(item for item in messages if item["type"] == "http.response.start")
    headers = {
        key.decode("latin-1").lower(): value.decode("latin-1")
        for key, value in response_start["headers"]
    }
    csp = headers["content-security-policy"]
    assert "require-trusted-types-for 'script'" in csp
    assert "trusted-types biddingflow-html biddingflow-dompurify goog#html 'allow-duplicates'" in csp
    assert "trusted-types dompurify" not in csp
    assert "default" not in csp.split("trusted-types ", 1)[1]


def test_cache_policy_separates_hashed_assets_from_api_data():
    async def inspect(path):
        async def app(_scope, _receive, send):
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"application/javascript")],
                }
            )
            await send({"type": "http.response.body", "body": b"ok"})

        messages = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        await SecurityHeadersMiddleware(app)(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "GET",
                "scheme": "https",
                "path": path,
                "raw_path": path.encode("ascii"),
                "query_string": b"",
                "root_path": "",
                "headers": [],
                "client": ("127.0.0.1", 12345),
                "server": ("testserver", 443),
            },
            receive,
            send,
        )
        response_start = next(
            item for item in messages if item["type"] == "http.response.start"
        )
        return {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in response_start["headers"]
        }

    asset_headers = asyncio.run(inspect("/dist/assets/app-AbCd1234.js"))
    api_headers = asyncio.run(inspect("/api/get-all-data"))
    assert asset_headers["cache-control"] == (
        "public, max-age=31536000, immutable"
    )
    assert api_headers["cache-control"].startswith("no-store")


def test_log_redaction_covers_authentication_and_connection_secrets():
    raw = (
        'Authorization: Bearer header-secret\n'
        'Cookie: session_token=cookie-secret\n'
        '{"otp_code":"123456","reset_token":"reset-secret",'
        '"credential":"google-secret","smtp_password":"smtp-secret",'
        '"database_url":"postgresql://user:password@db.internal/app"} '
        "https://app.test/reset?code=query-secret"
    )
    redacted = redact_log_value(raw)
    for secret in (
        "header-secret",
        "cookie-secret",
        "123456",
        "reset-secret",
        "google-secret",
        "smtp-secret",
        "user:password",
        "query-secret",
    ):
        assert secret not in redacted
    assert "[REDACTED" in redacted


def test_proxy_headers_are_visible_only_from_trusted_socket_peer(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "10.0.0.0/8")

    async def inspect(peer):
        observed = {}

        async def app(scope, _receive, send):
            observed.update(
                {
                    name.decode("latin-1").lower(): value.decode("latin-1")
                    for name, value in scope["headers"]
                }
            )
            await send(
                {
                    "type": "http.response.start",
                    "status": 204,
                    "headers": [],
                }
            )
            await send({"type": "http.response.body", "body": b""})

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(_message):
            return None

        await ProxyHeaderTrustMiddleware(app)(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "GET",
                "scheme": "http",
                "path": "/",
                "raw_path": b"/",
                "query_string": b"",
                "root_path": "",
                "headers": [
                    (b"host", b"app.example.test"),
                    (b"x-forwarded-for", b"198.51.100.10"),
                    (b"x-forwarded-proto", b"HTTPS"),
                    (b"x-forwarded-host", b"attacker.example"),
                    (b"forwarded", b"for=198.51.100.10;host=attacker.example"),
                ],
                "client": (peer, 12345),
                "server": ("127.0.0.1", 8000),
            },
            receive,
            send,
        )
        return observed

    untrusted = asyncio.run(inspect("203.0.113.20"))
    assert not any(name.startswith("x-forwarded-") for name in untrusted)
    assert "forwarded" not in untrusted

    trusted = asyncio.run(inspect("10.1.2.3"))
    assert trusted["x-forwarded-for"] == "198.51.100.10"
    assert trusted["x-forwarded-proto"] == "https"
    assert "x-forwarded-host" not in trusted
    assert "forwarded" not in trusted


def test_media_upload_is_reencoded_and_stored_as_managed_path(tmp_path, monkeypatch):
    monkeypatch.setattr(media_helper, "IMAGE_DIR", str(tmp_path))
    payload = _image_data_url(metadata={"Comment": "must be removed"})

    managed_path = media_helper.save_base64_image(
        payload, "chuyen_gia", "expert_cert"
    )

    assert managed_path == "images/chuyen_gia/expert_cert.png"
    stored_path = tmp_path / "chuyen_gia" / "expert_cert.png"
    assert stored_path.is_file()
    with Image.open(stored_path) as stored:
        assert stored.format == "PNG"
        assert "Comment" not in stored.info


@pytest.mark.parametrize(
    "payload",
    [
        "not-an-image",
        "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        "data:image/png;base64,AAAA",
        _image_data_url(image_format="PNG").replace("image/png", "image/jpeg", 1),
    ],
)
def test_media_upload_rejects_invalid_content_without_persisting_payload(
    payload, tmp_path, monkeypatch
):
    monkeypatch.setattr(media_helper, "IMAGE_DIR", str(tmp_path))

    with pytest.raises(ValueError):
        media_helper.save_base64_image(payload, "chuyen_gia", "invalid")

    assert not list(tmp_path.rglob("*"))


def test_media_upload_enforces_dimensions_pixels_and_decode_ratio():
    too_wide = _image_data_url(size=(media_helper.MAX_IMAGE_DIMENSION + 1, 1))
    with pytest.raises(ValueError, match="Chiều rộng"):
        media_helper._decode_and_validate_image(too_wide)

    ordinary = _image_data_url(size=(100, 100))
    with pytest.raises(ValueError, match="Tổng số pixel"):
        media_helper._decode_and_validate_image(ordinary, max_pixels=9_999)
    with pytest.raises(ValueError, match="Tỷ lệ giải nén"):
        media_helper._decode_and_validate_image(ordinary, max_decode_ratio=0)


def test_managed_media_path_requires_explicit_record_or_tenant_ownership():
    signed_url = (
        "/images/chuyen_gia/expert_cert.png"
        "?expires=1784430000&org=org-1&sig=" + ("a" * 64)
    )
    with pytest.raises(ValueError, match="không thuộc bản ghi"):
        media_helper.save_base64_image(
            signed_url,
            "chuyen_gia",
            "expert_cert",
        )

    assert (
        media_helper.save_base64_image(
            signed_url,
            "chuyen_gia",
            "expert_cert",
            allowed_existing_paths={"images/chuyen_gia/expert_cert.png"},
        )
        == "images/chuyen_gia/expert_cert.png"
    )


def test_profile_avatar_is_reencoded_to_small_metadata_free_jpeg():
    payload = _image_data_url(
        size=(400, 300),
        metadata={"Comment": "private metadata"},
    )

    _name, _email, avatar = validate_profile_fields(
        "Nguyễn Văn A", "user@example.com", payload
    )

    assert avatar.startswith("data:image/jpeg;base64,")
    raw = base64.b64decode(avatar.split(",", 1)[1], validate=True)
    assert len(raw) < media_helper.MAX_IMAGE_UPLOAD_BYTES
    with Image.open(io.BytesIO(raw)) as image:
        assert image.width <= 256
        assert image.height <= 256
        assert not image.getexif()


def _safe_runtime_role_snapshot():
    return {
        "role": (
            "biddingflow_app",
            True,
            False,
            False,
            False,
            False,
            False,
        ),
        "memberships": [],
        "identity": (
            "biddingflow_app",
            "biddingflow",
            "public",
            ["public"],
            False,
            False,
            False,
        ),
        "owned_objects": [],
        "disallowed_grants": [],
        "missing_crud": [],
    }


def test_runtime_database_role_accepts_only_isolated_crud_identity():
    validate_runtime_role_snapshot(
        _safe_runtime_role_snapshot(),
        expected_role="biddingflow_app",
    )


@pytest.mark.parametrize(
    ("index", "attribute"),
    [(2, "SUPERUSER"), (3, "CREATEDB"), (4, "CREATEROLE"), (5, "REPLICATION"), (6, "BYPASSRLS")],
)
def test_runtime_database_role_rejects_elevated_attributes(index, attribute):
    snapshot = _safe_runtime_role_snapshot()
    role = list(snapshot["role"])
    role[index] = True
    snapshot["role"] = tuple(role)

    with pytest.raises(StartupValidationError, match=attribute):
        validate_runtime_role_snapshot(snapshot)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("memberships", ["biddingflow_migrator"], "inherit"),
        ("owned_objects", [("table", "tai_khoan")], "owns"),
        ("disallowed_grants", [("private", "secret", "SELECT")], "allow-list"),
        ("missing_crud", ["tai_khoan"], "lacks"),
    ],
)
def test_runtime_database_role_rejects_privilege_escape(field, value, message):
    snapshot = _safe_runtime_role_snapshot()
    snapshot[field] = value

    with pytest.raises(StartupValidationError, match=message):
        validate_runtime_role_snapshot(snapshot)


def test_runtime_database_role_rejects_unsafe_search_path():
    snapshot = _safe_runtime_role_snapshot()
    identity = list(snapshot["identity"])
    identity[3] = ["runtime_user", "public"]
    snapshot["identity"] = tuple(identity)

    with pytest.raises(StartupValidationError, match="search_path"):
        validate_runtime_role_snapshot(snapshot)


@pytest.mark.parametrize("identity_index", [4, 5, 6])
def test_runtime_database_role_rejects_database_schema_creation(identity_index):
    snapshot = _safe_runtime_role_snapshot()
    identity = list(snapshot["identity"])
    identity[identity_index] = True
    snapshot["identity"] = tuple(identity)

    with pytest.raises(StartupValidationError, match="CREATE or TEMP"):
        validate_runtime_role_snapshot(snapshot)


@pytest.mark.parametrize(
    "url",
    [
        "http://api.example.com/data",
        "https://user:password@api.example.com/data",
        "https://api.example.com:8443/data",
        "https://unapproved.example.com/data",
    ],
)
def test_outbound_http_rejects_urls_outside_exact_https_allowlist(url):
    request = urllib.request.Request(url)

    with pytest.raises(UnsafeOutboundUrl):
        open_allowlisted_https(
            request,
            allowed_hosts={"api.example.com"},
            timeout=1,
        )


def test_outbound_http_rejects_allowlisted_host_resolving_private(
    monkeypatch,
):
    monkeypatch.setattr(
        "backend.shared.safe_http.socket.getaddrinfo",
        lambda *_args, **_kwargs: [
            (2, 1, 6, "", ("127.0.0.1", 443)),
        ],
    )
    request = urllib.request.Request("https://api.example.com/data")

    with pytest.raises(UnsafeOutboundUrl, match="non-public"):
        open_allowlisted_https(
            request,
            allowed_hosts={"api.example.com"},
            timeout=1,
        )
