from pathlib import Path
from types import SimpleNamespace

from backend.sync.payload_validation import (
    validate_package_locked_fields,
    validate_package_status_transition,
    validate_sync_item,
    validate_sync_payload_shape,
)
from backend.sync.request_contract import (
    generated_aggregate_batch_limit,
    sync_batch_limit,
)
from backend.procurement_import.sync_binding import _session_records
from backend.shared.access_policy import AccessDecision
from backend.sync import deletion_service


def test_manual_unknown_to_invited_package_transition_remains_rejected():
    errors = validate_package_status_transition(
        "Chưa xác định",
        {"trangThai": "Đang mời thầu"},
    )

    assert errors == [
        "Không được chuyển trạng thái gói thầu từ 'Chưa xác định' "
        "sang 'Đang mời thầu'."
    ]


def test_trusted_procurement_reconciliation_allows_unknown_to_invited():
    errors = validate_package_status_transition(
        "Chưa xác định",
        {"trangThai": "Đang mời thầu"},
        allow_source_reconciliation=True,
    )

    assert errors == []


def test_invited_package_scheduling_fields_are_server_locked():
    previous = {
        "trang_thai": "INVITED",
        "thoi_gian_thuc_hien": "120 ngày",
        "thoi_gian_to_chuc": "90 ngày",
        "thoi_gian_bat_dau_to_chuc": "Quý III/2026",
    }
    errors = validate_package_locked_fields(previous, {
        "thoiGianThucHien": "150 ngày",
        "thoiGianToChuc": "100 ngày",
        "thoiGianBatDauToChuc": "Quý IV/2026",
    })

    assert {error["field"] for error in errors} == {
        "thoiGianThucHien",
        "thoiGianToChuc",
        "thoiGianBatDauToChuc",
    }


def test_manual_invited_package_evaluation_method_remains_server_locked():
    errors = validate_package_locked_fields(
        {
            "trang_thai": "INVITED",
            "phuong_phap_danh_gia": "Giá thấp nhất",
        },
        {"phuongPhapDanhGia": "Kết hợp giữa kỹ thuật và giá"},
    )

    assert errors == [{
        "field": "phuongPhapDanhGia",
        "code": "PACKAGE_FIELD_LOCKED",
        "message": (
            "Trường này không được sửa sau khi phát hành mời thầu; "
            "hãy tạo phiên bản gói thầu mới."
        ),
    }]


def test_trusted_procurement_reconciliation_can_refresh_invited_locked_fields():
    previous = {
        "trang_thai": "INVITED",
        "phuong_phap_danh_gia": "Giá thấp nhất",
        "thoi_gian_thuc_hien": "120 ngày",
    }

    errors = validate_package_locked_fields(
        previous,
        {
            "phuongPhapDanhGia": "Kết hợp giữa kỹ thuật và giá",
            "thoiGianThucHien": "150 ngày",
        },
        allow_source_reconciliation=True,
    )

    assert errors == []


def test_trusted_msc_plan_option_flag_can_wait_for_unpublished_item_details():
    def package():
        return {
            "keHoachId": "plan-00",
            "tenGoiThau": "Gói có tùy chọn mua thêm từ MSC",
            "giaGoiThau": "1000000",
            "thoiGianThucHien": "30 ngày",
            "nguonVon": "Ngân sách nhà nước",
            "thoiGianToChuc": "30 ngày",
            "thoiGianBatDauToChuc": "Quý III/2026",
            "phanLo": "Không",
            "phanLoList": [],
            "tuyChonMuaThem": "Có",
            "tuyChonMuaThemList": [],
        }

    message = "Gói có tùy chọn mua thêm phải khai báo ít nhất một hạng mục."
    _, manual_errors, _ = validate_sync_item("goi_thau", package())
    _, imported_errors, _ = validate_sync_item(
        "goi_thau",
        package(),
        allow_source_option_without_items=True,
    )

    assert message in manual_errors
    assert message not in imported_errors


def test_mutating_sync_payload_requires_client_mutation_id():
    errors = validate_sync_payload_shape({
        "goithau": [{"id": "package-1"}],
        "baseSyncVersion": 1,
    })

    assert any(
        error["field"] == "clientMutationId"
        and error["code"] == "MUTATION_ID_REQUIRED"
        for error in errors
    )


def test_read_only_sync_payload_does_not_require_client_mutation_id():
    errors = validate_sync_payload_shape({"includeDashboardSummary": True})

    assert not any(error["field"] == "clientMutationId" for error in errors)


def test_server_generated_aggregate_has_a_separate_bounded_limit(monkeypatch):
    monkeypatch.setenv("SYNC_MAX_BATCH_ITEMS", "2000")
    monkeypatch.setenv("AGGREGATE_VERSION_MAX_ITEMS", "25000")
    assert sync_batch_limit() == 2000
    assert generated_aggregate_batch_limit() == 25000


def test_sync_accepts_only_bounded_source_revision_authority_on_plan_and_package():
    authority = {
        "sessionId": "session-1", "workspaceLease": "lease-1",
        "provider": "MUASAMCONG",
        "familyNo": "PL2600000001", "revisionId": "rev-00",
        "revisionNumber": "00", "revisionDigest": "sha256:" + "a" * 64,
    }
    errors = validate_sync_payload_shape({
        "clientMutationId": "mutation-1",
        "kehoach": [{"id": "plan-1", "sourceRevision": authority}],
        "goithau": [{
            "id": "package-1",
            "sourceRevision": {
                **authority, "packageObservationId": "detail-a",
                "stablePackageId": "stable-a", "packageRevisionNumber": "01",
            },
        }],
    })
    assert errors == []

    malicious = validate_sync_payload_shape({
        "clientMutationId": "mutation-2",
        "kehoach": [{
            "id": "plan-1",
            "sourceRevision": {**authority, "canonicalPayload": {"name": "fake"}},
        }],
    })
    assert any(
        error["field"].endswith("sourceRevision.canonicalPayload")
        and error["code"] == "UNKNOWN_FIELD"
        for error in malicious
    )


def test_import_authority_uses_only_records_that_carry_bounded_authority():
    def authority(number):
        return {
            "sessionId": "session-1", "workspaceLease": "lease-1",
            "provider": "MUASAMCONG",
            "familyNo": "PL2600000001", "revisionId": f"rev-{number}",
            "revisionNumber": number, "revisionDigest": "sha256:" + number[0] * 64,
        }

    context = _session_records({
        "kehoach": [
            {"id": "plan-00"},
            {"id": "plan-01", "sourceRevision": authority("01")},
        ],
        "goithau": [
            {"id": "package-00"},
            {"id": "package-01", "sourceRevision": authority("01")},
        ],
    })
    assert context["revisionNumber"] == "01"
    assert [row["id"] for row in context["plans"]] == ["plan-01"]
    assert [row["id"] for row in context["packages"]] == ["package-01"]


def test_import_authority_rejects_two_source_revisions_even_if_client_demotes_one():
    def authority(number):
        return {
            "sessionId": "session-1", "workspaceLease": "lease-1",
            "provider": "MUASAMCONG",
            "familyNo": "PL2600000001", "revisionId": f"rev-{number}",
            "revisionNumber": number, "revisionDigest": "sha256:" + "a" * 64,
        }

    import pytest

    with pytest.raises(ValueError, match="PROCUREMENT_SOURCE_VERSION_CONFLICT"):
        _session_records({
            "kehoach": [
                {"id": "plan-00", "isLatest": 0, "sourceRevision": authority("00")},
                {"id": "plan-01", "isLatest": 1, "sourceRevision": authority("01")},
            ],
        })
from backend.sync.record_validator import historical_record_mutation_error
from backend.sync.aggregate_mutability import (
    AggregateMutabilityContext,
    build_aggregate_mutability_context,
    historical_parent_mutation_error,
    package_mutability_error,
)


def test_generic_sync_rejects_historical_plan_and_package_mutation():
    for table_name in ("ke_hoach_lcnt", "goi_thau"):
        error = historical_record_mutation_error(
            table_name, {"id": "historical", "is_latest": 0}
        )
        assert error["code"] == "HISTORICAL_RECORD_IMMUTABLE"
    assert historical_record_mutation_error(
        "goi_thau", {"id": "latest", "is_latest": 1}
    ) is None


def test_package_and_children_under_historical_plan_are_immutable():
    context = AggregateMutabilityContext(
        package_plan_by_id={"package-1": "plan-history"},
        plan_is_latest_by_id={"plan-history": False},
    )
    cases = (
        ("goi_thau", {"id": "package-1"}, None),
        ("thong_tin_mo_thau", {"goiThauId": "package-1"}, None),
        ("goi_thau_hang_hoa", {"id": "goods-1"}, {"goi_thau_id": "package-1"}),
        ("hang_hoa_du_thau_nha_thau", {"goiThauId": "package-1"}, None),
        (
            "phan_cong_nhan_su",
            {"type": "goithau", "targetId": "package-1"},
            None,
        ),
    )
    for table_name, item, current in cases:
        error = historical_parent_mutation_error(
            context, table_name, item, current
        )
        assert error["code"] == "HISTORICAL_PARENT_IMMUTABLE"


def test_new_plan_and_packages_in_same_sync_batch_are_mutable():
    class Cursor:
        def execute(self, _sql, _parameters=()):
            raise AssertionError("complete incoming ownership must not query PostgreSQL")

    context = build_aggregate_mutability_context(
        Cursor(),
        "org-1",
        {
            "ke_hoach_lcnt": [{
                "id": "plan-new",
                "maKeHoach": "PL2600164871",
            }],
            "goi_thau": [
                {"id": "package-1", "keHoachId": "plan-new"},
                {"id": "package-2", "keHoachId": "plan-new"},
                {"id": "package-3", "keHoachId": "plan-new"},
            ],
        },
        current_records_by_table={
            "ke_hoach_lcnt": {},
            "goi_thau": {},
        },
    )

    assert context.plan_is_latest_by_id == {"plan-new": True}
    assert all(
        historical_parent_mutation_error(context, "goi_thau", {"id": package_id})
        is None
        for package_id in ("package-1", "package-2", "package-3")
    )


def test_existing_historical_plan_in_sync_batch_remains_immutable():
    class Cursor:
        def execute(self, _sql, _parameters=()):
            raise AssertionError("complete incoming ownership must not query PostgreSQL")

    context = build_aggregate_mutability_context(
        Cursor(),
        "org-1",
        {
            "ke_hoach_lcnt": [{"id": "plan-history"}],
            "goi_thau": [{"id": "package-1", "keHoachId": "plan-history"}],
        },
        current_records_by_table={
            "ke_hoach_lcnt": {
                "plan-history": {"id": "plan-history", "is_latest": 0},
            },
            "goi_thau": {},
        },
    )

    error = historical_parent_mutation_error(
        context,
        "goi_thau",
        {"id": "package-1"},
    )
    assert error["code"] == "HISTORICAL_PARENT_IMMUTABLE"


def test_sync_has_no_successor_requirement_for_optional_assignments():
    service_source = Path("backend/sync/service.py").read_text(encoding="utf-8")

    assert "ASSIGNMENT_SUCCESSOR_REQUIRED" not in service_source
    assert "find_unreplaced_assignment_removals" not in service_source


def test_direct_package_mutability_guard_locks_owning_plan_and_fails_closed():
    class Cursor:
        def __init__(self, latest):
            self.latest = latest
            self.sql = ""
            self.parameters = ()

        def execute(self, sql, parameters=()):
            self.sql = " ".join(str(sql).split())
            self.parameters = tuple(parameters)
            return self

        def fetchone(self):
            return ("package-1", "plan-1", self.latest)

    latest = Cursor(1)
    historical = Cursor(0)

    assert package_mutability_error(latest, "org-1", "package-1") is None
    denied = package_mutability_error(historical, "org-1", "package-1")
    assert denied["code"] == "HISTORICAL_PARENT_IMMUTABLE"
    assert "FOR UPDATE OF package, plan" in historical.sql
    assert historical.parameters == ("org-1", "package-1")


def test_package_deletion_may_remove_historical_snapshots(monkeypatch):
    packages = {
        "package-history": {
            "id": "package-history",
            "id_goc": "package-root",
            "ke_hoach_id": "plan-history",
            "row_version": 1,
            "archived_at": None,
        },
        "package-current": {
            "id": "package-current",
            "id_goc": "package-root",
            "ke_hoach_id": "plan-current",
            "row_version": 1,
            "archived_at": None,
        },
    }

    class Answer:
        def __init__(self, rows=()):
            self.rows = list(rows)

        def fetchall(self):
            return list(self.rows)

        def fetchone(self):
            return self.rows[0] if self.rows else None

    class Cursor:
        rowcount = 1

        def __init__(self):
            self.answer = Answer()

        def execute(self, sql, parameters=()):
            normalized = " ".join(str(sql).split())
            parameters = tuple(parameters)
            if normalized.startswith("SELECT * FROM goi_thau"):
                self.answer = Answer(
                    packages[record_id]
                    for record_id in parameters[1:]
                    if record_id in packages
                )
            elif normalized.startswith("SELECT id, is_latest FROM ke_hoach_lcnt"):
                self.answer = Answer([
                    ("plan-history", 0),
                    ("plan-current", 1),
                ])
            elif normalized.startswith(
                "SELECT id, COALESCE(id_goc, id) AS family_root FROM goi_thau"
            ):
                self.answer = Answer([
                    ("package-history", "package-root"),
                    ("package-current", "package-root"),
                ])
            else:
                self.answer = Answer()
            return self

        def fetchall(self):
            return self.answer.fetchall()

        def fetchone(self):
            return self.answer.fetchone()

    def impacts(_cursor, _organization_id, _table_name, record_ids):
        return {
            str(record_id): {
                "rootCount": 1,
                "dependentCount": 0,
                "totalCount": 1,
                "dependents": [],
                "assignmentCount": 0,
            }
            for record_id in record_ids
        }

    monkeypatch.setattr(
        deletion_service,
        "build_delete_impacts_by_record_ids",
        impacts,
    )
    monkeypatch.setattr(
        deletion_service,
        "find_blocking_delete_references_by_record_ids",
        lambda _cursor, _organization_id, _table_name, record_ids: {
            str(record_id): [] for record_id in record_ids
        },
    )
    monkeypatch.setattr(
        deletion_service,
        "build_batch_write_authorization_context",
        lambda *_args, **_kwargs: SimpleNamespace(organization_manager=True),
    )
    monkeypatch.setattr(
        deletion_service,
        "authorize_record_write_from_context",
        lambda *_args, **_kwargs: AccessDecision(True),
    )
    monkeypatch.setattr(
        deletion_service,
        "insert_delete_audit",
        lambda *_args, **_kwargs: None,
    )

    historical_only = deletion_service.apply_sync_deletions(
        Cursor(),
        [{"table": "goithau", "id": "package-history", "expectedVersion": 1}],
        organization_id="org-1",
        actor_role="manager",
        actor_user_id="manager-1",
        current_time="2026-08-15 12:00:00",
        sync_version=2,
        clean_record_id=lambda _table, value: str(value) if value else None,
        ip_address="127.0.0.1",
    )

    assert historical_only["errors"] == []
    assert {item["id"] for item in historical_only["impacts"]} == {
        "package-history",
    }

    result = deletion_service.apply_sync_deletions(
        Cursor(),
        [
            {"table": "goithau", "id": "package-history", "expectedVersion": 1},
            {"table": "goithau", "id": "package-current", "expectedVersion": 1},
        ],
        organization_id="org-1",
        actor_role="manager",
        actor_user_id="manager-1",
        current_time="2026-08-15 12:00:00",
        sync_version=2,
        clean_record_id=lambda _table, value: str(value) if value else None,
        ip_address="127.0.0.1",
    )

    assert result["errors"] == []
    assert {item["id"] for item in result["impacts"]} == {
        "package-history",
        "package-current",
    }


def test_historical_child_delete_exception_requires_parent_package_in_batch():
    record = {"goi_thau_id": "package-history"}

    assert not deletion_service._historical_delete_is_part_of_package_deletion(
        "thong_tin_mo_thau",
        record,
        set(),
    )
    assert deletion_service._historical_delete_is_part_of_package_deletion(
        "thong_tin_mo_thau",
        record,
        {"package-history"},
    )
