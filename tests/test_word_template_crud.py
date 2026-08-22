import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.documents import custom_exporter
from backend.documents.document_worker import DocumentWorkerInputError
from backend.documents.routes_docx import (
    _content_disposition,
    _docx_error,
    _delete_scoped_template,
    _persist_scoped_template_from_path,
    _replace_scoped_template_from_path,
    _update_scoped_template,
    _validate_docx_upload,
    delete_template_api,
    set_active_template_api,
    replace_template_api,
    view_template_api,
)


def _request(path="/api/templates/example.docx", method="PUT"):
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "headers": [],
        "query_string": b"",
        "server": ("testserver", 80),
        "client": ("testclient", 50000),
        "scheme": "http",
    })


@pytest.fixture
def template_root(tmp_path, monkeypatch):
    monkeypatch.setattr(custom_exporter, "TEMPLATE_DIR", str(tmp_path))
    (tmp_path / "mau_bao_cao_dau_thau.docx").write_bytes(b"legacy-default")
    return tmp_path


def _custom_template(template_root, owner_type, owner_id, filename, content):
    scope_dir = Path(custom_exporter.get_scope_template_dir(owner_type, owner_id))
    path = scope_dir / filename
    path.write_bytes(content)
    return path


def test_upload_preserves_vietnamese_filename_without_random_suffix():
    filename = "4.1.0. Bìa E-HSMT - Gói 04.docx"

    first = _validate_docx_upload(filename, b"docx", deep_validation=False)
    second = _validate_docx_upload(filename, b"docx", deep_validation=False)

    assert first == filename
    assert second == filename


def test_download_header_keeps_unicode_filename_in_rfc5987_parameter():
    disposition = _content_disposition("4.1.0. Bìa E-HSMT - Gói 04.docx")

    assert "filename=4.1.0._B_a_E-HSMT_-_G_i_04.docx" in disposition
    assert (
        "filename*=UTF-8''4.1.0.%20B%C3%ACa%20E-HSMT%20-%20G%C3%B3i%2004.docx"
        in disposition
    )


def test_upload_rejects_duplicate_name_in_same_scope(template_root, tmp_path):
    filename = "4.1.0. Bìa E-HSMT - Gói 04.docx"
    existing = _custom_template(
        template_root, "organization", "org-a", filename, b"existing"
    )
    upload = tmp_path / "validated-upload.docx"
    upload.write_bytes(b"new")

    with pytest.raises(FileExistsError, match="Tên biểu mẫu đã tồn tại"):
        _persist_scoped_template_from_path(
            "organization", "org-a", filename, str(upload)
        )

    assert existing.read_bytes() == b"existing"


def test_upload_allows_same_name_in_different_scopes(template_root, tmp_path):
    filename = "4.1.0. Bìa E-HSMT - Gói 04.docx"
    _custom_template(
        template_root, "organization", "org-a", filename, b"organization-a"
    )
    upload = tmp_path / "validated-upload.docx"
    upload.write_bytes(b"organization-b")

    _persist_scoped_template_from_path(
        "organization", "org-b", filename, str(upload)
    )

    stored = (
        Path(custom_exporter.get_scope_template_dir("organization", "org-b"))
        / filename
    )
    assert stored.read_bytes() == b"organization-b"


def test_new_upload_requires_explicit_enablement(template_root, tmp_path):
    upload = tmp_path / "validated-upload.docx"
    upload.write_bytes(b"new")

    _persist_scoped_template_from_path(
        "organization",
        "org-a",
        "Biểu mẫu mới.docx",
        str(upload),
    )

    template = next(
        item for item in custom_exporter.list_templates(
            "org-a",
            owner_type="organization",
        )
        if item["filename"] == "Biểu mẫu mới.docx"
    )
    assert template["is_enabled"] is False


def test_template_enablement_allows_multiple_independent_choices(template_root):
    _custom_template(template_root, "organization", "org-a", "one.docx", b"one")
    _custom_template(template_root, "organization", "org-a", "two.docx", b"two")
    custom_exporter.set_active_template(
        "one.docx",
        "org-a",
        owner_type="organization",
    )

    assert custom_exporter.get_enabled_templates(
        "org-a",
        owner_type="organization",
    ) == ["one.docx"]

    custom_exporter.set_template_enabled(
        "two.docx",
        True,
        "org-a",
        owner_type="organization",
    )
    assert custom_exporter.get_enabled_templates(
        "org-a",
        owner_type="organization",
    ) == ["one.docx", "two.docx"]

    custom_exporter.set_template_enabled(
        "one.docx",
        False,
        "org-a",
        owner_type="organization",
    )
    assert custom_exporter.get_enabled_templates(
        "org-a",
        owner_type="organization",
    ) == ["two.docx"]
    assert custom_exporter.get_active_template(
        "org-a",
        owner_type="organization",
    ) == "two.docx"


def test_template_availability_api_persists_and_audits_the_choice(
    template_root,
    monkeypatch,
):
    _custom_template(
        template_root,
        "organization",
        "org-a",
        "bao-cao.docx",
        b"content",
    )
    audits = []
    monkeypatch.setattr(
        "backend.documents.routes_docx.verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-a")),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_config_access_response",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.get_active_org",
        lambda *_args: "org-a",
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.log_audit",
        lambda event, **kwargs: audits.append((event, kwargs)),
    )
    client = TestClient(Starlette(routes=[
        Route(
            "/api/templates/active",
            set_active_template_api,
            methods=["POST"],
        ),
    ]))

    response = client.post(
        "/api/templates/active",
        json={
            "template_name": "bao-cao.docx",
            "enabled": True,
            "expectedRevision": 0,
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "filename": "bao-cao.docx",
        "enabled": True,
        "revision": 1,
    }
    assert custom_exporter.is_template_enabled(
        "bao-cao.docx",
        "org-a",
        owner_type="organization",
    )
    assert [event for event, _kwargs in audits[:2]] == [
        "document.word_template_availability_update_requested",
        "document.word_template_availability_updated",
    ]
    assert audits[1][1]["metadata"]["enabled"] is True

    stale_response = client.post(
        "/api/templates/active",
        json={
            "template_name": "bao-cao.docx",
            "enabled": False,
            "expectedRevision": 0,
        },
    )
    assert stale_response.status_code == 409
    assert stale_response.json()["code"] == "WORD_TEMPLATE_CONFIG_CONFLICT"
    assert stale_response.json()["currentRevision"] == 1
    assert custom_exporter.is_template_enabled(
        "bao-cao.docx",
        "org-a",
        owner_type="organization",
    )
    assert [event for event, _kwargs in audits] == [
        "document.word_template_availability_update_requested",
        "document.word_template_availability_updated",
        "document.word_template_availability_update_requested",
    ]


def test_template_availability_api_reuses_word_config_write_permission(
    template_root,
    monkeypatch,
):
    _custom_template(
        template_root,
        "organization",
        "org-a",
        "bao-cao.docx",
        b"content",
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-a")),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_config_access_response",
        lambda _request, _session, *, write=False: (
            JSONResponse({"error": "forbidden"}, status_code=403)
            if write else None
        ),
    )
    client = TestClient(Starlette(routes=[
        Route(
            "/api/templates/active",
            set_active_template_api,
            methods=["POST"],
        ),
    ]))

    response = client.post(
        "/api/templates/active",
        json={"template_name": "bao-cao.docx", "enabled": True},
    )

    assert response.status_code == 403
    assert not custom_exporter.is_template_enabled(
        "bao-cao.docx",
        "org-a",
        owner_type="organization",
    )


def test_template_availability_rolls_back_when_required_audit_fails(
    template_root,
    monkeypatch,
):
    _custom_template(
        template_root,
        "organization",
        "org-a",
        "bao-cao.docx",
        b"content",
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-a")),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_config_access_response",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.get_active_org",
        lambda *_args: "org-a",
    )
    audits = []

    def fail_result_audit(event, **_kwargs):
        audits.append(event)
        if event == "document.word_template_availability_updated":
            raise OSError("audit unavailable")

    monkeypatch.setattr(
        "backend.documents.routes_docx.log_audit",
        fail_result_audit,
    )
    client = TestClient(Starlette(routes=[
        Route("/api/templates/active", set_active_template_api, methods=["POST"]),
    ]))

    response = client.post(
        "/api/templates/active",
        json={
            "template_name": "bao-cao.docx",
            "enabled": True,
            "expectedRevision": 0,
        },
    )

    assert response.status_code == 500
    assert custom_exporter.get_template_config_revision(
        "org-a", owner_type="organization"
    ) == 0
    assert not custom_exporter.is_template_enabled(
        "bao-cao.docx",
        "org-a",
        owner_type="organization",
    )
    assert audits == [
        "document.word_template_availability_update_requested",
        "document.word_template_availability_updated",
    ]


def test_replace_custom_template_preserves_name_and_active_selection(template_root, tmp_path):
    target = _custom_template(
        template_root, "organization", "org-a", "bao_cao.docx", b"old"
    )
    custom_exporter.set_active_template(
        "bao_cao.docx", "org-a", owner_type="organization"
    )
    upload = tmp_path / "validated-upload.docx"
    upload.write_bytes(b"new")

    replaced = _replace_scoped_template_from_path(
        "organization", "org-a", "bao_cao.docx", str(upload)
    )

    assert Path(replaced) == target
    assert target.read_bytes() == b"new"
    assert custom_exporter.get_active_template(
        "org-a", owner_type="organization"
    ) == "bao_cao.docx"


def test_delete_active_custom_template_clears_active_selection(template_root):
    target = _custom_template(
        template_root, "personal", "user-a", "quyet_dinh.docx", b"custom"
    )
    custom_exporter.set_active_template(
        "quyet_dinh.docx", "user-a", owner_type="personal"
    )

    _delete_scoped_template("personal", "user-a", "quyet_dinh.docx")

    assert not target.exists()
    assert custom_exporter.get_active_template(
        "user-a", owner_type="personal"
    ) == ""


def test_delete_route_decodes_percent_encoded_unicode_filename(
    template_root,
    monkeypatch,
):
    filename = "4.3.0. Bìa BCTĐ E-HSMT - Gói 04.docx"
    target = _custom_template(
        template_root,
        "organization",
        "org-a",
        filename,
        b"content",
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-a")),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_config_access_response",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_template_upload_access_response",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.get_active_org",
        lambda *_args: "org-a",
    )
    audits = []
    monkeypatch.setattr(
        "backend.documents.routes_docx.log_audit",
        lambda event, **kwargs: audits.append((event, kwargs)),
    )
    app = Starlette(routes=[
        Route("/api/templates/{filename}", delete_template_api, methods=["DELETE"]),
    ])

    client = TestClient(app)
    resource_url = f"/api/templates/{quote(filename, safe='')}"
    response = client.delete(resource_url)
    repeated_response = client.delete(resource_url)

    assert response.status_code == 200
    assert repeated_response.status_code == 200
    assert not target.exists()
    assert [event for event, _kwargs in audits] == [
        "document.word_template_delete_requested",
        "document.word_template_deleted",
    ]


def test_rename_custom_template_preserves_active_selection(template_root):
    original = _custom_template(
        template_root, "organization", "org-a", "bao_cao.docx", b"content"
    )
    custom_exporter.set_active_template(
        "bao_cao.docx", "org-a", owner_type="organization"
    )

    renamed, filename = _update_scoped_template(
        "organization", "org-a", "bao_cao.docx", "Báo cáo lựa chọn nhà thầu"
    )

    assert not original.exists()
    assert filename == "Báo cáo lựa chọn nhà thầu.docx"
    assert Path(renamed).read_bytes() == b"content"
    assert custom_exporter.get_active_template(
        "org-a", owner_type="organization"
    ) == filename


def test_replace_route_audits_renamed_template(template_root, monkeypatch):
    original = _custom_template(
        template_root, "organization", "org-a", "old.docx", b"content"
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-a")),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_config_access_response",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_template_upload_access_response",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.get_active_org",
        lambda *_args: "org-a",
    )
    audits = []
    monkeypatch.setattr(
        "backend.documents.routes_docx.log_audit",
        lambda event, **kwargs: audits.append((event, kwargs)),
    )
    client = TestClient(Starlette(routes=[
        Route(
            "/api/templates/{filename}",
            replace_template_api,
            methods=["PUT"],
        ),
    ]))

    response = client.put(
        "/api/templates/old.docx",
        data={"name": "new.docx"},
    )

    assert response.status_code == 200
    assert response.json()["filename"] == "new.docx"
    assert not original.exists()
    assert (original.parent / "new.docx").read_bytes() == b"content"
    assert [event for event, _kwargs in audits] == [
        "document.word_template_replace_requested",
        "document.word_template_replaced",
    ]


def test_rename_custom_template_rejects_duplicate_name(template_root):
    original = _custom_template(
        template_root, "organization", "org-a", "original.docx", b"original"
    )
    duplicate = _custom_template(
        template_root, "organization", "org-a", "duplicate.docx", b"duplicate"
    )

    with pytest.raises(FileExistsError):
        _update_scoped_template(
            "organization", "org-a", "original.docx", "duplicate.docx"
        )

    assert original.read_bytes() == b"original"
    assert duplicate.read_bytes() == b"duplicate"


def test_rename_custom_template_supports_case_only_change(template_root):
    original = _custom_template(
        template_root, "organization", "org-a", "report.docx", b"content"
    )

    renamed, filename = _update_scoped_template(
        "organization", "org-a", "report.docx", "Report.docx"
    )

    assert filename == "Report.docx"
    assert Path(renamed).name == "Report.docx"
    assert Path(renamed).read_bytes() == b"content"
    assert not original.exists() or original == Path(renamed)


def test_delete_custom_template_is_limited_to_current_scope(template_root):
    org_a = _custom_template(
        template_root, "organization", "org-a", "shared-name.docx", b"a"
    )
    org_b = _custom_template(
        template_root, "organization", "org-b", "shared-name.docx", b"b"
    )

    _delete_scoped_template("organization", "org-a", "shared-name.docx")

    assert not org_a.exists()
    assert org_b.read_bytes() == b"b"


def test_legacy_default_template_can_be_deleted(template_root):
    legacy = template_root / "mau_bao_cao_dau_thau.docx"

    _delete_scoped_template(
        "organization", "org-a", "mau_bao_cao_dau_thau.docx"
    )

    assert not legacy.exists()


def test_editing_legacy_default_moves_it_into_the_current_scope(template_root):
    legacy = template_root / "mau_bao_cao_dau_thau.docx"

    updated, filename = _update_scoped_template(
        "organization",
        "org-a",
        "mau_bao_cao_dau_thau.docx",
        "Báo cáo tùy chỉnh.docx",
    )

    assert filename == "Báo cáo tùy chỉnh.docx"
    assert Path(updated).read_bytes() == b"legacy-default"
    assert not legacy.exists()


def test_edit_can_rename_and_replace_template_in_one_update(template_root, tmp_path):
    original = _custom_template(
        template_root, "organization", "org-a", "bao_cao_cu.docx", b"old"
    )
    replacement = tmp_path / "replacement.docx"
    replacement.write_bytes(b"new")

    updated, filename = _update_scoped_template(
        "organization",
        "org-a",
        "bao_cao_cu.docx",
        "Báo cáo mới.docx",
        source_path=str(replacement),
    )

    assert not original.exists()
    assert filename == "Báo cáo mới.docx"
    assert Path(updated).read_bytes() == b"new"


def test_upload_file_is_removed_when_required_audit_fails(template_root, tmp_path):
    upload = tmp_path / "validated-upload.docx"
    upload.write_bytes(b"new")

    with pytest.raises(OSError, match="audit unavailable"):
        _persist_scoped_template_from_path(
            "organization",
            "org-a",
            "new.docx",
            str(upload),
            audit_callback=lambda *_args: (_ for _ in ()).throw(
                OSError("audit unavailable")
            ),
        )

    stored = Path(
        custom_exporter.get_scope_template_dir("organization", "org-a")
    ) / "new.docx"
    assert not stored.exists()


def test_rename_and_config_are_restored_when_required_audit_fails(template_root):
    original = _custom_template(
        template_root, "organization", "org-a", "old.docx", b"old"
    )
    custom_exporter.set_active_template(
        "old.docx", "org-a", owner_type="organization"
    )
    config_path = original.parent / "config.json"
    original_config = config_path.read_bytes()

    with pytest.raises(OSError, match="audit unavailable"):
        _update_scoped_template(
            "organization",
            "org-a",
            "old.docx",
            "new.docx",
            audit_callback=lambda *_args: (_ for _ in ()).throw(
                OSError("audit unavailable")
            ),
        )

    assert original.read_bytes() == b"old"
    assert not (original.parent / "new.docx").exists()
    assert config_path.read_bytes() == original_config


def test_deleted_file_and_config_are_restored_when_required_audit_fails(
    template_root,
):
    original = _custom_template(
        template_root, "organization", "org-a", "delete.docx", b"old"
    )
    custom_exporter.set_template_assignments(
        {"procurement_plan": ["delete.docx"]},
        "org-a",
        owner_type="organization",
    )
    config_path = original.parent / "config.json"
    original_config = config_path.read_bytes()

    with pytest.raises(OSError, match="audit unavailable"):
        _delete_scoped_template(
            "organization",
            "org-a",
            "delete.docx",
            audit_callback=lambda *_args: (_ for _ in ()).throw(
                OSError("audit unavailable")
            ),
        )

    assert original.read_bytes() == b"old"
    assert config_path.read_bytes() == original_config
    assert custom_exporter.get_template_assignments(
        "org-a", owner_type="organization"
    ) == {"procurement_plan": ["delete.docx"]}


def test_invalid_replacement_returns_the_safe_document_validation_reason():
    response = _docx_error(
        _request(),
        DocumentWorkerInputError("Tệp Office chứa liên kết ngoài không được phép."),
        "replace_template_api",
    )

    payload = json.loads(response.body)
    assert response.status_code == 422
    assert payload["code"] == "DOCX_INPUT_INVALID"
    assert payload["error"] == "Tệp Office chứa liên kết ngoài không được phép."


def test_view_template_returns_an_inline_workspace_file(
    template_root,
    monkeypatch,
):
    template = _custom_template(
        template_root,
        "organization",
        "org-a",
        "Báo cáo.docx",
        b"docx-content",
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-a")),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_config_access_response",
        lambda _request, _session: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.get_active_org",
        lambda _request, _user_id: "org-a",
    )
    request = _request(path="/api/templates/B%C3%A1o%20c%C3%A1o.docx", method="GET")
    request.scope["path_params"] = {"filename": "Báo cáo.docx"}

    response = asyncio.run(view_template_api(request))

    assert response.status_code == 200
    assert Path(response.path) == template
    assert response.media_type.endswith("wordprocessingml.document")
    assert response.headers["content-disposition"].startswith("inline;")
    assert "B%C3%A1o%20c%C3%A1o.docx" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "private, no-store"
