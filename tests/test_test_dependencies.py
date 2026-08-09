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
        "- name: Python compile",
        "- name: Python lint and quality",
        "- name: ESLint and Trusted Types",
        "- name: Frontend debt gate",
        "- name: Python tests and coverage",
        "- name: JavaScript tests",
        "- name: Cross-browser Playwright matrix",
        "- name: Secure build",
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
    package = (PROJECT_ROOT / "package.json").read_text(encoding="utf-8")
    workflow = (PROJECT_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )

    assert package.count("--cov-fail-under=45") == 1
    assert "--cov-fail-under=45" in workflow
    assert '"test:js:coverage": "node scripts/run_js_coverage.mjs"' in package
    assert "JS_JUNIT_PATH: javascript-junit.xml" in workflow
    assert "npm run test:js:coverage" in workflow


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
