from copy import deepcopy
from decimal import Decimal
import inspect
import time
from types import SimpleNamespace

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.version_comparison.diff_kernel import compare_snapshots
from backend.version_comparison.errors import VersionComparisonError
from backend.version_comparison.routes import version_comparison_routes
from backend.version_comparison.service import VersionComparisonService
from backend.version_comparison.providers.timeline import TimelineImpactProvider
from backend.version_comparison.providers.legal import LegalImpactProvider
from backend.version_comparison.providers.documents import GeneratedDocumentImpactProvider
from backend.auth.auth_helper import SessionRole
from backend.sync.visibility_scope import VisibilityScope
from backend.version_comparison.read_repository import VersionComparisonReadRepository
from tests.test_read_scope_contract import _delete_seeded_workspace
from tests.test_sync_conflict_authorization import _seed_denied_package, _test_database


def _snapshot(*, record_id, version, closing_time, goods, assignments):
    return {
        "entityType": "goithau",
        "record": {
            "id": record_id,
            "rootId": "package-root",
            "phienBan": version,
            "rowVersion": 3,
            "thoiGianDongThau": closing_time,
            "soCCCD": "001234567890",
            "soTaiKhoan": "1234567890",
            "anhChuKy": "/images/signature.png",
            "anhDau": "/images/stamp.png",
        },
        "relations": {
            "hangHoa": goods,
            "assignments": assignments,
        },
        "context": {},
    }


def test_compare_snapshots_returns_full_values_and_matches_cloned_relations():
    left = _snapshot(
        record_id="package-v1",
        version=1,
        closing_time="2026-08-10T09:00:00",
        goods=[{
            "id": "physical-goods-v1",
            "maHangHoa": "HH-01",
            "tenHangHoa": "Máy tính",
            "soLuong": 10,
        }],
        assignments=[{"id": "assignment-v1", "empId": "employee-a", "type": "goithau"}],
    )
    right = _snapshot(
        record_id="package-v2",
        version=2,
        closing_time="2026-08-12T09:00:00",
        goods=[{
            "id": "physical-goods-v2",
            "maHangHoa": "HH-01",
            "tenHangHoa": "Máy tính",
            "soLuong": 12,
        }],
        assignments=[
            {"id": "assignment-v2", "empId": "employee-a", "type": "goithau"},
            {"id": "assignment-v3", "empId": "employee-b", "type": "goithau"},
        ],
    )

    result = compare_snapshots(left, right, include_unchanged=True)

    fields = {field["path"]: field for field in result["fields"]}
    assert fields["thoiGianDongThau"] == {
        "path": "thoiGianDongThau",
        "labelKey": "package.bidClosingTime",
        "kind": "SCALAR",
        "change": "MODIFIED",
        "oldValue": "2026-08-10T09:00:00",
        "newValue": "2026-08-12T09:00:00",
    }
    # Authorized business values remain complete; Word entitlement is irrelevant.
    assert fields["soCCCD"]["oldValue"] == "001234567890"
    assert fields["soTaiKhoan"]["newValue"] == "1234567890"
    assert fields["anhChuKy"]["oldValue"] == "/images/signature.png"
    assert fields["anhDau"]["newValue"] == "/images/stamp.png"
    assert "id" not in fields
    assert "rowVersion" not in fields

    relations = {relation["path"]: relation for relation in result["relations"]}
    assert relations["hangHoa"]["summary"] == {
        "added": 0,
        "removed": 0,
        "modified": 1,
        "unchanged": 0,
    }
    goods_change = relations["hangHoa"]["changes"][0]
    assert goods_change["change"] == "MODIFIED"
    assert goods_change["identity"] == {"maHangHoa": "HH-01"}
    assert goods_change["oldValue"]["soLuong"] == 10
    assert goods_change["newValue"]["soLuong"] == 12
    assert relations["assignments"]["summary"]["added"] == 1


def test_compare_snapshots_reports_duplicate_business_identity_as_ambiguous():
    duplicate = [
        {"id": "physical-1", "maHangHoa": "HH-01", "tenHangHoa": "A"},
        {"id": "physical-2", "maHangHoa": "HH-01", "tenHangHoa": "B"},
    ]
    left = _snapshot(
        record_id="package-v1",
        version=1,
        closing_time="2026-08-10T09:00:00",
        goods=duplicate,
        assignments=[],
    )
    right = deepcopy(left)
    right["record"]["id"] = "package-v2"
    right["record"]["phienBan"] = 2
    right["relations"]["hangHoa"] = [{
        "id": "physical-3", "maHangHoa": "HH-01", "tenHangHoa": "C",
    }]

    relation = next(
        relation for relation in compare_snapshots(left, right)["relations"]
        if relation["path"] == "hangHoa"
    )

    assert relation["changes"] == []
    assert relation["ambiguousMatches"] == [{
        "identity": {"maHangHoa": "HH-01"},
        "leftCount": 2,
        "rightCount": 1,
        "oldValues": [
            {"maHangHoa": "HH-01", "tenHangHoa": "A"},
            {"maHangHoa": "HH-01", "tenHangHoa": "B"},
        ],
        "newValues": [{"maHangHoa": "HH-01", "tenHangHoa": "C"}],
        "reasonCode": "DUPLICATE_BUSINESS_IDENTITY",
    }]


def test_scalar_type_matrix_is_json_safe_and_type_aware():
    left = _snapshot(
        record_id="package-v1",
        version=1,
        closing_time="2026-08-10T09:00:00+07:00",
        goods=[],
        assignments=[],
    )
    right = deepcopy(left)
    right["record"].update({
        "id": "package-v2",
        "phienBan": 2,
        "thoiGianDongThau": "2026-08-10T02:00:00Z",
    })
    left["record"].update({
        "giaGoiThau": Decimal("1000.00"),
        "nullable": None,
        "unicode": "Đấu thầu",
        "booleanValue": True,
    })
    right["record"].update({
        "giaGoiThau": 1000,
        "nullable": "",
        "unicode": "Đấu thầu",
        "booleanValue": 1,
    })

    result = compare_snapshots(left, right, include_unchanged=True)
    fields = {field["path"]: field for field in result["fields"]}

    assert fields["thoiGianDongThau"]["change"] == "UNCHANGED"
    assert fields["giaGoiThau"]["change"] == "UNCHANGED"
    assert fields["giaGoiThau"]["oldValue"] == "1000"
    assert fields["nullable"]["change"] == "MODIFIED"
    assert fields["unicode"]["change"] == "UNCHANGED"
    assert fields["booleanValue"]["change"] == "MODIFIED"


def test_unknown_relation_policy_is_ambiguous_and_preserves_authorized_values():
    left = _snapshot(
        record_id="package-v1",
        version=1,
        closing_time="2026-08-10T09:00:00Z",
        goods=[],
        assignments=[],
    )
    right = deepcopy(left)
    right["record"].update({"id": "package-v2", "phienBan": 2})
    left["record"]["unknownRows"] = [{
        "id": "physical-left",
        "name": "Mutable name",
        "soTaiKhoan": "001122",
    }]
    right["record"]["unknownRows"] = [{
        "id": "physical-right",
        "name": "Changed name",
        "soTaiKhoan": "998877",
    }]

    relation = next(
        item for item in compare_snapshots(left, right)["relations"]
        if item["path"] == "unknownRows"
    )

    assert relation["changes"] == []
    assert [item["reasonCode"] for item in relation["ambiguousMatches"]] == [
        "UNREGISTERED_RELATION_POLICY",
        "UNREGISTERED_RELATION_POLICY",
    ]
    assert relation["ambiguousMatches"][0]["oldValues"] == [{
        "name": "Mutable name",
        "soTaiKhoan": "001122",
    }]
    assert relation["ambiguousMatches"][1]["newValues"] == [{
        "name": "Changed name",
        "soTaiKhoan": "998877",
    }]


def test_registered_relation_does_not_use_mutable_name_as_fallback_identity():
    left = _snapshot(
        record_id="package-v1",
        version=1,
        closing_time="2026-08-10T09:00:00Z",
        goods=[{"id": "physical-left", "tenHangHoa": "Tên cũ"}],
        assignments=[],
    )
    right = deepcopy(left)
    right["record"].update({"id": "package-v2", "phienBan": 2})
    right["relations"]["hangHoa"] = [{
        "id": "physical-right",
        "tenHangHoa": "Tên mới",
    }]

    relation = next(
        item for item in compare_snapshots(left, right)["relations"]
        if item["path"] == "hangHoa"
    )

    assert relation["changes"] == []
    assert [item["reasonCode"] for item in relation["ambiguousMatches"]] == [
        "MISSING_BUSINESS_IDENTITY",
        "MISSING_BUSINESS_IDENTITY",
    ]


def test_nested_ordered_relation_detects_reorder_without_using_physical_ids():
    left = _snapshot(
        record_id="package-v1",
        version=1,
        closing_time="2026-08-10T09:00:00",
        goods=[],
        assignments=[],
    )
    right = deepcopy(left)
    right["record"].update({"id": "package-v2", "phienBan": 2})
    left["record"]["danhGiaHsdtMetadata"] = {
        "criteria": [
            {"id": "criterion-v1-a", "maTieuChi": "TC-A", "name": "A"},
            {"id": "criterion-v1-b", "maTieuChi": "TC-B", "name": "B"},
        ],
    }
    right["record"]["danhGiaHsdtMetadata"] = {
        "criteria": [
            {"id": "criterion-v2-b", "maTieuChi": "TC-B", "name": "B"},
            {"id": "criterion-v2-a", "maTieuChi": "TC-A", "name": "A"},
        ],
    }

    relation = next(
        item for item in compare_snapshots(left, right)["relations"]
        if item["path"] == "danhGiaHsdtMetadata.criteria"
    )

    assert relation["summary"]["modified"] == 2
    assert [item["orderChange"] for item in relation["changes"]] == [
        {"oldIndex": 0, "newIndex": 1},
        {"oldIndex": 1, "newIndex": 0},
    ]


def test_relation_cursor_is_stable_and_summary_is_not_page_limited():
    left = _snapshot(
        record_id="package-v1",
        version=1,
        closing_time="2026-08-10T09:00:00",
        goods=[],
        assignments=[],
    )
    right = _snapshot(
        record_id="package-v2",
        version=2,
        closing_time="2026-08-10T09:00:00",
        goods=[],
        assignments=[
            {"id": "a", "empId": "employee-a", "type": "goithau"},
            {"id": "b", "empId": "employee-b", "type": "goithau"},
        ],
    )

    first = compare_snapshots(
        left,
        right,
        relation_page_request={"path": "assignments", "limit": 1},
    )
    first_relation = next(item for item in first["relations"] if item["path"] == "assignments")
    second = compare_snapshots(
        left,
        right,
        relation_page_request={
            "path": "assignments",
            "limit": 1,
            "cursor": first_relation["nextCursor"],
        },
    )
    second_relation = next(item for item in second["relations"] if item["path"] == "assignments")

    assert first_relation["summary"]["added"] == 2
    assert len(first_relation["changes"]) == 1
    assert len(second_relation["changes"]) == 1
    assert first_relation["changes"][0]["identity"] != second_relation["changes"][0]["identity"]
    assert second_relation["nextCursor"] is None

    mutated = deepcopy(right)
    mutated["relations"]["assignments"][1]["empId"] = "employee-c"
    with pytest.raises(ValueError, match="INVALID_RELATION_CURSOR"):
        compare_snapshots(
            left,
            mutated,
            relation_page_request={
                "path": "assignments",
                "limit": 1,
                "cursor": first_relation["nextCursor"],
            },
        )

    different_pair = deepcopy(right)
    different_left = deepcopy(left)
    different_left["record"]["id"] = "other-package-v1"
    different_pair["record"]["id"] = "other-package-v2"
    with pytest.raises(ValueError, match="INVALID_RELATION_CURSOR"):
        compare_snapshots(
            different_left,
            different_pair,
            relation_page_request={
                "path": "assignments",
                "limit": 1,
                "cursor": first_relation["nextCursor"],
            },
        )


def test_plan_package_aggregate_ignores_cloned_ids_but_keeps_business_changes():
    left = {
        "record": {"id": "plan-v1", "rootId": "plan-root", "phienBan": 1},
        "relations": {"packages": [{
            "id": "package-v1",
            "rootId": "package-root",
            "keHoachId": "plan-v1",
            "tenGoiThau": "Gói A",
            "hangHoa": [{
                "id": "goods-v1", "goiThauId": "package-v1", "maHangHoa": "HH-01", "soLuong": 10,
            }],
        }]},
    }
    right = deepcopy(left)
    right["record"].update({"id": "plan-v2", "phienBan": 2})
    package = right["relations"]["packages"][0]
    package.update({"id": "package-v2", "keHoachId": "plan-v2"})
    package["hangHoa"][0].update({"id": "goods-v2", "goiThauId": "package-v2"})

    unchanged = next(
        item for item in compare_snapshots(left, right, include_unchanged=True)["relations"]
        if item["path"] == "packages"
    )
    assert unchanged["summary"]["unchanged"] == 1

    package["hangHoa"][0]["soLuong"] = 12
    modified = next(
        item for item in compare_snapshots(left, right)["relations"]
        if item["path"] == "packages"
    )
    assert modified["summary"]["modified"] == 1


def test_timeline_provider_projects_extension_relations_after_record_lists_are_extracted():
    left = _snapshot(
        record_id="package-v1",
        version=1,
        closing_time="2026-08-10T09:00:00",
        goods=[],
        assignments=[],
    )
    right = deepcopy(left)
    right["record"].update({"id": "package-v2", "phienBan": 2})
    left["relations"]["giaHanList"] = [{
        "id": "extension-v1", "thoiGianDongThau": "2026-08-11T09:00:00",
    }]
    right["relations"]["giaHanList"] = [{
        "id": "extension-v2", "thoiGianDongThau": "2026-08-12T09:00:00",
    }]

    impact = TimelineImpactProvider().assess(left, right, {})

    assert impact["assessment"] == "CONFIRMED"
    assert impact["reasonCode"] == "TIMELINE_PROJECTION_CHANGED"




class _Repository:
    def __init__(self):
        self.loaded = []

    def authorize_version(self, entity_type, version_id):
        if version_id == "denied-v2":
            return None
        return {
            "id": version_id,
            "rootId": "package-root",
            "organizationId": "org-1",
            "entityType": entity_type,
            "phienBan": 1,
        }

    def load_snapshot(self, entity_type, authorized_record):
        self.loaded.append(authorized_record["id"])
        return _snapshot(
            record_id=authorized_record["id"],
            version=authorized_record["phienBan"],
            closing_time="2026-08-10T09:00:00",
            goods=[],
            assignments=[],
        )


def test_service_authorizes_both_versions_before_loading_either_aggregate():
    repository = _Repository()
    service = VersionComparisonService(repository, impact_providers=[])

    with pytest.raises(VersionComparisonError) as error:
        service.compare(
            entity_type="goithau",
            left_version_id="allowed-v1",
            right_version_id="denied-v2",
        )

    assert error.value.code == "VERSION_COMPARISON_NOT_FOUND"
    assert repository.loaded == []


@pytest.mark.parametrize(
    ("right_patch", "code"),
    [
        ({"organizationId": "org-2"}, "VERSION_COMPARISON_TENANT_MISMATCH"),
        ({"rootId": "other-root"}, "VERSION_COMPARISON_FAMILY_MISMATCH"),
        ({"entityType": "kehoach"}, "VERSION_COMPARISON_ENTITY_MISMATCH"),
    ],
)
def test_service_rejects_cross_scope_pairs_before_snapshot_loading(right_patch, code):
    class Repository(_Repository):
        def authorize_version(self, entity_type, version_id):
            record = super().authorize_version(entity_type, version_id)
            if version_id == "allowed-v2":
                record.update(right_patch)
            return record

    repository = Repository()
    with pytest.raises(VersionComparisonError) as error:
        VersionComparisonService(repository).compare(
            entity_type="goithau",
            left_version_id="allowed-v1",
            right_version_id="allowed-v2",
        )

    assert error.value.code == code
    assert repository.loaded == []


def test_service_keeps_provider_failures_and_unsupported_categories_explicit():
    class Provider:
        category = "TIMELINE"

        def assess(self, *_args):
            raise RuntimeError("provider down")

    repository = _Repository()
    service = VersionComparisonService(repository, impact_providers=[Provider()])
    result = service.compare(
        entity_type="goithau",
        left_version_id="allowed-v1",
        right_version_id="allowed-v2",
    )

    assert result["impacts"] == [{
        "category": "TIMELINE",
        "assessment": "NOT_EVALUATED",
        "reasonCode": "PROVIDER_UNAVAILABLE",
        "references": [],
    }]


def test_service_times_out_one_provider_without_losing_the_diff():
    class Provider:
        category = "TIMELINE"

        def assess(self, *_args):
            time.sleep(0.05)
            return {"assessment": "CONFIRMED"}

    repository = _Repository()
    service = VersionComparisonService(
        repository,
        impact_providers=[Provider()],
        provider_timeout_seconds=0.001,
    )

    result = service.compare(
        entity_type="goithau",
        left_version_id="allowed-v1",
        right_version_id="allowed-v2",
    )

    assert result["fields"] == []
    assert result["impacts"] == [{
        "category": "TIMELINE",
        "assessment": "NOT_EVALUATED",
        "reasonCode": "PROVIDER_TIMEOUT",
        "references": [],
    }]


def test_legal_impact_requires_two_resolved_exact_bindings():
    provider = LegalImpactProvider(enabled=True)
    left = {"context": {"legalBinding": {
        "id": "binding-left", "bindingRevision": 1, "status": "RESOLVED",
        "profileVersionId": "profile-v1", "policyVersionId": "policy-v1",
    }}}
    right = {"context": {"legalBinding": {
        "id": "binding-right", "bindingRevision": 1, "status": "RESOLVED",
        "profileVersionId": "profile-v2", "policyVersionId": "policy-v1",
    }}}

    changed = provider.assess(left, right, {})
    assert changed["assessment"] == "CONFIRMED"
    assert changed["reasonCode"] == "EXACT_LEGAL_BINDING_CHANGED"
    assert changed["references"][0]["bindingId"] == "binding-left"
    assert changed["references"][1]["profileVersionId"] == "profile-v2"

    right["context"]["legalBinding"]["profileVersionId"] = "profile-v1"
    unchanged = provider.assess(left, right, {})
    assert unchanged["assessment"] == "NOT_EVALUATED"
    assert unchanged["reasonCode"] == "NO_LEGAL_BINDING_CHANGE"

    right["context"]["legalBinding"]["status"] = "AMBIGUOUS"
    unresolved = provider.assess(left, right, {})
    assert unresolved["assessment"] == "NOT_EVALUATED"
    assert unresolved["reasonCode"] == "LEGAL_BINDING_NOT_RESOLVED"


def test_legal_impact_is_not_evaluated_when_feature_is_off_or_binding_missing():
    snapshot = {"context": {}}
    disabled = LegalImpactProvider(enabled=False).assess(snapshot, snapshot, {})
    assert disabled == {
        "category": "LEGAL_RULES",
        "assessment": "NOT_EVALUATED",
        "reasonCode": "LEGAL_VERSIONING_DISABLED",
        "references": [],
    }
    missing = LegalImpactProvider(enabled=True).assess(snapshot, snapshot, {})
    assert missing["assessment"] == "NOT_EVALUATED"
    assert missing["reasonCode"] == "LEGAL_BINDING_UNAVAILABLE"


def test_http_contract_rejects_unknown_fields_before_running_comparison(monkeypatch):
    import backend.version_comparison.routes as routes

    called = []
    monkeypatch.setattr(routes, "VERSION_COMPARISON_ENABLED", True)
    monkeypatch.setattr(
        routes,
        "_compare_blocking",
        lambda *_args, **_kwargs: called.append(True),
    )
    app = Starlette(routes=version_comparison_routes(Route))

    with TestClient(app) as client:
        response = client.post("/api/version-comparisons/query", json={
            "entityType": "goithau",
            "leftVersionId": "package-v1",
            "rightVersionId": "package-v2",
            "arbitraryField": "must-not-pass",
        })

    assert response.status_code == 400
    assert response.json()["code"] == "VERSION_COMPARISON_INVALID_REQUEST"
    assert response.json()["fields"] == {"arbitraryField": "UNKNOWN_FIELD"}
    assert called == []


@pytest.mark.parametrize(
    ("relation_page", "expected_field"),
    [
        ({"cursor": "opaque"}, "relationPage.path"),
        ({"path": ["assignments"]}, "relationPage.path"),
        ({"path": "assignments", "cursor": []}, "relationPage.cursor"),
    ],
)
def test_http_contract_strictly_validates_relation_page(
    monkeypatch,
    relation_page,
    expected_field,
):
    import backend.version_comparison.routes as routes

    monkeypatch.setattr(routes, "VERSION_COMPARISON_ENABLED", True)
    app = Starlette(routes=version_comparison_routes(Route))
    with TestClient(app) as client:
        response = client.post("/api/version-comparisons/query", json={
            "entityType": "goithau",
            "leftVersionId": "package-v1",
            "rightVersionId": "package-v2",
            "relationPage": relation_page,
        })

    assert response.status_code == 400
    assert expected_field in response.json()["fields"]


def test_diff_rejects_relation_page_for_a_path_outside_the_pair():
    left = _snapshot(
        record_id="package-v1",
        version=1,
        closing_time="2026-08-10T09:00:00Z",
        goods=[],
        assignments=[],
    )
    right = deepcopy(left)
    right["record"].update({"id": "package-v2", "phienBan": 2})

    with pytest.raises(ValueError, match="INVALID_RELATION_PATH"):
        compare_snapshots(
            left,
            right,
            relation_page_request={"path": "not-present", "limit": 10},
        )


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class _BoundedCursor:
    def __init__(self, row_count=0):
        self.row_count = row_count
        self.queries = []

    def execute(self, sql, parameters=()):
        self.queries.append((sql, tuple(parameters)))
        if "information_schema.tables" in sql:
            return _Rows([(1,)])
        if sql.lstrip().startswith("SELECT id FROM"):
            limit = int(parameters[-1])
            return _Rows([(f"row-{index}",) for index in range(min(self.row_count, limit))])
        return _Rows([])


def test_repository_preflight_is_chunked_bounded_and_has_one_total_budget():
    cursor = _BoundedCursor(row_count=0)
    repository = VersionComparisonReadRepository(
        cursor,
        SimpleNamespace(organization_id="org-1"),
    )

    repository._bounded_child_ids(
        "goi_thau_gia_han",
        "goi_thau_id",
        [f"package-{index}" for index in range(1000)],
    )

    child_queries = [sql for sql, _params in cursor.queries if "SELECT id FROM" in sql]
    assert len(child_queries) == 2
    assert all(" LIMIT ?" in sql for sql in child_queries)

    oversized = VersionComparisonReadRepository(
        _BoundedCursor(row_count=5001),
        SimpleNamespace(organization_id="org-1"),
    )
    with pytest.raises(VersionComparisonError, match="5,000-row") as error:
        oversized._bounded_child_ids(
            "goi_thau_gia_han",
            "goi_thau_id",
            ["package-1"],
        )
    assert error.value.code == "VERSION_COMPARISON_RELATION_TOO_LARGE"

    expert_cursor = _BoundedCursor(row_count=0)
    expert_repository = VersionComparisonReadRepository(
        expert_cursor,
        SimpleNamespace(organization_id="org-1"),
    )
    expert_repository._preflight_package_attachments(["package-1"])
    assert any(
        "SELECT chuyen_gia_id FROM goi_thau_chuyen_gia" in sql
        for sql, _params in expert_cursor.queries
    )


def test_read_repository_contract_contains_no_write_or_row_lock_query():
    source = inspect.getsource(VersionComparisonReadRepository).upper()
    assert "FOR UPDATE" not in source
    assert "INSERT INTO" not in source
    assert "DELETE FROM" not in source
    assert "UPDATE " not in source


def test_read_repository_authorizes_each_package_version_with_canonical_scope():
    database = _test_database()
    connection = database.get_connection()
    organization_id = None
    try:
        cursor = connection.cursor()
        organization_id, employee_id, package_v1 = _seed_denied_package(cursor)
        package_v2 = f"{package_v1}-v2"
        cursor.execute(
            "UPDATE goi_thau SET phien_ban = 1, is_latest = 0 WHERE organization_id = ? AND id = ?",
            (organization_id, package_v1),
        )
        cursor.execute(
            """INSERT INTO goi_thau (
                   id, organization_id, id_goc, ke_hoach_id, ten_goi_thau,
                   gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                   thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc,
                   trang_thai, phien_ban, is_latest
               )
               SELECT ?, organization_id, id_goc, ke_hoach_id, ?,
                      gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                      thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc,
                      trang_thai, 2, 1
                 FROM goi_thau
                WHERE organization_id = ? AND id = ?""",
            (package_v2, "Gói thầu kiểm thử phiên bản 2", organization_id, package_v1),
        )
        for version_id in (package_v1, package_v2):
            cursor.execute(
                """INSERT INTO phan_cong_nhan_su
                       (id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)
                   VALUES (?, ?, ?, ?, 'goithau')""",
                (f"reader-{version_id}", organization_id, employee_id, version_id),
            )
        connection.commit()

        role = SessionRole(
            "user", employee_id, platform_role="user", active_role="employee"
        )
        scope = VisibilityScope.resolve(cursor, role, employee_id, organization_id)
        repository = VersionComparisonReadRepository(cursor, scope)
        left = repository.authorize_version("goithau", package_v1)
        right = repository.authorize_version("goithau", package_v2)

        assert left["tenGoiThau"] == "Gói thầu kiểm thử conflict"
        assert right["tenGoiThau"] == "Gói thầu kiểm thử phiên bản 2"
        assert repository.load_snapshot("goithau", left)["record"]["id"] == package_v1

        cursor.execute(
            "DELETE FROM phan_cong_nhan_su WHERE organization_id = ? AND id_nhan_vien = ? AND id_muc_tieu = ?",
            (organization_id, employee_id, package_v2),
        )
        connection.commit()
        assert repository.authorize_version("goithau", package_v2) is None
    finally:
        connection.close()
        if organization_id:
            _delete_seeded_workspace(database, organization_id)
        database.close()


def test_generated_word_provider_confirms_source_version_change_from_provenance():
    provider = GeneratedDocumentImpactProvider()
    document = {
        "artifactId": "artifact-left", "templateVersionId": "template-v3",
        "templateSha256": "a" * 64, "recordRowVersion": 7,
    }
    result = provider.assess(
        {"context": {"generatedDocuments": [document]}},
        {"context": {"generatedDocuments": []}},
        {"summary": {"added": 0, "removed": 0, "modified": 1}},
    )
    assert result["assessment"] == "CONFIRMED"
    assert result["reasonCode"] == "GENERATED_DOCUMENT_SOURCE_VERSION_CHANGED"
    assert result["references"][0]["artifactId"] == "artifact-left"


def test_generated_word_provider_does_not_guess_without_provenance():
    result = GeneratedDocumentImpactProvider().assess(
        {"context": {}}, {"context": {}},
        {"summary": {"added": 0, "removed": 0, "modified": 1}},
    )
    assert result["assessment"] == "NOT_EVALUATED"
    assert result["reasonCode"] == "NO_GENERATED_DOCUMENT_PROVENANCE"
