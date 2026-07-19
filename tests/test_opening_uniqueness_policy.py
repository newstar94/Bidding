from __future__ import annotations

from collections import deque

from backend.sync import opening_uniqueness as policy


class _Cursor:
    def __init__(self, rowsets=()):
        self.rowsets = deque(rowsets)
        self.calls = []

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        return self

    def fetchall(self):
        return self.rowsets.popleft() if self.rowsets else []


def test_lot_scope_and_participant_helpers() -> None:
    assert policy.normalize_lot_scope("") == policy.PACKAGE_SCOPE
    assert policy.normalize_lot_scope("  Lot   A ") == "lot a"
    assert policy._member_ids({"thanhVienLienDanh": "bad"}) == []
    assert policy._member_ids(
        {
            "thanhVienLienDanh": [
                "bad",
                {"thanhVienNhaThauId": "one"},
                {"thanh_vien_nha_thau_id": "two"},
                {"nhaThauId": "three"},
            ]
        }
    ) == ["one", "two", "three"]
    assert policy._is_joint_venture({"loaiNhaThau": " Liên danh "})
    assert policy._incoming_participant_ids(
        {
            "loaiNhaThau": "Liên danh",
            "thanhVienLienDanh": [
                {"thanhVienNhaThauId": "one"},
                {"thanhVienNhaThauId": ""},
            ],
        }
    ) == ["one"]
    assert policy._incoming_participant_ids({"nhaThauId": "one"}) == ["one"]
    assert policy._incoming_participant_ids({}) == []


def test_contractor_roots_are_owner_scoped_and_empty_safe() -> None:
    assert policy._contractor_root_ids(_Cursor(), "org", []) == {}
    cursor = _Cursor(rowsets=[[("version-1", "root-1"), ("plain", "plain")]])
    assert policy._contractor_root_ids(
        cursor, "org", ["version-1", "plain", "", "plain"]
    ) == {"version-1": "root-1", "plain": "plain"}
    assert cursor.calls[0][1][0] == "org"
    assert cursor.calls[0][1][1:] == ("plain", "version-1")


def test_empty_or_invalid_openings_are_ignored() -> None:
    assert policy.validate_opening_participant_uniqueness(
        _Cursor(), "org", []
    ) == []
    assert policy.validate_opening_participant_uniqueness(
        _Cursor(), "org", ["bad", None]
    ) == []


def test_duplicate_contractor_lineage_is_rejected_per_package_lot() -> None:
    cursor = _Cursor(
        rowsets=[
            [
                ("stored-1", "package", "contractor-v1", "Lot A", "Độc lập"),
                ("stored-jv", "package", None, "", "Liên danh"),
            ],
            [("stored-jv", "member-v1")],
            [
                ("contractor-v1", "root-contractor"),
                ("contractor-v2", "root-contractor"),
                ("member-v1", "root-member"),
                ("member-v2", "root-member"),
            ],
        ]
    )
    incoming = [
        {
            "id": "incoming-1",
            "goiThauId": "package",
            "nhaThauId": "contractor-v2",
            "maPhanLo": " lot   a ",
            "loaiNhaThau": "Độc lập",
        },
        {
            "id": "incoming-jv",
            "goiThauId": "package",
            "maPhanLo": "",
            "loaiNhaThau": "Liên danh",
            "thanhVienLienDanh": [
                {"thanhVienNhaThauId": "member-v2"},
                {"thanhVienNhaThauId": "member-v2"},
            ],
        },
    ]
    errors = policy.validate_opening_participant_uniqueness(
        cursor, "org", incoming
    )
    assert {error["id"] for error in errors} == {
        "incoming-1",
        "incoming-jv",
    }
    assert all(error["code"] == "OPENING_CONTRACTOR_DUPLICATE" for error in errors)
    assert any("Lot A" in error["message"] or "lot" in error["message"] for error in errors)
    assert any("toàn" in error["message"] for error in errors)


def test_incoming_update_replaces_stored_values_but_preserves_members_when_omitted() -> None:
    cursor = _Cursor(
        rowsets=[
            [("bid-1", "package", None, "", "Liên danh")],
            [("bid-1", "member-1")],
            [("member-1", "root-1")],
        ]
    )
    errors = policy.validate_opening_participant_uniqueness(
        cursor,
        "org",
        [
            {
                "id": "bid-1",
                "goiThauId": "package-new",
                "loaiNhaThau": "Liên danh",
            }
        ],
    )
    assert errors == []


def test_two_stored_duplicates_do_not_block_unrelated_incoming_record() -> None:
    cursor = _Cursor(
        rowsets=[
            [
                ("stored-1", "package", "contractor", "", "Độc lập"),
                ("stored-2", "package", "contractor", "", "Độc lập"),
            ],
            [],
            [("contractor", "root"), ("new", "new")],
        ]
    )
    assert (
        policy.validate_opening_participant_uniqueness(
            cursor,
            "org",
            [
                {
                    "id": "incoming",
                    "goiThauId": "other-package",
                    "nhaThauId": "new",
                    "loaiNhaThau": "Độc lập",
                }
            ],
        )
        == []
    )
