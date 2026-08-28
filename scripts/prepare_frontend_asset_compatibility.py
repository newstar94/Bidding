"""Retain the immediately previous frontend asset set in a staged release.

Run this after extracting a release into a fresh versioned directory and before
switching the ``/opt/biddingflow/current`` symlink. On the first deployment,
staged assets outside the current Vite manifest are pruned. On later deployments,
only assets named by release N's Vite manifest are copied into N+1, and staged
assets outside the exact N/N+1 set are pruned. Every supplied release must come
from a verified production package; its Vite manifest, secure marker, and
selected assets are checksum-checked before an unrelated or modified file can
become public.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path, PurePosixPath


IMMUTABLE_RELEASE_ID = re.compile(r"^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$")
HASHED_ASSET_PATH = re.compile(
    r"^assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$"
)
JOURNAL_NAME = "frontend-compat-assets.json"


def _load_json_object(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{label} is missing or invalid: {path}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} must be an object: {path}")
    return value


def _manifest_assets(manifest: dict, release_root: Path) -> tuple[str, ...]:
    assets: set[str] = set()
    for key, entry in manifest.items():
        if not isinstance(entry, dict):
            raise RuntimeError(f"Vite manifest entry is invalid: {key}")
        values = [entry.get("file")]
        for field in ("css", "assets"):
            field_values = entry.get(field) or []
            if not isinstance(field_values, list):
                raise RuntimeError(f"Vite manifest entry has invalid {field}: {key}")
            values.extend(field_values)
        for value in values:
            if value is None:
                continue
            normalized = str(value).replace("\\", "/")
            if normalized != value or not HASHED_ASSET_PATH.fullmatch(normalized):
                raise RuntimeError(f"Vite manifest contains an unsafe asset: {value}")
            if ".." in PurePosixPath(normalized).parts:
                raise RuntimeError(f"Vite manifest contains an unsafe asset: {value}")
            assets.add(normalized)
    if not assets:
        raise RuntimeError(f"Vite manifest contains no hashed assets: {release_root}")
    return tuple(sorted(assets))


def _package_file_records(release_root: Path) -> dict[str, tuple[int, str]]:
    package_manifest = _load_json_object(
        release_root / "PRODUCTION_MANIFEST.json", "production package manifest"
    )
    if package_manifest.get("formatVersion") != 1:
        raise RuntimeError(f"production package manifest has an unsupported version: {release_root}")
    files = package_manifest.get("files")
    if not isinstance(files, list):
        raise RuntimeError(f"production package manifest has no file inventory: {release_root}")
    records: dict[str, tuple[int, str]] = {}
    for record in files:
        if not isinstance(record, dict):
            raise RuntimeError(f"production package manifest has an invalid file record: {release_root}")
        path = record.get("path")
        size = record.get("size")
        digest = record.get("sha256")
        if (
            not isinstance(path, str)
            or not isinstance(size, int)
            or isinstance(size, bool)
            or size < 0
            or not isinstance(digest, str)
            or not re.fullmatch(r"[0-9a-f]{64}", digest)
            or path in records
        ):
            raise RuntimeError(f"production package manifest has an invalid file record: {release_root}")
        records[path] = (size, digest)
    return records


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _verified_package_file(
    release_root: Path,
    relative_path: str,
    package_records: dict[str, tuple[int, str]],
    *,
    label: str,
) -> tuple[Path, int, str]:
    expected = package_records.get(relative_path)
    pure_path = PurePosixPath(relative_path)
    source = release_root.joinpath(*pure_path.parts)
    if (
        expected is None
        or pure_path.is_absolute()
        or ".." in pure_path.parts
        or source.is_symlink()
        or not source.is_file()
    ):
        raise RuntimeError(f"production package does not verify {label}: {relative_path}")
    try:
        source.resolve().relative_to(release_root)
    except ValueError as error:
        raise RuntimeError(
            f"production package does not verify {label}: {relative_path}"
        ) from error
    expected_size, expected_digest = expected
    if source.stat().st_size != expected_size or _sha256(source) != expected_digest:
        raise RuntimeError(f"{label} integrity mismatch: {relative_path}")
    return source, expected_size, expected_digest


def _verify_current_package_inventory(
    release_root: Path,
    package_records: dict[str, tuple[int, str]],
) -> None:
    """Verify the complete freshly extracted package before mutating ``dist``."""
    for relative_path in sorted(package_records):
        _verified_package_file(
            release_root,
            relative_path,
            package_records,
            label="production package file",
        )

    actual_files: set[str] = set()
    for candidate in release_root.rglob("*"):
        if candidate.is_symlink():
            raise RuntimeError(f"production package contains a symlink: {candidate}")
        if not candidate.is_file():
            continue
        relative_path = candidate.relative_to(release_root).as_posix()
        if relative_path != "PRODUCTION_MANIFEST.json":
            actual_files.add(relative_path)
    expected_files = set(package_records)
    if actual_files != expected_files:
        untracked = sorted(actual_files - expected_files)
        missing = sorted(expected_files - actual_files)
        raise RuntimeError(
            "production package inventory does not match extracted files "
            f"(untracked={untracked[:5]}, missing={missing[:5]})"
        )


def _verified_release_metadata(
    release_root: Path,
    package_records: dict[str, tuple[int, str]],
) -> tuple[str, tuple[str, ...], str, str]:
    manifest_path, _, manifest_digest = _verified_package_file(
        release_root,
        "dist/.vite/manifest.json",
        package_records,
        label="release metadata",
    )
    marker_path, _, marker_digest = _verified_package_file(
        release_root,
        "dist/secure-build.json",
        package_records,
        label="release metadata",
    )
    manifest = _load_json_object(manifest_path, "Vite manifest")
    marker = _load_json_object(marker_path, "secure build marker")
    release_id = marker.get("releaseId")
    if not isinstance(release_id, str) or not IMMUTABLE_RELEASE_ID.fullmatch(release_id):
        raise RuntimeError(f"release has no immutable release ID: {release_root}")
    return (
        release_id,
        _manifest_assets(manifest, release_root),
        manifest_digest,
        marker_digest,
    )


def _verified_asset(
    release_root: Path,
    asset_path: str,
    package_records: dict[str, tuple[int, str]],
) -> tuple[Path, int, str]:
    relative = f"dist/{asset_path}"
    return _verified_package_file(
        release_root,
        relative,
        package_records,
        label="frontend asset",
    )


def _atomic_copy(
    source: Path,
    destination: Path,
    expected_size: int,
    expected_digest: str,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink():
        raise RuntimeError(f"frontend compatibility asset collision: {destination}")
    if destination.exists():
        if (
            destination.is_file()
            and destination.stat().st_size == expected_size
            and _sha256(destination) == expected_digest
        ):
            return
        raise RuntimeError(f"frontend compatibility asset collision: {destination}")
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent,
            prefix=".bf-compat-",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            with source.open("rb") as input_file:
                shutil.copyfileobj(input_file, temporary, length=1024 * 1024)
            temporary.flush()
            os.fsync(temporary.fileno())
        shutil.copymode(source, temporary_path)
        if (
            temporary_path.stat().st_size != expected_size
            or _sha256(temporary_path) != expected_digest
        ):
            raise RuntimeError(
                f"frontend compatibility copy integrity mismatch: {destination}"
            )
        os.replace(temporary_path, destination)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _prune_unexpected_assets(release_root: Path, allowed_assets: set[str]) -> None:
    assets_root = release_root / "dist" / "assets"
    if assets_root.is_symlink() or not assets_root.is_dir():
        raise RuntimeError(f"frontend asset directory is missing or unsafe: {assets_root}")
    for candidate in assets_root.iterdir():
        asset_path = f"assets/{candidate.name}"
        if asset_path in allowed_assets:
            continue
        if candidate.is_symlink() or candidate.is_file():
            candidate.unlink()
            continue
        raise RuntimeError(f"unexpected frontend asset entry is unsafe: {candidate}")


def _write_journal(path: Path, journal: dict) -> None:
    content = (json.dumps(journal, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent,
            prefix=".bf-compat-journal-",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_path, 0o644)
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def prepare_compatibility_assets(
    *,
    current_release: str | Path,
    previous_release: str | Path | None = None,
    expected_current_release_id: str | None = None,
) -> dict[str, str | int | None]:
    current_root = Path(current_release).resolve()
    previous_root = (
        Path(previous_release).resolve() if previous_release is not None else None
    )
    if previous_root is not None and current_root == previous_root:
        raise RuntimeError("current and previous releases must be distinct versioned directories")
    if not current_root.is_dir():
        raise RuntimeError("current release must be an existing versioned directory")
    if previous_root is not None and not previous_root.is_dir():
        raise RuntimeError("previous release must be an existing versioned directory")
    if (
        expected_current_release_id is not None
        and (
            not isinstance(expected_current_release_id, str)
            or not IMMUTABLE_RELEASE_ID.fullmatch(expected_current_release_id)
        )
    ):
        raise RuntimeError("expected current release ID must be immutable")

    current_records = _package_file_records(current_root)
    (
        current_release_id,
        current_asset_paths,
        current_manifest_digest,
        current_marker_digest,
    ) = _verified_release_metadata(current_root, current_records)
    _verify_current_package_inventory(current_root, current_records)
    if (
        expected_current_release_id is not None
        and current_release_id != expected_current_release_id
    ):
        raise RuntimeError(
            "current release ID does not match the expected immutable release ID: "
            f"marker={current_release_id}, expected={expected_current_release_id}"
        )

    previous_records: dict[str, tuple[int, str]] = {}
    previous_release_id: str | None = None
    previous_assets: tuple[str, ...] = ()
    previous_manifest_digest: str | None = None
    previous_marker_digest: str | None = None
    if previous_root is not None:
        previous_records = _package_file_records(previous_root)
        (
            previous_release_id,
            previous_assets,
            previous_manifest_digest,
            previous_marker_digest,
        ) = _verified_release_metadata(previous_root, previous_records)
        if current_release_id == previous_release_id:
            raise RuntimeError(
                "current and previous releases must have distinct immutable release IDs"
            )

    current_assets = set(current_asset_paths)
    current_verified = {
        asset: _verified_asset(current_root, asset, current_records)
        for asset in current_assets
    }
    previous_verified = (
        {
            asset: _verified_asset(previous_root, asset, previous_records)
            for asset in previous_assets
        }
        if previous_root is not None
        else {}
    )
    assets_root = current_root / "dist" / "assets"
    if assets_root.is_symlink() or not assets_root.is_dir():
        raise RuntimeError(f"frontend asset directory is missing or unsafe: {assets_root}")

    retained = []
    for asset in previous_assets:
        source, size, digest = previous_verified[asset]
        if asset in current_verified:
            if current_verified[asset][2] != digest:
                raise RuntimeError(f"content-hashed frontend asset collision: {asset}")
            continue
        destination = current_root / "dist" / Path(*PurePosixPath(asset).parts)
        _atomic_copy(source, destination, size, digest)
        retained.append({"path": asset, "sha256": digest, "size": size})

    _prune_unexpected_assets(current_root, current_assets | set(previous_assets))

    journal = {
        "version": 1,
        "currentReleaseId": current_release_id,
        "previousReleaseId": previous_release_id,
        "currentManifestSha256": current_manifest_digest,
        "currentSecureMarkerSha256": current_marker_digest,
        "previousManifestSha256": previous_manifest_digest,
        "previousSecureMarkerSha256": previous_marker_digest,
        "assets": retained,
    }
    _write_journal(current_root / "dist" / JOURNAL_NAME, journal)
    return {
        "currentReleaseId": current_release_id,
        "previousReleaseId": previous_release_id,
        "retainedAssetCount": len(retained),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--current-release", required=True, type=Path)
    parser.add_argument("--previous-release", type=Path)
    parser.add_argument("--expected-current-release-id")
    arguments = parser.parse_args(argv)
    result = prepare_compatibility_assets(
        current_release=arguments.current_release,
        previous_release=arguments.previous_release,
        expected_current_release_id=arguments.expected_current_release_id,
    )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
