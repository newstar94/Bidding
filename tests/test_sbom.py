import hashlib
import json
from pathlib import Path

from scripts import generate_sbom


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VENDOR_ROOT = PROJECT_ROOT / "views" / "vendor"


def test_vendor_manifest_is_merged_into_cyclonedx_with_file_hashes_and_licenses():
    document = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "metadata": {"component": {"bom-ref": "app@1", "type": "application"}},
        "components": [],
        "dependencies": [{"ref": "app@1", "dependsOn": []}],
    }

    generate_sbom._merge_vendor_inventory(document)

    manifest = json.loads(
        (VENDOR_ROOT / "vendor-manifest.json").read_text(encoding="utf-8")
    )
    components = {component["bom-ref"]: component for component in document["components"]}
    vendor_parents = [
        component
        for component in components.values()
        if component.get("type") == "library"
    ]
    vendor_files = [
        component for component in components.values() if component.get("type") == "file"
    ]

    assert len(vendor_parents) == len(manifest["assets"]) == 4
    assert len(vendor_files) == sum(
        len(asset["files"]) for asset in manifest["assets"]
    ) == 8
    assert len(document["dependencies"][0]["dependsOn"]) == 4

    for parent in vendor_parents:
        assert parent["version"]
        assert parent["licenses"][0]["license"]["id"]
        assert parent["externalReferences"][0]["url"].startswith("https://")

    for component in vendor_files:
        properties = {
            item["name"]: item["value"] for item in component["properties"]
        }
        relative_path = properties["biddingflow:vendor:path"]
        content = (PROJECT_ROOT / relative_path).read_bytes()
        assert component["hashes"] == [
            {"alg": "SHA-256", "content": hashlib.sha256(content).hexdigest()}
        ]
        assert component["licenses"][0]["license"]["id"]


def test_vendor_bom_refs_are_stable_and_unique():
    first = generate_sbom._vendor_inventory()
    second = generate_sbom._vendor_inventory()

    assert first == second
    references = [component["bom-ref"] for component in first[0]]
    assert len(references) == len(set(references))
