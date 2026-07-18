import importlib
import json
import sqlite3
import urllib.parse

import pytest

from backend.auth.auth_helper import SessionRole
from backend.shared.media_helper import public_image_path


app_module = importlib.import_module("backend.app")


class _Request:
    def __init__(self, file_path, query_params=None, session_token="test-session"):
        self.path_params = {"file_path": file_path}
        self.query_params = query_params or {}
        self.cookies = {"session_token": session_token}


def _authorization_database(
    *,
    expert_permission="none",
    contractor_permission="none",
    signature_capability=True,
):
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            scope_type TEXT NOT NULL,
            personal_owner_user_id TEXT
        );
        CREATE TABLE thanh_vien_to_chuc (
            user_id TEXT NOT NULL,
            organization_id TEXT NOT NULL,
            vai_tro_trong_to_chuc TEXT
        );
        CREATE TABLE ma_tran_phan_quyen (
            organization_id TEXT NOT NULL,
            emp_id TEXT NOT NULL,
            chuyengia TEXT,
            nhathau TEXT
        );
        CREATE TABLE document_export_capabilities (
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            financial INTEGER NOT NULL DEFAULT 0,
            identity INTEGER NOT NULL DEFAULT 0,
            signature INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (organization_id, user_id)
        );
        CREATE TABLE chuyen_gia (
            organization_id TEXT NOT NULL,
            anh_chung_chi TEXT,
            anh_chu_ky TEXT
        );
        CREATE TABLE nha_thau (
            organization_id TEXT NOT NULL,
            anh_dau TEXT
        );

        INSERT INTO to_chuc VALUES ('org-a', 'organization', NULL);
        INSERT INTO to_chuc VALUES ('org-b', 'organization', NULL);
        INSERT INTO thanh_vien_to_chuc VALUES ('actor', 'org-a', 'member');
        INSERT INTO chuyen_gia VALUES (
            'org-a',
            'images/chuyen_gia/expert_certificate.png',
            'images/chuyen_gia/expert_signature.png'
        );
        INSERT INTO chuyen_gia VALUES (
            'org-b',
            'images/chuyen_gia/other_workspace_signature.png',
            NULL
        );
        INSERT INTO nha_thau VALUES (
            'org-a',
            'images/nha_thau/contractor_stamp.png'
        );
        """
    )
    connection.execute(
        """
        INSERT INTO ma_tran_phan_quyen (
            organization_id, emp_id, chuyengia, nhathau
        ) VALUES ('org-a', 'actor', ?, ?)
        """,
        (expert_permission, contractor_permission),
    )
    if signature_capability:
        connection.execute(
            """INSERT INTO document_export_capabilities (
                   organization_id, user_id, signature
               ) VALUES ('org-a', 'actor', 1)"""
        )
    connection.commit()
    return connection


def _configure_request(monkeypatch, tmp_path, connection, relative_path):
    images_root = tmp_path / "images"
    target = images_root / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"protected-image")

    monkeypatch.setattr(app_module, "IMAGE_DIR", images_root)
    monkeypatch.setattr(
        app_module,
        "verify_session",
        lambda _request: (True, SessionRole("user", "actor")),
    )
    monkeypatch.setattr(app_module, "get_active_org", lambda _request, _user: "org-a")
    monkeypatch.setattr(app_module.database, "get_connection", lambda: connection)
    signed_url = public_image_path(
        f"images/{relative_path}",
        session_token="test-session",
        organization_id="org-a",
    )
    parsed = urllib.parse.urlparse(signed_url)
    query_params = {
        name: values[0]
        for name, values in urllib.parse.parse_qs(parsed.query).items()
    }
    return _Request(relative_path, query_params)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("relative_path", "expert_permission", "contractor_permission"),
    (
        ("chuyen_gia/expert_certificate.png", "view", "none"),
        ("chuyen_gia/expert_signature.png", "view", "none"),
        ("nha_thau/contractor_stamp.png", "none", "view"),
    ),
)
async def test_view_permission_cannot_download_sensitive_images(
    monkeypatch,
    tmp_path,
    relative_path,
    expert_permission,
    contractor_permission,
):
    connection = _authorization_database(
        expert_permission=expert_permission,
        contractor_permission=contractor_permission,
    )
    request = _configure_request(monkeypatch, tmp_path, connection, relative_path)

    response = await app_module.protected_image_api(request)

    assert response.status_code == 403
    assert "error" in json.loads(response.body)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("relative_path", "expert_permission", "contractor_permission"),
    (
        ("chuyen_gia/expert_certificate.png", "edit", "none"),
        ("chuyen_gia/expert_signature.png", "edit", "none"),
        ("chuyen_gia/expert_signature_opt_800.jpg", "edit", "none"),
        ("nha_thau/contractor_stamp.png", "none", "edit"),
    ),
)
async def test_edit_permission_can_download_referenced_workspace_images(
    monkeypatch,
    tmp_path,
    relative_path,
    expert_permission,
    contractor_permission,
):
    connection = _authorization_database(
        expert_permission=expert_permission,
        contractor_permission=contractor_permission,
    )
    request = _configure_request(monkeypatch, tmp_path, connection, relative_path)

    response = await app_module.protected_image_api(request)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert response.path.endswith(relative_path.replace("/", "\\")) or response.path.endswith(relative_path)


@pytest.mark.anyio
async def test_edit_permission_cannot_download_image_from_another_workspace(monkeypatch, tmp_path):
    connection = _authorization_database(expert_permission="edit")
    relative_path = "chuyen_gia/other_workspace_signature.png"
    request = _configure_request(monkeypatch, tmp_path, connection, relative_path)

    response = await app_module.protected_image_api(request)

    assert response.status_code == 403


@pytest.mark.anyio
async def test_edit_permission_without_signature_capability_cannot_download_image(
    monkeypatch,
    tmp_path,
):
    connection = _authorization_database(
        expert_permission="edit",
        signature_capability=False,
    )
    relative_path = "chuyen_gia/expert_signature.png"
    request = _configure_request(monkeypatch, tmp_path, connection, relative_path)

    response = await app_module.protected_image_api(request)

    assert response.status_code == 403


@pytest.mark.anyio
async def test_expired_or_tampered_image_link_is_rejected_before_database_access(
    monkeypatch,
    tmp_path,
):
    connection = _authorization_database(expert_permission="edit")
    request = _configure_request(
        monkeypatch,
        tmp_path,
        connection,
        "chuyen_gia/expert_signature.png",
    )
    request.query_params["sig"] = "0" * 64

    def unexpected_database_access():
        raise AssertionError("Invalid signed URLs must not reach the database")

    monkeypatch.setattr(app_module.database, "get_connection", unexpected_database_access)

    response = await app_module.protected_image_api(request)

    assert response.status_code == 403


@pytest.mark.anyio
async def test_path_traversal_is_rejected_before_database_access(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, "IMAGE_DIR", tmp_path / "images")
    monkeypatch.setattr(
        app_module,
        "verify_session",
        lambda _request: (True, SessionRole("user", "actor")),
    )

    def unexpected_database_access():
        raise AssertionError("Traversal requests must not reach the database")

    monkeypatch.setattr(app_module.database, "get_connection", unexpected_database_access)

    response = await app_module.protected_image_api(_Request("../private/signature.png"))

    assert response.status_code == 400
