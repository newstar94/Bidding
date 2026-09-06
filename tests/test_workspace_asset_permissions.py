import sqlite3
from types import SimpleNamespace

from backend.db.db_helper import CompatRow
from backend.documents import custom_exporter
from backend.shared.access_policy import can_upload_workspace_assets
from backend.sync.service import (
    validate_protected_media_mutation_access,
    validate_protected_media_upload_access,
)


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


def test_contractor_stamp_defers_to_record_write_but_expert_images_remain_protected():
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


def _protected_media_cursor():
    connection = sqlite3.connect(":memory:")
    connection.execute(
        """CREATE TABLE nha_thau (
               id TEXT PRIMARY KEY,
               organization_id TEXT NOT NULL,
               id_goc TEXT,
               is_latest INTEGER,
               updated_at TEXT,
               anh_dau TEXT,
               ten_anh_dau TEXT
           )"""
    )
    connection.execute(
        """CREATE TABLE chuyen_gia (
               id TEXT PRIMARY KEY,
               organization_id TEXT NOT NULL,
               id_goc TEXT,
               is_latest INTEGER,
               updated_at TEXT,
               anh_chung_chi TEXT,
               ten_anh_chung_chi TEXT,
               anh_chu_ky TEXT,
               ten_anh_chu_ky TEXT
           )"""
    )
    connection.execute(
        """INSERT INTO nha_thau VALUES (
               'nt-1', 'org-a', 'nt-1', 1, '2026-08-02 08:00:00',
               'images/nha_thau/stamp.png', 'DAU_NT.png'
           )"""
    )
    connection.execute(
        """INSERT INTO chuyen_gia VALUES (
               'cg-1', 'org-a', 'cg-1', 1, '2026-08-02 08:00:00',
               'images/chuyen_gia/cert.jpg', 'CC_001.jpg',
               'images/chuyen_gia/signature.webp', 'CK_001.webp'
           )"""
    )
    return connection, connection.cursor()


class _CompatCursor:
    """Expose sqlite fixture rows through the PostgreSQL-compatible row shape."""

    def __init__(self, cursor):
        self._cursor = cursor

    def execute(self, statement, parameters=()):
        self._cursor.execute(statement, parameters)
        return self

    def fetchall(self):
        columns = tuple(column[0] for column in self._cursor.description or ())
        return [CompatRow(columns, row) for row in self._cursor.fetchall()]


def test_contractor_stamp_can_be_cleared_but_expert_media_remains_protected():
    connection, cursor = _protected_media_cursor()
    try:
        errors = validate_protected_media_mutation_access(
            {
                "nhathau": [{
                    "id": "nt-1",
                    "anhDau": "",
                    "tenAnhDau": "renamed.png",
                }],
                "chuyengia": [{
                    "id": "cg-1",
                    "anhChungChi": "images/chuyen_gia/other.jpg",
                    "tenAnhChungChi": "CC_001.jpg",
                    "anhChuKy": None,
                    "tenAnhChuKy": "CK_001.webp",
                }],
            },
            owner_type="organization",
            can_upload=False,
            cursor=cursor,
            organization_id="org-a",
        )
    finally:
        connection.close()

    assert {(item["table"], item["field"]) for item in errors} == {
        ("chuyen_gia", "anh_chung_chi"),
        ("chuyen_gia", "anh_chu_ky"),
    }
    assert {item["code"] for item in errors} == {
        "ORG_ASSET_MUTATION_MANAGER_REQUIRED"
    }


def test_contractor_fresh_stamp_upload_and_replace_defer_to_record_permission():
    from backend.shared.access_policy import BatchWriteAuthorizationContext, authorize_record_write_from_context
    connection, cursor = _protected_media_cursor()
    try:
        for record_id in ("nt-new", "nt-1"):
            record = {"id": record_id, "anhDau": "data:image/png;base64,AA=="}
            assert validate_protected_media_mutation_access(
                {"nhathau": [record]}, owner_type="organization", can_upload=False,
                cursor=cursor, organization_id="org-a",
            ) == []
            context = BatchWriteAuthorizationContext(
                role_str="employee", user_id="employee", organization_id="org-a",
                organization_manager=False, personal_workspace_owner=False,
                active_membership=True, inherited_specialist_access=False,
                membership_role="employee", permissions={"nhathau": "view"},
                new_records={("nha_thau", "nt-new")},
            )
            assert authorize_record_write_from_context(context, "nhathau", "nha_thau", record).allowed == (record_id == "nt-new")
            context.permissions["nhathau"] = "edit"
            assert authorize_record_write_from_context(context, "nhathau", "nha_thau", record).allowed
            context.permissions.clear()
            assert not authorize_record_write_from_context(context, "nhathau", "nha_thau", record).allowed
    finally:
        connection.close()


def test_organization_employee_can_preserve_existing_media_in_updates_and_versions():
    connection, cursor = _protected_media_cursor()
    try:
        errors = validate_protected_media_mutation_access(
            {
                "nhathau": [{
                    "id": "nt-2",
                    "rootId": "nt-1",
                    "anhDau": "images/nha_thau/stamp.png",
                    "tenAnhDau": "DAU_NT.png",
                }],
                "chuyengia": [{
                    "id": "cg-1",
                    "anhChungChi": "images/chuyen_gia/cert.jpg",
                    "tenAnhChungChi": "CC_001.jpg",
                    "anhChuKy": "images/chuyen_gia/signature.webp",
                    "tenAnhChuKy": "CK_001.webp",
                }],
            },
            owner_type="organization",
            can_upload=False,
            cursor=cursor,
            organization_id="org-a",
        )
    finally:
        connection.close()

    assert errors == []


def test_media_access_check_accepts_postgresql_compat_rows():
    connection, cursor = _protected_media_cursor()
    try:
        errors = validate_protected_media_mutation_access(
            {
                "chuyengia": [{
                    "id": "cg-1",
                    "anhChungChi": "images/chuyen_gia/cert.jpg",
                    "anhChuKy": "images/chuyen_gia/signature.webp",
                }],
            },
            owner_type="organization",
            can_upload=False,
            cursor=_CompatCursor(cursor),
            organization_id="org-a",
        )
    finally:
        connection.close()

    assert errors == []


def test_organization_employee_can_preserve_signed_media_urls_and_snake_case_fields():
    connection, cursor = _protected_media_cursor()
    try:
        errors = validate_protected_media_mutation_access(
            {
                "nhathau": [{
                    "id": "nt-1",
                    "anh_dau": "/images/nha_thau/stamp.png?expires=1&sig=signed",
                }],
                "chuyengia": [{
                    "id": "cg-1",
                    "anh_chung_chi": (
                        "/images/chuyen_gia/cert.jpg?expires=1&sig=signed"
                    ),
                    "anh_chu_ky": (
                        "/images/chuyen_gia/signature.webp?expires=1&sig=signed"
                    ),
                }],
            },
            owner_type="organization",
            can_upload=False,
            cursor=cursor,
            organization_id="org-a",
        )
    finally:
        connection.close()

    assert errors == []


def test_organization_employee_cannot_use_media_from_another_organization():
    connection, cursor = _protected_media_cursor()
    connection.execute(
        """INSERT INTO nha_thau VALUES (
               'nt-other', 'org-b', 'nt-other', 1, '2026-08-02 08:00:00',
               'images/nha_thau/other-org.png', 'DAU_KHAC.png'
           )"""
    )
    try:
        errors = validate_protected_media_mutation_access(
            {
                "nhathau": [{
                    "id": "nt-new",
                    "rootId": "nt-other",
                    "anhDau": "/images/nha_thau/other-org.png?sig=signed",
                }],
            },
            owner_type="organization",
            can_upload=False,
            cursor=cursor,
            organization_id="org-a",
        )
    finally:
        connection.close()

    assert [(item["id"], item["field"]) for item in errors] == [
        ("nt-new", "anh_dau"),
    ]


def test_organization_employee_cannot_attach_media_to_new_or_versioned_records():
    payload = {
        "nhathau": [
            {
                "id": "nt-new",
                "anhDau": "images/nha_thau/stamp.png",
            },
            {
                "id": "nt-2",
                "rootId": "nt-1",
                "anhDau": "images/nha_thau/other.png",
            },
        ],
    }
    connection, cursor = _protected_media_cursor()
    try:
        errors = validate_protected_media_mutation_access(
            payload,
            owner_type="organization",
            can_upload=False,
            cursor=cursor,
            organization_id="org-a",
        )
        assert validate_protected_media_mutation_access(
            payload,
            owner_type="organization",
            can_upload=True,
            cursor=cursor,
            organization_id="org-a",
        ) == []
        assert validate_protected_media_mutation_access(
            payload,
            owner_type="personal",
            can_upload=False,
            cursor=cursor,
            organization_id="user-a",
        ) == []
    finally:
        connection.close()

    assert [(item["id"], item["field"]) for item in errors] == [
        ("nt-new", "anh_dau"),
        ("nt-2", "anh_dau"),
    ]
