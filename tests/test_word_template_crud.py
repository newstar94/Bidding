import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from backend.documents import custom_exporter
from backend.documents.document_worker import DocumentWorkerInputError
from backend.documents.routes_docx import (
    _docx_error,
    _delete_scoped_template,
    _replace_scoped_template_from_path,
    _update_scoped_template,
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
