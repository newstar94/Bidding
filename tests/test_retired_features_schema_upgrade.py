"""Removed feature data is archived without retaining live business constraints."""

import pytest
from psycopg import sql

from backend.db.postgres_schema import assert_schema_contract
from backend.db.schema import (
    HISTORICAL_SCHEMA_DINH_NGHIA,
    RETIRED_OPTIONAL_FEATURE_TABLES,
    SCHEMA_DINH_NGHIA,
)
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    apply_database_upgrades,
    retired_feature_archive_schema,
)
from tests.test_postgres_migration_chain import (
    _close_fixture_connection,
    _open_fixture_connection,
    _upgrade_context,
)


def test_fresh_schema_omits_retired_features_but_keeps_released_upgrade_ddl():
    assert DB_SCHEMA_VERSION >= 99
    assert RETIRED_OPTIONAL_FEATURE_TABLES.isdisjoint(SCHEMA_DINH_NGHIA)
    assert RETIRED_OPTIONAL_FEATURE_TABLES <= HISTORICAL_SCHEMA_DINH_NGHIA.keys()
    for table_name, target_column, target_table in (
        ("plan_legal_binding", "plan_id", "ke_hoach_lcnt"),
        ("package_legal_binding", "package_id", "goi_thau"),
    ):
        assert any(
            f"FOREIGN KEY (organization_id, {target_column}) "
            f"REFERENCES {target_table}(organization_id, id)" in constraint
            for constraint in HISTORICAL_SCHEMA_DINH_NGHIA[table_name]["foreign_keys"]
        ), "historical replay must retain its released tenant-scoped bindings"


def _seed_retired_feature_data(cursor):
    digest = "a" * 64
    cursor.execute(
        """INSERT INTO conflict_resolution_drafts (
             id, organization_id, actor_user_id, workspace_fingerprint,
             batch_id, mutation_id, entity_type, table_name, record_id,
             expected_row_version, server_row_version, payload_ciphertext,
             payload_sha256, created_at, updated_at, expires_at
           ) VALUES ('draft', 'fixture-org', 'fixture-user', 'workspace',
             'batch', 'mutation', 'goithau', 'goi_thau', 'fixture-package',
             1, 2, 'encrypted-original', ?, 1, 1, 9999999999)""",
        (digest,),
    )
    cursor.execute(
        """INSERT INTO legal_instrument (
             id, stable_code, title, document_type, document_number, created_by_id
           ) VALUES ('instrument', 'CODE', 'Original title', 'LAW', '01', 'fixture-user')"""
    )
    cursor.execute(
        """INSERT INTO legal_instrument_draft (
             id, instrument_id, source_uri, source_content, issued_date,
             effective_from, updated_by_id
           ) VALUES ('instrument-draft', 'instrument', 'https://example.test/law',
             'Original draft', '2026-01-01', '2026-01-01', 'fixture-user')"""
    )
    cursor.execute(
        """INSERT INTO legal_instrument_version (
             id, instrument_id, version_no, source_uri, source_content,
             content_sha256, issued_date, effective_from, relation_manifest_json,
             relation_manifest_hash, published_by_id
           ) VALUES ('instrument-version', 'instrument', 1,
             'https://example.test/law', 'Original law', ?, '2026-01-01',
             '2026-01-01', '{}', ?, 'fixture-user')""",
        (digest, digest),
    )
    cursor.execute(
        """INSERT INTO legal_source_profile (id, stable_code, display_name, created_by_id)
           VALUES ('profile', 'PROFILE', 'Original profile', 'fixture-user')"""
    )
    cursor.execute(
        """INSERT INTO legal_source_profile_draft (
             id, profile_id, effective_from, instrument_version_ids_json, updated_by_id
           ) VALUES ('profile-draft', 'profile', '2026-01-01',
             '["instrument-version"]', 'fixture-user')"""
    )
    cursor.execute(
        """INSERT INTO legal_source_profile_version (
             id, profile_id, version_no, effective_from, manifest_hash, published_by_id
           ) VALUES ('profile-version', 'profile', 1, '2026-01-01', ?, 'fixture-user')""",
        (digest,),
    )
    cursor.execute(
        """INSERT INTO legal_source_profile_member (
             id, profile_version_id, instrument_version_id
           ) VALUES ('member', 'profile-version', 'instrument-version')"""
    )
    cursor.execute(
        """INSERT INTO legal_applicability_policy_version (
             id, policy_code, version, config_json, config_hash, published_by_id
           ) VALUES ('policy', 'POLICY', '1', '{}', ?, 'fixture-user')""",
        (digest,),
    )
    for kind, target_column, target_id in (
        ("plan", "plan_id", "fixture-plan-record"),
        ("package", "package_id", "fixture-package"),
    ):
        cursor.execute(
            sql.SQL("""INSERT INTO {} (
                 id, organization_id, {}, binding_revision, target_row_version,
                 policy_version_id, profile_version_id, status, reason,
                 anchor_source, evidence_json, evidence_hash, created_by_id
               ) VALUES (%s, 'fixture-org', %s, 1, 1, 'policy', 'profile-version',
                 'RESOLVED', 'Original reason', 'original', '{{}}', %s, 'fixture-user')""").format(
                sql.Identifier(f"{kind}_legal_binding"), sql.Identifier(target_column),
            ),
            (f"{kind}-binding", target_id, digest),
        )
        cursor.execute(
            sql.SQL("""INSERT INTO {} (
                 id, organization_id, {}, current_binding_id, binding_revision
               ) VALUES (%s, 'fixture-org', %s, %s, 1)""").format(
                sql.Identifier(f"{kind}_legal_binding_head"), sql.Identifier(target_column),
            ),
            (f"{kind}-head", target_id, f"{kind}-binding"),
        )


def _feature_rows(cursor, schema_name):
    return {
        table_name: cursor.execute(
            sql.SQL("SELECT to_jsonb(record) FROM {}.{} AS record ORDER BY id").format(
                sql.Identifier(schema_name), sql.Identifier(table_name),
            ),
        ).fetchall()
        for table_name in sorted(RETIRED_OPTIONAL_FEATURE_TABLES)
    }


def test_v99_archives_every_row_and_detaches_only_live_outbound_foreign_keys():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(cursor, 1, context, target_version=98) == 98
        _seed_retired_feature_data(cursor)
        before = _feature_rows(cursor, schema_name)
        original_oids = dict(cursor.execute(
            """SELECT relname, oid FROM pg_class
               WHERE relnamespace = current_schema()::regnamespace
                 AND relname = ANY(?)""",
            (sorted(RETIRED_OPTIONAL_FEATURE_TABLES),),
        ).fetchall())

        cursor.execute("SAVEPOINT before_feature_retirement")
        assert apply_database_upgrades(cursor, 98, context) == DB_SCHEMA_VERSION
        archive_schema = retired_feature_archive_schema(schema_name)
        assert _feature_rows(cursor, archive_schema) == before
        archive_oids = dict(cursor.execute(
            """SELECT relation.relname, relation.oid FROM pg_class AS relation
                 JOIN pg_namespace AS namespace ON namespace.oid=relation.relnamespace
                WHERE namespace.nspname = ? AND relation.relname = ANY(?)""",
            (archive_schema, sorted(RETIRED_OPTIONAL_FEATURE_TABLES)),
        ).fetchall())
        assert archive_oids == original_oids
        assert_schema_contract(cursor)
        archive_fks = cursor.execute(
            """SELECT child_namespace.nspname, parent_namespace.nspname
                 FROM pg_constraint AS constraint_record
                 JOIN pg_class AS child ON child.oid=constraint_record.conrelid
                 JOIN pg_namespace AS child_namespace ON child_namespace.oid=child.relnamespace
                 JOIN pg_class AS parent ON parent.oid=constraint_record.confrelid
                 JOIN pg_namespace AS parent_namespace ON parent_namespace.oid=parent.relnamespace
                WHERE constraint_record.contype='f' AND child_namespace.nspname=?""",
            (archive_schema,),
        ).fetchall()
        assert archive_fks and all(tuple(row) == (archive_schema, archive_schema) for row in archive_fks)
        assert apply_database_upgrades(cursor, DB_SCHEMA_VERSION, context) == DB_SCHEMA_VERSION
        cursor.execute("ROLLBACK TO SAVEPOINT before_feature_retirement")
        assert _feature_rows(cursor, schema_name) == before
        assert cursor.execute("SELECT schema_version FROM database_metadata WHERE id=1").fetchone()[0] == 98
        assert cursor.execute("SELECT to_regnamespace(?) IS NULL", (archive_schema,)).fetchone()[0]
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


@pytest.mark.parametrize("failure", ("inbound", "collision"))
def test_v99_rejects_unexpected_dependencies_or_archive_collisions_without_partial_move(failure):
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(cursor, 1, context, target_version=98) == 98
        archive_schema = retired_feature_archive_schema(schema_name)
        if failure == "inbound":
            cursor.execute("CREATE TABLE active_dependency (id TEXT REFERENCES legal_instrument(id))")
        else:
            cursor.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(archive_schema)))
            cursor.execute(sql.SQL("CREATE TABLE {}.legal_instrument (id TEXT)").format(sql.Identifier(archive_schema)))

        with pytest.raises(RuntimeError, match="foreign keys|destination objects"):
            apply_database_upgrades(cursor, 98, context)
        assert cursor.execute("SELECT schema_version FROM database_metadata WHERE id=1").fetchone()[0] == 98
        assert cursor.execute("SELECT to_regclass('legal_instrument') IS NOT NULL").fetchone()[0]
    finally:
        _close_fixture_connection(connection, cursor, schema_name)
