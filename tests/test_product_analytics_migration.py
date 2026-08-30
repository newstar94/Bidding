from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    PRODUCT_ANALYTICS_V85_INDEXES,
    PRODUCT_ANALYTICS_V85_TABLES,
    PRODUCT_ANALYTICS_V86_INDEXES,
    PRODUCT_ANALYTICS_V86_TABLES,
    PRODUCT_ANALYTICS_V87_INDEXES,
    PRODUCT_ANALYTICS_V87_TABLES,
    PRODUCT_ANALYTICS_V84_INDEXES,
    PRODUCT_ANALYTICS_V84_TABLES,
    apply_database_upgrades,
)
from backend.db.postgres_schema import assert_schema_contract
from backend.product_analytics.aggregation import refresh_product_analytics
from backend.product_analytics import routes as analytics_routes
from backend.product_analytics.query_service import VIEWS, build_dashboard
from scripts.audit_fk_indexes import find_missing_foreign_key_indexes
from tests.test_postgres_migration_chain import (
    _close_fixture_connection,
    _open_fixture_connection,
    _upgrade_context,
)


def test_v84_adjacent_upgrade_builds_product_analytics_contract():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(cursor, 1, context, target_version=83) == 83
        # The historical v46 catalog reconciler sees today's registry in this
        # fixture. Remove those future artifacts to rehearse a deployed v83 DB.
        for table in reversed(PRODUCT_ANALYTICS_V84_TABLES):
            cursor.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

        assert apply_database_upgrades(cursor, 83, context) == DB_SCHEMA_VERSION == 88
        for table in PRODUCT_ANALYTICS_V84_TABLES:
            assert cursor.execute("SELECT to_regclass(?)", (table,)).fetchone()[0] == table
        for table in PRODUCT_ANALYTICS_V85_TABLES:
            assert cursor.execute("SELECT to_regclass(?)", (table,)).fetchone()[0] == table
        for table in PRODUCT_ANALYTICS_V86_TABLES:
            assert cursor.execute("SELECT to_regclass(?)", (table,)).fetchone()[0] == table
        for table in PRODUCT_ANALYTICS_V87_TABLES:
            assert cursor.execute("SELECT to_regclass(?)", (table,)).fetchone()[0] == table

        index_names = {
            row[0]
            for row in cursor.execute(
                "SELECT indexname FROM pg_indexes WHERE schemaname=current_schema()"
            ).fetchall()
        }
        for statement in PRODUCT_ANALYTICS_V84_INDEXES:
            expected = statement.split("INDEX IF NOT EXISTS ", 1)[1].split(" ON ", 1)[0]
            assert expected in index_names
        for statement in PRODUCT_ANALYTICS_V85_INDEXES:
            expected = statement.split("INDEX IF NOT EXISTS ", 1)[1].split(" ON ", 1)[0]
            assert expected in index_names
        for statement in PRODUCT_ANALYTICS_V86_INDEXES:
            expected = statement.split("INDEX IF NOT EXISTS ", 1)[1].split(" ON ", 1)[0]
            assert expected in index_names
        for statement in PRODUCT_ANALYTICS_V87_INDEXES:
            expected = statement.split("INDEX IF NOT EXISTS ", 1)[1].split(" ON ", 1)[0]
            assert expected in index_names

        assert cursor.execute(
            """SELECT COUNT(*) FROM pg_constraint
                WHERE connamespace=current_schema()::regnamespace
                  AND conrelid='commercial_analytics_events'::regclass
                  AND contype='f' AND convalidated"""
        ).fetchone()[0] == 1
        assert find_missing_foreign_key_indexes(connection)["missing"] == []
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_v88_converges_a_partial_deployed_v84_analytics_catalog():
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(cursor, 1, context, target_version=84) == 84

        cursor.execute("DROP TABLE subscription_snapshot_daily CASCADE")
        cursor.execute("DROP TABLE workspace_seat_daily CASCADE")
        for column_name in (
            "fetch_attempted",
            "fetch_failures",
            "fetch_cancelled",
            "cache_hits",
            "credits_reserved",
            "credits_released",
        ):
            cursor.execute(
                f"ALTER TABLE workspace_usage_daily DROP COLUMN {column_name}"
            )
        cursor.execute(
            "ALTER TABLE cost_usage_daily DROP CONSTRAINT "
            "cost_usage_daily_analytics_workspace_id_check"
        )
        cursor.execute(
            "ALTER TABLE cost_usage_daily ALTER COLUMN analytics_workspace_id "
            "DROP DEFAULT"
        )
        cursor.execute(
            "ALTER TABLE cost_usage_daily ADD CONSTRAINT "
            "cost_usage_daily_analytics_workspace_id_check "
            "CHECK(analytics_workspace_id IS NULL OR "
            "length(analytics_workspace_id)=64)"
        )
        cursor.execute(
            "ALTER TABLE retention_cohort_weekly ALTER COLUMN "
            "commercial_release_id DROP DEFAULT"
        )
        cursor.execute(
            "ALTER TABLE retention_cohort_weekly ADD CONSTRAINT "
            "fk_retention_cohort_weekly_1_2ea853e4 "
            "FOREIGN KEY(commercial_release_id) "
            "REFERENCES commercial_releases(id) ON DELETE RESTRICT"
        )

        assert apply_database_upgrades(cursor, 84, context) == DB_SCHEMA_VERSION == 88
        assert_schema_contract(cursor)
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_product_analytics_primary_keys_enforce_aggregate_grain(monkeypatch):
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(cursor, 1, context) == DB_SCHEMA_VERSION
        primary_keys = {
            row[0]: tuple(row[1])
            for row in cursor.execute(
                """SELECT relation.relname,
                          ARRAY_AGG(attribute.attname ORDER BY key.ordinality)
                     FROM pg_constraint AS constraint_row
                     JOIN pg_class AS relation ON relation.oid=constraint_row.conrelid
                     JOIN LATERAL unnest(constraint_row.conkey)
                          WITH ORDINALITY AS key(attnum, ordinality) ON TRUE
                     JOIN pg_attribute AS attribute
                       ON attribute.attrelid=relation.oid AND attribute.attnum=key.attnum
                    WHERE constraint_row.connamespace=current_schema()::regnamespace
                      AND constraint_row.contype='p'
                      AND relation.relname=ANY(?)
                    GROUP BY relation.relname""",
            (list(PRODUCT_ANALYTICS_V84_TABLES + PRODUCT_ANALYTICS_V85_TABLES + PRODUCT_ANALYTICS_V86_TABLES + PRODUCT_ANALYTICS_V87_TABLES),),
            ).fetchall()
        }
        assert primary_keys["workspace_usage_daily"] == ("usage_date", "analytics_workspace_id")
        assert primary_keys["workspace_seat_daily"] == (
            "usage_date", "analytics_workspace_id", "analytics_user_id"
        )
        assert primary_keys["plan_fit_monthly"] == ("snapshot_month", "analytics_workspace_id")
        columns = {
            (row[0], row[1])
            for row in cursor.execute(
                """SELECT table_name,column_name FROM information_schema.columns
                    WHERE table_schema=current_schema()
                      AND table_name IN ('workspace_usage_daily',
                                         'commercial_funnel_workspace_daily',
                                         'cost_usage_daily','plan_fit_monthly')"""
            ).fetchall()
        }
        assert ("workspace_usage_daily", "expired_unused_credits") in columns
        assert ("commercial_funnel_workspace_daily", "first_occurred_at") in columns
        assert ("commercial_funnel_workspace_daily", "last_occurred_at") in columns
        assert ("cost_usage_daily", "cost_status") in columns
        assert ("plan_fit_monthly", "cost_status") in columns

        epoch = int(datetime(2026, 8, 30, 9, tzinfo=ZoneInfo("Asia/Ho_Chi_Minh")).timestamp())
        cursor.execute(
            """INSERT INTO product_usage_hourly
               (window_started_at,user_id,organization_id,owner_type,metric_key,
                feature_key,event_count,first_seen_at,last_seen_at)
               VALUES (?, 'fixture-user', 'fixture-org', 'organization',
                       'feature.used', 'plans', 3, ?, ?)""",
            (epoch, epoch, epoch),
        )
        release_id = cursor.execute(
            "SELECT id FROM commercial_releases ORDER BY created_at LIMIT 1"
        ).fetchone()[0]
        cursor.execute(
            """INSERT INTO ai_usage_daily
               (usage_date,organization_id,user_id,request_count,input_tokens,
                output_tokens,tool_call_count,estimated_cost)
               VALUES ('2026-08-30','fixture-org','fixture-user',2,100,50,1,3.5)"""
        )
        cursor.execute(
            """INSERT INTO usage_credit_grants
               (id,account_user_id,organization_id,owner_kind,feature,total,
                remaining,reserved,source,order_item_id,release_id,policy_checksum,
                issued_at,expires_at)
               VALUES ('expired-purchase-grant',NULL,'fixture-org','organization',
                       'procurement.source_fetch',100,25,0,'purchase',NULL,?,
                       ?,?,?)""",
            (release_id, "a" * 64, epoch - 3_600, epoch + 3_600),
        )
        for offset, occurred_at in enumerate((epoch - 86_400, epoch), start=1):
            cursor.execute(
                """INSERT INTO commercial_analytics_events
                   (event_id,event_name,analytics_user_id,analytics_workspace_id,
                    owner_kind,size_bucket,sku_code,commercial_release_id,source,
                    occurred_at,received_at)
                   VALUES (?, 'pricing.viewed', ?, ?, 'organization', '6_15',
                           NULL, ?, 'pricing_page', ?, ?)""",
                (f"event-{offset}", "u" * 64, "w" * 64, release_id, occurred_at, occurred_at),
            )
        monkeypatch.delenv("ANALYTICS_AI_COST_VND_MULTIPLIER", raising=False)
        result = refresh_product_analytics(
            cursor,
            from_date="2026-08-29",
            to_date="2026-08-30",
            hmac_key="analytics-migration-test-key",
        )
        assert result["workspaceRows"] >= 1
        aggregate = cursor.execute(
            """SELECT active_seats,meaningful_actions,feature_uses,expired_unused_credits
                 FROM workspace_usage_daily WHERE usage_date='2026-08-30'"""
        ).fetchone()
        assert tuple(aggregate) == (1, 3, 3, 25)
        ai_cost = cursor.execute(
            """SELECT quantity,estimated_cost_vnd,cost_status FROM cost_usage_daily
                WHERE usage_date='2026-08-30' AND cost_type='ai'"""
        ).fetchone()
        assert tuple(ai_cost) == (2, 0, "not_configured")
        monkeypatch.setenv("ANALYTICS_AI_COST_VND_MULTIPLIER", "2")
        refresh_product_analytics(
            cursor,
            from_date="2026-08-29",
            to_date="2026-08-30",
            hmac_key="analytics-migration-test-key",
        )
        configured_ai_cost = cursor.execute(
            """SELECT quantity,estimated_cost_vnd,cost_status FROM cost_usage_daily
                WHERE usage_date='2026-08-30' AND cost_type='ai'"""
        ).fetchone()
        assert tuple(configured_ai_cost) == (2, 7, "available")
        plan_fit_cost = cursor.execute(
            """SELECT estimated_cost_vnd,cost_status FROM plan_fit_monthly
                WHERE snapshot_month='2026-08-01'"""
        ).fetchone()
        assert tuple(plan_fit_cost) == (7, "available")
        assert cursor.execute(
            "SELECT event_count FROM workspace_feature_daily WHERE usage_date='2026-08-30'"
        ).fetchone()[0] == 3
        funnel_timing = cursor.execute(
            """SELECT first_occurred_at,last_occurred_at
                 FROM commercial_funnel_workspace_daily
                WHERE usage_date='2026-08-30' AND event_name='pricing.viewed'"""
        ).fetchone()
        assert tuple(funnel_timing) == (epoch, epoch)
        funnel = build_dashboard(
            cursor, from_date="2026-08-29", to_date="2026-08-30", view="funnel",
        )
        pricing = next(row for row in funnel["funnel"] if row["stage"] == "pricing.viewed")
        assert pricing["count"] == 2
        assert pricing["uniqueWorkspaces"] == 1
        credits = build_dashboard(
            cursor, from_date="2026-08-29", to_date="2026-08-30", view="credits",
        )
        assert credits["credits"]["expiredUnusedCredits"] == {
            "status": "available", "value": 25,
        }
        for view in sorted(VIEWS):
            dashboard = build_dashboard(
                cursor, from_date="2026-08-30", to_date="2026-08-30", view=view,
            )
            assert dashboard["hasData"] is True
            assert dashboard["view"] == view
        filtered_empty = build_dashboard(
            cursor,
            from_date="2026-08-30",
            to_date="2026-08-30",
            view="overview",
            filters={"releaseId": "release-with-no-analytics-facts"},
        )
        assert filtered_empty["hasData"] is False
    finally:
        _close_fixture_connection(connection, cursor, schema_name)


def test_backend_backed_dashboard_route_serves_every_decision_view(monkeypatch):
    connection, cursor, schema_name = _open_fixture_connection()
    try:
        context = _upgrade_context()
        assert apply_database_upgrades(cursor, 1, context) == DB_SCHEMA_VERSION
        epoch = int(datetime(2026, 8, 30, 9, tzinfo=ZoneInfo("Asia/Ho_Chi_Minh")).timestamp())
        cursor.execute(
            """INSERT INTO product_usage_hourly
               (window_started_at,user_id,organization_id,owner_type,metric_key,
                feature_key,event_count,first_seen_at,last_seen_at)
               VALUES (?, 'fixture-user', 'fixture-org', 'organization',
                       'feature.used', 'plans', 3, ?, ?)""",
            (epoch, epoch, epoch),
        )
        refresh_product_analytics(
            cursor, from_date="2026-08-30", to_date="2026-08-30",
            hmac_key="analytics-route-test-key",
        )

        class ConnectionProxy:
            def cursor(self):
                return cursor

            def close(self):
                return None

        async def database_read(function, *args, **_kwargs):
            return function(*args)

        monkeypatch.setattr(analytics_routes, "run_database_read", database_read)
        monkeypatch.setattr(
            analytics_routes, "verify_session",
            lambda _request, required_role: (
                required_role == "super_admin", SimpleNamespace(user_id="super-1")
            ),
        )
        monkeypatch.setattr(
            analytics_routes, "database",
            SimpleNamespace(get_connection=lambda: ConnectionProxy()),
        )
        app = Starlette(routes=analytics_routes.product_analytics_routes(Route))
        with TestClient(app) as client:
            for view in sorted(VIEWS):
                response = client.get(
                    "/api/admin/product-analytics/dashboard",
                    params={"from": "2026-08-30", "to": "2026-08-30", "view": view},
                )
                assert response.status_code == 200, (view, response.text)
                dashboard = response.json()["dashboard"]
                assert dashboard["view"] == view
                assert dashboard["hasData"] is True
            overview = client.get(
                "/api/admin/product-analytics/dashboard",
                params={"from": "2026-08-30", "to": "2026-08-30", "view": "overview"},
            ).json()["dashboard"]
            assert len(overview["kpis"]) == 14
            assert len(overview["overviewCharts"]) == 6
            assert overview["comparisonPeriod"] == {
                "from": "2026-08-29", "to": "2026-08-29", "days": 1,
            }
    finally:
        _close_fixture_connection(connection, cursor, schema_name)
