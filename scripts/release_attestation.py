"""Validate production gates plus immutable CI evidence for one source revision."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


GATES = {
    "p0SecurityRegression": "RELEASE_P0_SECURITY_GATE",
    "capacity": "RELEASE_CAPACITY_GATE",
    "externalAuthentication": "RELEASE_EXTERNAL_AUTH_GATE",
    "reverseProxyLimits": "RELEASE_PROXY_LIMITS_GATE",
    "backupRestoreDrill": "RELEASE_BACKUP_RESTORE_GATE",
    "migrationRehearsal": "RELEASE_MIGRATION_REHEARSAL_GATE",
    "databaseAcceptance": "RELEASE_DATABASE_GATE",
}
DATABASE_MODES = {"sqlite-single-instance", "postgresql"}
SOURCE_REVISION = re.compile(r"[0-9a-fA-F]{40,64}")
AUTOMATED_GATES = {"quality", "api", "supplyChain", "packageSmoke", "e2e"}


class ReleaseAttestationError(RuntimeError):
    """Raised when release evidence is missing or a gate did not pass."""


def _required(environment: dict[str, str], name: str) -> str:
    value = str(environment.get(name, "")).strip()
    if not value:
        raise ReleaseAttestationError(f"{name} is required.")
    if any(character in value for character in ("\r", "\n", "\x00")):
        raise ReleaseAttestationError(f"{name} contains an unsafe control character.")
    return value


def _load_ci_evidence(path: Path, environment: dict[str, str]) -> tuple[dict, str]:
    try:
        raw = path.read_bytes()
        evidence = json.loads(raw)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReleaseAttestationError("CI evidence is missing or is not valid JSON.") from exc
    if not isinstance(evidence, dict):
        raise ReleaseAttestationError("CI evidence must be a JSON object.")
    if evidence.get("format") != "biddingflow-ci-evidence" or evidence.get("version") != 1:
        raise ReleaseAttestationError("CI evidence format/version is not supported.")

    source_revision = _required(environment, "RELEASE_SOURCE_REVISION").lower()
    if not SOURCE_REVISION.fullmatch(source_revision):
        raise ReleaseAttestationError("RELEASE_SOURCE_REVISION must be a full Git revision.")
    if str(evidence.get("sourceRevision", "")).lower() != source_revision:
        raise ReleaseAttestationError("CI evidence source revision does not match the release.")

    repository = _required(environment, "RELEASE_REPOSITORY")
    if evidence.get("repository") != repository:
        raise ReleaseAttestationError("CI evidence repository does not match the release repository.")
    run_id = _required(environment, "RELEASE_CI_RUN_ID")
    if str(evidence.get("runId", "")) != run_id or not run_id.isdigit():
        raise ReleaseAttestationError("CI evidence run ID does not match the selected CI run.")
    if evidence.get("workflow") != "Production CI" or evidence.get("conclusion") != "success":
        raise ReleaseAttestationError("CI evidence is not from a successful Production CI workflow.")
    automated = evidence.get("automatedGates")
    if not isinstance(automated, dict) or set(automated) != AUTOMATED_GATES:
        raise ReleaseAttestationError("CI evidence does not contain the exact automated gate set.")
    if any(value != "success" for value in automated.values()):
        raise ReleaseAttestationError("A CI automated gate did not succeed.")
    return evidence, hashlib.sha256(raw).hexdigest()


def build_attestation(
    environment: dict[str, str], *, ci_evidence_path: Path
) -> dict[str, object]:
    gates = {}
    failed = []
    for label, variable in GATES.items():
        result = _required(environment, variable).casefold()
        if result not in {"passed", "failed"}:
            raise ReleaseAttestationError(f"{variable} must be 'passed' or 'failed'.")
        gates[label] = result
        if result != "passed":
            failed.append(label)
    if failed:
        raise ReleaseAttestationError(
            "Production release is blocked by gate(s): " + ", ".join(sorted(failed))
        )

    database_mode = _required(environment, "RELEASE_DATABASE_MODE")
    if database_mode not in DATABASE_MODES:
        raise ReleaseAttestationError(
            "RELEASE_DATABASE_MODE must be sqlite-single-instance or postgresql."
        )

    source_revision = _required(environment, "RELEASE_SOURCE_REVISION").lower()
    if not SOURCE_REVISION.fullmatch(source_revision):
        raise ReleaseAttestationError("RELEASE_SOURCE_REVISION must be a full Git revision.")
    _evidence, evidence_sha256 = _load_ci_evidence(ci_evidence_path, environment)
    repository = _required(environment, "RELEASE_REPOSITORY")
    run_id = _required(environment, "RELEASE_CI_RUN_ID")

    return {
        "format": "biddingflow-release-attestation",
        "version": 2,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceRevision": source_revision,
        "databaseMode": database_mode,
        "gates": gates,
        "evidence": {
            "reference": f"https://github.com/{repository}/actions/runs/{run_id}",
            "runId": run_id,
            "sha256": evidence_sha256,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ci-evidence", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        attestation = build_attestation(
            dict(os.environ), ci_evidence_path=args.ci_evidence
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(attestation, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except (OSError, ReleaseAttestationError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"Release attestation written: {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
