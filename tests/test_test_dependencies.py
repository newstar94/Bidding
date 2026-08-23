import json
import re
import tomllib
from pathlib import Path

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _ci_workflow():
    return yaml.safe_load(
        (PROJECT_ROOT / ".github" / "workflows" / "ci.yml").read_text(
            encoding="utf-8"
        )
    )


def _job_runs(workflow, job_name):
    return "\n".join(
        str(step.get("run") or "")
        for step in workflow["jobs"][job_name].get("steps", [])
    )


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


def test_full_ci_runs_independent_gates_and_installs_required_browsers():
    workflow = _ci_workflow()
    jobs = workflow["jobs"]

    assert set(jobs) == {
        "quality",
        "unit-python",
        "unit-js",
        "build",
        "database",
        "e2e",
        "performance",
        "package",
        "release",
    }
    assert jobs["e2e"]["needs"] == "build"
    assert jobs["performance"]["needs"] == "build"
    assert jobs["package"]["needs"] == ["build", "database"]
    assert set(jobs["release"]["needs"]) == set(jobs) - {"release"}

    e2e_runs = _job_runs(workflow, "e2e")
    unit_js_runs = _job_runs(workflow, "unit-js")
    performance_runs = _job_runs(workflow, "performance")
    package_runs = _job_runs(workflow, "package")
    assert "npx playwright install --with-deps chromium firefox webkit" in e2e_runs
    assert "npx playwright install --with-deps chromium" in unit_js_runs
    assert "npx playwright install --with-deps chromium" in performance_runs
    for gate, runs in (
        ("npm run test:e2e:smoke", e2e_runs),
        ("npm run test:performance", performance_runs),
        ("python scripts/package_production.py --check", package_runs),
        ("npm run sbom", package_runs),
        ("npm run audit:dependencies", package_runs),
        ("python scripts/audit_fk_indexes.py", _job_runs(workflow, "database")),
    ):
        assert gate in runs


def test_secure_build_artifact_keeps_hidden_manifest_and_is_verified_after_restore():
    workflow = _ci_workflow()
    build_steps = workflow["jobs"]["build"]["steps"]
    upload = next(
        step
        for step in build_steps
        if step.get("name") == "Upload secure build for dependent gates"
    )

    assert upload["with"]["path"] == "dist/"
    assert upload["with"]["include-hidden-files"] is True
    assert upload["with"]["if-no-files-found"] == "error"

    for job_name in ("e2e", "performance", "package"):
        steps = workflow["jobs"][job_name]["steps"]
        restore_index = next(
            index
            for index, step in enumerate(steps)
            if step.get("name") == "Restore verified secure build"
        )
        verification_index = next(
            index
            for index, step in enumerate(steps)
            if step.get("name") == "Verify restored secure build artifact"
        )
        assert verification_index > restore_index
        assert "python scripts/verify_secure_build_artifact.py" in str(
            steps[verification_index].get("run") or ""
        )


def test_canonical_playwright_matrix_has_three_required_non_skipped_projects():
    workflow = _ci_workflow()
    config = (PROJECT_ROOT / "playwright.config.mjs").read_text(encoding="utf-8")
    smoke = PROJECT_ROOT / "e2e" / "specs" / "browser-matrix.spec.mjs"
    discovery = (
        PROJECT_ROOT / "scripts" / "check_playwright_discovery.mjs"
    ).read_text(encoding="utf-8")

    assert "npm run test:e2e:smoke" in _job_runs(workflow, "e2e")
    assert "npm run check:e2e-discovery" in _job_runs(workflow, "e2e")
    assert workflow["jobs"]["e2e"]["env"]["VNEPS_VIOLATION_FIXTURE_PATH"] == (
        "tests/fixtures/vneps_contractor_violations.json"
    )
    for browser in ("chromium", "firefox", "webkit"):
        assert f'name: "{browser}"' in config
    assert "testIgnore" not in config
    assert "contractor-violation.spec.mjs" in discovery
    assert "procurement-plan-import.spec.mjs" in discovery
    assert smoke.is_file()
    assert "test.skip" not in smoke.read_text(encoding="utf-8")


def test_ci_enforces_reviewed_python_and_javascript_coverage_gates():
    package_text = (PROJECT_ROOT / "package.json").read_text(encoding="utf-8")
    package = json.loads(package_text)
    workflow = _ci_workflow()

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
    assert "npm run check:ci" not in str(workflow)
    python_runs = _job_runs(workflow, "unit-python")
    js_runs = _job_runs(workflow, "unit-js")
    assert "python -m pytest -q" in python_runs
    assert "--cov-fail-under=45" in python_runs
    assert "python scripts/check_critical_coverage.py coverage.json" in python_runs
    assert "--junitxml=pytest-junit.xml" in str(workflow["jobs"]["unit-python"])
    assert "--cov-report=xml:coverage.xml" in str(workflow["jobs"]["unit-python"])
    js_coverage_step = next(
        step
        for step in workflow["jobs"]["unit-js"]["steps"]
        if step.get("name") == "JavaScript coverage and critical-module ratchet"
    )
    assert js_coverage_step["env"]["JS_JUNIT_PATH"] == "javascript-junit.xml"
    assert "npm run test:js:coverage" in js_runs


def test_full_ci_decomposes_canonical_check_without_duplicating_its_gates():
    workflow = _ci_workflow()

    assert _job_runs(workflow, "quality").count("npm run check:static") == 1
    assert _job_runs(workflow, "build").count("npm run build:secure") == 1
    assert _job_runs(workflow, "unit-python").count("python -m pytest -q") == 1
    assert _job_runs(workflow, "unit-js").count("npm run test:js:coverage") == 1
    assert "npm run package:production:from-build" in _job_runs(workflow, "package")


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
    workflow = _ci_workflow()
    workflow_source = (PROJECT_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )

    configured_databases = re.findall(
        r"^\s+(?:DATABASE_URL|TEST_DATABASE_URL|API_TEST_DATABASE_URL):\s+"
        r"postgresql://[^/]+/([^?\s]+)",
        workflow_source,
        flags=re.MULTILINE,
    )
    assert len(configured_databases) == 3
    assert len(set(configured_databases)) == 3
    for job_name in ("unit-python", "database", "e2e", "performance", "package"):
        job = workflow["jobs"][job_name]
        assert "postgres" in job["services"]
        runs = _job_runs(workflow, job_name)
        assert "createdb --host 127.0.0.1" in runs
        assert runs.count("python scripts/manage_database.py") == 3


def test_performance_probe_authenticates_once_and_reuses_session_state():
    probe = (PROJECT_ROOT / "scripts" / "measure_startup.mjs").read_text(
        encoding="utf-8"
    )

    assert probe.count("await authenticate(") == 1
    assert "await authenticatedContext.storageState()" in probe
    assert "browser.newContext({" in probe
    assert "storageState: authenticatedState" in probe
