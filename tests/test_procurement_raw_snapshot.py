import json
from copy import deepcopy
from datetime import datetime, timezone
import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES
from backend.procurement_raw import ProcurementRawSnapshotRepository


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return None
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'") or None
    return None


def raw_bundle(price=100):
    return {
        "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
        "provider": "MUASAMCONG",
        "entity": {
            "kind": "PLAN",
            "planNo": "PL2600244105",
            "canonicalCode": "PL2600244105",
        },
        "retrievedAt": "2026-08-11T00:00:00Z",
        "sources": {
            "search": {
                "operation": "SEARCH",
                "endpoint": "/smart/search",
                "request": {
                    "code": "PL2600244105",
                    "Authorization": "Bearer secret",
                },
                "response": {"page": {"content": [{"planNo": "PL2600244105"}]}},
                "schemaFingerprint": "search:v1:fixture",
                "success": True,
                "retrievedAt": "2026-08-11T00:00:00Z",
            },
            "versionList": {
                "operation": "PLAN_VERSION_LIST",
                "endpoint": "/plan/get-version-list",
                "request": {"planNo": "PL2600244105"},
                "response": {
                    "versionList": [{
                        "id": "revision-00",
                        "planNo": "PL2600244105",
                        "planVersion": "00",
                    }],
                },
                "schemaFingerprint": "plan-version-list:v1:fixture",
                "success": True,
                "retrievedAt": "2026-08-11T00:00:00Z",
            },
        },
        "revisions": {
            "00": {
                "revisionId": "revision-00",
                "sources": {
                    "planDetail": {
                        "operation": "PLAN_DETAIL",
                        "endpoint": "/plan/get-by-id",
                        "request": {"id": "revision-00", "token": "secret"},
                        "response": {
                            "planNo": "PL2600244105",
                            "bidpPlanDetailToProjectList": [{
                                "id": "package-a",
                                "idDetail": "package-a",
                                "idPlan": "revision-00",
                                "bidNo": "01",
                                "planNo": "PL2600244105",
                                "bidName": "Goi thau A",
                                "isInternet": 1,
                                "isMultiLot": 0,
                                "isDomestic": 1,
                                "isPrequalification": 0,
                                "isConcentrateShopping": 0,
                                "bidPrice": price,
                                "bidPriceUnit": "VND",
                                "bidForm": "DTRR",
                                "bidField": "HH",
                                "bidMode": "1_MTHS",
                                "processApply": "LDT",
                                "capitalDetail": "Von ngan sach",
                                "bidStartUnit": "THANG",
                                "bidStartYear": 2026,
                                "bidStartMonth": 8,
                                "bidStartQuarter": 3,
                                "createdDate": "2026-08-01",
                                "planDecisionDate": "2026-07-30",
                                "bidTime": 30,
                                "ctype": "TRON_GOI",
                                "cperiod": 12,
                                "cperiodUnit": "M",
                                "unknownFuturePackageField": {"kept": True},
                            }],
                            "unknownFutureField2027": {"abc": 123},
                        },
                        "schemaFingerprint": "plan:v1:fixture",
                        "success": True,
                        "retrievedAt": "2026-08-11T00:00:00Z",
                    },
                },
                "packages": {
                    "package-a": {
                        "sources": {
                            "planPackageDetail": {
                                "operation": "PLAN_PACKAGE_DETAIL",
                                "endpoint": "/plan/package-detail",
                                "request": {"id": "package-a"},
                                "response": {
                                    "id": "package-a",
                                    "bidPrice": price,
                                    "accessToken": "response-secret",
                                },
                                "schemaFingerprint": "plan-package:v1:fixture",
                                "success": True,
                                "retrievedAt": "2026-08-11T00:00:00Z",
                            },
                        },
                    },
                },
            },
        },
    }


def notice_raw_bundle():
    bundle = {
        "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
        "provider": "MUASAMCONG",
        "entity": {
            "kind": "NOTICE",
            "noticeNo": "IB2600000002",
            "canonicalCode": "IB2600000002",
        },
        "retrievedAt": "2026-08-12T00:00:00Z",
        "sources": {
            "search": {
                "operation": "SEARCH",
                "endpoint": "/smart/search",
                "request": {"code": "IB2600000002"},
                "response": {"page": {"content": [{
                    "notifyNo": "IB2600000002"
                }]}},
                "success": True,
                "retrievedAt": "2026-08-12T00:00:00Z",
            },
            "ldtVersionList": {
                "operation": "NOTICE_LDT_VERSION_LIST",
                "endpoint": "/notice/get-version-list",
                "request": {"notifyNo": "IB2600000002"},
                "response": {"versionList": [{
                    "id": "notice-01",
                    "notifyNo": "IB2600000002",
                    "notifyVersion": "01",
                }]},
                "success": True,
                "retrievedAt": "2026-08-12T00:00:00Z",
            },
            "contractList": {
                "operation": "NOTICE_CONTRACT_LIST",
                "endpoint": "/contract/list-contract-for-po",
                "request": {"notifyNo": "IB2600000002"},
                "response": [{"contractCode": "HD-01"}],
                "success": True,
                "retrievedAt": "2026-08-12T00:00:00Z",
            },
        },
        "revisions": {
            "01": {
                "revisionId": "notice-01",
                "sources": {
                    "noticeDetail": {
                        "operation": "NOTICE_LDT_DETAIL",
                        "endpoint": "/notice/get-by-id",
                        "request": {"id": "notice-01"},
                        "response": {
                            "notifyNo": "IB2600000002",
                            "notifyId": "notice-01",
                            "notifyVersion": "01",
                            "bidName": "Gói thầu A",
                        },
                        "success": True,
                        "retrievedAt": "2026-08-12T00:00:00Z",
                    },
                    "openingBid": {
                        "operation": "OPENING_BID",
                        "endpoint": "/opening/bid-open",
                        "request": {
                            "notifyNo": "IB2600000002", "packType": 0,
                        },
                        "response": {"bidders": [{"contractorCode": "A"}]},
                        "success": True,
                        "retrievedAt": "2026-08-12T00:00:00Z",
                    },
                    "selectionResult": {
                        "operation": "SELECTION_RESULT",
                        "endpoint": "/result/get",
                        "request": {"id": "result-1"},
                        "response": {"decisionNo": "QD-01"},
                        "success": True,
                        "retrievedAt": "2026-08-12T00:00:00Z",
                    },
                },
            }
        },
    }
    return bundle


class CursorResult:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class Connection:
    def __init__(self):
        self.keys = set()
        self.parameters = []
        self.rows = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def execute(self, sql, parameters):
        if sql.lstrip().startswith("SELECT"):
            organization_id, canonical_code, cutoff = parameters
            rows = [
                row for row in self.rows
                if row["organization_id"] == organization_id
                and row["canonical_code"] == canonical_code
                and row["retrieved_at"] >= cutoff
            ]
            rows.sort(
                key=lambda row: (row["retrieved_at"], row["created_at"]),
                reverse=True,
            )
            return CursorResult(rows=rows[:5000])
        self.parameters.append(parameters)
        dedup_key = parameters[15]
        if dedup_key in self.keys:
            return CursorResult(None)
        self.keys.add(dedup_key)
        self.rows.append({
            "revision_id": parameters[5],
            "revision_number": parameters[6],
            "child_entity_kind": parameters[7],
            "child_entity_id": parameters[8],
            "operation": parameters[9],
            "endpoint": parameters[10],
            "request_json": parameters[11],
            "response_json": parameters[12],
            "error_json": parameters[13],
            "content_hash": parameters[14],
            "schema_fingerprint": parameters[16],
            "success": parameters[17],
            "retrieved_at": parameters[18],
            "created_at": parameters[18],
            "organization_id": parameters[1],
            "canonical_code": parameters[4],
        })
        return CursorResult((parameters[0],))

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


class Database:
    def __init__(self):
        self.connection = Connection()

    def get_connection(self):
        self.connection.closed = False
        return self.connection


def test_raw_snapshots_preserve_unknown_fields_redact_secrets_and_deduplicate():
    database = Database()
    repository = ProcurementRawSnapshotRepository(database=database)

    first = repository.save_bundle("org-1", raw_bundle())
    second = repository.save_bundle("org-1", raw_bundle())
    changed = repository.save_bundle("org-1", raw_bundle(price=200))

    assert first == {"inserted": 4, "duplicates": 0}
    assert second == {"inserted": 0, "duplicates": 4}
    assert changed == {"inserted": 2, "duplicates": 2}
    encoded_requests = [row[11] for row in database.connection.parameters]
    assert "Bearer secret" not in "".join(encoded_requests)
    assert any("[REDACTED]" in value for value in encoded_requests)
    responses = [json.loads(row[12]) for row in database.connection.parameters]
    assert "response-secret" not in "".join(
        row[12] for row in database.connection.parameters
    )
    assert any(
        response.get("accessToken") == "[REDACTED]"
        for response in responses
    )
    assert any(
        response.get("unknownFutureField2027") == {"abc": 123}
        for response in responses
    )
    assert database.connection.rollbacks == 0


def test_fresh_raw_snapshot_reassembles_complete_bundle_and_every_package_field():
    database = Database()
    repository = ProcurementRawSnapshotRepository(database=database)
    original = raw_bundle()
    repository.save_bundle("org-1", original)

    loaded = repository.load_fresh_plan_bundle(
        "org-1",
        "pl2600244105",
        revision_mode="ALL",
        max_age_seconds=900,
        now=datetime(2026, 8, 11, 0, 5, tzinfo=timezone.utc),
    )

    assert loaded["status"] == "FOUND_COMPLETE"
    assert loaded["manifest"] == {
        "sourceCount": 4,
        "successCount": 4,
        "failedCount": 0,
        "revisions": ["00"],
        "packages": 1,
        "operations": [
            "SEARCH", "PLAN_VERSION_LIST", "PLAN_DETAIL",
            "PLAN_PACKAGE_DETAIL",
        ],
    }
    package = loaded["revisions"]["00"]["sources"]["planDetail"][
        "response"
    ]["bidpPlanDetailToProjectList"][0]
    assert package == original["revisions"]["00"]["sources"][
        "planDetail"
    ]["response"]["bidpPlanDetailToProjectList"][0]
    assert package["unknownFuturePackageField"] == {"kept": True}
    assert loaded["metrics"]["upstream"]["requestCount"] == 0


def test_fresh_notice_snapshot_reassembles_sources_for_mapping_without_refetch():
    database = Database()
    repository = ProcurementRawSnapshotRepository(database=database)
    original = notice_raw_bundle()
    repository.save_bundle("org-1", original)

    loaded = repository.load_fresh_notice_bundle(
        "org-1",
        "ib2600000002",
        revision_mode="ALL",
        max_age_seconds=900,
        now=datetime(2026, 8, 12, 0, 5, tzinfo=timezone.utc),
    )

    assert loaded["status"] == "FOUND_COMPLETE"
    assert loaded["entity"] == {
        "kind": "NOTICE",
        "canonicalCode": "IB2600000002",
        "noticeNo": "IB2600000002",
    }
    assert list(loaded["revisions"]) == ["01"]
    sources = loaded["revisions"]["01"]["sources"]
    assert sources["noticeDetail"]["response"]["bidName"] == "Gói thầu A"
    assert sources["opening_bid_0"]["response"]["bidders"] == [
        {"contractorCode": "A"}
    ]
    assert sources["selectionResult"]["response"]["decisionNo"] == "QD-01"
    assert loaded["sources"]["contractList"]["response"] == [
        {"contractCode": "HD-01"}
    ]
    assert loaded["metrics"]["upstream"]["requestCount"] == 0


def test_invitation_notice_snapshot_excludes_post_opening_sources():
    database = Database()
    repository = ProcurementRawSnapshotRepository(database=database)
    repository.save_bundle("org-1", notice_raw_bundle())

    loaded = repository.load_fresh_notice_bundle(
        "org-1",
        "IB2600000002",
        detail_level="INVITATION",
        revision_mode="ALL",
        max_age_seconds=900,
        now=datetime(2026, 8, 12, 0, 5, tzinfo=timezone.utc),
    )

    assert loaded["detailLevel"] == "INVITATION"
    assert "contractList" not in loaded["sources"]
    sources = loaded["revisions"]["01"]["sources"]
    assert "opening_bid_0" not in sources
    assert "selectionResult" not in sources
    assert "technicalResult" not in sources


def test_raw_snapshot_cache_is_tenant_scoped_stale_safe_and_requires_package_detail():
    database = Database()
    repository = ProcurementRawSnapshotRepository(database=database)
    repository.save_bundle("org-1", raw_bundle())

    assert repository.load_fresh_plan_bundle(
        "org-2", "PL2600244105",
        now=datetime(2026, 8, 11, 0, 5, tzinfo=timezone.utc),
    ) is None
    assert repository.load_fresh_plan_bundle(
        "org-1", "PL2600244105", max_age_seconds=60,
        now=datetime(2026, 8, 11, 0, 5, tzinfo=timezone.utc),
    ) is None

    database.connection.rows = [
        row for row in database.connection.rows
        if row["operation"] != "PLAN_PACKAGE_DETAIL"
    ]
    assert repository.load_fresh_plan_bundle(
        "org-1", "PL2600244105",
        now=datetime(2026, 8, 11, 0, 5, tzinfo=timezone.utc),
    ) is None


def test_raw_snapshot_revision_modes_select_without_cross_revision_packages():
    database = Database()
    repository = ProcurementRawSnapshotRepository(database=database)
    bundle = raw_bundle(price=100)
    bundle["sources"]["versionList"]["response"]["versionList"].append({
        "id": "revision-01",
        "planNo": "PL2600244105",
        "planVersion": "01",
    })
    revision = deepcopy(bundle["revisions"]["00"])
    revision["revisionId"] = "revision-01"
    row = revision["sources"]["planDetail"]["response"][
        "bidpPlanDetailToProjectList"
    ][0]
    row.update({
        "id": "package-b",
        "idDetail": "package-b",
        "idPlan": "revision-01",
        "bidNo": "02",
        "bidPrice": 200,
    })
    revision["sources"]["planDetail"]["request"] = {"id": "revision-01"}
    revision["packages"] = {
        "package-b": deepcopy(revision["packages"]["package-a"])
    }
    package_source = revision["packages"]["package-b"]["sources"][
        "planPackageDetail"
    ]
    package_source["request"] = {"id": "package-b"}
    package_source["response"] = {"id": "package-b", "bidPrice": 200}
    bundle["revisions"]["01"] = revision
    repository.save_bundle("org-1", bundle)
    now = datetime(2026, 8, 11, 0, 5, tzinfo=timezone.utc)

    selected = repository.load_fresh_plan_bundle(
        "org-1",
        "PL2600244105",
        revision_mode="SELECTED",
        revision_numbers=["00"],
        now=now,
    )
    latest = repository.load_fresh_plan_bundle(
        "org-1", "PL2600244105", revision_mode="LATEST", now=now
    )
    all_revisions = repository.load_fresh_plan_bundle(
        "org-1", "PL2600244105", revision_mode="ALL", now=now
    )

    assert list(selected["revisions"]) == ["00"]
    assert list(selected["revisions"]["00"]["packages"]) == ["package-a"]
    assert list(latest["revisions"]) == ["01"]
    assert list(latest["revisions"]["01"]["packages"]) == ["package-b"]
    assert list(all_revisions["revisions"]) == ["00", "01"]


def test_raw_snapshot_schema_and_migration_are_append_only():
    table = SCHEMA_DINH_NGHIA["procurement_raw_snapshot"]
    assert "content_hash" in table["columns"]
    assert "dedup_key" in table["columns"]
    assert any("dedup_key" in item for item in table["unique_constraints"])
    assert any(
        upgrade.version == 53
        and upgrade.name == "add_procurement_raw_snapshots"
        for upgrade in UPGRADES
    )
    assert UPGRADES[-1].version == DB_SCHEMA_VERSION


def test_real_postgres_raw_snapshot_round_trip_dedup_and_immutability():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        connection = psycopg.connect(
            database_url,
            connect_timeout=5,
            row_factory=compat_row_factory,
        )
    except psycopg.Error as error:
        pytest.skip(
            "PostgreSQL test database is unavailable: "
            f"{type(error).__name__}"
        )

    class TransactionConnection:
        def execute(self, statement, parameters=None):
            return PostgresCursor(connection.cursor()).execute(
                statement, parameters
            )

        def commit(self):
            # Repository semantics are exercised inside one rollback-only test.
            return None

        def rollback(self):
            connection.rollback()

        def close(self):
            return None

    class TransactionDatabase:
        def get_connection(self):
            return TransactionConnection()

    organization_id = f"__raw_snapshot_test_{uuid4().hex}"
    repository = ProcurementRawSnapshotRepository(
        database=TransactionDatabase()
    )
    try:
        first = repository.save_bundle(organization_id, raw_bundle())
        duplicate = repository.save_bundle(organization_id, raw_bundle())
        loaded = repository.load_fresh_plan_bundle(
            organization_id,
            "PL2600244105",
            revision_mode="ALL",
            now=datetime(2026, 8, 11, 0, 5, tzinfo=timezone.utc),
        )

        assert first == {"inserted": 4, "duplicates": 0}
        assert duplicate == {"inserted": 0, "duplicates": 4}
        assert loaded["revisions"]["00"]["sources"]["planDetail"][
            "response"
        ]["unknownFutureField2027"] == {"abc": 123}
        with pytest.raises(psycopg.Error):
            connection.execute(
                "UPDATE procurement_raw_snapshot SET success = 0 "
                "WHERE organization_id = %s",
                (organization_id,),
            )
    finally:
        connection.rollback()
        connection.close()
