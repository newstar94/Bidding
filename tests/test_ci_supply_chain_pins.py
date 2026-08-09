import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = PROJECT_ROOT / ".github" / "workflows"
ACTION_REF = re.compile(r"^\s*(?:-\s*)?uses:\s*([^\s#]+)", re.MULTILINE)
SERVICE_IMAGE = re.compile(r"^\s*image:\s*([^\s#]+)", re.MULTILINE)
RUN_IMAGE = re.compile(
    r"^\s+(?P<image>(?:docker\.io|ghcr\.io)/[^\s]+)",
    re.MULTILINE,
)
PINNED_ACTION = re.compile(r"[^@]+@[0-9a-f]{40}")
PINNED_IMAGE = re.compile(r"[^@\s]+@sha256:[0-9a-f]{64}")


def _workflow_sources():
    return {
        path.name: path.read_text(encoding="utf-8")
        for path in sorted(WORKFLOW_DIR.glob("*.y*ml"))
    }


def test_every_external_action_uses_a_full_commit_sha():
    failures = []
    for workflow_name, source in _workflow_sources().items():
        for reference in ACTION_REF.findall(source):
            if reference.startswith("./"):
                continue
            if not PINNED_ACTION.fullmatch(reference):
                failures.append(f"{workflow_name}: {reference}")

    assert failures == []


def test_every_workflow_container_uses_an_immutable_digest():
    failures = []
    for workflow_name, source in _workflow_sources().items():
        references = SERVICE_IMAGE.findall(source)
        references.extend(match.group("image") for match in RUN_IMAGE.finditer(source))
        for reference in references:
            if not PINNED_IMAGE.fullmatch(reference):
                failures.append(f"{workflow_name}: {reference}")

    assert failures == []


def test_dependabot_proposes_reviewable_action_pin_updates():
    config = (PROJECT_ROOT / ".github" / "dependabot.yml").read_text(
        encoding="utf-8"
    )

    assert 'package-ecosystem: "github-actions"' in config
    assert 'directory: "/"' in config
    assert 'interval: "weekly"' in config
