"""Generate reproducible CycloneDX inventories for production dependencies."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIRECTORY = PROJECT_ROOT / "release"


def _run_json(command: list[str]) -> dict[str, object]:
    result = subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    document = json.loads(result.stdout)
    if document.get("bomFormat") != "CycloneDX":
        raise RuntimeError(f"Unexpected SBOM output from {command[0]}")
    return document


def _write_reproducible(document: dict[str, object], output: Path) -> None:
    metadata = document.get("metadata")
    if isinstance(metadata, dict):
        metadata.pop("timestamp", None)
    document.pop("serialNumber", None)
    output.write_text(
        json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    npm = shutil.which("npm")
    cyclonedx = shutil.which("cyclonedx-py")
    if npm is None or cyclonedx is None:
        raise RuntimeError("npm and cyclonedx-py must be installed to generate SBOMs")
    npm_document = _run_json(
        [
            npm,
            "sbom",
            "--omit=dev",
            "--package-lock-only",
            "--sbom-format=cyclonedx",
            "--sbom-type=application",
        ]
    )
    _write_reproducible(npm_document, OUTPUT_DIRECTORY / "npm-sbom.cdx.json")

    subprocess.run(
        [
            cyclonedx,
            "requirements",
            "requirements.txt",
            "--pyproject",
            "pyproject.toml",
            "--output-reproducible",
            "--of",
            "JSON",
            "-o",
            str(OUTPUT_DIRECTORY / "python-sbom.cdx.json"),
        ],
        cwd=PROJECT_ROOT,
        check=True,
    )
    print("Generated production CycloneDX SBOMs in release/.")


if __name__ == "__main__":
    main()
