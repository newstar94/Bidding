from scripts.audit_fk_indexes import index_covers_foreign_key
from types import SimpleNamespace

from backend.db.upgrades import (
    COMMERCIAL_V81_FK_INDEXES,
    COMMERCIAL_V81_FK_INDEX_NAMES,
    DB_SCHEMA_VERSION,
    UPGRADES,
    _upgrade_to_v29_cover_remaining_foreign_keys,
    _upgrade_to_v81_index_commercial_foreign_keys,
)


def test_fk_index_audit_accepts_only_matching_left_prefixes():
    assert index_covers_foreign_key([2, 6], [2, 6])
    assert index_covers_foreign_key([2, 6, 9], [2, 6])
    assert not index_covers_foreign_key([2, 4, 6], [2, 6])
    assert not index_covers_foreign_key([6, 2], [2, 6])
    assert not index_covers_foreign_key([], [2])


def test_v29_creates_all_fk_indexes_and_rechecks_integrity():
    statements = []
    checks = []

    class Cursor:
        def execute(self, statement, params=None):
            statements.append((" ".join(statement.split()), params))
            return self

    cursor = Cursor()
    context = SimpleNamespace(
        assert_foreign_key_integrity=lambda value: checks.append(value),
    )
    _upgrade_to_v29_cover_remaining_foreign_keys(cursor, context)

    sql = "\n".join(statement for statement, _params in statements)
    assert "idx_bidder_goods_lot_fk" in sql
    assert "idx_bidder_goods_requirement_fk" in sql
    assert "idx_bidder_goods_manual_actor_fk" in sql
    assert "idx_package_documents_batch_fk" in sql
    assert checks == [cursor]
    assert DB_SCHEMA_VERSION >= 29
    assert any(upgrade.version == 29 for upgrade in UPGRADES)


def test_v81_creates_each_commercial_fk_index_and_rechecks_integrity():
    statements = []
    checks = []

    class Cursor:
        def execute(self, statement, params=None):
            statements.append((" ".join(statement.split()), params))
            return self

    cursor = Cursor()
    context = SimpleNamespace(
        assert_foreign_key_integrity=lambda value: checks.append(value),
    )
    _upgrade_to_v81_index_commercial_foreign_keys(cursor, context)

    assert len(COMMERCIAL_V81_FK_INDEXES) == 32
    assert len(COMMERCIAL_V81_FK_INDEX_NAMES) == 32
    assert [statement for statement, _params in statements] == [
        " ".join(statement.split()) for statement in COMMERCIAL_V81_FK_INDEXES
    ]
    assert checks == [cursor]
    assert DB_SCHEMA_VERSION >= 81
    assert any(upgrade.version == 81 for upgrade in UPGRADES)
