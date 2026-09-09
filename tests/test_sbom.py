import hashlib
import json
import pytest
from pathlib import Path

from scripts import generate_sbom


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VENDOR_ROOT = PROJECT_ROOT / "views" / "vendor"


def test_python_root_dependencies_preserve_inventory_and_existing_edges():
    document = {
        "metadata": {"component": {"bom-ref": "root"}},
        "components": [{"name": "Some_Package", "version": "1.2", "bom-ref": "pkg", "hashes": []}],
        "dependencies": [{"ref": "root"}, {"ref": "pkg", "dependsOn": ["transitive"]}],
    }
    generate_sbom._link_python_root(document, ["some-package[extra]==1.2"])
    assert document["dependencies"][0]["dependsOn"] == ["pkg"]
    assert document["dependencies"][1]["dependsOn"] == ["transitive"]
    assert document["components"][0]["hashes"] == []


@pytest.mark.parametrize("components", [[], [
    {"name": "example", "version": "2", "bom-ref": "wrong"},
], [
    {"name": "example", "version": "1", "bom-ref": "a"},
    {"name": "example", "version": "1", "bom-ref": "b"},
]])
def test_python_root_rejects_missing_wrong_version_or_ambiguous_component(components):
    document = {"metadata": {"component": {"bom-ref": "root"}},
                "components": components, "dependencies": [{"ref": "root"}]}
    with pytest.raises(ValueError, match="exactly one"):
        generate_sbom._link_python_root(document, ["example==1"])


def test_main_emits_python_root_edges_from_project_manifest(tmp_path, monkeypatch):
    (tmp_path / "pyproject.toml").write_text(
        '[project]\ndependencies = ["example==1"]\n', encoding="utf-8"
    )
    output = tmp_path / "release"
    monkeypatch.setattr(generate_sbom, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(generate_sbom, "OUTPUT_DIRECTORY", output)
    monkeypatch.setattr(generate_sbom.shutil, "which", lambda name: name)
    monkeypatch.setattr(generate_sbom, "_run_json", lambda command: {"bomFormat": "CycloneDX"})
    monkeypatch.setattr(generate_sbom, "_merge_vendor_inventory", lambda document: None)

    def generate_inventory(*args, **kwargs):
        (output / "python-sbom.cdx.json").write_text(json.dumps({
            "metadata": {"component": {"bom-ref": "root"}},
            "components": [{"name": "example", "version": "1", "bom-ref": "example-1"}],
            "dependencies": [{"ref": "root"}],
        }), encoding="utf-8")

    monkeypatch.setattr(generate_sbom.subprocess, "run", generate_inventory)
    generate_sbom.main()
    document = json.loads((output / "python-sbom.cdx.json").read_text(encoding="utf-8"))
    assert document["dependencies"] == [{"ref": "root", "dependsOn": ["example-1"]}]


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
