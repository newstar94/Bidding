"""Validated Vite asset graph used by the production application shell.

The Vite manifest is deployment input, not a trusted runtime API.  This module
keeps its parsing and path validation in one small, testable boundary so a
broken artifact fails at startup instead of returning an HTML shell that later
loads a missing JavaScript file.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Mapping


APP_ENTRY = "frontend/app/app.js"
STYLE_ENTRY = "views/css/app.css"
LANDING_STYLE_ENTRY = "views/css/landing-shell.css"
HASHED_ASSET_PATH = re.compile(
    r"^assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$"
)
IMMUTABLE_RELEASE_ID = re.compile(r"^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$")


class FrontendAssetError(RuntimeError):
    """Raised when a production frontend artifact cannot be trusted."""


@dataclass(frozen=True)
class FrontendAssets:
    """The validated asset references needed to render the production shell."""

    app_file: str
    stylesheets: tuple[str, ...]
    landing_stylesheet: str
    preload_files: tuple[str, ...]
    dist_root: Path
    manifest: Mapping[str, Any]


def _dist_root(project_root: str | Path) -> Path:
    return (Path(project_root).resolve() / "dist").resolve()


def _load_json_object(path: Path, *, label: str) -> dict[str, Any]:
    if not path.is_file():
        raise FrontendAssetError(f"{label} is missing: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise FrontendAssetError(f"{label} is malformed: {path}") from error
    if not isinstance(value, dict):
        raise FrontendAssetError(f"{label} must be an object: {path}")
    return value


def load_frontend_manifest(project_root: str | Path) -> dict[str, Any]:
    """Load a non-empty Vite manifest from the fixed production location."""

    manifest = _load_json_object(
        _dist_root(project_root) / ".vite" / "manifest.json",
        label="frontend manifest",
    )
    if not manifest:
        raise FrontendAssetError("frontend manifest must be a non-empty object")
    return manifest


def validate_frontend_asset_path(dist_root: Path, asset_path: object) -> str:
    """Return a safe, hashed relative asset reference or reject it explicitly."""

    if not isinstance(asset_path, str) or not asset_path.strip():
        raise FrontendAssetError("frontend manifest contains an unsafe asset path")
    normalized = asset_path.replace("\\", "/")
    posix_path = PurePosixPath(normalized)
    if (
        normalized != asset_path
        or posix_path.is_absolute()
        or ".." in posix_path.parts
        or "." in posix_path.parts
    ):
        raise FrontendAssetError(f"frontend manifest contains an unsafe asset path: {asset_path}")

    candidate = (dist_root / Path(*posix_path.parts)).resolve()
    try:
        candidate.relative_to(dist_root)
    except ValueError as error:
        raise FrontendAssetError(
            f"frontend manifest contains an unsafe asset path: {asset_path}"
        ) from error
    if not HASHED_ASSET_PATH.fullmatch(normalized):
        raise FrontendAssetError(
            f"frontend manifest asset is not content-hashed: {asset_path}"
        )
    if not candidate.is_file():
        raise FrontendAssetError(f"frontend manifest references a missing asset: {asset_path}")
    return normalized


def _entry(manifest: Mapping[str, Any], key: str, *, required: bool = True) -> Mapping[str, Any] | None:
    value = manifest.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, Mapping):
        if key == APP_ENTRY:
            raise FrontendAssetError("frontend manifest app entry is missing")
        raise FrontendAssetError(f"frontend manifest entry is invalid: {key}")
    return value


def _entry_file(manifest: Mapping[str, Any], dist_root: Path, key: str) -> str:
    entry = _entry(manifest, key)
    assert entry is not None
    file_path = entry.get("file")
    if not isinstance(file_path, str) or not file_path:
        if key == APP_ENTRY:
            raise FrontendAssetError("frontend manifest app entry has no file")
        raise FrontendAssetError(f"frontend manifest entry has no file: {key}")
    return validate_frontend_asset_path(dist_root, file_path)


def resolve_frontend_entry(
    manifest: Mapping[str, Any],
    dist_root: Path,
    entry_key: str = APP_ENTRY,
) -> str:
    """Resolve a required manifest entry to a validated, hashed asset path."""

    return _entry_file(manifest, dist_root, entry_key)


def _validated_asset_list(
    entry: Mapping[str, Any],
    field_name: str,
    dist_root: Path,
    entry_key: str,
) -> tuple[str, ...]:
    values = entry.get(field_name, [])
    if values is None:
        return ()
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        raise FrontendAssetError(
            f"frontend manifest entry has invalid {field_name}: {entry_key}"
        )
    return tuple(validate_frontend_asset_path(dist_root, value) for value in values)


def resolve_frontend_styles(
    manifest: Mapping[str, Any],
    dist_root: Path,
    entry_key: str = APP_ENTRY,
) -> tuple[str, ...]:
    """Resolve the app stylesheet(s), preferring Vite's dedicated CSS entry."""

    style_entry = _entry(manifest, STYLE_ENTRY, required=False)
    if style_entry is not None:
        return (resolve_frontend_entry(manifest, dist_root, STYLE_ENTRY),)
    app_entry = _entry(manifest, entry_key)
    assert app_entry is not None
    return _validated_asset_list(app_entry, "css", dist_root, entry_key)


def resolve_preload_graph(
    manifest: Mapping[str, Any],
    dist_root: Path,
    entry_keys: tuple[str, ...] = (APP_ENTRY,),
) -> tuple[str, ...]:
    """Resolve entry files and static imports in deterministic preload order."""

    pending = list(entry_keys)
    visited: set[str] = set()
    files: list[str] = []
    while pending:
        key = pending.pop(0)
        if key in visited:
            continue
        visited.add(key)
        entry = _entry(manifest, key)
        assert entry is not None
        files.append(_entry_file(manifest, dist_root, key))
        imports = entry.get("imports", [])
        if imports is None:
            imports = []
        if not isinstance(imports, list) or not all(isinstance(value, str) for value in imports):
            raise FrontendAssetError(f"frontend manifest entry has invalid imports: {key}")
        for imported_key in imports:
            if imported_key not in manifest:
                raise FrontendAssetError(
                    f"frontend manifest import is missing its entry: {imported_key}"
                )
            pending.append(imported_key)
    return tuple(dict.fromkeys(files))


def _validate_manifest_graph(manifest: Mapping[str, Any], dist_root: Path) -> None:
    """Validate every dynamic and static asset before the server exposes HTML."""

    for key in manifest:
        entry = _entry(manifest, key)
        assert entry is not None
        _entry_file(manifest, dist_root, key)
        _validated_asset_list(entry, "css", dist_root, key)
        _validated_asset_list(entry, "assets", dist_root, key)
        imports = entry.get("imports", [])
        if imports is None:
            imports = []
        if not isinstance(imports, list) or not all(isinstance(value, str) for value in imports):
            raise FrontendAssetError(f"frontend manifest entry has invalid imports: {key}")
        for imported_key in imports:
            if imported_key not in manifest:
                raise FrontendAssetError(
                    f"frontend manifest import is missing its entry: {imported_key}"
                )


def _validate_secure_build_marker(project_root: str | Path) -> None:
    marker = _load_json_object(
        _dist_root(project_root) / "secure-build.json",
        label="secure build marker",
    )
    release_id = marker.get("releaseId")
    transformed_files = marker.get("transformedFiles")
    valid = (
        isinstance(marker.get("version"), int)
        and not isinstance(marker.get("version"), bool)
        and marker["version"] >= 5
        and isinstance(release_id, str)
        and release_id == release_id.strip()
        and bool(IMMUTABLE_RELEASE_ID.fullmatch(release_id))
        and marker.get("obfuscation") is True
        and marker.get("deadCodeInjection") is True
        and isinstance(transformed_files, list)
        and bool(transformed_files)
    )
    if not valid:
        raise FrontendAssetError("secure build marker is invalid or unsupported")


def assert_production_frontend_ready(project_root: str | Path) -> FrontendAssets:
    """Validate the complete deployment graph required by production HTML."""

    manifest = load_frontend_manifest(project_root)
    dist_root = _dist_root(project_root)
    _validate_secure_build_marker(project_root)
    _validate_manifest_graph(manifest, dist_root)
    app_file = resolve_frontend_entry(manifest, dist_root)
    return FrontendAssets(
        app_file=app_file,
        stylesheets=resolve_frontend_styles(manifest, dist_root),
        landing_stylesheet=resolve_frontend_entry(
            manifest,
            dist_root,
            LANDING_STYLE_ENTRY,
        ),
        preload_files=resolve_preload_graph(manifest, dist_root),
        dist_root=dist_root,
        manifest=manifest,
    )
