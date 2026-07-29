from types import SimpleNamespace

from backend.documents import custom_exporter
from backend.shared.access_policy import can_upload_workspace_assets
from backend.sync.service import validate_protected_media_upload_access


class _Cursor:
    def __init__(self, membership_role=None):
        self.membership_role = membership_role
        self._row = None

    def execute(self, sql, _params=()):
        if "FROM thanh_vien_to_chuc" in sql:
            self._row = (self.membership_role,) if self.membership_role else None
        elif "FROM to_chuc" in sql:
            self._row = (1,)
        else:
            self._row = None
        return self

    def fetchone(self):
        return self._row


def test_word_templates_are_shared_by_organization_and_isolated_from_personal_scope(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(custom_exporter, "TEMPLATE_DIR", str(tmp_path))

    organization_dir = custom_exporter.get_scope_template_dir(
        "organization", "org-a"
    )
    other_organization_dir = custom_exporter.get_scope_template_dir(
        "organization", "org-b"
    )
    personal_dir = custom_exporter.get_scope_template_dir("personal", "user-a")

    organization_template = "mau_rieng_org_a.docx"
    (tmp_path / "organizations" / "org-a" / organization_template).write_bytes(b"docx")
    custom_exporter.set_active_template(
        organization_template,
        "org-a",
        owner_type="organization",
    )

    assert organization_dir != other_organization_dir
    assert organization_dir != personal_dir
    assert custom_exporter.get_active_template(
        "org-a", owner_type="organization"
    ) == organization_template
    assert any(
        item["filename"] == organization_template
        for item in custom_exporter.list_templates(
            "org-a", owner_type="organization"
        )
    )
    assert all(
        item["filename"] != organization_template
        for item in custom_exporter.list_templates(
            "org-b", owner_type="organization"
        )
    )
    assert all(
        item["filename"] != organization_template
        for item in custom_exporter.list_templates(
            "user-a", owner_type="personal"
        )
    )


def test_only_active_organization_manager_can_upload_workspace_assets():
    manager = SimpleNamespace(active_role="manager", platform_role="user")
    employee = SimpleNamespace(active_role="employee", platform_role="user")

    assert can_upload_workspace_assets(
        _Cursor("manager"), manager, "user-a", "org-a"
    )
    assert not can_upload_workspace_assets(
        _Cursor("employee"), employee, "user-b", "org-a"
    )


def test_organization_employee_cannot_upload_stamp_signature_or_certificate_images():
    payload = {
        "nhathau": [{"id": "nt-1", "anhDau": "data:image/png;base64,AA=="}],
        "chuyengia": [{
            "id": "cg-1",
            "anhChungChi": "data:image/jpeg;base64,AA==",
            "anhChuKy": "data:image/webp;base64,AA==",
        }],
    }

    errors = validate_protected_media_upload_access(
        payload,
        owner_type="organization",
        can_upload=False,
    )

    assert {(item["table"], item["field"]) for item in errors} == {
        ("nha_thau", "anh_dau"),
        ("chuyen_gia", "anh_chung_chi"),
        ("chuyen_gia", "anh_chu_ky"),
    }
    assert {item["code"] for item in errors} == {"ORG_ASSET_UPLOAD_MANAGER_REQUIRED"}
    assert validate_protected_media_upload_access(
        payload,
        owner_type="organization",
        can_upload=True,
    ) == []
    assert validate_protected_media_upload_access(
        payload,
        owner_type="personal",
        can_upload=False,
    ) == []
