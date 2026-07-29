from scripts import package_production


def test_extracted_smoke_environment_cannot_inherit_another_database(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://runtime/dev")
    monkeypatch.setenv("MIGRATOR_DATABASE_URL", "postgresql://migrator/dev")
    monkeypatch.setenv("DATABASE_ADMIN_URL", "postgresql://admin/dev")
    monkeypatch.setenv("API_TEST_DATABASE_URL", "postgresql://test/discovery")

    isolated = "postgresql://isolated/package_smoke_test"
    environment = package_production._isolated_smoke_environment(isolated)

    assert environment["DATABASE_URL"] == isolated
    assert environment["MIGRATOR_DATABASE_URL"] == isolated
    assert "DATABASE_ADMIN_URL" not in environment
    assert "API_TEST_DATABASE_URL" not in environment
