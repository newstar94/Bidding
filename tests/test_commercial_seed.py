"""First-install commercial seeds must remain editable and preserve existing facts."""

import json
import sqlite3

import pytest

from backend.commercial_policy.document import canonical_json, checksum_document, validate_document
from backend.db.upgrades import seed_commercial_v79


INITIAL_DRAFT_ID = "commercial-draft-initial-v1"
LEGACY_RELEASE_ID = "commercial-release-legacy-v79"
ORGANIZATION_EXPORTS = {
    "silver": (False, True, False),
    "gold": (True, False, True),
    "diamond": (False, False, True),
}
EXPORT_KEYS = (
    "document.export.word",
    "document.export.excel",
    "document.export.award_result_excel",
)


@pytest.fixture
def seed_connection():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE goi_dich_vu (
            id TEXT PRIMARY KEY, ten_goi TEXT, han_muc_nhan_su INTEGER,
            document_export_word INTEGER, document_export_excel INTEGER,
            document_export_award_result_excel INTEGER, trang_thai TEXT
        );
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY, vai_tro TEXT, trang_thai TEXT,
            created_at INTEGER
        );
        CREATE TABLE organization_subscriptions (
            organization_id TEXT PRIMARY KEY, package_id TEXT,
            member_quota INTEGER, plan_version_id TEXT, source TEXT,
            status TEXT
        );
        CREATE TABLE account_subscriptions (
            user_id TEXT PRIMARY KEY, package_id TEXT,
            plan_version_id TEXT, source TEXT, status TEXT
        );
        CREATE TABLE commercial_releases (
            id TEXT PRIMARY KEY, version_label TEXT, schema_version INTEGER,
            checksum TEXT, snapshot_json TEXT, mode TEXT, scope_key TEXT,
            effective_from INTEGER, non_sellable INTEGER, reason TEXT
        );
        CREATE TABLE billing_plan_versions (
            id TEXT PRIMARY KEY, release_id TEXT, logical_package_code TEXT,
            owner_kind TEXT, tier TEXT, variant TEXT, legacy_package_id TEXT,
            member_quota INTEGER, included_procurement_quota INTEGER,
            document_export_word INTEGER, document_export_excel INTEGER,
            document_export_award_result_excel INTEGER,
            violation_check_enabled INTEGER, sales_state TEXT,
            display_json TEXT,
            UNIQUE (release_id, logical_package_code)
        );
        CREATE TABLE payment_provider_profiles (
            id TEXT PRIMARY KEY, version INTEGER, provider TEXT,
            environment TEXT, public_alias TEXT, capabilities_json TEXT,
            min_amount INTEGER, max_amount INTEGER,
            checkout_ttl_seconds INTEGER, timeout_ms INTEGER,
            max_attempts INTEGER, routing_priority INTEGER,
            mode TEXT, readiness_status TEXT
        );
        CREATE TABLE commercial_drafts (
            id TEXT PRIMARY KEY, schema_version INTEGER,
            base_release_id TEXT, status TEXT, revision INTEGER,
            document_json TEXT, checksum TEXT, created_by TEXT,
            updated_by TEXT
        );
        """
    )
    connection.executemany(
        """INSERT INTO goi_dich_vu VALUES (?, ?, ?, ?, ?, ?, 'active')""",
        [
            (tier, f"Configured {tier}", quota, *map(int, ORGANIZATION_EXPORTS[tier]))
            for tier, quota in (("silver", 5), ("gold", 15), ("diamond", 50))
        ],
    )
    yield connection
    connection.close()


def _add_admin(connection):
    connection.execute(
        "INSERT INTO tai_khoan VALUES ('seed-admin', 'super_admin', 'active', 1)"
    )


def _draft(connection):
    row = connection.execute(
        "SELECT * FROM commercial_drafts WHERE id = ?", (INITIAL_DRAFT_ID,)
    ).fetchone()
    return dict(row) if row else None


def _rows(connection, table):
    queries = {
        "commercial_releases": "SELECT * FROM commercial_releases ORDER BY 1",
        "commercial_drafts": "SELECT * FROM commercial_drafts ORDER BY 1",
        "billing_plan_versions": "SELECT * FROM billing_plan_versions ORDER BY 1",
        "payment_provider_profiles": "SELECT * FROM payment_provider_profiles ORDER BY 1",
        "goi_dich_vu": "SELECT * FROM goi_dich_vu ORDER BY 1",
        "organization_subscriptions": "SELECT * FROM organization_subscriptions ORDER BY 1",
        "account_subscriptions": "SELECT * FROM account_subscriptions ORDER BY 1",
    }
    return [dict(row) for row in connection.execute(queries[table])]


def test_first_install_seeds_eight_editable_annual_offers_without_publishing(seed_connection):
    _add_admin(seed_connection)

    seed_commercial_v79(seed_connection.cursor())

    draft = _draft(seed_connection)
    document = json.loads(draft["document_json"])
    assert validate_document(document)["errors"] == []
    assert draft["status"] == "draft"
    assert draft["revision"] == 1
    assert draft["created_by"] == draft["updated_by"] == "seed-admin"
    assert draft["base_release_id"] == LEGACY_RELEASE_ID
    assert draft["checksum"] == checksum_document(document)
    assert len(document["offers"]) == 8
    assert {
        (offer["tier"], offer["variant"], offer["price"]["period"])
        for offer in document["offers"]
    } == {
        (tier, variant, "yearly")
        for tier in ("personal", "silver", "gold", "diamond")
        for variant in ("internal", "connected")
    }
    assert len({offer["code"] for offer in document["offers"]}) == 8
    assert all(
        offer["includedProcurementQuota"] == 0
        for offer in document["offers"] if offer["variant"] == "internal"
    )
    releases = _rows(seed_connection, "commercial_releases")
    assert [(row["id"], row["mode"], row["non_sellable"]) for row in releases] == [
        (LEGACY_RELEASE_ID, "legacy", 1)
    ]
    assert _rows(seed_connection, "billing_plan_versions") == []


def test_seed_copies_configured_organization_exports_without_changing_purchased_terms(seed_connection):
    _add_admin(seed_connection)
    seed_connection.execute(
        """INSERT INTO organization_subscriptions VALUES
           ('purchased-org', 'silver', 13, 'purchased-plan', 'order', 'active')"""
    )
    seed_connection.execute(
        """INSERT INTO account_subscriptions VALUES
           ('purchased-account', 'gold', 'purchased-account-plan', 'order', 'active')"""
    )
    before = {
        table: _rows(seed_connection, table)
        for table in ("goi_dich_vu", "organization_subscriptions", "account_subscriptions")
    }

    seed_commercial_v79(seed_connection.cursor())

    offers = json.loads(_draft(seed_connection)["document_json"])["offers"]
    for offer in offers:
        if offer["tier"] in ORGANIZATION_EXPORTS:
            assert offer["exportCapabilities"] == dict(
                zip(EXPORT_KEYS, ORGANIZATION_EXPORTS[offer["tier"]])
            )
    for table, rows in before.items():
        assert _rows(seed_connection, table) == rows
    assert all(
        row["sales_state"] == "non_sellable"
        for row in _rows(seed_connection, "billing_plan_versions")
    )


@pytest.mark.parametrize("status", ["draft", "archived"])
def test_repeated_seed_preserves_edited_or_archived_draft_and_custom_release(seed_connection, status):
    _add_admin(seed_connection)
    seed_commercial_v79(seed_connection.cursor())
    edited_document = json.loads(_draft(seed_connection)["document_json"])
    edited_document["offers"][0]["display"]["name"] = "Owner edited package"
    seed_connection.execute(
        """UPDATE commercial_drafts
              SET document_json = ?, checksum = ?, revision = 7,
                  status = ?, updated_by = 'another-admin'
            WHERE id = ?""",
        (
            canonical_json(edited_document), checksum_document(edited_document),
            status, INITIAL_DRAFT_ID,
        ),
    )
    custom_snapshot = {"schemaVersion": 1, "ownerConfigured": True}
    seed_connection.execute(
        """INSERT INTO commercial_releases VALUES
           ('custom-release', 'owner-version', 1, ?, ?, 'production',
            'global', 1800000000, 0, 'Owner approved release')""",
        (checksum_document(custom_snapshot), canonical_json(custom_snapshot)),
    )
    before_drafts = _rows(seed_connection, "commercial_drafts")
    before_releases = _rows(seed_connection, "commercial_releases")
    before_profiles = _rows(seed_connection, "payment_provider_profiles")

    seed_commercial_v79(seed_connection.cursor())

    assert _rows(seed_connection, "commercial_drafts") == before_drafts
    assert _rows(seed_connection, "commercial_releases") == before_releases
    assert _rows(seed_connection, "payment_provider_profiles") == before_profiles


def test_seed_waits_for_admin_before_creating_initial_draft(seed_connection):
    seed_connection.execute(
        "INSERT INTO tai_khoan VALUES ('ordinary-user', 'user', 'active', 1)"
    )

    seed_commercial_v79(seed_connection.cursor())

    assert _draft(seed_connection) is None
    _add_admin(seed_connection)
    seed_commercial_v79(seed_connection.cursor())
    assert _draft(seed_connection)["created_by"] == "seed-admin"
    assert len(_rows(seed_connection, "commercial_drafts")) == 1


def test_seed_uses_owner_approved_partial_batch_policy(seed_connection):
    _add_admin(seed_connection)

    seed_commercial_v79(seed_connection.cursor())

    document = json.loads(_draft(seed_connection)["document_json"])
    assert document["policies"]["partialBatch"]["kind"] == "process_affordable_in_stable_order"
