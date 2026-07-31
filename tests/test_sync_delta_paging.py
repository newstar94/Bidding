import pytest

from backend.sync.delta_paging import (
    DeltaCursorError,
    _load_candidates,
    decode_delta_cursor,
    encode_delta_cursor,
)
from tests.test_sync_conflict_authorization import _seed_denied_package, _test_database


def _cursor(**overrides):
    values = {
        "signing_key": "session-secret",
        "organization_id": "org-a",
        "user_id": "user-a",
        "after_version": 10,
        "through_version": 50,
        "marker": (20, "upsert", "goithau", "package-1"),
        "expires_at": 2_000,
    }
    values.update(overrides)
    return encode_delta_cursor(**values)


def test_delta_cursor_round_trips_fixed_snapshot_and_marker():
    decoded = decode_delta_cursor(
        _cursor(),
        signing_key="session-secret",
        organization_id="org-a",
        user_id="user-a",
        now=1_000,
    )
    assert decoded["after"] == 10
    assert decoded["through"] == 50
    assert decoded["marker"] == (20, "upsert", "goithau", "package-1")


@pytest.mark.parametrize(
    "changes",
    [
        {"signing_key": "other"},
        {"organization_id": "org-b"},
        {"user_id": "user-b"},
    ],
)
def test_delta_cursor_rejects_tamper_and_cross_scope_replay(changes):
    arguments = {
        "signing_key": "session-secret",
        "organization_id": "org-a",
        "user_id": "user-a",
        "now": 1_000,
    }
    arguments.update(changes)
    with pytest.raises(DeltaCursorError):
        decode_delta_cursor(_cursor(), **arguments)


def test_delta_cursor_expires():
    with pytest.raises(DeltaCursorError, match="CURSOR_EXPIRED"):
        decode_delta_cursor(
            _cursor(),
            signing_key="session-secret",
            organization_id="org-a",
            user_id="user-a",
            now=2_001,
        )


def test_delta_query_pins_through_version_and_orders_live_with_tombstone():
    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, _employee_id, package_id = _seed_denied_package(cursor)
        cursor.execute(
            "UPDATE goi_thau SET sync_version = 11 WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        )
        cursor.execute(
            """INSERT INTO deleted_records
               (table_name, record_id, organization_id, delete_version, record_snapshot_json)
               VALUES ('goi_thau', ?, ?, 12, '{}')""",
            (f"deleted-{package_id}", organization_id),
        )
        cursor.execute(
            """INSERT INTO deleted_records
               (table_name, record_id, organization_id, delete_version, record_snapshot_json)
               VALUES ('goi_thau', ?, ?, 13, '{}')""",
            (f"concurrent-{package_id}", organization_id),
        )

        rows = _load_candidates(
            cursor,
            organization_id,
            10,
            12,
            (10, "", "", ""),
            100,
        )

        identities = [(int(row["version"]), row["kind"], row["record_id"]) for row in rows]
        assert (11, "upsert", package_id) in identities
        assert (12, "delete", f"deleted-{package_id}") in identities
        assert all(version <= 12 for version, _kind, _record_id in identities)
        assert identities == sorted(identities)
    finally:
        connection.rollback()
        connection.close()
        database.close()
