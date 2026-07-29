from backend.sync.opening_uniqueness import validate_opening_participant_uniqueness
from backend.sync.payload_validation import validate_sync_item


def _member(contractor_id, role):
    return {
        "thanhVienNhaThauId": contractor_id,
        "vaiTro": role,
    }


def _joint_venture(*members):
    return {
        "loaiNhaThau": "Liên danh",
        "thanhVienLienDanh": list(members),
    }


def _errors(payload):
    _, errors, _ = validate_sync_item("thong_tin_mo_thau", payload)
    return errors


def test_jv_01_and_jv_02_accept_two_or_more_unique_members_with_one_leader():
    two_members = _joint_venture(
        _member("contractor-1", "Đứng đầu liên danh"),
        _member("contractor-2", "Thành viên liên danh"),
    )
    three_members = _joint_venture(
        _member("contractor-1", "Đứng đầu liên danh"),
        _member("contractor-2", "Thành viên liên danh"),
        _member("contractor-3", "Thành viên liên danh"),
    )
    assert _errors(two_members) == []
    assert _errors(three_members) == []


def test_jv_03_requires_a_leader():
    errors = _errors(_joint_venture(
        _member("contractor-1", "Thành viên liên danh"),
        _member("contractor-2", "Thành viên liên danh"),
    ))
    assert "Liên danh phải có đúng một thành viên đứng đầu." in errors


def test_jv_04_rejects_two_leaders():
    errors = _errors(_joint_venture(
        _member("contractor-1", "Đứng đầu liên danh"),
        _member("contractor-2", "Đứng đầu liên danh"),
    ))
    assert "Liên danh phải có đúng một thành viên đứng đầu." in errors


def test_jv_05_rejects_a_duplicate_member():
    errors = _errors(_joint_venture(
        _member("contractor-1", "Đứng đầu liên danh"),
        _member("contractor-1", "Thành viên liên danh"),
    ))
    assert "Một nhà thầu không được xuất hiện nhiều lần trong cùng liên danh." in errors


class _OpeningCursor:
    def __init__(self, roots):
        self.roots = roots
        self.rows = []

    def execute(self, sql, params=()):
        if "FROM thong_tin_mo_thau" in sql:
            self.rows = []
        elif "FROM nha_thau" in sql:
            requested = {str(value) for value in params[1:]}
            self.rows = [
                (contractor_id, root_id)
                for contractor_id, root_id in self.roots.items()
                if contractor_id in requested
            ]
        else:
            self.rows = []
        return self

    def fetchall(self):
        return self.rows


def _opening(bid_id, package_id, contractor_id=None, members=None, lot=None):
    return {
        "id": bid_id,
        "goiThauId": package_id,
        "maPhanLo": lot,
        "nhaThauId": contractor_id,
        "loaiNhaThau": "Liên danh" if members else "Độc lập",
        "thanhVienLienDanh": members or [],
    }


def test_jv_10_rejects_the_same_contractor_as_independent_and_joint_venture_in_one_scope():
    cursor = _OpeningCursor({"c1": "root-1", "c2": "root-2"})
    errors = validate_opening_participant_uniqueness(cursor, "org-1", [
        _opening("bid-1", "pkg-1", contractor_id="c1"),
        _opening("bid-2", "pkg-1", members=[
            _member("c1", "Đứng đầu liên danh"),
            _member("c2", "Thành viên liên danh"),
        ]),
    ])
    assert any(error["code"] == "OPENING_CONTRACTOR_DUPLICATE" for error in errors)


def test_jv_11_rejects_shared_members_across_joint_ventures_in_one_scope():
    cursor = _OpeningCursor({"c1": "root-1", "c2": "root-2", "c3": "root-3"})
    errors = validate_opening_participant_uniqueness(cursor, "org-1", [
        _opening("bid-1", "pkg-1", members=[
            _member("c1", "Đứng đầu liên danh"),
            _member("c2", "Thành viên liên danh"),
        ]),
        _opening("bid-2", "pkg-1", members=[
            _member("c3", "Đứng đầu liên danh"),
            _member("c2", "Thành viên liên danh"),
        ]),
    ])
    assert any(error["code"] == "OPENING_CONTRACTOR_DUPLICATE" for error in errors)


def test_joint_venture_members_may_participate_in_different_lots():
    cursor = _OpeningCursor({"c1": "root-1", "c2": "root-2"})
    errors = validate_opening_participant_uniqueness(cursor, "org-1", [
        _opening("bid-1", "pkg-1", members=[
            _member("c1", "Đứng đầu liên danh"),
            _member("c2", "Thành viên liên danh"),
        ], lot="L1"),
        _opening("bid-2", "pkg-1", members=[
            _member("c1", "Đứng đầu liên danh"),
            _member("c2", "Thành viên liên danh"),
        ], lot="L2"),
    ])
    assert errors == []
