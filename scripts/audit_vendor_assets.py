"""Verify vendored third-party assets against their pinned security manifest."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VENDOR_ROOT = PROJECT_ROOT / "views" / "vendor"
MANIFEST_PATH = VENDOR_ROOT / "vendor-manifest.json"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _version_tuple(value: str) -> tuple[int, ...]:
    if not re.fullmatch(r"\d+(?:\.\d+)*", str(value or "")):
        raise RuntimeError(f"Unsupported vendored version: {value!r}")
    return tuple(int(part) for part in value.split("."))


def audit_vendor_assets() -> list[str]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or not isinstance(
        manifest.get("assets"), list
    ):
        raise RuntimeError("Vendored asset manifest is invalid.")

    verified: list[str] = []
    for asset in manifest["assets"]:
        name = str(asset.get("name") or "").strip()
        version = str(asset.get("version") or "").strip()
        source = str(asset.get("source") or "").strip()
        files = asset.get("files")
        if not name or not version or not source.startswith("https://"):
            raise RuntimeError(f"Vendored asset metadata is incomplete: {name!r}")
        if not isinstance(files, dict) or not files:
            raise RuntimeError(f"Vendored asset has no pinned files: {name}")

        security_minimum = asset.get("securityMinimumVersion")
        if security_minimum and _version_tuple(version) < _version_tuple(
            str(security_minimum)
        ):
            raise RuntimeError(
                f"{name} {version} is below security minimum {security_minimum}."
            )

        for relative_name, expected_hash in files.items():
            candidate = (VENDOR_ROOT / str(relative_name)).resolve()
            try:
                candidate.relative_to(VENDOR_ROOT.resolve())
            except ValueError as exc:
                raise RuntimeError(
                    f"Vendored path escapes the vendor directory: {relative_name}"
                ) from exc
            if not candidate.is_file():
                raise RuntimeError(f"Vendored file is missing: {relative_name}")
            actual_hash = _sha256(candidate)
            if actual_hash != str(expected_hash).casefold():
                raise RuntimeError(
                    f"Vendored checksum mismatch for {relative_name}: {actual_hash}"
                )
            verified.append(candidate.relative_to(PROJECT_ROOT).as_posix())

        if name.casefold().startswith("sheetjs"):
            sheetjs_path = VENDOR_ROOT / "xlsx" / "xlsx.full.min.js"
            content = sheetjs_path.read_text(encoding="utf-8")
            if f'version="{version}"' not in content:
                raise RuntimeError("SheetJS embedded version does not match the manifest.")
            loader = (
                PROJECT_ROOT / "frontend" / "shared" / "externalAssets.js"
            ).read_text(encoding="utf-8")
            if f"xlsx.full.min.js?v={version}" not in loader:
                raise RuntimeError("SheetJS runtime reference is not version-aligned.")

    return verified


def main() -> int:
    verified = audit_vendor_assets()
    print(f"Vendored asset audit passed ({len(verified)} pinned files).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
