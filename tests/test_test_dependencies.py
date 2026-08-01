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

    install = "npx playwright install --with-deps chromium"
    quality_gate = "run: npm run check"
    assert install in workflow
    assert workflow.index(install) < workflow.index(quality_gate)


def test_performance_probe_authenticates_once_and_reuses_session_state():
    probe = (PROJECT_ROOT / "scripts" / "measure_startup.mjs").read_text(
        encoding="utf-8"
    )

    assert probe.count("await authenticate(") == 1
    assert "await authenticatedContext.storageState()" in probe
    assert "browser.newContext({" in probe
    assert "storageState: authenticatedState" in probe
