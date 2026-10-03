import sqlite3

import pytest

from backend.db.db_helper import CompatRow
from backend.sync.mapper import (
    _format_extension_child,
    _save_extensions,
    _save_package_children,
)


NOW = "2026-10-03T00:00:00Z"
FIRST_SOURCE_ID = "gh-" + "a" * 64
SECOND_SOURCE_ID = "gh-" + "b" * 64


@pytest.fixture
def extension_database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = lambda cursor, values: CompatRow(
        [column[0] for column in cursor.description], values,
    )
    connection.execute(
        """CREATE TABLE goi_thau_gia_han (
            id TEXT, organization_id TEXT, owner_type TEXT, goi_thau_id TEXT,
            thoi_gian_dong_thau TEXT, ly_do_gia_han TEXT, sort_order INTEGER,
            sync_version INTEGER, updated_at TEXT,
            UNIQUE(organization_id, id)
        )"""
    )
    stale_calls = []
    connection.create_function(
        "bf_mark_contractor_violation_package_stale", 2,
        lambda organization_id, package_id: stale_calls.append((organization_id, package_id)),
    )
    yield connection, stale_calls
    connection.close()


def save_extensions(connection, rows, *, version=2, organization_id="org", package_id="package-a"):
    _save_extensions(
        connection.cursor(), package_id, rows,
        organization_id, "organization", version, NOW,
    )


def extension_rows(connection, *, organization_id="org", package_id="package-a"):
    return [dict(row) for row in connection.execute(
        """SELECT * FROM goi_thau_gia_han
           WHERE organization_id = ? AND goi_thau_id = ? ORDER BY sort_order""",
        (organization_id, package_id),
    ).fetchall()]


def test_distinct_source_ids_keep_equal_closing_and_reason(extension_database):
    connection, _ = extension_database
    content = {
        "thoiGianDongThau": "2026-10-01T10:00:00",
        "lyDoGiaHan": "Gia hạn để trả lời yêu cầu làm rõ E-HSMT",
    }
    save_extensions(connection, [
        {"id": FIRST_SOURCE_ID, **content},
        {"id": SECOND_SOURCE_ID, **content},
    ])

    rows = extension_rows(connection)
    assert [row["id"] for row in rows] == [FIRST_SOURCE_ID, SECOND_SOURCE_ID]
    assert [row["sort_order"] for row in rows] == [0, 1]
    assert all(row["ly_do_gia_han"] == content["lyDoGiaHan"] for row in rows)


def test_exact_repeat_source_id_is_deduplicated(extension_database):
    connection, _ = extension_database
    row = {
        "id": FIRST_SOURCE_ID,
        "thoiGianDongThau": "2026-10-01T10:00:00",
        "lyDoGiaHan": "Gia hạn để sửa đổi E-HSMT",
    }
    save_extensions(connection, [row, dict(row)])
    assert len(extension_rows(connection)) == 1


def test_conflicting_duplicate_source_id_rejects_before_replacing_history(extension_database):
    connection, stale_calls = extension_database
    row = {
        "id": FIRST_SOURCE_ID,
        "thoiGianDongThau": "2026-10-01T10:00:00",
        "lyDoGiaHan": "Original reason",
    }
    save_extensions(connection, [row])
    previous = extension_rows(connection)
    stale_calls.clear()

    with pytest.raises(ValueError, match="DUPLICATE_EXTENSION_ID"):
        save_extensions(connection, [row, {**row, "lyDoGiaHan": "Conflicting reason"}], version=3)
    assert extension_rows(connection) == previous
    assert stale_calls == []


@pytest.mark.parametrize("conflicting_reason", [
    "original reason", "Original  reason", " Original reason", "Original reason\n",
])
def test_duplicate_source_id_does_not_fold_visible_reason_changes(extension_database, conflicting_reason):
    connection, stale_calls = extension_database
    row = {
        "id": FIRST_SOURCE_ID,
        "thoiGianDongThau": "2026-10-01T10:00:00",
        "lyDoGiaHan": "Original reason",
    }
    save_extensions(connection, [row])
    previous = extension_rows(connection)
    stale_calls.clear()

    with pytest.raises(ValueError, match="DUPLICATE_EXTENSION_ID"):
        save_extensions(connection, [row, {**row, "lyDoGiaHan": conflicting_reason}], version=3)
    assert extension_rows(connection) == previous
    assert stale_calls == []


def test_repeat_source_id_compares_canonical_persisted_closing_time(extension_database):
    connection, _ = extension_database
    row = {
        "id": FIRST_SOURCE_ID,
        "thoiGianDongThau": "2026-10-01T10:00:00",
        "lyDoGiaHan": "Original reason",
    }
    save_extensions(connection, [row, {**row, "thoiGianDongThau": "01/10/2026 10:00"}])
    rows = extension_rows(connection)
    assert len(rows) == 1
    assert rows[0]["thoi_gian_dong_thau"] == "2026-10-01 10:00:00"


def test_legacy_rows_without_ids_keep_existing_content_deduplication(extension_database):
    connection, _ = extension_database
    first = {"thoiGianDongThau": "2026-10-01T10:00:00", "lyDoGiaHan": " Same  CONTENT "}
    save_extensions(connection, [
        first,
        {"thoiGianDongThau": first["thoiGianDongThau"], "lyDoGiaHan": "same content"},
    ])
    rows = extension_rows(connection)
    assert len(rows) == 1
    assert rows[0]["id"]
    assert rows[0]["ly_do_gia_han"] == first["lyDoGiaHan"]


def test_explicit_id_and_legacy_content_have_separate_identity(extension_database):
    connection, _ = extension_database
    content = {"thoiGianDongThau": "2026-10-01T10:00:00", "lyDoGiaHan": "Equal content"}
    save_extensions(connection, [content, {"id": FIRST_SOURCE_ID, **content}])
    assert len(extension_rows(connection)) == 2


def test_repeat_save_preserves_hashed_ids_and_does_not_mark_unchanged_close_stale(extension_database):
    connection, stale_calls = extension_database
    rows = [
        {"id": FIRST_SOURCE_ID, "thoiGianDongThau": "2026-10-01T10:00:00", "lyDoGiaHan": "First"},
        {"id": SECOND_SOURCE_ID, "thoiGianDongThau": "2026-10-12T09:00:00", "lyDoGiaHan": "Second"},
    ]
    save_extensions(connection, rows)
    assert stale_calls == [("org", "package-a")]
    rows[0]["lyDoGiaHan"] = "User edited reason\nRetain full text"
    save_extensions(connection, rows, version=3)

    persisted = extension_rows(connection)
    assert [row["id"] for row in persisted] == [FIRST_SOURCE_ID, SECOND_SOURCE_ID]
    assert [row["thoi_gian_dong_thau"] for row in persisted] == [
        "2026-10-01 10:00:00", "2026-10-12 09:00:00",
    ]
    assert persisted[0]["ly_do_gia_han"] == rows[0]["lyDoGiaHan"]
    assert all(row["sync_version"] == 3 for row in persisted)
    assert stale_calls == [("org", "package-a")]


@pytest.mark.parametrize("naming", ["camel", "snake"])
def test_canonical_projection_roundtrip_retains_source_ids_and_each_new_close(extension_database, naming):
    connection, _ = extension_database
    save_extensions(connection, [
        {"id": FIRST_SOURCE_ID, "thoiGianDongThau": "2026-09-28T10:00:00", "lyDoGiaHan": "Phiên bản 00"},
        {"id": SECOND_SOURCE_ID, "thoiGianDongThau": "2026-10-01T10:00:00", "lyDoGiaHan": "Phiên bản 01"},
    ])
    projected = [_format_extension_child(row, naming) for row in extension_rows(connection)]
    save_extensions(connection, projected, version=3)
    roundtrip = [_format_extension_child(row, naming) for row in extension_rows(connection)]
    assert roundtrip == projected
    assert [row["id"] for row in roundtrip] == [FIRST_SOURCE_ID, SECOND_SOURCE_ID]


def test_closing_change_marks_only_target_package_stale(extension_database):
    connection, stale_calls = extension_database
    row = {"id": FIRST_SOURCE_ID, "thoiGianDongThau": "28/09/2026 10:00", "lyDoGiaHan": "First"}
    save_extensions(connection, [row])
    save_extensions(connection, [{**row, "thoiGianDongThau": "01/10/2026 10:00"}], version=3)
    assert stale_calls == [("org", "package-a"), ("org", "package-a")]
    assert extension_rows(connection)[0]["thoi_gian_dong_thau"] == "2026-10-01 10:00:00"


def test_replacement_preserves_other_tenant_and_other_package(extension_database):
    connection, stale_calls = extension_database
    source = {"id": FIRST_SOURCE_ID, "thoiGianDongThau": "2026-10-01T10:00:00", "lyDoGiaHan": "Shared"}
    save_extensions(connection, [source], organization_id="other-org")
    save_extensions(connection, [{**source, "id": SECOND_SOURCE_ID}], package_id="package-b")
    other_tenant = extension_rows(connection, organization_id="other-org")
    other_package = extension_rows(connection, package_id="package-b")
    stale_calls.clear()

    save_extensions(connection, [source])
    save_extensions(connection, [{**source, "lyDoGiaHan": "Edited target reason"}], version=3)
    assert extension_rows(connection, organization_id="other-org") == other_tenant
    assert extension_rows(connection, package_id="package-b") == other_package
    assert stale_calls == [("org", "package-a")]


def test_missing_extension_payload_preserves_existing_history(extension_database):
    connection, stale_calls = extension_database
    save_extensions(connection, [{
        "id": FIRST_SOURCE_ID, "thoiGianDongThau": "2026-10-01T10:00:00", "lyDoGiaHan": "Existing",
    }])
    previous = extension_rows(connection)
    stale_calls.clear()
    _save_package_children(connection.cursor(), "package-a", {"id": "package-a"}, "org", "organization", 3, NOW)
    assert extension_rows(connection) == previous
    assert stale_calls == []


def test_foreign_package_id_collision_rolls_back_target_replacement(extension_database):
    connection, stale_calls = extension_database
    source = {"id": FIRST_SOURCE_ID, "thoiGianDongThau": "2026-10-01T10:00:00", "lyDoGiaHan": "Target"}
    save_extensions(connection, [source])
    save_extensions(connection, [{**source, "id": SECOND_SOURCE_ID}], package_id="package-b")
    connection.commit()
    previous = extension_rows(connection)
    other_package = extension_rows(connection, package_id="package-b")
    stale_calls.clear()

    with pytest.raises(sqlite3.IntegrityError):
        with connection:
            save_extensions(connection, [{**source, "id": SECOND_SOURCE_ID}], version=3)
    assert extension_rows(connection) == previous
    assert extension_rows(connection, package_id="package-b") == other_package
    assert stale_calls == []
