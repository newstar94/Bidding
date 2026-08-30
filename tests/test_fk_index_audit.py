from scripts.audit_fk_indexes import index_covers_foreign_key
from types import SimpleNamespace

from backend.db.upgrades import (
    COMMERCIAL_V81_FK_INDEXES,
    COMMERCIAL_V81_FK_INDEX_NAMES,
    DB_SCHEMA_VERSION,
    UPGRADES,
    _upgrade_to_v29_cover_remaining_foreign_keys,
    _upgrade_to_v81_index_commercial_foreign_keys,
    _upgrade_to_v82_add_product_usage_analytics,
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


def test_v82_creates_usage_rollup_fk_indexes_trigger_and_rechecks_integrity():
    statements = []
    foreign_key_calls = []
    trigger_function_calls = []
    checks = []

    class Cursor:
        def execute(self, statement, params=None):
            statements.append((" ".join(statement.split()), params))
            return self

    cursor = Cursor()
    context = SimpleNamespace(
        build_create_table_sql=lambda table_name, _table_spec: (
            f"CREATE TABLE {table_name} (id TEXT)"
        ),
        create_foreign_keys=lambda value, table_names, **kwargs: (
            foreign_key_calls.append((value, table_names, kwargs))
        ),
        create_trigger_functions=lambda value: trigger_function_calls.append(value),
        assert_foreign_key_integrity=lambda value: checks.append(value),
    )

    _upgrade_to_v82_add_product_usage_analytics(cursor, context)

    sql = "\n".join(statement for statement, _params in statements)
    assert statements[0][0].startswith(
        "CREATE TABLE IF NOT EXISTS product_usage_hourly"
    )
    assert foreign_key_calls == [
        (cursor, ("product_usage_hourly",), {"if_not_exists": True})
    ]
    assert "idx_product_usage_presence_recent" in sql
    assert "idx_product_usage_feature_window" in sql
    assert "DROP INDEX IF EXISTS idx_product_usage_user_window" in sql
    assert "idx_product_usage_metric_window" in sql
    assert (
        "ON product_usage_hourly (metric_key, window_started_at, user_id) "
        "INCLUDE (event_count)"
    ) in sql
    assert "idx_product_usage_user_fk" in sql
    assert "ON product_usage_hourly (user_id)" in sql
    assert "idx_product_usage_hourly_owner_type_owner" in sql
    assert "idx_activity_product_usage" in sql
    assert (
        "ON nhat_ky_thuc_hien (occurred_at, actor_user_id) "
        "WHERE actor_user_id IS NOT NULL"
    ) in sql
    assert "trg_product_usage_hourly_workspace_owner" in sql
    assert trigger_function_calls == [cursor]
    assert checks == [cursor]
    assert DB_SCHEMA_VERSION >= 82
    assert any(upgrade.version == 82 for upgrade in UPGRADES)
