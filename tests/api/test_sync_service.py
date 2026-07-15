import json

import pytest

from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.auth.auth_helper import SessionRole
from backend.auth.auth_service import provision_user_organization
from backend.auth import session_utils
from backend.db import db_utils
from backend.db.db_helper import SQLiteDatabase
import backend.sync.service as sync_service
import backend.sync.read_service as read_service


class _Request:
    query_params = {}

    async def json(self):
        return {}


@pytest.mark.anyio
async def test_sync_service_rejects_invalid_session_before_opening_database(monkeypatch):
    monkeypatch.setattr(sync_service, "verify_session", lambda _request: (False, "Phiên hết hạn"))
    monkeypatch.setattr(
        sync_service.database,
        "get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("Database must not be opened")),
    )

    response = await sync_service.process_sync_request(_Request())

    assert response.status_code == 403
    assert json.loads(response.body)["error"] == "Phiên hết hạn"


def test_sync_read_window_handles_full_and_delta_reads():
    full = sync_service.parse_sync_read_window({"since": "0"})
    delta = sync_service.parse_sync_read_window({"since": "0", "after_version": "12"})

    assert full.is_full_initial_fetch is True
    assert full.after_version is None
    assert delta.is_full_initial_fetch is False
    assert delta.after_version == 12


class _DataRequest:
    headers = {}
    cookies = {}

    def __init__(self, payload=None, query_params=None):
        self._payload = payload or {}
        self.query_params = query_params or {}

    async def json(self):
        return self._payload


@pytest.mark.anyio
async def test_custom_paper_status_round_trip_reload_and_contract_use(monkeypatch, tmp_path):
    database = SQLiteDatabase(tmp_path / "custom-status-round-trip.db")
    monkeypatch.setattr(db_utils, "database", database)
    monkeypatch.setenv("ADMIN_PASSWORD", "Test-only-password-123!")
    db_utils.khoi_tao_va_di_tru_he_thong()

    connection = database.get_connection()
    organization_id = connection.execute("SELECT id FROM to_chuc LIMIT 1").fetchone()[0]
    user_id = connection.execute("SELECT id FROM tai_khoan LIMIT 1").fetchone()[0]
    connection.close()
    role = SessionRole("super_admin", user_id)

    monkeypatch.setattr(sync_service, "database", database)
    monkeypatch.setattr(sync_service, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(sync_service, "get_active_org", lambda _request, _user: organization_id)
    monkeypatch.setattr(read_service, "database", database)
    monkeypatch.setattr(read_service, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(read_service, "get_active_org", lambda _request, _user: organization_id)

    create_response = await sync_service.process_sync_request(
        _DataRequest({
            "custompaperstatuses": [{
                "id": "hsg-round-trip",
                "organizationId": organization_id,
                "name": "Đã nhận hồ sơ",
                "color": "#2563eb",
            }]
        })
    )
    assert create_response.status_code == 200

    async def load_statuses():
        response = await read_service.read_sync_data(
            _DataRequest(query_params={"since": "0", "tables": "custompaperstatuses"})
        )
        assert response.status_code == 200
        return json.loads(response.body)["custompaperstatuses"]

    first_list = await load_statuses()
    reloaded_list = await load_statuses()
    expected_status = {
        "id": "hsg-round-trip",
        "organizationId": organization_id,
        "ownerType": "organization",
        "name": "Đã nhận hồ sơ",
        "color": "#2563eb",
    }
    for statuses in (first_list, reloaded_list):
        status = next(item for item in statuses if item["id"] == "hsg-round-trip")
        for key, expected in expected_status.items():
            assert status[key] == expected
        assert "orgId" not in status

    contract_response = await sync_service.process_sync_request(
        _DataRequest({
            "chudautu": [{
                "id": "cdt-custom-status",
                "tenChuDauTu": "Chủ đầu tư trạng thái tùy chỉnh",
            }],
            "nhathau": [{
                "id": "nt-custom-status",
                "tenNhaThau": "Nhà thầu trạng thái tùy chỉnh",
            }],
            "kehoach": [{
                "id": "kh-custom-status",
                "tenKeHoach": "Kế hoạch trạng thái tùy chỉnh",
                "tenDuAnDuToan": "Dự toán trạng thái tùy chỉnh",
                "loaiHinhMuaSam": "Dự toán mua sắm",
                "chuDauTuId": "cdt-custom-status",
                "ngayPheDuyet": "2026-01-02",
                "quyetDinhPheDuyet": "QD-KH-01",
            }],
            "goithau": [{
                "id": "gt-custom-status",
                "keHoachId": "kh-custom-status",
                "tenGoiThau": "Gói thầu trạng thái tùy chỉnh",
                "giaGoiThau": 100,
                "thoiGianThucHien": "30 ngày",
                "nguonVon": "Ngân sách",
                "thoiGianToChuc": "30 ngày",
                "thoiGianBatDauToChuc": "Quý I/2026",
            }],
            "hopdong": [{
                "id": "hd-custom-status",
                "tenHopDong": "Hợp đồng dùng trạng thái tùy chỉnh",
                "soHopDong": "HD-CUSTOM-STATUS",
                "ngayKy": "2026-02-01",
                "chuDauTuId": "cdt-custom-status",
                "nhaThauId": "nt-custom-status",
                "keHoachId": "kh-custom-status",
                "giaTri": 100,
                "loaiHopDong": "Trọn gói",
                "soNgayThucHien": "30 ngày",
                "goiThauIds": ["gt-custom-status"],
                "coQdChiDinh": 1,
                "soQdChiDinh": "QD-CD-01",
                    "ngayQdChiDinh": "2026-01-20",
                    "trangThaiHopDong": "Đang thực hiện",
                    "trangThaiHoSo": "Đã nhận hồ sơ",
                }],
                "assignments": [
                    {"id": "asg-kh-custom-status", "empId": user_id, "targetId": "kh-custom-status", "type": "kehoach"},
                    {"id": "asg-gt-custom-status", "empId": user_id, "targetId": "gt-custom-status", "type": "goithau"},
                    {"id": "asg-hd-custom-status", "empId": user_id, "targetId": "hd-custom-status", "type": "hopdong"},
                ],
            })
    )
    assert contract_response.status_code == 200
    connection = database.get_connection()
    contract_status = connection.execute(
        "SELECT trang_thai_ho_so FROM hop_dong WHERE organization_id = ? AND id = ?",
        (organization_id, "hd-custom-status"),
    ).fetchone()[0]
    connection.close()
    assert contract_status == "Đã nhận hồ sơ"


@pytest.mark.anyio
async def test_personal_workspace_owns_create_and_update_when_user_has_no_business_org(monkeypatch, tmp_path):
    database = SQLiteDatabase(tmp_path / "personal-workspace-sync.db")
    monkeypatch.setattr(db_utils, "database", database)
    monkeypatch.setenv("ADMIN_PASSWORD", "Test-only-password-123!")
    db_utils.khoi_tao_va_di_tru_he_thong()

    connection = database.get_connection()
    connection.execute(
        """INSERT INTO tai_khoan (
               id, ten_dang_nhap, username_norm, mat_khau, email, email_norm, vai_tro
           ) VALUES ('personal-user', 'personal_user', 'personal_user', 'test-hash',
                     'personal@example.com', 'personal@example.com', 'user')"""
    )
    cursor = connection.cursor()
    personal_workspace_id = provision_user_organization(cursor, "personal-user", "Người dùng cá nhân")
    connection.commit()
    connection.close()

    role = SessionRole("user", "personal-user")
    monkeypatch.setattr(sync_service, "database", database)
    monkeypatch.setattr(sync_service, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(session_utils, "database", database)
    session_utils._org_cache.clear()
    monkeypatch.setattr(sync_service, "get_active_org", session_utils.get_active_org)

    create_response = await sync_service.process_sync_request(
        _DataRequest({
            "custompaperstatuses": [{
                "id": "personal-status",
                "name": "Bản nháp cá nhân",
                "color": "#2563eb",
            }]
        })
    )
    assert create_response.status_code == 200

    update_response = await sync_service.process_sync_request(
        _DataRequest({
            "custompaperstatuses": [{
                "id": "personal-status",
                "name": "Đã cập nhật cá nhân",
                "color": "#16a34a",
                "expectedVersion": 1,
            }]
        })
    )
    assert update_response.status_code == 200

    connection = database.get_connection()
    row = connection.execute(
        """SELECT organization_id, name FROM trang_thai_ho_so_giay
           WHERE id = 'personal-status'"""
    ).fetchone()
    connection.close()
    assert tuple(row) == (personal_workspace_id, "Đã cập nhật cá nhân")
