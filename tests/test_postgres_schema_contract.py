from copy import deepcopy
import os
from pathlib import Path

import psycopg
import pytest

from backend.db.postgres_schema import assert_schema_contract
from backend.db.postgres_schema_contract import (
    assert_catalog_contract,
    schema_catalog_drift,
)


def _catalog_fixture():
    return {
        "contractVersion": 1,
        "postgresMajor": 17,
        "schemaVersion": 42,
        "tables": {
            "items": {
                "persistence": "p",
                "rowSecurity": False,
                "columns": {
                    "id": {
                        "type": "text",
                        "notNull": True,
                        "default": None,
                        "identity": "",
                        "generated": "",
                    },
                    "code": {
                        "type": "text",
                        "notNull": False,
                        "default": "'draft'::text",
                        "identity": "",
                        "generated": "",
                    },
                },
                "constraints": {
                    "items_pkey": {
                        "kind": "p",
                        "definition": "PRIMARY KEY (id)",
                        "validated": True,
                        "deferrable": False,
                        "initiallyDeferred": False,
                    },
                    "items_code_check": {
                        "kind": "c",
                        "definition": "CHECK (code <> ''::text)",
                        "validated": True,
                        "deferrable": False,
                        "initiallyDeferred": False,
                    },
                    "items_code_key": {
                        "kind": "u",
                        "definition": "UNIQUE (code)",
                        "validated": True,
                        "deferrable": False,
                        "initiallyDeferred": False,
                    },
                    "items_parent_fkey": {
                        "kind": "f",
                        "definition": (
                            "FOREIGN KEY (id) REFERENCES parents(id) ON DELETE CASCADE"
                        ),
                        "validated": True,
                        "deferrable": False,
                        "initiallyDeferred": False,
                    },
                },
            },
            "parents": {
                "persistence": "p",
                "rowSecurity": False,
                "columns": {},
                "constraints": {},
            },
        },
        "indexes": {
            "idx_items_code": {
                "table": "items",
                "definition": (
                    "CREATE INDEX idx_items_code ON $SCHEMA.items USING btree (code)"
                ),
                "valid": True,
                "ready": True,
                "live": True,
            }
        },
        "triggers": {
            "items.trg_items_touch": {
                "table": "items",
                "definition": (
                    "CREATE TRIGGER trg_items_touch BEFORE UPDATE ON items "
                    "FOR EACH ROW EXECUTE FUNCTION bf_touch()"
                ),
                "enabled": "O",
            }
        },
    }


def _set(path, value):
    def mutate(catalog):
        target = catalog
        for segment in path[:-1]:
            target = target[segment]
        target[path[-1]] = value

    return mutate


@pytest.mark.parametrize(
    ("label", "mutate", "expected_path"),
    (
        (
            "column type",
            _set(("tables", "items", "columns", "id", "type"), "bigint"),
            "tables.items.columns.id.type",
        ),
        (
            "column nullability",
            _set(("tables", "items", "columns", "code", "notNull"), True),
            "tables.items.columns.code.notNull",
        ),
        (
            "column default",
            _set(("tables", "items", "columns", "code", "default"), None),
            "tables.items.columns.code.default",
        ),
        (
            "CHECK definition",
            _set(
                (
                    "tables",
                    "items",
                    "constraints",
                    "items_code_check",
                    "definition",
                ),
                "CHECK (code IS NOT NULL)",
            ),
            "tables.items.constraints.items_code_check.definition",
        ),
        (
            "UNIQUE definition",
            _set(
                (
                    "tables",
                    "items",
                    "constraints",
                    "items_code_key",
                    "definition",
                ),
                "UNIQUE NULLS NOT DISTINCT (code)",
            ),
            "tables.items.constraints.items_code_key.definition",
        ),
        (
            "foreign-key definition",
            _set(
                (
                    "tables",
                    "items",
                    "constraints",
                    "items_parent_fkey",
                    "definition",
                ),
                "FOREIGN KEY (id) REFERENCES parents(id) ON DELETE RESTRICT",
            ),
            "tables.items.constraints.items_parent_fkey.definition",
        ),
        (
            "index definition",
            _set(
                ("indexes", "idx_items_code", "definition"),
                "CREATE INDEX idx_items_code ON $SCHEMA.items USING hash (code)",
            ),
            "indexes.idx_items_code.definition",
        ),
        (
            "trigger definition",
            _set(
                ("triggers", "items.trg_items_touch", "definition"),
                (
                    "CREATE TRIGGER trg_items_touch AFTER UPDATE ON items "
                    "FOR EACH ROW EXECUTE FUNCTION bf_touch()"
                ),
            ),
            "triggers.items.trg_items_touch.definition",
        ),
    ),
)
def test_schema_catalog_drift_rejects_changed_definitions(
    label,
    mutate,
    expected_path,
):
    expected = _catalog_fixture()
    actual = deepcopy(expected)
    mutate(actual)

    drift = schema_catalog_drift(expected, actual)

    assert any(expected_path in issue for issue in drift), label


def test_schema_catalog_drift_rejects_missing_trigger():
    expected = _catalog_fixture()
    actual = deepcopy(expected)
    del actual["triggers"]["items.trg_items_touch"]

    assert any(
        "triggers.items.trg_items_touch" in issue and "missing" in issue
        for issue in schema_catalog_drift(expected, actual)
    )


@pytest.mark.parametrize(
    ("collection", "name", "value"),
    (
        (
            "tables",
            "shadow_items",
            {
                "persistence": "p",
                "rowSecurity": False,
                "columns": {},
                "constraints": {},
            },
        ),
        (
            "indexes",
            "idx_items_shadow",
            {
                "table": "items",
                "definition": (
                    "CREATE INDEX idx_items_shadow ON $SCHEMA.items USING btree (id)"
                ),
                "valid": True,
                "ready": True,
                "live": True,
            },
        ),
        (
            "triggers",
            "items.trg_items_shadow",
            {
                "table": "items",
                "definition": (
                    "CREATE TRIGGER trg_items_shadow AFTER INSERT ON items "
                    "FOR EACH ROW EXECUTE FUNCTION bf_touch()"
                ),
                "enabled": "O",
            },
        ),
    ),
)
def test_schema_catalog_drift_rejects_unexpected_application_objects(
    collection,
    name,
    value,
):
    expected = _catalog_fixture()
    actual = deepcopy(expected)
    actual[collection][name] = value

    assert any(
        f"{collection}.{name}" in issue and "unexpected" in issue
        for issue in schema_catalog_drift(expected, actual)
    )


def test_schema_catalog_contract_accepts_exact_normalized_catalog():
    expected = _catalog_fixture()

    assert schema_catalog_drift(expected, deepcopy(expected)) == ()
    assert_catalog_contract(expected, deepcopy(expected))


def test_schema_catalog_contract_raises_one_bounded_diagnostic():
    expected = _catalog_fixture()
    actual = deepcopy(expected)
    actual["tables"]["items"]["columns"]["id"]["type"] = "bigint"
    actual["tables"]["items"]["columns"]["code"]["notNull"] = True

    with pytest.raises(RuntimeError, match="Normalized PostgreSQL schema drift") as error:
        assert_catalog_contract(expected, actual, diagnostic_limit=1)

    assert "tables.items.columns.code.notNull" in str(error.value)
    assert "additional difference" in str(error.value)


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


@pytest.fixture
def schema_contract_cursor():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        connection = psycopg.connect(database_url, connect_timeout=5)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        yield connection.cursor()
    finally:
        connection.rollback()
        connection.close()


def test_live_postgres_catalog_matches_generated_contract(schema_contract_cursor):
    assert_schema_contract(schema_contract_cursor)


@pytest.mark.parametrize(
    ("ddl", "expected_path"),
    (
        (
            "ALTER TABLE goi_dich_vu ALTER COLUMN ten_goi TYPE varchar(200)",
            "tables.goi_dich_vu.columns.ten_goi.type",
        ),
        (
            "ALTER TABLE database_metadata ALTER COLUMN baseline DROP NOT NULL",
            "tables.database_metadata.columns.baseline.notNull",
        ),
        (
            "ALTER TABLE goi_dich_vu ALTER COLUMN document_export_word DROP DEFAULT",
            "tables.goi_dich_vu.columns.document_export_word.default",
        ),
        (
            "ALTER TABLE goi_dich_vu DROP CONSTRAINT goi_dich_vu_gia_ca_check",
            "tables.goi_dich_vu.constraints.goi_dich_vu_gia_ca_check",
        ),
        (
            "ALTER TABLE tai_khoan DROP CONSTRAINT tai_khoan_username_norm_key",
            "tai_khoan_username_norm_key",
        ),
        (
            "ALTER TABLE account_subscriptions "
            "DROP CONSTRAINT fk_account_subscriptions_1_d0816114",
            "tables.account_subscriptions.constraints.fk_account_subscriptions_1_d0816114",
        ),
        (
            "DROP INDEX idx_rate_limit_expires; "
            "CREATE INDEX idx_rate_limit_expires "
            "ON rate_limit_buckets USING hash (expires_at)",
            "indexes.idx_rate_limit_expires.definition",
        ),
        (
            "DROP TRIGGER trg_goi_thau_lineage ON goi_thau",
            "triggers.goi_thau.trg_goi_thau_lineage",
        ),
        (
            "CREATE TABLE schema_contract_shadow (id text)",
            "tables.schema_contract_shadow",
        ),
        (
            "CREATE INDEX idx_schema_contract_shadow ON goi_dich_vu (id, ten_goi)",
            "indexes.idx_schema_contract_shadow",
        ),
        (
            "CREATE TRIGGER trg_goi_dich_vu_shadow "
            "BEFORE INSERT ON goi_dich_vu FOR EACH ROW "
            "EXECUTE FUNCTION bf_touch_synced_row()",
            "triggers.goi_dich_vu.trg_goi_dich_vu_shadow",
        ),
    ),
)
def test_live_postgres_catalog_rejects_transactional_drift(
    schema_contract_cursor,
    ddl,
    expected_path,
):
    for statement in ddl.split("; "):
        schema_contract_cursor.execute(statement)

    with pytest.raises(RuntimeError) as error:
        assert_schema_contract(schema_contract_cursor)

    assert expected_path in str(error.value)
