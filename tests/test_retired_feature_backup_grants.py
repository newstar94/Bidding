from scripts.configure_database_roles import _grant_retired_archive_backup_access


class RecordingCursor:
    def __init__(self, exists):
        self.exists = exists
        self.statements = []

    def execute(self, statement, parameters=None):
        rendered = statement.as_string() if hasattr(statement, "as_string") else statement
        self.statements.append((rendered, parameters))
        return self

    def fetchone(self):
        return (1,) if self.exists else None


def test_backup_role_setup_does_not_create_an_absent_retired_archive():
    cursor = RecordingCursor(False)
    _grant_retired_archive_backup_access(cursor, "backup_reader")
    assert cursor.statements == [(
        "SELECT 1 FROM pg_namespace WHERE nspname = %s", ("bidding_retired_features",)
    )]


def test_existing_archive_receives_only_read_access_for_the_configured_backup_role():
    cursor = RecordingCursor(True)
    _grant_retired_archive_backup_access(cursor, "backup_reader")
    grants = [statement for statement, _params in cursor.statements[1:]]
    assert grants == [
        'GRANT USAGE ON SCHEMA "bidding_retired_features" TO "backup_reader"',
        'GRANT SELECT ON ALL TABLES IN SCHEMA "bidding_retired_features" TO "backup_reader"',
        'GRANT SELECT ON ALL SEQUENCES IN SCHEMA "bidding_retired_features" TO "backup_reader"',
    ]
