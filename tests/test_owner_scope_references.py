from __future__ import annotations

from collections import deque

from backend.shared.domain_enums import PACKAGE_STATUS_LABELS
from backend.sync import ownership


class _Result:
    def __init__(self, *, one=None, many=None):
        self.one = one
        self.many = [] if many is None else many

    def fetchone(self):
        return self.one

    def fetchall(self):
        return self.many


class _Cursor:
    def __init__(self, responses=()):
        self.responses = deque(responses)
        self.calls = []

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        if not self.responses:
            return _Result()
        value = self.responses.popleft()
        if isinstance(value, _Result):
            return value
        return _Result(one=value)

    def fetchone(self):
        if not self.responses:
            return None
        value = self.responses.popleft()
        return value.one if isinstance(value, _Result) else value


def test_owner_type_distinguishes_business_personal_and_unknown() -> None:
    assert ownership.get_owner_type(_Cursor([(1,)]), "org-1") == "organization"
    cursor = _Cursor([None, (1,)])
    assert ownership.get_owner_type(cursor, "personal:user-1") == "personal"
    assert cursor.calls[1][1] == ("user-1",)
    assert ownership.get_owner_type(
        _Cursor([None]), "personal:admin"
    ) == "unknown"
    assert ownership.get_owner_type(_Cursor([None]), "unknown") == "unknown"


def test_incoming_record_and_plan_lineage_resolution() -> None:
    records = {
        "ke_hoach_lcnt": {
            "plan-1": {"id": "plan-1", "rootId": "root-1"},
            "plan-2": {"id": "plan-2", "idGoc": "root-2"},
        }
    }
    assert ownership._incoming_record(
        records, "ke_hoach_lcnt", "plan-1"
    )["rootId"] == "root-1"
    assert ownership._incoming_record(None, "goi_thau", "x") is None
    assert ownership._plan_root_id(
        _Cursor(), "org", "", records
    ) is None
    assert ownership._plan_root_id(
        _Cursor(), "org", "plan-1", records
    ) == "root-1"
    assert ownership._plan_root_id(
        _Cursor(), "org", "plan-2", records
    ) == "root-2"
    assert ownership._plan_root_id(
        _Cursor([("stored-root",)]), "org", "stored", records
    ) == "stored-root"
    assert ownership._plan_root_id(
        _Cursor([None]), "org", "missing", records
    ) is None


def test_assignment_references_require_active_owner_membership_and_target() -> None:
    item = {
        "empId": "user-2",
        "targetId": "package-1",
        "type": "goithau",
    }
    errors = ownership.validate_owner_scoped_references(
        _Cursor([None, None]), "org-1", "phan_cong_nhan_su", item
    )
    assert len(errors) == 2
    assert "user-2" in errors[0]
    assert "package-1" in errors[1]

    cursor = _Cursor([None, (1,)])
    errors = ownership.validate_owner_scoped_references(
        cursor,
        "org-1",
        "phan_cong_nhan_su",
        item,
        incoming_ids_by_table={"goi_thau": {"package-1"}},
    )
    assert errors == []
    assert len(cursor.calls) == 1

    personal = {
        "empId": "personal:user-1",
        "targetId": "",
        "type": "invalid",
    }
    assert ownership.validate_owner_scoped_references(
        _Cursor(), "personal:user-1", "phan_cong_nhan_su", personal
    ) == []


def test_assignment_reference_accepts_platform_admin_as_an_effective_specialist() -> None:
    cursor = _Cursor([None, (1,)])
    errors = ownership.validate_owner_scoped_references(
        cursor,
        "org-1",
        "phan_cong_nhan_su",
        {"empId": "admin-1", "targetId": "package-1", "type": "goithau"},
        incoming_ids_by_table={"goi_thau": {"package-1"}},
    )

    assert errors == []
    membership_query = cursor.calls[0][0]
    assert "tai_khoan" in membership_query
    assert "super_admin" in membership_query


def test_owner_references_accept_incoming_ids_and_reject_cross_tenant_rows() -> None:
    item = {
        "keHoachId": "plan-1",
        "nhaThauTrungThauId": "contractor-1",
    }
    errors = ownership.validate_owner_scoped_references(
        _Cursor([None, None]), "org", "goi_thau", item
    )
    assert len(errors) == 2
    assert all("owner" in error for error in errors)
    assert ownership.validate_owner_scoped_references(
        _Cursor(),
        "org",
        "goi_thau",
        item,
        incoming_ids_by_table={
            "ke_hoach_lcnt": {"plan-1"},
            "nha_thau": {"contractor-1"},
        },
    ) == []


def test_rebid_source_must_exist_be_cancelled_and_not_create_cycle() -> None:
    item = {
        "id": "package-new",
        "rebidFromPackageId": "package-source",
    }
    incoming = {"goi_thau": {"package-source"}}
    errors = ownership.validate_owner_scoped_references(
        _Cursor([None, None]),
        "org",
        "goi_thau",
        item,
        incoming_ids_by_table=incoming,
    )
    assert any("khong ton tai" in error for error in errors)

    errors = ownership.validate_owner_scoped_references(
        _Cursor([("INVITED",), (1,)]),
        "org",
        "goi_thau",
        item,
        incoming_ids_by_table=incoming,
    )
    assert len(errors) == 2

    errors = ownership.validate_owner_scoped_references(
        _Cursor([("CANCELLED",), None]),
        "org",
        "goi_thau",
        item,
        incoming_ids_by_table=incoming,
    )
    assert errors == []


def test_winner_requires_opened_bid_with_passing_conclusion() -> None:
    item = {
        "id": "package",
        "nhaThauTrungThauId": "winner",
        "trangThai": PACKAGE_STATUS_LABELS["AWARDED"],
        "hinhThucLuaChon": "Đấu thầu rộng rãi",
    }
    incoming_ids = {"nha_thau": {"winner"}}
    errors = ownership.validate_owner_scoped_references(
        _Cursor([None]),
        "org",
        "goi_thau",
        item,
        incoming_ids_by_table=incoming_ids,
    )
    assert any("danh sách hồ sơ" in error for error in errors)

    errors = ownership.validate_owner_scoped_references(
        _Cursor([("opening", "Không đạt")]),
        "org",
        "goi_thau",
        item,
        incoming_ids_by_table=incoming_ids,
    )
    assert any("kết luận" in error for error in errors)

    incoming_records = {
        "thong_tin_mo_thau": {
            "opening": {
                "id": "opening",
                "goiThauId": "package",
                "nhaThauId": "winner",
                "danhGiaKetLuan": "Đạt yêu cầu",
            }
        }
    }
    assert ownership.validate_owner_scoped_references(
        _Cursor([None]),
        "org",
        "goi_thau",
        item,
        incoming_ids_by_table=incoming_ids,
        incoming_records_by_table=incoming_records,
    ) == []

    direct = {
        **item,
        "hinhThucLuaChon": "Chỉ định thầu rút gọn",
    }
    assert ownership.validate_owner_scoped_references(
        _Cursor(),
        "org",
        "goi_thau",
        direct,
        incoming_ids_by_table=incoming_ids,
    ) == []

    awarded_without_winner = {
        "id": "package",
        "trangThai": PACKAGE_STATUS_LABELS["AWARDED"],
    }
    errors = ownership.validate_owner_scoped_references(
        _Cursor(), "org", "goi_thau", awarded_without_winner
    )
    assert errors


def _contract_item(**overrides):
    item = {
        "keHoachId": "plan",
        "nhaThauId": "winner",
        "chuDauTuId": "investor",
        "goiThauIds": ["package"],
        "giaTri": "100",
        "coQdChiDinh": False,
    }
    item.update(overrides)
    return item


def _contract_incoming_records(**package_overrides):
    package = {
        "id": "package",
        "keHoachId": "plan",
        "trangThai": PACKAGE_STATUS_LABELS["AWARDED"],
        "nhaThauTrungThauId": "winner",
        "giaTrungThau": "100",
        "giaGoiThau": "150",
    }
    package.update(package_overrides)
    return {
        "ke_hoach_lcnt": {
            "plan": {"id": "plan", "rootId": "plan-root"}
        },
        "goi_thau": {"package": package},
    }


def _contract_incoming_ids():
    return {
        "chu_dau_tu": {"investor"},
        "nha_thau": {"winner"},
        "ke_hoach_lcnt": {"plan"},
    }


def test_contract_packages_must_share_plan_winner_status_and_value() -> None:
    assert ownership.validate_owner_scoped_references(
        _Cursor(),
        "org",
        "hop_dong",
        _contract_item(),
        incoming_ids_by_table=_contract_incoming_ids(),
        incoming_records_by_table=_contract_incoming_records(),
    ) == []

    errors = ownership.validate_owner_scoped_references(
        _Cursor(),
        "org",
        "hop_dong",
        _contract_item(goiThauIds=["package", "package"], giaTri="999"),
        incoming_ids_by_table=_contract_incoming_ids(),
        incoming_records_by_table=_contract_incoming_records(
            keHoachId="other-plan",
            trangThai=PACKAGE_STATUS_LABELS["INVITED"],
            nhaThauTrungThauId="other",
            giaTrungThau="100",
        ),
    )
    assert len(errors) >= 5

    direct_errors = ownership.validate_owner_scoped_references(
        _Cursor(),
        "org",
        "hop_dong",
        _contract_item(coQdChiDinh=True, giaTri="151"),
        incoming_ids_by_table=_contract_incoming_ids(),
        incoming_records_by_table=_contract_incoming_records(),
    )
    assert any("vượt" in error for error in direct_errors)


def test_contract_missing_stored_package_does_not_run_value_comparison() -> None:
    errors = ownership.validate_owner_scoped_references(
        _Cursor([None]),
        "org",
        "hop_dong",
        _contract_item(),
        incoming_ids_by_table=_contract_incoming_ids(),
        incoming_records_by_table={
            "ke_hoach_lcnt": {
                "plan": {"id": "plan", "rootId": "plan-root"}
            }
        },
    )
    assert any("không tồn tại" in error for error in errors)


def test_opening_lot_and_joint_venture_references_are_owner_scoped() -> None:
    item = {
        "goiThauId": "package",
        "nhaThauId": "contractor",
        "maPhanLo": "B",
        "thanhVienLienDanh": [
            "invalid",
            {"thanhVienNhaThauId": ""},
            {"thanhVienNhaThauId": "member-incoming"},
            {"thanhVienNhaThauId": "member-missing"},
        ],
    }
    incoming_ids = {
        "goi_thau": {"package"},
        "nha_thau": {"contractor", "member-incoming"},
    }
    incoming_records = {
        "goi_thau": {
            "package": {
                "id": "package",
                "phanLo": "Có",
                "phanLoList": [{"maPhanLo": "A"}],
            }
        },
        "nha_thau": {
            "member-incoming": {"id": "member-incoming", "rootId": "root"}
        },
    }
    errors = ownership.validate_owner_scoped_references(
        _Cursor([None, None]),
        "org",
        "thong_tin_mo_thau",
        item,
        incoming_ids_by_table=incoming_ids,
        incoming_records_by_table=incoming_records,
    )
    assert any("phần lô" in error for error in errors)
    assert any("member-missing" in error for error in errors)

    stored_cursor = _Cursor(
        [
            ("Có",),
            _Result(many=[("A",)]),
            ("root-1",),
            ("root-1",),
        ]
    )
    errors = ownership.validate_owner_scoped_references(
        stored_cursor,
        "org",
        "thong_tin_mo_thau",
        {
            "goiThauId": "package",
            "nhaThauId": "",
            "maPhanLo": "A",
            "thanhVienLienDanh": [
                {"thanhVienNhaThauId": "v1"},
                {"thanhVienNhaThauId": "v2"},
            ],
        },
        incoming_ids_by_table={"goi_thau": {"package"}, "nha_thau": {"v1", "v2"}},
    )
    assert any("nhiều phiên bản" in error for error in errors)


def test_non_lotted_package_rejects_lot_code() -> None:
    errors = ownership.validate_owner_scoped_references(
        _Cursor([("Không",), _Result(many=[])]),
        "org",
        "thong_tin_mo_thau",
        {"goiThauId": "package", "maPhanLo": "A"},
        incoming_ids_by_table={"goi_thau": {"package"}},
    )
    assert any("không phân lô" in error for error in errors)
