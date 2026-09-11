import pytest

from scripts import benchmark_platform_admin


def test_platform_admin_benchmark_requires_dedicated_test_database(monkeypatch, tmp_path):
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    monkeypatch.setattr(benchmark_platform_admin, "__file__", str(tmp_path / "scripts" / "benchmark.py"))

    with pytest.raises(RuntimeError, match="will not fall back to DATABASE_URL"):
        benchmark_platform_admin._test_database_url()


def test_platform_admin_large_data_budgets_are_explicit_and_bounded():
    assert benchmark_platform_admin.USER_COUNT == 10_000
    assert benchmark_platform_admin.ORGANIZATION_COUNT == 1_000
    assert benchmark_platform_admin.AUDIT_COUNT >= 50_000
    assert benchmark_platform_admin.INVOICE_REQUEST_COUNT >= 25_000
    assert benchmark_platform_admin.PAGE_SIZE == 100
    assert benchmark_platform_admin.MAX_RESPONSE_BYTES == 256_000
    assert benchmark_platform_admin.QUERY_BUDGETS == {
        "users": 3,
        "organizations": 3,
        "audit": 2,
        "invoices": 2,
    }


def test_platform_admin_large_data_contract_on_postgresql():
    try:
        benchmark_platform_admin._test_database_url()
    except RuntimeError:
        pytest.skip("TEST_DATABASE_URL is not configured")

    report = benchmark_platform_admin.run(repetitions=1)

    assert report["status"] == "PASS"
    assert report["fixture"] == {
        "users": 10_000,
        "organizations": 1_000,
        "auditRows": 50_000,
        "invoiceRequests": 25_000,
        "isolation": "temporary tables in one rolled-back transaction",
    }
    assert {
        name: result["queries"] for name, result in report["results"].items()
    } == benchmark_platform_admin.QUERY_BUDGETS
    assert all(
        result["items"] == benchmark_platform_admin.PAGE_SIZE
        and result["responseBytesMax"] <= benchmark_platform_admin.MAX_RESPONSE_BYTES
        for result in report["results"].values()
    )
