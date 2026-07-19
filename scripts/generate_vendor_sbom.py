"""Generate a CycloneDX SBOM for pinned vendored browser assets."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "views" / "vendor" / "vendor-manifest.json"


def build_sbom() -> dict:
    source = json.loads(MANIFEST.read_text(encoding="utf-8"))
    components = []
    for asset in source["assets"]:
        hashes = [
            {"alg": "SHA-256", "content": digest}
            for digest in sorted(asset["files"].values())
        ]
        component = {
            "type": "library",
            "name": asset["name"],
            "version": asset["version"],
            "hashes": hashes,
            "externalReferences": [
                {"type": "distribution", "url": asset["source"]}
            ],
        }
        if asset.get("license"):
            component["licenses"] = [
                {"license": {"id": asset["license"]}}
            ]
        components.append(component)
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": "urn:uuid:00000000-0000-4000-8000-000000000001",
        "version": 1,
        "metadata": {
            "timestamp": datetime.now(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
            "component": {
                "type": "application",
                "name": "biddingflow-vendored-browser-assets",
                "version": "1.0.0",
            },
        },
        "components": components,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="release/evidence/vendor-sbom.cdx.json",
    )
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    output.relative_to(ROOT)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(build_sbom(), ensure_ascii=False, indent=2, sort_keys=True)
        + "\n",
        encoding="utf-8",
    )
    print(f"Vendor SBOM written to {output.relative_to(ROOT).as_posix()}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
