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
    assert version == upgrades.DB_SCHEMA_VERSION == 3


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
    assert version == upgrades.DB_SCHEMA_VERSION == 3
