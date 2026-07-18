import json
import sqlite3
from types import SimpleNamespace

import pytest

import backend.shared.sensitive_data as sensitive_data
import backend.sync.pagination as pagination
import backend.sync.read_service as read_service
from backend.shared.sensitive_data import SensitiveReadPolicy


READ_ONLY_POLICY = SensitiveReadPolicy(
    can_view_expert_details=False,
    can_view_contractor_financials=False,
    can_view_signature_images=False,
)


class _Request:
    def __init__(self, **query_params):
        self.query_params = query_params
        self.cookies = {"session_token": "test-session"}


class _Role:
    user_id = "employee-1"

    def __str__(self):
        return "employee"


def _contractor_connection():
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE nha_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            owner_type TEXT,
            id_goc TEXT,
            phien_ban TEXT,
            is_latest INTEGER,
            archived_at TEXT,
            ngay_ap_dung TEXT,
            ma_nha_thau TEXT,
            ten_nha_thau TEXT,
            so_tai_khoan TEXT,
            noi_mo_tai_khoan TEXT,
            ma_ngan_hang TEXT,
            anh_dau TEXT,
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    connection.execute(
        """
        INSERT INTO nha_thau VALUES (
            'contractor-1', 'org-active', 'organization', NULL, '00', 1, NULL,
            '2026-01-01', 'NT-01', 'Contractor One', '1234567890123',
            'Sensitive Bank', '001', 'images/contractor-stamp.png',
            '2026-01-01 00:00:00', '2026-01-02 00:00:00'
        )
        """
    )
    connection.commit()
    return connection


def _expert_connection():
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE chuyen_gia (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            owner_type TEXT,
            id_goc TEXT,
            phien_ban TEXT,
            is_latest INTEGER,
            archived_at TEXT,
            ho_ten TEXT,
            so_chung_chi TEXT,
            so_cccd TEXT,
            anh_chung_chi TEXT,
            ten_anh_chung_chi TEXT,
            anh_chu_ky TEXT,
            ten_anh_chu_ky TEXT,
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    connection.execute(
        """
        INSERT INTO chuyen_gia VALUES (
            'expert-1', 'org-active', 'organization', NULL, '00', 1, NULL,
            'Expert One', 'CERT-01', '001234567890',
            'images/certificate.png', 'certificate.png',
            'images/signature.png', 'signature.png',
            '2026-01-01 00:00:00', '2026-01-02 00:00:00'
        )
        """
    )
    connection.commit()
    return connection


def _attach_sensitive_joint_venture_member(_cursor, table_name, items, **_kwargs):
    if table_name == "nha_thau":
        items[0]["thanhVienLienDanh"] = [
            {
                "soTaiKhoan": "9876543210",
                "noiMoTaiKhoan": "Member Bank",
                "maNganHang": "002",
            }
        ]


def _patch_common_pagination(monkeypatch, connection):
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, _Role()))
    monkeypatch.setattr(
        pagination, "get_active_org", lambda _request, _user_id: "org-active"
    )
    monkeypatch.setattr(pagination, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(pagination, "is_organization_manager", lambda *_args: True)
    monkeypatch.setattr(
        pagination,
        "resolve_sensitive_read_policy",
        lambda *_args, **_kwargs: READ_ONLY_POLICY,
    )
    monkeypatch.setattr(pagination.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        pagination,
        "authorize_record_write",
        lambda *_args, **_kwargs: SimpleNamespace(allowed=False),
    )


def _patch_common_single_read(monkeypatch, connection):
    monkeypatch.setattr(read_service, "verify_session", lambda _request: (True, _Role()))
    monkeypatch.setattr(
        read_service, "get_active_org", lambda _request, _user_id: "org-active"
    )
    monkeypatch.setattr(read_service, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(read_service, "can_read_record", lambda *_args: True)
    monkeypatch.setattr(
        read_service,
        "resolve_sensitive_read_policy",
        lambda *_args, **_kwargs: READ_ONLY_POLICY,
    )
    monkeypatch.setattr(read_service.database, "get_connection", lambda: connection)


def test_sensitive_policy_uses_active_workspace_and_correct_modules(monkeypatch):
    calls = []
    capability_calls = []

    def permission(_cursor, role, user_id, organization_id, module_name, action):
        calls.append((role, user_id, organization_id, module_name, action))
        return module_name == "nhathau"

    monkeypatch.setattr(sensitive_data, "has_module_permission", permission)
    monkeypatch.setattr(
        sensitive_data,
        "can_export_document_capability",
        lambda cursor, role, user_id, organization_id, capability_id: (
            capability_calls.append(
                (cursor, role, user_id, organization_id, capability_id)
            )
            or True
        ),
    )

    cursor = object()
    policy = sensitive_data.resolve_sensitive_read_policy(
        cursor, "employee", "employee-1", "org-active"
    )

    assert calls == [
        ("employee", "employee-1", "org-active", "chuyengia", "edit"),
        ("employee", "employee-1", "org-active", "nhathau", "edit"),
    ]
    assert capability_calls == [
        (cursor, "employee", "employee-1", "org-active", "signature")
    ]
    assert policy.can_view("chuyen_gia") is False
    assert policy.can_view("nha_thau") is True
    authorized_contractor = sensitive_data.serialize_sensitive_read_item(
        "nha_thau",
        {"soTaiKhoan": "1234567890123", "noiMoTaiKhoan": "Sensitive Bank"},
        policy,
    )
    assert authorized_contractor["soTaiKhoan"] == "1234567890123"
    assert authorized_contractor["noiMoTaiKhoan"] == "Sensitive Bank"

    calls.clear()
    unrelated_policy = sensitive_data.resolve_sensitive_read_policy(
        object(),
        "employee",
        "employee-1",
        "org-active",
        table_names=("goi_thau",),
    )
    assert calls == []
    assert unrelated_policy.can_view("goi_thau") is True


def test_edit_policy_preserves_bank_identity_and_private_media():
    edit_policy = SensitiveReadPolicy(
        can_view_expert_details=True,
        can_view_contractor_financials=True,
        can_view_signature_images=True,
    )
    contractor = sensitive_data.serialize_sensitive_read_item(
        "nha_thau",
        {
            "soTaiKhoan": "1234567890123",
            "noiMoTaiKhoan": "Sensitive Bank",
            "maNganHang": "001",
            "thanhVienLienDanh": [
                {
                    "soTaiKhoan": "9876543210",
                    "noiMoTaiKhoan": "Member Bank",
                    "maNganHang": "002",
                }
            ],
        },
        edit_policy,
    )
    expert = sensitive_data.serialize_sensitive_read_item(
        "chuyen_gia",
        {
            "soCCCD": "001234567890",
            "anhChungChi": "/images/certificate.png",
            "anhChuKy": "/images/signature.png",
            "tenAnhChungChi": "certificate.png",
            "tenAnhChuKy": "signature.png",
        },
        edit_policy,
    )

    assert contractor["soTaiKhoan"] == "1234567890123"
    assert contractor["noiMoTaiKhoan"] == "Sensitive Bank"
    assert contractor["thanhVienLienDanh"][0]["soTaiKhoan"] == "9876543210"
    assert expert["soCCCD"] == "001234567890"
    assert expert["anhChungChi"] == "/images/certificate.png"
    assert expert["anhChuKy"] == "/images/signature.png"


def test_edit_without_signature_capability_keeps_business_data_but_strips_media():
    policy = SensitiveReadPolicy(
        can_view_expert_details=True,
        can_view_contractor_financials=True,
        can_view_signature_images=False,
    )
    contractor = sensitive_data.serialize_sensitive_read_item(
        "nha_thau",
        {
            "soTaiKhoan": "1234567890123",
            "anhDau": "/images/stamp.png?sig=secret",
            "tenAnhDau": "stamp.png",
        },
        policy,
    )
    expert = sensitive_data.serialize_sensitive_read_item(
        "chuyen_gia",
        {
            "soCCCD": "001234567890",
            "anhChungChi": "/images/certificate.png?sig=secret",
            "anhChuKy": "/images/signature.png?sig=secret",
        },
        policy,
    )

    assert contractor["soTaiKhoan"] == "1234567890123"
    assert contractor["anhDau"] is None
    assert contractor["tenAnhDau"] is None
    assert contractor["sensitiveMediaMasked"] is True
    assert expert["soCCCD"] == "001234567890"
    assert expert["anhChungChi"] is None
    assert expert["anhChuKy"] is None
    assert expert["sensitiveMediaMasked"] is True


@pytest.mark.anyio
async def test_contractor_pagination_redacts_parent_and_joint_venture_bank_data(
    monkeypatch,
):
    connection = _contractor_connection()
    _patch_common_pagination(monkeypatch, connection)
    monkeypatch.setattr(
        pagination,
        "attach_child_rows_to_items",
        _attach_sensitive_joint_venture_member,
    )

    response = await pagination.paginate_records(
        _Request(table="nhathau", page="1", pageSize="10")
    )
    item = json.loads(response.body)["items"][0]

    assert response.status_code == 200
    assert item["soTaiKhoan"].endswith("0123")
    assert item["noiMoTaiKhoan"] is None
    assert item["maNganHang"] is None
    assert item["anhDau"] is None
    assert item["sensitiveMediaMasked"] is True
    assert item["thanhVienLienDanh"][0]["soTaiKhoan"].endswith("3210")
    assert item["thanhVienLienDanh"][0]["noiMoTaiKhoan"] is None


@pytest.mark.anyio
async def test_expert_pagination_redacts_identity_and_private_media(monkeypatch):
    connection = _expert_connection()
    _patch_common_pagination(monkeypatch, connection)
    monkeypatch.setattr(
        pagination, "attach_child_rows_to_items", lambda *_args, **_kwargs: None
    )

    response = await pagination.paginate_records(
        _Request(table="chuyengia", page="1", pageSize="10")
    )
    item = json.loads(response.body)["items"][0]

    assert response.status_code == 200
    assert item["soCCCD"] == "********7890"
    assert item["anhChungChi"] is None
    assert item["anhChuKy"] is None
    assert item["tenAnhChungChi"] is None
    assert item["tenAnhChuKy"] is None


@pytest.mark.anyio
async def test_single_contractor_read_redacts_nested_financial_data(monkeypatch):
    connection = _contractor_connection()
    _patch_common_single_read(monkeypatch, connection)
    monkeypatch.setattr(
        read_service,
        "attach_child_rows_to_items",
        _attach_sensitive_joint_venture_member,
    )

    response = await read_service.read_single_record(
        _Request(table="nhathau", id="contractor-1")
    )
    item = json.loads(response.body)["item"]

    assert response.status_code == 200
    assert item["soTaiKhoan"].endswith("0123")
    assert item["noiMoTaiKhoan"] is None
    assert item["thanhVienLienDanh"][0]["maNganHang"] is None
