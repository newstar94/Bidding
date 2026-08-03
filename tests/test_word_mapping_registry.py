import hashlib
import sqlite3

from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    build_default_word_mappings,
)
from backend.documents import custom_exporter
from backend.documents.word_mapping_registry import (
    delete_word_mapping,
    migrate_seeded_word_mappings,
    reset_word_mapping,
    resolve_word_mappings,
    save_word_mapping,
)


def _database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE cau_hinh_bien_word (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            owner_type TEXT NOT NULL,
            ten_bien TEXT NOT NULL,
            source_table TEXT NOT NULL,
            source_column TEXT NOT NULL,
            mo_ta TEXT,
            UNIQUE(organization_id, ten_bien),
            UNIQUE(organization_id, source_table, source_column)
        );
        CREATE TABLE word_mapping_overrides (
            organization_id TEXT NOT NULL,
            owner_type TEXT NOT NULL,
            mapping_key TEXT NOT NULL,
            ten_bien_override TEXT,
            source_table_override TEXT,
            source_column_override TEXT,
            mo_ta_override TEXT,
            disabled INTEGER NOT NULL DEFAULT 0,
            base_version INTEGER NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            PRIMARY KEY (organization_id, mapping_key)
        );
        CREATE TABLE word_default_seeds (
            organization_id TEXT PRIMARY KEY,
            mappings_version INTEGER NOT NULL,
            updated_at TEXT
        );
        """
    )
    return connection


def _first_default():
    return build_default_word_mappings()[0]


def test_sparse_word_mapping_schema_upgrade_is_registered():
    assert DB_SCHEMA_VERSION >= 35
    assert UPGRADES[-1].name == "sparse_word_mapping_overrides"


def test_reading_shared_templates_does_not_create_an_empty_scope_directory(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(custom_exporter, "TEMPLATE_DIR", str(tmp_path))

    templates = custom_exporter.list_templates(
        "org-never-customized",
        owner_type="organization",
    )

    assert templates == []
    assert not (tmp_path / "organizations" / "org-never-customized").exists()


def test_system_catalog_is_shared_until_a_scope_changes_a_mapping():
    connection = _database()
    cursor = connection.cursor()
    default = _first_default()

    org_a = resolve_word_mappings(cursor, "org-a")
    org_b = resolve_word_mappings(cursor, "org-b")

    assert len(org_a) == len(build_default_word_mappings())
    assert len(org_b) == len(org_a)
    assert org_a[0]["origin"] == "system"
    assert org_a[0]["id"].startswith("word-default:")
    assert cursor.execute("SELECT COUNT(*) FROM cau_hinh_bien_word").fetchone()[0] == 0
    assert cursor.execute("SELECT COUNT(*) FROM word_mapping_overrides").fetchone()[0] == 0

    changed = save_word_mapping(
        cursor,
        "org-a",
        "organization",
        mapping_id=org_a[0]["id"],
        ten_bien=f"{default['ten_bien']}_org_a",
        source_table=default["source_table"],
        source_column=default["source_column"],
        mo_ta=None,
    )

    assert changed["origin"] == "override"
    assert changed["is_modified"] is True
    assert resolve_word_mappings(cursor, "org-a")[0]["ten_bien"].endswith("_org_a")
    assert resolve_word_mappings(cursor, "org-b")[0]["ten_bien"] == default["ten_bien"]
    assert cursor.execute("SELECT COUNT(*) FROM word_mapping_overrides").fetchone()[0] == 1
    assert cursor.execute("SELECT COUNT(*) FROM cau_hinh_bien_word").fetchone()[0] == 0

    reset_word_mapping(cursor, "org-a", changed["id"])
    assert resolve_word_mappings(cursor, "org-a")[0]["ten_bien"] == default["ten_bien"]
    assert cursor.execute("SELECT COUNT(*) FROM word_mapping_overrides").fetchone()[0] == 0
    connection.close()


def test_deleting_a_system_mapping_creates_only_a_scope_tombstone():
    connection = _database()
    cursor = connection.cursor()
    system_mapping = resolve_word_mappings(cursor, "personal:user-a")[0]

    result = delete_word_mapping(
        cursor,
        "personal:user-a",
        "personal",
        system_mapping["id"],
    )

    assert result["action"] == "disabled"
    assert system_mapping["mapping_key"] not in {
        row["mapping_key"] for row in resolve_word_mappings(cursor, "personal:user-a")
    }
    hidden = resolve_word_mappings(
        cursor,
        "personal:user-a",
        include_disabled=True,
    )
    hidden_mapping = next(
        row for row in hidden if row["mapping_key"] == system_mapping["mapping_key"]
    )
    assert hidden_mapping["disabled"] is True
    assert any(
        row["mapping_key"] == system_mapping["mapping_key"]
        for row in resolve_word_mappings(cursor, "personal:user-b")
    )
    assert cursor.execute("SELECT COUNT(*) FROM word_mapping_overrides").fetchone()[0] == 1
    connection.close()


def test_custom_mapping_remains_owned_by_only_the_active_scope():
    connection = _database()
    cursor = connection.cursor()

    custom = save_word_mapping(
        cursor,
        "org-a",
        "organization",
        mapping_id=None,
        ten_bien="bien_tu_tao",
        source_table="__computed__",
        source_column="1 + 1",
        mo_ta="Biến riêng",
    )

    assert custom["origin"] == "custom"
    assert any(row["id"] == custom["id"] for row in resolve_word_mappings(cursor, "org-a"))
    assert all(row["id"] != custom["id"] for row in resolve_word_mappings(cursor, "org-b"))
    assert cursor.execute("SELECT COUNT(*) FROM cau_hinh_bien_word").fetchone()[0] == 1
    connection.close()


def test_migration_compacts_seeded_rows_without_losing_customization():
    connection = _database()
    cursor = connection.cursor()
    defaults = build_default_word_mappings()
    changed_default = defaults[0]
    for mapping in defaults:
        stable_id = "wdef-" + hashlib.sha256(
            f"org-a:{mapping['ten_bien']}".encode("utf-8")
        ).hexdigest()[:16]
        name = (
            f"{mapping['ten_bien']}_customized"
            if mapping is changed_default
            else mapping["ten_bien"]
        )
        description = "" if mapping is changed_default else mapping["mo_ta"]
        cursor.execute(
            """INSERT INTO cau_hinh_bien_word
               (id, organization_id, owner_type, ten_bien, source_table, source_column, mo_ta)
               VALUES (?, 'org-a', 'organization', ?, ?, ?, ?)""",
            (
                stable_id,
                name,
                mapping["source_table"],
                mapping["source_column"],
                description,
            ),
        )
    cursor.execute(
        """INSERT INTO cau_hinh_bien_word
           (id, organization_id, owner_type, ten_bien, source_table, source_column, mo_ta)
           VALUES ('custom-1', 'org-a', 'organization', 'bien_rieng', '__computed__', '2 + 2', '')"""
    )
    cursor.execute(
        "INSERT INTO word_default_seeds (organization_id, mappings_version) VALUES ('org-a', ?)",
        (WORD_DEFAULT_MAPPINGS_VERSION,),
    )

    result = migrate_seeded_word_mappings(cursor)

    assert result["removed_default_rows"] == len(defaults)
    assert result["override_rows"] == 1
    assert cursor.execute("SELECT COUNT(*) FROM cau_hinh_bien_word").fetchone()[0] == 1
    assert cursor.execute("SELECT id FROM cau_hinh_bien_word").fetchone()[0] == "custom-1"
    assert cursor.execute("SELECT COUNT(*) FROM word_mapping_overrides").fetchone()[0] == 1
    effective = resolve_word_mappings(cursor, "org-a")
    migrated = next(row for row in effective if row["mapping_key"] == changed_default["mapping_key"])
    assert migrated["ten_bien"].endswith("_customized")
    assert migrate_seeded_word_mappings(cursor)["scopes"] == 0
    assert cursor.execute("SELECT COUNT(*) FROM word_mapping_overrides").fetchone()[0] == 1
    connection.close()
