from backend.db import upgrades


class _Cursor:
    def __init__(self):
        self.calls = []

    def execute(self, statement, parameters=()):
        self.calls.append((" ".join(statement.split()), tuple(parameters)))
        return self


def test_mfa_removal_upgrades_drop_legacy_objects_and_advance_version():
    cursor = _Cursor()

    version = upgrades.apply_database_upgrades(
        cursor,
        upgrades.BASELINE_SCHEMA_VERSION,
        upgrades.DatabaseUpgradeContext(None, None, None),
    )

    statements = [statement for statement, _ in cursor.calls]
    assert "DROP TABLE IF EXISTS account_mfa" in statements
    assert (
        "ALTER TABLE auth_sessions DROP COLUMN IF EXISTS mfa_verified_at"
        in statements
    )
    assert statements.count("DROP TABLE IF EXISTS account_mfa") == 2
    assert statements.count(
        "ALTER TABLE auth_sessions DROP COLUMN IF EXISTS mfa_verified_at"
    ) == 2
    assert any("ROW_NUMBER() OVER" in statement for statement in statements)
    assert any(
        "idx_auth_sessions_one_active_per_user" in statement
        for statement in statements
    )
    assert any(
        "ALTER TABLE goi_thau_chuyen_gia ADD COLUMN IF NOT EXISTS updated_at"
        in statement
        for statement in statements
    )
    assert any(
        "SET trong_so_ky_thuat = NULL" in statement
        for statement in statements
    )
    assert version == upgrades.DB_SCHEMA_VERSION == 9


def test_v2_installation_reconciles_retired_mfa_schema_in_v3():
    cursor = _Cursor()

    version = upgrades.apply_database_upgrades(
        cursor,
        2,
        upgrades.DatabaseUpgradeContext(None, None, None),
    )

    statements = [statement for statement, _ in cursor.calls]
    assert "DROP TABLE IF EXISTS account_mfa" in statements
    assert (
        "ALTER TABLE auth_sessions DROP COLUMN IF EXISTS mfa_verified_at"
        in statements
    )
    assert any("ROW_NUMBER() OVER" in statement for statement in statements)
    assert version == upgrades.DB_SCHEMA_VERSION == 9


def test_v3_installation_enforces_one_active_session_in_v4():
    cursor = _Cursor()

    version = upgrades.apply_database_upgrades(
        cursor,
        3,
        upgrades.DatabaseUpgradeContext(None, None, None),
    )

    statements = [statement for statement, _ in cursor.calls]
    assert any("ROW_NUMBER() OVER" in statement for statement in statements)
    assert any(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_one_active_per_user"
        in statement
        for statement in statements
    )
    assert version == upgrades.DB_SCHEMA_VERSION == 9


def test_v4_installation_adds_package_expert_updated_at_in_v5():
    cursor = _Cursor()

    version = upgrades.apply_database_upgrades(
        cursor,
        4,
        upgrades.DatabaseUpgradeContext(None, None, None),
    )

    statements = [statement for statement, _ in cursor.calls]
    assert any(
        "ALTER TABLE goi_thau_chuyen_gia ADD COLUMN IF NOT EXISTS updated_at"
        in statement
        for statement in statements
    )
    assert version == upgrades.DB_SCHEMA_VERSION == 9
