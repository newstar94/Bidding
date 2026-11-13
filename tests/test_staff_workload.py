"""ADR 0104: manager-only staff coordination board on the dashboard."""

from backend.sync import dashboard_summary


class SequencedCursor:
    """Returns one prepared result set per execute call, in order."""

    def __init__(self, results):
        self.results = list(results)
        self.queries = []
        self._current = []

    def execute(self, sql, params=()):
        self.queries.append((sql, tuple(params)))
        self._current = self.results.pop(0)
        return self

    def fetchall(self):
        return list(self._current)


MEMBERS = [
    ("owner-1", "Chủ tổ chức", "manager", 1),
    ("emp-1", "Nguyễn An", "employee", 0),
    ("emp-2", "Trần Bình", "employee", 0),
]
ASSIGNMENTS = [
    ("emp-1", "goithau", "pkg-1"),
    ("emp-2", "goithau", "pkg-1"),  # shared package counts for both
    ("emp-1", "goithau", "pkg-2"),
    ("emp-2", "hopdong", "hd-1"),
    ("left-1", "goithau", "pkg-3"),  # former member: package is unassigned
    ("emp-1", "kehoach", "kh-1"),
]
PACKAGES = [
    ("pkg-1", "INVITED", "closingSoon", "2026-11-18 09:00", None),
    ("pkg-2", "EVALUATING", "delayedEvaluation", "2026-10-20 09:00", "2026-10-21 09:00"),
    ("pkg-3", "PREPARING", "", None, None),
    ("pkg-4", "PARTIALLY_AWARDED", "", None, None),
]
CONTRACTS = [("hd-1",), ("hd-2",)]


def _board(other_alerts=(), with_contracts=True):
    results = [MEMBERS, ASSIGNMENTS, PACKAGES]
    if with_contracts:
        results.append(CONTRACTS)
    cursor = SequencedCursor(results)
    board = dashboard_summary._staff_workload(
        cursor,
        "org-1",
        "SELECT 1",
        ["org-1"],
        "''",
        list(other_alerts),
        "SELECT * FROM hop_dong WHERE organization_id = ?" if with_contracts else None,
    )
    return board, cursor


def _row(board, user_id):
    return next(row for row in board["rows"] if row["userId"] == user_id)


def test_counts_open_packages_by_stage_for_every_assignee():
    board, _cursor = _board()
    an = _row(board, "emp-1")
    assert (an["activePackages"], an["inviting"], an["evaluating"], an["preparing"]) == (2, 1, 1, 0)
    binh = _row(board, "emp-2")
    assert (binh["activePackages"], binh["inviting"], binh["activeContracts"]) == (1, 1, 1)
    assert _row(board, "owner-1")["activePackages"] == 0


def test_status_alerts_use_their_own_deadline():
    board, _cursor = _board()
    an = _row(board, "emp-1")
    assert an["alerts"] == 2
    # delayedEvaluation uses the opening time, closingSoon the closing time.
    assert an["earliestDeadline"] == "2026-10-21"
    assert _row(board, "emp-2")["earliestDeadline"] == "2026-11-18"


def test_packages_without_an_active_assignee_are_unassigned():
    board, _cursor = _board()
    unassigned = board["unassigned"]
    assert (unassigned["activePackages"], unassigned["preparing"], unassigned["evaluating"]) == (2, 1, 1)


def test_other_alerts_follow_assignment_and_skip_status_duplicates():
    other = [
        {"targetType": "package", "id": "pkg-1", "alertKey": "closingSoon", "deadline": "2026-11-18"},
        {"targetType": "package", "id": "pkg-2", "alertKey": "bidValidityExpiring", "deadline": "2026-10-01"},
        {"targetType": "contract", "id": "hd-1", "alertKey": "contractExpiring", "deadline": "2026-11-20"},
        {"targetType": "plan", "id": "kh-1", "alertKey": "planPublishingWarning", "deadline": "2026-11-16T00:00:00.000Z"},
        {"targetType": "package", "id": "pkg-4", "alertKey": "milestoneOverdue", "deadline": "2026-11-01"},
    ]
    board, _cursor = _board(other)
    an = _row(board, "emp-1")
    assert an["alerts"] == 4  # two status alerts + validity on pkg-2 + plan kh-1
    assert an["earliestDeadline"] == "2026-10-01"
    assert _row(board, "emp-2")["alerts"] == 2  # closingSoon on pkg-1 + contract hd-1
    assert board["unassigned"]["alerts"] == 1  # milestone on unassigned pkg-4


def test_rows_are_sorted_by_alerts_then_workload():
    board, _cursor = _board()
    assert [row["userId"] for row in board["rows"]] == ["emp-1", "emp-2", "owner-1"]
    assert _row(board, "owner-1")["role"] == "owner"


def test_queries_stay_inside_the_organization():
    _board_result, cursor = _board()
    members_sql, members_params = cursor.queries[0]
    assert "tvtc.organization_id = ?" in members_sql and members_params == ("org-1",)
    assert "trang_thai_thanh_vien" in members_sql
    assert cursor.queries[1][1] == ("org-1",)
    assert "AWARDED" in cursor.queries[2][0] and "CANCELLED" in cursor.queries[2][0]
    assert cursor.queries[3][1][0] == "org-1"


def test_contract_column_is_skipped_without_contract_permission():
    board, cursor = _board(with_contracts=False)
    assert len(cursor.queries) == 3
    assert _row(board, "emp-2")["activeContracts"] == 0
