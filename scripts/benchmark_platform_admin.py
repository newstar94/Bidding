"""Deterministic PostgreSQL large-data evidence for Platform Admin list reads.

The benchmark creates transaction-local temporary tables, exercises the real
production list handlers, and always rolls the transaction back. It never
writes synthetic rows to application tables.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import psycopg

from backend.admin import platform_billing_routes, platform_directory_routes, security_routes
from backend.db.db_helper import PostgresCursor, compat_row_factory


USER_COUNT = 10_000
ORGANIZATION_COUNT = 1_000
AUDIT_COUNT = 50_000
INVOICE_REQUEST_COUNT = 25_000
PAGE_SIZE = 100
MAX_RESPONSE_BYTES = 256_000
QUERY_BUDGETS = {"users": 3, "organizations": 3, "audit": 2, "invoices": 2}


def _test_database_url() -> str:
    value = os.environ.get("TEST_DATABASE_URL", "").strip()
    if value:
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            key, separator, candidate = line.partition("=")
            if separator and key.strip() == "TEST_DATABASE_URL":
                return candidate.strip().strip('"').strip("'")
    raise RuntimeError(
        "TEST_DATABASE_URL is required; the benchmark will not fall back to DATABASE_URL."
    )


class _CountingCursor:
    def __init__(self, raw_cursor):
        self._cursor = PostgresCursor(raw_cursor)
        self.query_count = 0

    def execute(self, statement, parameters=()):
        self.query_count += 1
        self._cursor.execute(statement, parameters)
        return self

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()


class _BorrowedConnection:
    def __init__(self, raw_connection):
        self._raw_connection = raw_connection
        self.cursors: list[_CountingCursor] = []

    def cursor(self):
        cursor = _CountingCursor(self._raw_connection.cursor())
        self.cursors.append(cursor)
        return cursor

    def close(self):
        # The route borrows the benchmark transaction. The benchmark owns the
        # real connection and rolls it back in its outermost finally block.
        return None


class _BorrowedDatabase:
    def __init__(self, raw_connection):
        self.connection = _BorrowedConnection(raw_connection)

    def get_connection(self):
        return self.connection

    def take_query_count(self):
        total = sum(cursor.query_count for cursor in self.connection.cursors)
        self.connection.cursors.clear()
        return total


def _create_fixture(connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout = '60s'")
        cursor.execute(
            """
            CREATE TEMP TABLE tai_khoan (
                id TEXT PRIMARY KEY, ten_dang_nhap TEXT, ho_ten TEXT,
                vai_tro TEXT NOT NULL, email TEXT NOT NULL, anh_dai_dien TEXT,
                trang_thai TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            ) ON COMMIT DROP;
            CREATE TEMP TABLE to_chuc (
                id TEXT PRIMARY KEY, ten_to_chuc TEXT NOT NULL,
                trang_thai TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            ) ON COMMIT DROP;
            CREATE TEMP TABLE thanh_vien_to_chuc (
                user_id TEXT NOT NULL, organization_id TEXT NOT NULL,
                vai_tro_trong_to_chuc TEXT NOT NULL, ten_nhan_su TEXT,
                so_dien_thoai TEXT, trang_thai_thanh_vien TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
            ) ON COMMIT DROP;
            CREATE TEMP TABLE account_subscriptions (
                user_id TEXT PRIMARY KEY, package_id TEXT, plan_version_id TEXT,
                status TEXT, starts_at BIGINT, expires_at BIGINT
            ) ON COMMIT DROP;
            CREATE TEMP TABLE organization_subscriptions (
                organization_id TEXT PRIMARY KEY, package_id TEXT,
                status TEXT, starts_at BIGINT, expires_at BIGINT,
                member_quota INTEGER, revision BIGINT
            ) ON COMMIT DROP;
            CREATE TEMP TABLE auth_sessions (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, last_seen_at BIGINT
            ) ON COMMIT DROP;
            CREATE TEMP TABLE product_usage_hourly (
                organization_id TEXT NOT NULL, last_seen_at BIGINT
            ) ON COMMIT DROP;
            CREATE TEMP TABLE audit_log (
                id BIGINT PRIMARY KEY, chain_id TEXT NOT NULL, sequence BIGINT NOT NULL,
                actor_user_id TEXT, organization_id TEXT, action TEXT NOT NULL,
                target_type TEXT, target_id TEXT, created_at TIMESTAMPTZ NOT NULL,
                metadata_json TEXT
            ) ON COMMIT DROP;
            CREATE TEMP TABLE payment_provider_profiles (
                id TEXT PRIMARY KEY, provider TEXT NOT NULL,
                environment TEXT NOT NULL
            ) ON COMMIT DROP;
            CREATE TEMP TABLE billing_orders (
                id TEXT PRIMARY KEY, public_id TEXT NOT NULL,
                account_user_id TEXT, organization_id TEXT,
                owner_kind TEXT NOT NULL, total_amount BIGINT NOT NULL,
                currency TEXT NOT NULL, provider_profile_id TEXT
            ) ON COMMIT DROP;
            CREATE TEMP TABLE payment_transactions (
                id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
                provider_transaction_id TEXT NOT NULL, status TEXT NOT NULL,
                verified_paid_amount BIGINT NOT NULL,
                provider_occurred_at BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            ) ON COMMIT DROP;
            CREATE TEMP TABLE billing_invoice_requests (
                id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
                payment_transaction_id TEXT NOT NULL, status TEXT NOT NULL,
                provider_reference TEXT, attempt_count INTEGER NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            ) ON COMMIT DROP
            """
        )
        cursor.execute(
            """
            INSERT INTO to_chuc
            SELECT 'bench-org-' || n, 'Benchmark Organization ' || lpad(n::text, 4, '0'),
                   'active', TIMESTAMPTZ '2026-01-01 00:00:00+00' + n * INTERVAL '1 second',
                   TIMESTAMPTZ '2026-01-01 00:00:00+00'
              FROM generate_series(1, %s) AS n
            """,
            (ORGANIZATION_COUNT,),
        )
        cursor.execute(
            """
            INSERT INTO tai_khoan
            SELECT 'bench-user-' || n, 'bench' || n,
                   'Benchmark User ' || lpad(n::text, 5, '0'), 'user',
                   'bench' || n || '@example.test', NULL, 'active',
                   TIMESTAMPTZ '2026-01-01 00:00:00+00' + n * INTERVAL '1 second',
                   TIMESTAMPTZ '2026-01-01 00:00:00+00'
              FROM generate_series(1, %s) AS n
            """,
            (USER_COUNT,),
        )
        cursor.execute(
            """
            INSERT INTO thanh_vien_to_chuc
            SELECT 'bench-user-' || n, 'bench-org-' || (((n - 1) %% %s) + 1),
                   CASE WHEN n <= %s THEN 'owner' ELSE 'employee' END,
                   'Benchmark User ' || lpad(n::text, 5, '0'), NULL, 'active',
                   TIMESTAMPTZ '2026-01-01 00:00:00+00',
                   TIMESTAMPTZ '2026-01-01 00:00:00+00'
              FROM generate_series(1, %s) AS n
            """,
            (ORGANIZATION_COUNT, ORGANIZATION_COUNT, USER_COUNT),
        )
        cursor.execute(
            """
            INSERT INTO auth_sessions
            SELECT 'bench-session-' || n, 'bench-user-' || n, 1800000000 + n
              FROM generate_series(1, %s) AS n
            """,
            (USER_COUNT,),
        )
        cursor.execute(
            """
            INSERT INTO product_usage_hourly
            SELECT 'bench-org-' || n, 1800000000 + n
              FROM generate_series(1, %s) AS n
            """,
            (ORGANIZATION_COUNT,),
        )
        cursor.execute(
            """
            INSERT INTO audit_log
            SELECT n, 'benchmark', n, 'bench-user-' || (((n - 1) %% %s) + 1),
                   'bench-org-' || (((n - 1) %% %s) + 1), 'admin.benchmark.success',
                   'benchmark', n::text,
                   TIMESTAMPTZ '2026-01-01 00:00:00+00' + n * INTERVAL '1 second',
                   '{"requestId": "benchmark"}'
              FROM generate_series(1, %s) AS n
            """,
            (USER_COUNT, ORGANIZATION_COUNT, AUDIT_COUNT),
        )
        cursor.execute(
            "INSERT INTO payment_provider_profiles VALUES ('bench-provider', 'payos', 'test')"
        )
        cursor.execute(
            """
            INSERT INTO billing_orders
            SELECT 'bench-order-' || n, 'BENCH-' || lpad(n::text, 8, '0'),
                   CASE WHEN n %% 2 = 1
                        THEN 'bench-user-' || (((n - 1) %% %s) + 1) END,
                   CASE WHEN n %% 2 = 0
                        THEN 'bench-org-' || (((n - 1) %% %s) + 1) END,
                   CASE WHEN n %% 2 = 1 THEN 'account' ELSE 'organization' END,
                   100000 + n, 'VND', 'bench-provider'
              FROM generate_series(1, %s) AS n
            """,
            (USER_COUNT, ORGANIZATION_COUNT, INVOICE_REQUEST_COUNT),
        )
        cursor.execute(
            """
            INSERT INTO payment_transactions
            SELECT 'bench-transaction-' || n, 'bench-order-' || n,
                   'bench-provider-transaction-' || n, 'settled', 100000 + n,
                   1800000000 + n,
                   TIMESTAMPTZ '2026-02-01 00:00:00+00' + n * INTERVAL '1 second'
              FROM generate_series(1, %s) AS n
            """,
            (INVOICE_REQUEST_COUNT,),
        )
        cursor.execute(
            """
            INSERT INTO billing_invoice_requests
            SELECT 'bench-invoice-request-' || n, 'bench-order-' || n,
                   'bench-transaction-' || n,
                   CASE n %% 3 WHEN 0 THEN 'requested'
                               WHEN 1 THEN 'issued' ELSE 'failed' END,
                   CASE WHEN n %% 5 = 0 THEN NULL ELSE 'bench-invoice-ref-' || n END,
                   n %% 4,
                   TIMESTAMPTZ '2026-02-01 00:00:00+00' + n * INTERVAL '1 second',
                   TIMESTAMPTZ '2026-02-02 00:00:00+00' + n * INTERVAL '1 second'
              FROM generate_series(1, %s) AS n
            """,
            (INVOICE_REQUEST_COUNT,),
        )
        cursor.execute(
            """
            CREATE INDEX ON thanh_vien_to_chuc (user_id, organization_id);
            CREATE INDEX ON thanh_vien_to_chuc (organization_id, user_id);
            CREATE INDEX ON auth_sessions (user_id, last_seen_at DESC);
            CREATE INDEX ON product_usage_hourly (organization_id, last_seen_at DESC);
            CREATE INDEX ON audit_log (created_at DESC, id DESC);
            CREATE INDEX ON billing_invoice_requests (created_at DESC, id);
            CREATE INDEX ON billing_invoice_requests (order_id, payment_transaction_id);
            CREATE INDEX ON payment_transactions (order_id, id);
            ANALYZE tai_khoan; ANALYZE to_chuc; ANALYZE thanh_vien_to_chuc;
            ANALYZE auth_sessions; ANALYZE product_usage_hourly; ANALYZE audit_log;
            ANALYZE billing_orders; ANALYZE payment_transactions;
            ANALYZE billing_invoice_requests
            """
        )
        counts = cursor.execute(
            """SELECT (SELECT COUNT(*) FROM tai_khoan) AS users,
                      (SELECT COUNT(*) FROM to_chuc) AS organizations,
                      (SELECT COUNT(*) FROM audit_log) AS audit,
                      (SELECT COUNT(*) FROM billing_invoice_requests) AS invoices"""
        ).fetchone()
    assert (
        counts["users"], counts["organizations"], counts["audit"], counts["invoices"]
    ) == (USER_COUNT, ORGANIZATION_COUNT, AUDIT_COUNT, INVOICE_REQUEST_COUNT)


def _request():
    return SimpleNamespace(query_params={"page": "1", "pageSize": str(PAGE_SIZE)})


def _measure(name, operation, database, repetitions):
    samples = []
    query_counts = []
    response_bytes = []
    totals = []
    for iteration in range(repetitions + 1):
        started = time.perf_counter()
        response = operation(_request())
        elapsed_ms = (time.perf_counter() - started) * 1_000
        queries = database.take_query_count()
        payload = json.loads(response.body)
        assert response.status_code == 200, payload
        assert len(payload["items"]) == PAGE_SIZE
        assert payload["pagination"]["pageSize"] == PAGE_SIZE
        assert len(response.body) <= MAX_RESPONSE_BYTES
        assert queries == QUERY_BUDGETS[name]
        if iteration > 0:  # first execution is an explicit warm-up
            samples.append(elapsed_ms)
            query_counts.append(queries)
            response_bytes.append(len(response.body))
            totals.append(payload["pagination"]["totalRows"])
    return {
        "rows": totals[0],
        "items": PAGE_SIZE,
        "queries": query_counts[0],
        "responseBytesMax": max(response_bytes),
        "medianMs": round(statistics.median(samples), 2),
        "maxMs": round(max(samples), 2),
    }


def run(repetitions: int = 5) -> dict:
    connection = psycopg.connect(_test_database_url(), row_factory=compat_row_factory)
    original_directory_database = platform_directory_routes.database
    original_billing_database = platform_billing_routes.database
    original_security_database = security_routes.database
    original_directory_auth = platform_directory_routes._forbidden_or_role
    original_billing_auth = platform_billing_routes._forbidden_or_role
    original_security_auth = security_routes._forbidden_or_role
    try:
        _create_fixture(connection)
        database = _BorrowedDatabase(connection)
        allow = lambda _request: (None, "super_admin")
        platform_directory_routes.database = database
        platform_billing_routes.database = database
        security_routes.database = database
        platform_directory_routes._forbidden_or_role = allow
        platform_billing_routes._forbidden_or_role = allow
        security_routes._forbidden_or_role = allow
        results = {
            "users": _measure(
                "users", platform_directory_routes._list_admin_users_sync,
                database, repetitions,
            ),
            "organizations": _measure(
                "organizations", platform_directory_routes._list_admin_organizations_sync,
                database, repetitions,
            ),
            "audit": _measure(
                "audit", security_routes._list_admin_audit_sync,
                database, repetitions,
            ),
            "invoices": _measure(
                "invoices", platform_billing_routes._list_admin_invoice_requests_sync,
                database, repetitions,
            ),
        }
        return {
            "status": "PASS",
            "fixture": {
                "users": USER_COUNT,
                "organizations": ORGANIZATION_COUNT,
                "auditRows": AUDIT_COUNT,
                "invoiceRequests": INVOICE_REQUEST_COUNT,
                "isolation": "temporary tables in one rolled-back transaction",
            },
            "budgets": {
                "pageSize": PAGE_SIZE,
                "maxResponseBytes": MAX_RESPONSE_BYTES,
                "queryCounts": QUERY_BUDGETS,
            },
            "results": results,
        }
    finally:
        platform_directory_routes.database = original_directory_database
        platform_billing_routes.database = original_billing_database
        security_routes.database = original_security_database
        platform_directory_routes._forbidden_or_role = original_directory_auth
        platform_billing_routes._forbidden_or_role = original_billing_auth
        security_routes._forbidden_or_role = original_security_auth
        connection.rollback()
        connection.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repetitions", type=int, default=5)
    args = parser.parse_args(argv)
    if args.repetitions < 1 or args.repetitions > 20:
        parser.error("--repetitions must be between 1 and 20")
    try:
        report = run(args.repetitions)
    except Exception as exc:  # noqa: BLE001 - command boundary prints safe type/message only.
        print(json.dumps({"status": "FAIL", "error": f"{type(exc).__name__}: {exc}"}))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
