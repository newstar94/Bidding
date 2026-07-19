from backend.db import upgrades


class _Cursor:
    def __init__(self):
        self.calls = []

    def execute(self, statement, parameters=()):
        self.calls.append((" ".join(statement.split()), tuple(parameters)))
        return self


def test_mfa_removal_upgrade_drops_legacy_objects_and_advances_version():
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
    assert version == upgrades.DB_SCHEMA_VERSION == 2
