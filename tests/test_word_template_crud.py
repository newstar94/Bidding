from pathlib import Path

import pytest

from backend.documents import custom_exporter
from backend.documents.routes_docx import (
    _delete_scoped_template,
    _replace_scoped_template_from_path,
    _update_scoped_template,
)


@pytest.fixture
def template_root(tmp_path, monkeypatch):
    monkeypatch.setattr(custom_exporter, "TEMPLATE_DIR", str(tmp_path))
    (tmp_path / custom_exporter.DEFAULT_TEMPLATE).write_bytes(b"system-default")
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


def test_delete_active_custom_template_resets_to_system_default(template_root):
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
    ) == custom_exporter.DEFAULT_TEMPLATE


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


@pytest.mark.parametrize(
    "operation",
    [
        lambda source: _replace_scoped_template_from_path(
            "organization", "org-a", custom_exporter.DEFAULT_TEMPLATE, source
        ),
        lambda _source: _delete_scoped_template(
            "organization", "org-a", custom_exporter.DEFAULT_TEMPLATE
        ),
    ],
)
def test_system_templates_cannot_be_replaced_or_deleted(template_root, tmp_path, operation):
    upload = tmp_path / "replacement.docx"
    upload.write_bytes(b"replacement")

    with pytest.raises(ValueError):
        operation(str(upload))

    assert (template_root / custom_exporter.DEFAULT_TEMPLATE).read_bytes() == b"system-default"
