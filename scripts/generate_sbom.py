"""Generate reproducible CycloneDX inventories for production dependencies."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIRECTORY = PROJECT_ROOT / "release"
VENDOR_ROOT = PROJECT_ROOT / "views" / "vendor"
VENDOR_MANIFEST_PATH = VENDOR_ROOT / "vendor-manifest.json"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.audit_vendor_assets import audit_vendor_assets


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


def _vendor_ref_segment(value: str) -> str:
    segment = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    if not segment:
        raise RuntimeError(f"Vendored component name is invalid: {value!r}")
    return segment


def _vendor_inventory() -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    audit_vendor_assets()
    manifest = json.loads(VENDOR_MANIFEST_PATH.read_text(encoding="utf-8"))
    assets = manifest.get("assets")
    if not isinstance(assets, list):
        raise RuntimeError("Vendored asset manifest has no component inventory.")

    components: list[dict[str, object]] = []
    dependencies: list[dict[str, object]] = []
    for asset in assets:
        if not isinstance(asset, dict):
            raise RuntimeError("Vendored asset component must be an object.")
        name = str(asset.get("name") or "").strip()
        version = str(asset.get("version") or "").strip()
        license_id = str(asset.get("license") or "").strip()
        source = str(asset.get("source") or "").strip()
        files = asset.get("files")
        if (
            not name
            or not version
            or not license_id
            or not source.startswith("https://")
            or not isinstance(files, dict)
            or not files
        ):
            raise RuntimeError(f"Vendored SBOM metadata is incomplete: {name!r}")

        parent_ref = f"vendor:{_vendor_ref_segment(name)}@{version}"
        licenses = [{"license": {"id": license_id}}]
        properties: list[dict[str, str]] = [
            {"name": "biddingflow:distribution", "value": "vendored"}
        ]
        for field, property_name in (
            ("securityMinimumVersion", "biddingflow:vendor:security-minimum"),
            ("updateSource", "biddingflow:vendor:update-source"),
        ):
            value = str(asset.get(field) or "").strip()
            if value:
                properties.append({"name": property_name, "value": value})
        local_patches = asset.get("localPatches")
        if isinstance(local_patches, list):
            properties.extend(
                {"name": "biddingflow:vendor:local-patch", "value": str(patch)}
                for patch in local_patches
                if str(patch).strip()
            )

        components.append(
            {
                "type": "library",
                "bom-ref": parent_ref,
                "name": name,
                "version": version,
                "scope": "required",
                "licenses": licenses,
                "externalReferences": [{"type": "distribution", "url": source}],
                "properties": properties,
            }
        )

        file_refs: list[str] = []
        for relative_name, expected_hash in sorted(files.items()):
            relative_name = str(relative_name)
            file_ref = f"{parent_ref}/file/{quote(relative_name, safe='')}"
            file_refs.append(file_ref)
            components.append(
                {
                    "type": "file",
                    "bom-ref": file_ref,
                    "name": f"{name}/{relative_name}",
                    "version": version,
                    "scope": "required",
                    "hashes": [
                        {
                            "alg": "SHA-256",
                            "content": str(expected_hash).casefold(),
                        }
                    ],
                    "licenses": licenses,
                    "externalReferences": [
                        {"type": "distribution", "url": source}
                    ],
                    "properties": [
                        {
                            "name": "biddingflow:vendor:path",
                            "value": f"views/vendor/{relative_name}",
                        }
                    ],
                }
            )
            dependencies.append({"ref": file_ref, "dependsOn": []})
        dependencies.append({"ref": parent_ref, "dependsOn": sorted(file_refs)})

    references = [str(component["bom-ref"]) for component in components]
    if len(references) != len(set(references)):
        raise RuntimeError("Vendored SBOM component references are not unique.")
    return (
        sorted(components, key=lambda component: str(component["bom-ref"])),
        sorted(dependencies, key=lambda dependency: str(dependency["ref"])),
    )


def _merge_vendor_inventory(document: dict[str, object]) -> None:
    components = document.get("components")
    dependencies = document.get("dependencies")
    metadata = document.get("metadata")
    root = metadata.get("component") if isinstance(metadata, dict) else None
    root_ref = root.get("bom-ref") if isinstance(root, dict) else None
    if (
        not isinstance(components, list)
        or not isinstance(dependencies, list)
        or not isinstance(root_ref, str)
        or not root_ref
    ):
        raise RuntimeError("npm CycloneDX document has no usable dependency graph.")

    vendor_components, vendor_dependencies = _vendor_inventory()
    existing_refs = {
        str(component.get("bom-ref"))
        for component in components
        if isinstance(component, dict)
    }
    vendor_refs = {str(component["bom-ref"]) for component in vendor_components}
    collisions = existing_refs.intersection(vendor_refs)
    if collisions:
        raise RuntimeError(f"Vendored SBOM references collide: {sorted(collisions)}")
    components.extend(vendor_components)

    parent_refs = sorted(
        str(component["bom-ref"])
        for component in vendor_components
        if component.get("type") == "library"
    )
    root_dependency = next(
        (
            dependency
            for dependency in dependencies
            if isinstance(dependency, dict) and dependency.get("ref") == root_ref
        ),
        None,
    )
    if root_dependency is None:
        root_dependency = {"ref": root_ref, "dependsOn": []}
        dependencies.append(root_dependency)
    current_dependencies = root_dependency.get("dependsOn")
    if not isinstance(current_dependencies, list):
        raise RuntimeError("npm CycloneDX root dependency entry is invalid.")
    root_dependency["dependsOn"] = sorted(
        set(str(reference) for reference in current_dependencies).union(parent_refs)
    )
    dependencies.extend(vendor_dependencies)


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
    _merge_vendor_inventory(npm_document)
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
    print("Generated production dependency and vendored-asset CycloneDX SBOMs in release/.")


if __name__ == "__main__":
    main()
