"""Write the machine-verifiable aggregate record for a successful CI run."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


GATE_ENV = {
    "quality": "QUALITY_RESULT",
    "api": "API_RESULT",
    "supplyChain": "SUPPLY_CHAIN_RESULT",
    "packageSmoke": "PACKAGE_RESULT",
    "e2e": "E2E_RESULT",
}


def build_ci_evidence(environment: dict[str, str]) -> dict[str, object]:
    gates = {name: str(environment.get(variable, "")) for name, variable in GATE_ENV.items()}
    if any(result != "success" for result in gates.values()):
        raise ValueError("Every automated CI gate must be successful.")
    revision = str(environment.get("GITHUB_SHA", "")).lower()
    if len(revision) != 40 or any(character not in "0123456789abcdef" for character in revision):
        raise ValueError("GITHUB_SHA must be a full 40-character Git revision.")
    repository = str(environment.get("GITHUB_REPOSITORY", "")).strip()
    run_id = str(environment.get("GITHUB_RUN_ID", "")).strip()
    if not repository or not run_id.isdigit():
        raise ValueError("GitHub repository and numeric run ID are required.")
    return {
        "format": "biddingflow-ci-evidence",
        "version": 1,
        "workflow": "Production CI",
        "repository": repository,
        "runId": run_id,
        "sourceRevision": revision,
        "conclusion": "success",
        "automatedGates": gates,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        evidence = build_ci_evidence(dict(os.environ))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    except (OSError, ValueError) as exc:
        print(str(exc))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
