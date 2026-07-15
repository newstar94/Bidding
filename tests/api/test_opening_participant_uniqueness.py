import sqlite3
import threading

from backend.sync.opening_uniqueness import (
    PACKAGE_SCOPE,
    normalize_lot_scope,
    validate_opening_participant_uniqueness,
)


def _database():
    connection = sqlite3.connect(":memory:")
    connection.executescript("""
        CREATE TABLE nha_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            id_goc TEXT
        );
        CREATE TABLE thong_tin_mo_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            archived_at TEXT,
            goi_thau_id TEXT NOT NULL,
            nha_thau_id TEXT NOT NULL,
            ma_phan_lo TEXT NOT NULL DEFAULT '',
            loai_nha_thau TEXT
        );
        CREATE TABLE thong_tin_mo_thau_lien_danh_thanh_vien (
            organization_id TEXT NOT NULL,
            thong_tin_mo_thau_id TEXT NOT NULL,
            thanh_vien_nha_thau_id TEXT
        );
        INSERT INTO nha_thau VALUES
            ('nt-a-v0', 'org-1', 'nt-a-v0'),
            ('nt-a-v1', 'org-1', 'nt-a-v0'),
            ('nt-b', 'org-1', 'nt-b'),
            ('nt-jv', 'org-1', 'nt-jv');
    """)
    return connection


def test_lot_scope_keeps_existing_month_independent_business_normalization():
    assert normalize_lot_scope("") == PACKAGE_SCOPE
    assert normalize_lot_scope(" LÔ  01 ") == "lô 01"


def test_independent_contractor_cannot_enter_same_package_scope_twice():
    connection = _database()
    connection.execute(
        "INSERT INTO thong_tin_mo_thau VALUES (?, ?, NULL, ?, ?, ?, ?)",
        ("bid-1", "org-1", "package-1", "nt-a-v0", "", "Độc lập"),
    )

    errors = validate_opening_participant_uniqueness(connection, "org-1", [{
        "id": "bid-2", "goiThauId": "package-1", "nhaThauId": "nt-a-v1",
        "maPhanLo": "", "loaiNhaThau": "Độc lập",
    }])

    assert errors[0]["code"] == "OPENING_CONTRACTOR_DUPLICATE"
    assert errors[0]["conflictingId"] == "bid-1"


def test_joint_venture_member_cannot_enter_another_bid_in_same_lot():
    connection = _database()
    connection.execute(
        "INSERT INTO thong_tin_mo_thau VALUES (?, ?, NULL, ?, ?, ?, ?)",
        ("bid-jv", "org-1", "package-1", "nt-jv", "L1", "Liên danh"),
    )
    connection.execute(
        "INSERT INTO thong_tin_mo_thau_lien_danh_thanh_vien VALUES (?, ?, ?)",
        ("org-1", "bid-jv", "nt-a-v0"),
    )

    errors = validate_opening_participant_uniqueness(connection, "org-1", [{
        "id": "bid-independent", "goiThauId": "package-1", "nhaThauId": "nt-a-v1",
        "maPhanLo": "l1", "loaiNhaThau": "Độc lập",
    }])

    assert errors[0]["code"] == "OPENING_CONTRACTOR_DUPLICATE"


def test_same_contractor_can_enter_different_lots():
    connection = _database()
    connection.execute(
        "INSERT INTO thong_tin_mo_thau VALUES (?, ?, NULL, ?, ?, ?, ?)",
        ("bid-l1", "org-1", "package-1", "nt-a-v0", "L1", "Độc lập"),
    )

    errors = validate_opening_participant_uniqueness(connection, "org-1", [{
        "id": "bid-l2", "goiThauId": "package-1", "nhaThauId": "nt-a-v1",
        "maPhanLo": "L2", "loaiNhaThau": "Độc lập",
    }])

    assert errors == []


def test_duplicates_inside_one_incoming_batch_are_rejected():
    connection = _database()
    errors = validate_opening_participant_uniqueness(connection, "org-1", [
        {"id": "bid-1", "goiThauId": "package-1", "nhaThauId": "nt-a-v0", "maPhanLo": "L1", "loaiNhaThau": "Độc lập"},
        {"id": "bid-2", "goiThauId": "package-1", "nhaThauId": "nt-a-v1", "maPhanLo": "l1", "loaiNhaThau": "Độc lập"},
    ])

    assert len(errors) == 1
    assert errors[0]["id"] == "bid-2"


def test_database_serializes_concurrent_inserts_for_the_same_participant_scope(tmp_path):
    """The database constraint remains authoritative under concurrent requests."""
    database_path = tmp_path / "opening-concurrency.db"
    setup = sqlite3.connect(database_path)
    setup.execute("PRAGMA journal_mode = WAL")
    setup.execute("""
        CREATE TABLE participant_registry (
            request_id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            goi_thau_id TEXT NOT NULL,
            lot_scope TEXT NOT NULL,
            nha_thau_goc_id TEXT NOT NULL,
            UNIQUE (organization_id, goi_thau_id, lot_scope, nha_thau_goc_id)
        )
    """)
    setup.close()

    first_has_written = threading.Event()
    allow_first_commit = threading.Event()
    outcomes = []

    def insert(request_id, wait_before_commit=False):
        connection = sqlite3.connect(database_path, timeout=2)
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "INSERT INTO participant_registry VALUES (?, 'org-1', 'package-1', 'lot-1', 'contractor-root')",
                (request_id,),
            )
            if wait_before_commit:
                first_has_written.set()
                assert allow_first_commit.wait(2)
            connection.commit()
            outcomes.append((request_id, "committed"))
        except sqlite3.IntegrityError:
            connection.rollback()
            outcomes.append((request_id, "duplicate"))
        finally:
            connection.close()

    first = threading.Thread(target=insert, args=("request-1", True))
    second = threading.Thread(target=insert, args=("request-2",))
    first.start()
    assert first_has_written.wait(2)
    second.start()
    allow_first_commit.set()
    first.join(3)
    second.join(3)

    assert not first.is_alive() and not second.is_alive()
    assert sorted(status for _, status in outcomes) == ["committed", "duplicate"]
    connection = sqlite3.connect(database_path)
    assert connection.execute("SELECT COUNT(*) FROM participant_registry").fetchone()[0] == 1
    connection.close()
