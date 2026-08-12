import json
import re
import tomllib
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_starlette_test_client_dependency_is_explicitly_pinned():
    project = tomllib.loads((PROJECT_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    test_dependencies = project["project"]["optional-dependencies"]["test"]

    assert any(
        re.fullmatch(r"httpx2==\d+\.\d+\.\d+", dependency)
        for dependency in test_dependencies
    )
    assert not any(
        re.match(r"httpx(?:==|$)", dependency) for dependency in test_dependencies
    )


def test_full_ci_installs_chromium_before_running_browser_tests():
    workflow = (PROJECT_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )

    install = "npx playwright install --with-deps chromium firefox webkit"
    assert install in workflow
    required_gates = (
        "- name: Canonical quality and secure build",
        "- name: Cross-browser Playwright matrix",
        "- name: FK and index audit",
        "- name: Production package validation",
        "- name: SBOM",
        "- name: Full role and workflow E2E",
        "- name: Dependency audit",
    )
    for gate in required_gates:
        assert gate in workflow
        assert workflow.index(install) < workflow.index(gate)


def test_canonical_playwright_matrix_has_three_required_non_skipped_projects():
    workflow = (PROJECT_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )
    config = (PROJECT_ROOT / "playwright.config.mjs").read_text(encoding="utf-8")
    smoke = PROJECT_ROOT / "e2e" / "specs" / "browser-matrix.spec.mjs"

    assert "npm run test:e2e:smoke" in workflow
    for browser in ("chromium", "firefox", "webkit"):
        assert f'name: "{browser}"' in config
    assert "contractorViolationReady" in config
    assert smoke.is_file()
    assert "test.skip" not in smoke.read_text(encoding="utf-8")


def test_ci_enforces_reviewed_python_and_javascript_coverage_gates():
    package_text = (PROJECT_ROOT / "package.json").read_text(encoding="utf-8")
    package = json.loads(package_text)
    workflow = (PROJECT_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )

    assert package_text.count("--cov-fail-under=45") == 1
    assert package["scripts"]["check:ci"] == (
        "npm run check:static && npm test && npm run build:secure"
    )
    static_gate = package["scripts"]["check:static"]
    for required in (
        "check:schema-runtime",
        "generate_postgres_migration_fixture.py --check",
        "lint:python",
        "lint:encoding",
        "lint:modules",
        "lint:debt",
    ):
        assert required in static_gate
    assert package["scripts"]["test:js:coverage"] == "node scripts/run_js_coverage.mjs"
    assert workflow.count("npm run check:ci") == 1
    assert "PYTEST_ADDOPTS:" in workflow
    assert "--junitxml=pytest-junit.xml" in workflow
    assert "--cov-report=xml:coverage.xml" in workflow
    assert "JS_JUNIT_PATH: javascript-junit.xml" in workflow
    assert "npm run test:js:coverage" not in workflow


def test_full_ci_does_not_duplicate_canonical_quality_or_build_commands():
    workflow = (PROJECT_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )

    for duplicated_command in (
        "python -m compileall -q backend scripts tests",
        "npm run lint:python",
        "npm run lint:security",
        "npm run lint:debt",
        "npm run build:secure",
        "python -m pytest -q",
    ):
        assert duplicated_command not in workflow
    assert "npm run package:production:from-build" in workflow


def test_full_npm_lock_audit_is_enforced_in_ci_and_scheduled_security():
    package = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
    ci_workflow = (PROJECT_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )
    security_workflow = (
        PROJECT_ROOT / ".github" / "workflows" / "security.yml"
    ).read_text(encoding="utf-8")

    assert package["scripts"]["audit:npm"] == "npm audit && npm audit --omit=dev"
    assert "npm run audit:npm" in package["scripts"]["audit:dependencies"]
    assert "npm run audit:dependencies" in ci_workflow
    assert 'cron: "41 3 * * 1"' in security_workflow
    assert "npm run audit:npm" in security_workflow


def test_gitleaks_suppresses_only_the_reviewed_historical_recaptcha_finding():
    security_workflow = (
        PROJECT_ROOT / ".github" / "workflows" / "security.yml"
    ).read_text(encoding="utf-8")
    ignore_entries = (
        PROJECT_ROOT / ".gitleaksignore"
    ).read_text(encoding="utf-8").splitlines()
    fingerprint = (
        "b2ebe0b1753b372eb92b6a35559191063c6bde5d:"
        "backend/integrations/muasamcong_browser/session_provider.mjs:"
        "generic-api-key:5"
    )

    assert "--gitleaks-ignore-path=/repo/.gitleaksignore" in security_workflow
    assert fingerprint in ignore_entries


def test_python_ci_installs_hashed_locks_before_the_project_without_resolution():
    workflows = {
        "ci.yml": "requirements-test.txt",
        "n-plus-one-regressions.yml": "requirements-test.txt",
        "startup-performance.yml": "requirements.txt",
    }

    for workflow_name, lock_name in workflows.items():
        workflow = (
            PROJECT_ROOT / ".github" / "workflows" / workflow_name
        ).read_text(encoding="utf-8")
        lock_install = (
            "python -m pip install --disable-pip-version-check "
            f"--require-hashes -r {lock_name}"
        )
        project_install = (
            "python -m pip install --disable-pip-version-check "
            "--no-build-isolation --no-deps -e ."
        )

        assert lock_install in workflow
        assert project_install in workflow
        assert workflow.index(lock_install) < workflow.index(project_install)

    test_lock = (PROJECT_ROOT / "requirements-test.txt").read_text(encoding="utf-8")
    assert "--generate-hashes" in test_lock
    assert "--all-build-deps" in test_lock
    assert "--extra=test" in test_lock
    assert "pytest==9.1.1" in test_lock
    assert "setuptools==83.0.0" in test_lock

    runtime_lock = (PROJECT_ROOT / "requirements.txt").read_text(encoding="utf-8")
    pinned_requirement = re.compile(r"^([a-z0-9][a-z0-9._-]*==[^\\s;]+)", re.MULTILINE)
    assert set(pinned_requirement.findall(runtime_lock)) <= set(
        pinned_requirement.findall(test_lock)
    )


def test_full_ci_keeps_runtime_and_integration_databases_isolated():
    workflow = (PROJECT_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )

    configured_databases = re.findall(
        r"^\s+(?:DATABASE_URL|TEST_DATABASE_URL|API_TEST_DATABASE_URL):\s+"
        r"postgresql://[^/]+/([^?\s]+)",
        workflow,
        flags=re.MULTILINE,
    )
    assert len(configured_databases) == 3
    assert len(set(configured_databases)) == 3
    assert "createdb --host 127.0.0.1" in workflow
    assert workflow.count("python scripts/manage_database.py") == 3


def test_performance_probe_authenticates_once_and_reuses_session_state():
    probe = (PROJECT_ROOT / "scripts" / "measure_startup.mjs").read_text(
        encoding="utf-8"
    )

    assert probe.count("await authenticate(") == 1
    assert "await authenticatedContext.storageState()" in probe
    assert "browser.newContext({" in probe
    assert "storageState: authenticatedState" in probe
