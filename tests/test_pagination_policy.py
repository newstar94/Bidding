import asyncio
import base64
import hashlib
import hmac
import json
from types import SimpleNamespace

import pytest

from backend.auth.session_utils import OrgPermissionError
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.sensitive_data import SensitiveReadPolicy
from backend.sync import pagination


def _body(response):
    return json.loads(response.body.decode("utf-8"))


def _request(**params):
    return SimpleNamespace(
        query_params=params,
        cookies={"session_token": "session-secret-with-enough-entropy"},
        headers={},
        state=SimpleNamespace(),
        method="GET",
        url=SimpleNamespace(path="/api/sync/paginate"),
    )


class _Cursor:
    def __init__(self, rows=(), *, versions=()):
        self.rows = list(rows)
        self.versions = list(versions)
        self.calls = []
        self.last_sql = ""

    def execute(self, sql, params=()):
        self.last_sql = " ".join(str(sql).split())
        self.calls.append((self.last_sql, tuple(params)))
        return self

    def fetchone(self):
        if "COUNT(*)" in self.last_sql:
            return (len(self.rows),)
        return None

    def fetchall(self):
        if "SELECT id, id_goc, phien_ban" in self.last_sql:
            return list(self.versions)
        if "SELECT *" in self.last_sql:
            return list(self.rows)
        return []


class _Connection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.closed = 0

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed += 1


def _install_success_policy(monkeypatch, rows=(), *, versions=(), manager=True):
    cursor = _Cursor(rows, versions=versions)
    connection = _Connection(cursor)
    role = SimpleNamespace(user_id="user-1", __str__=lambda self: "employee")
    monkeypatch.setattr(
        pagination.database,
        "get_connection",
        lambda: connection,
    )
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(
        pagination,
        "get_active_org",
        lambda _request, _user_id, cursor=None: "org-1",
    )
    monkeypatch.setattr(pagination, "can_read_table", lambda *args: True)
    monkeypatch.setattr(
        pagination,
        "is_organization_manager",
        lambda *args: manager,
    )
    monkeypatch.setattr(
        pagination,
        "resolve_sensitive_read_policy",
        lambda *args, **kwargs: SensitiveReadPolicy(True, True, True),
    )
    monkeypatch.setattr(
        pagination,
        "serialize_sensitive_read_items",
        lambda _table, items, _policy: items,
    )
    monkeypatch.setattr(pagination, "attach_child_rows_to_items", lambda *args, **kwargs: None)
    return cursor, connection


def test_keyset_cursor_is_signed_session_bound_and_context_bound():
    token = pagination._encode_keyset_cursor(
        "goi_thau",
        "ma_goi_thau",
        "ASC",
        "GT-001",
        "record-1",
        signing_key="session-a",
    )

    assert pagination._decode_keyset_cursor(
        token,
        "goi_thau",
        "ma_goi_thau",
        "ASC",
        signing_key="session-a",
    ) == ("GT-001", "record-1")
    assert pagination._decode_keyset_cursor(
        token,
        "goi_thau",
        "ma_goi_thau",
        "ASC",
        signing_key="session-b",
    ) is None
    assert pagination._decode_keyset_cursor(
        token,
        "goi_thau",
        "id",
        "ASC",
        signing_key="session-a",
    ) is None
    assert pagination._decode_keyset_cursor(
        token,
        "goi_thau",
        "ma_goi_thau",
        "DESC",
        signing_key="session-a",
    ) is None


def test_keyset_cursor_rejects_payload_and_signature_tampering():
    token = pagination._encode_keyset_cursor(
        "goi_thau",
        "id",
        "ASC",
        None,
        "record-1",
        signing_key="session-a",
    )
    payload, signature = token.split(".")
    decoded = json.loads(pagination._urlsafe_b64decode(payload))
    decoded["id"] = "attacker-controlled"
    tampered_payload = pagination._urlsafe_b64encode(
        json.dumps(decoded, separators=(",", ":")).encode()
    )

    assert pagination._decode_keyset_cursor(
        f"{tampered_payload}.{signature}",
        "goi_thau",
        "id",
        "ASC",
        signing_key="session-a",
    ) is None
    assert pagination._decode_keyset_cursor(
        f"{payload}.{signature[:-1]}A",
        "goi_thau",
        "id",
        "ASC",
        signing_key="session-a",
    ) is None


@pytest.mark.parametrize(
    "token",
    [
        None,
        "",
        "not-a-token",
        "a.b.c",
        "!" * 2049,
        "%%%.%%%",
    ],
)
def test_keyset_cursor_rejects_malformed_bounded_input(token):
    assert pagination._decode_keyset_cursor(
        token,
        "goi_thau",
        "id",
        "ASC",
        signing_key="session-a",
    ) is None


def test_keyset_cursor_rejects_signed_non_object_and_invalid_contract():
    def signed(payload):
        encoded = pagination._urlsafe_b64encode(
            json.dumps(payload, separators=(",", ":")).encode()
        )
        digest = hmac.new(b"session-a", encoded.encode(), hashlib.sha256).digest()
        return f"{encoded}.{pagination._urlsafe_b64encode(digest)}"

    for payload in (
        [],
        {"v": 1, "table": "goi_thau", "column": "id", "direction": "ASC", "id": "1"},
        {"v": 2, "table": "other", "column": "id", "direction": "ASC", "id": "1"},
        {"v": 2, "table": "goi_thau", "column": "id", "direction": "ASC", "id": ""},
    ):
        assert pagination._decode_keyset_cursor(
            signed(payload),
            "goi_thau",
            "id",
            "ASC",
            signing_key="session-a",
        ) is None

    with pytest.raises(ValueError):
        pagination._encode_keyset_cursor(
            "goi_thau", "id", "ASC", "", "1", signing_key=""
        )
    with pytest.raises(ValueError):
        pagination._urlsafe_b64decode("")


@pytest.mark.parametrize(
    ("exception", "code"),
    [
        (BlockingIOBusyError("busy"), "DATABASE_READ_QUEUE_FULL"),
        (BlockingIOTimeoutError("timeout"), "DATABASE_READ_TIMEOUT"),
    ],
)
def test_async_pagination_fails_closed_when_database_executor_is_unavailable(
    monkeypatch, exception, code
):
    async def fail(*args, **kwargs):
        raise exception

    monkeypatch.setattr(pagination, "run_database_read", fail)
    response = asyncio.run(pagination.paginate_records(_request(table="goithau")))

    assert response.status_code == 503
    assert response.headers["retry-after"] == "1"
    assert _body(response)["code"] == code


def test_pagination_rejects_unauthenticated_invalid_table_and_invalid_numbers(monkeypatch):
    monkeypatch.setattr(
        pagination,
        "verify_session",
        lambda _request: (False, "Phiên đăng nhập không hợp lệ"),
    )
    response = pagination._paginate_records_blocking(_request(table="goithau"))
    assert response.status_code == 403

    role = SimpleNamespace(user_id="user-1")
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, role))
    response = pagination._paginate_records_blocking(_request(table="tai_khoan"))
    assert response.status_code == 400
    assert _body(response)["error"] == "Invalid table key"

    response = pagination._paginate_records_blocking(
        _request(table="goithau", page="1 OR 1=1")
    )
    assert response.status_code == 400
    assert _body(response)["error"] == "Tham số phân trang không hợp lệ"


def test_pagination_returns_empty_result_when_table_access_is_denied(monkeypatch):
    cursor, connection = _install_success_policy(monkeypatch)
    monkeypatch.setattr(pagination, "can_read_table", lambda *args: False)

    response = pagination._paginate_records_blocking(
        _request(table="custompaperstatuses")
    )

    assert response.status_code == 200
    assert _body(response) == {"items": [], "totalItems": 0}
    assert connection.closed >= 1
    assert not cursor.calls


def test_offset_pagination_clamps_bounds_and_uses_only_allowlisted_sort(monkeypatch):
    rows = [
        {
            "id": "status-1",
            "organization_id": "org-1",
            "owner_type": "organization",
            "name": "Đang xử lý",
            "color": "#000000",
            "sync_version": 1,
            "created_at": "2026-01-01",
            "updated_at": "2026-01-01",
        }
    ]
    cursor, connection = _install_success_policy(monkeypatch, rows)

    response = pagination._paginate_records_blocking(
        _request(
            table="custompaperstatuses",
            page="-10",
            pageSize="9999",
            sortBy="id; DROP TABLE tai_khoan",
            sortOrder="sideways",
        )
    )
    payload = _body(response)

    assert response.status_code == 200
    assert payload["totalItems"] == 1
    assert payload["items"][0]["id"] == "status-1"
    item_sql, item_params = next(
        call for call in cursor.calls if "SELECT *" in call[0]
    )
    assert "DROP TABLE" not in item_sql
    assert "ORDER BY COALESCE(id, '') ASC" in item_sql
    assert item_params[-2:] == (200, 0)
    assert connection.closed >= 1


def test_cursor_pagination_issues_and_accepts_only_signed_cursor(monkeypatch):
    rows = [
        {"id": "a", "organization_id": "org-1", "name": "A"},
        {"id": "b", "organization_id": "org-1", "name": "B"},
    ]
    _install_success_policy(monkeypatch, rows)
    first = pagination._paginate_records_blocking(
        _request(
            table="custompaperstatuses",
            pagination="cursor",
            pageSize="1",
        )
    )
    first_payload = _body(first)

    assert first_payload["hasMore"] is True
    assert first_payload["totalItems"] is None
    assert first_payload["nextCursor"]
    assert pagination._decode_keyset_cursor(
        first_payload["nextCursor"],
        "trang_thai_ho_so_giay",
        "id",
        "ASC",
        signing_key="session-secret-with-enough-entropy",
    ) == ("a", "a")

    cursor, _ = _install_success_policy(monkeypatch, [])
    second = pagination._paginate_records_blocking(
        _request(
            table="custompaperstatuses",
            pagination="cursor",
            cursor=first_payload["nextCursor"],
        )
    )
    assert second.status_code == 200
    item_sql, item_params = next(
        call for call in cursor.calls if "SELECT *" in call[0]
    )
    assert "COALESCE(id, '') > ?" in item_sql
    assert item_params[-4:-1] == ("a", "a", "a")

    tampered = first_payload["nextCursor"][:-1] + "A"
    rejected = pagination._paginate_records_blocking(
        _request(
            table="custompaperstatuses",
            pagination="cursor",
            cursor=tampered,
        )
    )
    assert rejected.status_code == 400
    assert _body(rejected)["error"] == "Cursor phân trang không hợp lệ"


@pytest.mark.parametrize(
    ("table_key", "expected_fragment"),
    [
        ("assignments", "id_nhan_vien = ?"),
        ("permissionmatrix", "emp_id = ?"),
        ("kehoach", "loai_doi_tuong = 'kehoach'"),
        ("goithau", "loai_doi_tuong = ?"),
        ("hopdong", "loai_doi_tuong = ?"),
        ("thongtinmothau", "loai_doi_tuong = 'goithau'"),
    ],
)
def test_employee_pagination_is_restricted_by_assignment(
    monkeypatch, table_key, expected_fragment
):
    cursor, _ = _install_success_policy(monkeypatch, manager=False)

    response = pagination._paginate_records_blocking(
        _request(table=table_key, pageSize="1")
    )

    assert response.status_code == 200
    count_sql = next(call[0] for call in cursor.calls if "COUNT(*)" in call[0])
    assert expected_fragment in count_sql


@pytest.mark.parametrize(
    "table_key",
    ("kehoach", "goithau", "hopdong", "thongtinmothau"),
)
def test_personal_workspace_pagination_does_not_require_assignments(
    monkeypatch, table_key
):
    cursor, _ = _install_success_policy(monkeypatch, manager=False)
    monkeypatch.setattr(
        pagination,
        "get_active_org",
        lambda _request, _user_id, cursor=None: "personal:user-1",
    )

    response = pagination._paginate_records_blocking(
        _request(table=table_key, pageSize="1")
    )

    assert response.status_code == 200
    count_sql, count_params = next(
        call for call in cursor.calls if "COUNT(*)" in call[0]
    )
    assert "phan_cong_nhan_su" not in count_sql
    assert count_params[0] == "personal:user-1"


@pytest.mark.parametrize(
    ("table_key", "expected_column"),
    [
        ("kehoach", "ma_ke_hoach"),
        ("goithau", "ma_goi_thau"),
        ("chudautu", "ma_chu_dau_tu"),
        ("nhathau", "ma_nha_thau"),
        ("chuyengia", "ho_ten"),
        ("hopdong", "so_hop_dong"),
    ],
)
def test_search_uses_fixed_column_sets_and_bound_parameter(
    monkeypatch, table_key, expected_column
):
    cursor, _ = _install_success_policy(monkeypatch)

    response = pagination._paginate_records_blocking(
        _request(table=table_key, search="  O'REILLY%  ")
    )

    assert response.status_code == 200
    count_sql, count_params = next(
        call for call in cursor.calls if "COUNT(*)" in call[0]
    )
    assert expected_column in count_sql
    assert "O'REILLY" not in count_sql
    assert count_params[-1] == "o'reilly%"


def test_expert_search_hides_identity_column_without_sensitive_permission(monkeypatch):
    cursor, _ = _install_success_policy(monkeypatch)
    monkeypatch.setattr(
        pagination,
        "resolve_sensitive_read_policy",
        lambda *args, **kwargs: SensitiveReadPolicy(False, False, False),
    )

    response = pagination._paginate_records_blocking(
        _request(table="chuyengia", search="nguyen")
    )

    assert response.status_code == 200
    count_sql = next(call[0] for call in cursor.calls if "COUNT(*)" in call[0])
    assert "ho_ten" in count_sql
    assert "so_chung_chi" in count_sql
    assert "so_cccd" not in count_sql


@pytest.mark.parametrize(
    ("params", "expected_sql", "expected_values"),
    [
        (
            {"nam": "2026", "thang": "12"},
            "ngay_ky >= ? AND ngay_ky < ?",
            ("2026-12-01", "2027-01-01"),
        ),
        (
            {"nam": "2026"},
            "ngay_ky >= ? AND ngay_ky < ?",
            ("2026-01-01", "2027-01-01"),
        ),
        (
            {"thang": "7"},
            "EXTRACT(MONTH FROM ngay_ky) = ?",
            (7,),
        ),
    ],
)
def test_date_filters_are_bounded_and_sargable(
    monkeypatch, params, expected_sql, expected_values
):
    cursor, _ = _install_success_policy(monkeypatch)

    response = pagination._paginate_records_blocking(
        _request(table="hopdong", **params)
    )

    assert response.status_code == 200
    count_sql, count_params = next(
        call for call in cursor.calls if "COUNT(*)" in call[0]
    )
    assert expected_sql in count_sql
    assert count_params[-len(expected_values):] == expected_values


def test_invalid_date_filter_is_ignored_instead_of_entering_sql(monkeypatch):
    cursor, _ = _install_success_policy(monkeypatch)

    response = pagination._paginate_records_blocking(
        _request(table="hopdong", nam="2026 OR TRUE", thang="99")
    )

    assert response.status_code == 200
    count_sql = next(call[0] for call in cursor.calls if "COUNT(*)" in call[0])
    assert "ngay_ky >=" not in count_sql
    assert "EXTRACT(MONTH" not in count_sql


def test_package_filters_snapshot_and_valid_sort_are_parameterized(monkeypatch):
    cursor, _ = _install_success_policy(monkeypatch)

    response = pagination._paginate_records_blocking(
        _request(
            table="goithau",
            keHoachId="plan-1",
            trangThai="Đã phê duyệt",
            hinhThuc="Đấu thầu rộng rãi",
            sortBy="maGoiThau",
            sortOrder="desc",
        )
    )

    assert response.status_code == 200
    count_sql, count_params = next(
        call for call in cursor.calls if "COUNT(*)" in call[0]
    )
    item_sql = next(call[0] for call in cursor.calls if "SELECT *" in call[0])
    assert "ke_hoach_id = ?" in count_sql
    assert "trang_thai = ?" in count_sql
    assert "hinh_thuc_lua_chon = ?" in count_sql
    assert "plan-1" in count_params
    assert "Đấu thầu rộng rãi" in count_params
    assert "ORDER BY COALESCE(ma_goi_thau, '') DESC NULLS LAST, id DESC" in item_sql


def test_versioned_package_rows_include_relations_versions_and_edit_policy(monkeypatch):
    row = {
        "id": "package-v2",
        "id_goc": "package-root",
        "organization_id": "org-1",
        "phien_ban": 2,
        "ma_goi_thau": "GT-01",
    }
    cursor, _ = _install_success_policy(
        monkeypatch,
        [row],
        versions=[
            ("package-v2", "package-root", 2),
            ("package-v1", "package-root", 1),
        ],
    )
    monkeypatch.setattr(
        pagination,
        "_get_expert_relations_for_packages",
        lambda _cursor, ids, org: {
            ids[0]: {
                "to_cg": [{"id": "expert-1"}],
                "to_td": [{"id": "reviewer-1"}],
                "cg_ids": ["expert-1"],
            }
        },
    )
    monkeypatch.setattr(
        pagination,
        "authorize_record_write",
        lambda *args, **kwargs: SimpleNamespace(allowed=True),
    )
    monkeypatch.setattr(
        pagination,
        "map_db_to_json",
        lambda _table, record: {
            "id": record["id"],
            "phanLoList": None,
            "tuyChonMuaThemList": None,
            "awardedPhanLoList": None,
            "giaHanList": None,
            "yeuCauLamRoList": None,
            "traLoiLamRoList": None,
        },
    )

    response = pagination._paginate_records_blocking(
        _request(table="goithau", keHoachId="plan-1")
    )
    item = _body(response)["items"][0]

    assert item["toChuyenGia"] == [{"id": "expert-1"}]
    assert item["toThamDinh"] == [{"id": "reviewer-1"}]
    assert item["chuyenGiaIds"] == ["expert-1"]
    assert item["allVersions"] == [
        {"id": "package-v2", "phienBan": 2},
        {"id": "package-v1", "phienBan": 1},
    ]
    assert item["phanLoList"] == []
    version_sql, version_params = next(
        call for call in cursor.calls if "SELECT id, id_goc, phien_ban" in call[0]
    )
    assert "ke_hoach_id = ?" in version_sql
    assert version_params[-1] == "plan-1"


def test_contract_rows_include_owner_scoped_package_relations(monkeypatch):
    row = {
        "id": "contract-1",
        "id_goc": None,
        "organization_id": "org-1",
        "phien_ban": 1,
    }
    _install_success_policy(
        monkeypatch,
        [row],
        versions=[("contract-1", None, 1)],
    )
    monkeypatch.setattr(
        pagination,
        "_get_contract_package_ids",
        lambda _cursor, ids, org: {ids[0]: ["package-1"]},
    )
    monkeypatch.setattr(
        pagination,
        "authorize_record_write",
        lambda *args, **kwargs: SimpleNamespace(allowed=False),
    )
    monkeypatch.setattr(
        pagination,
        "map_db_to_json",
        lambda _table, record: {"id": record["id"]},
    )

    response = pagination._paginate_records_blocking(
        _request(table="hopdong")
    )
    item = _body(response)["items"][0]

    assert item["goiThauIds"] == ["package-1"]
    assert item["allVersions"] == [{"id": "contract-1", "phienBan": 1}]


@pytest.mark.parametrize(
    ("table_key", "media_columns"),
    [
        ("chuyengia", ("anh_chung_chi", "anh_chu_ky")),
        ("nhathau", ("anh_dau",)),
    ],
)
def test_private_media_is_converted_to_session_bound_urls(
    monkeypatch, table_key, media_columns
):
    row = {
        "id": "record-1",
        "id_goc": None,
        "organization_id": "org-1",
        "phien_ban": 1,
        **{column: f"managed/{column}.png" for column in media_columns},
    }
    _install_success_policy(
        monkeypatch,
        [row],
        versions=[("record-1", None, 1)],
    )
    calls = []

    def protect(path, **kwargs):
        calls.append((path, kwargs))
        return f"/protected/{path}"

    monkeypatch.setattr(pagination, "public_image_path", protect)
    monkeypatch.setattr(
        pagination,
        "authorize_record_write",
        lambda *args, **kwargs: SimpleNamespace(allowed=True),
    )
    monkeypatch.setattr(
        pagination,
        "map_db_to_json",
        lambda _table, record: dict(record),
    )

    response = pagination._paginate_records_blocking(
        _request(table=table_key)
    )

    assert response.status_code == 200
    assert len(calls) == len(media_columns)
    assert all(call[1]["organization_id"] == "org-1" for call in calls)
    assert all(
        call[1]["session_token"] == "session-secret-with-enough-entropy"
        for call in calls
    )


def test_org_scope_error_is_stable_and_unexpected_error_is_redacted(monkeypatch):
    _install_success_policy(monkeypatch)

    def deny(*args, **kwargs):
        raise OrgPermissionError("internal membership detail")

    monkeypatch.setattr(pagination, "get_active_org", deny)
    denied = pagination._paginate_records_blocking(
        _request(table="custompaperstatuses")
    )
    assert denied.status_code == 403
    assert _body(denied)["code"] == "ORG_ACCESS_DENIED"
    assert "internal membership detail" not in denied.body.decode()

    monkeypatch.setattr(
        pagination.database,
        "get_connection",
        lambda: (_ for _ in ()).throw(RuntimeError("database-secret")),
    )
    failed = pagination._paginate_records_blocking(
        _request(table="custompaperstatuses")
    )
    assert failed.status_code == 500
    assert _body(failed)["code"] == "PAGINATION_FAILED"
    assert "database-secret" not in failed.body.decode()
