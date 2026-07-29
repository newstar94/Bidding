from scripts.audit_fk_indexes import index_covers_foreign_key
from types import SimpleNamespace

from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    _upgrade_to_v29_cover_remaining_foreign_keys,
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
    assert DB_SCHEMA_VERSION == 29
