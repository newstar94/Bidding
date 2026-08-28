import hashlib
import json
import stat
from pathlib import Path

import pytest

from scripts import package_production, prepare_frontend_asset_compatibility


def _write_release(
    root: Path,
    release_id: str,
    assets: dict[str, bytes],
    *,
    manifest_assets: tuple[str, ...] | None = None,
) -> None:
    if manifest_assets is None:
        manifest_assets = tuple(sorted(assets))
    manifest = {}
    for asset_path, content in sorted(assets.items()):
        target = root / "dist" / asset_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    for index, asset_path in enumerate(manifest_assets):
        manifest[f"entry-{index}.js"] = {"file": asset_path}
    manifest_directory = root / "dist" / ".vite"
    manifest_directory.mkdir(parents=True, exist_ok=True)
    manifest_directory.joinpath("manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    root.joinpath("dist", "secure-build.json").write_text(
        json.dumps({"version": 6, "releaseId": release_id}), encoding="utf-8"
    )
    package_files = []
    for candidate in sorted(root.joinpath("dist").rglob("*")):
        if not candidate.is_file():
            continue
        content = candidate.read_bytes()
        package_files.append({
            "path": candidate.relative_to(root).as_posix(),
            "sha256": hashlib.sha256(content).hexdigest(),
            "size": len(content),
        })
    root.joinpath("PRODUCTION_MANIFEST.json").write_text(
        json.dumps({"formatVersion": 1, "files": package_files}), encoding="utf-8"
    )


def test_prepare_release_retains_exact_previous_manifest_assets(tmp_path):
    previous = tmp_path / "releases" / ("a" * 40)
    current = tmp_path / "releases" / ("b" * 40)
    previous_assets = {
        "assets/app-OLDHASH1.js": b"old app",
        "assets/feature-OLDHASH2.js": b"old lazy feature",
    }
    _write_release(previous, "a" * 40, previous_assets)
    _write_release(current, "b" * 40, {"assets/app-NEWHASH1.js": b"new app"})
    unrelated = previous / "dist" / "assets" / "untracked-OLDHASH3.js"
    unrelated.write_bytes(b"must not be copied")

    result = prepare_frontend_asset_compatibility.prepare_compatibility_assets(
        current_release=current,
        previous_release=previous,
    )

    assert result == {
        "currentReleaseId": "b" * 40,
        "previousReleaseId": "a" * 40,
        "retainedAssetCount": 2,
    }
    for asset_path, content in previous_assets.items():
        assert (current / "dist" / asset_path).read_bytes() == content
        assert stat.S_IMODE((current / "dist" / asset_path).stat().st_mode) == stat.S_IMODE(
            (previous / "dist" / asset_path).stat().st_mode
        )
    assert not (current / "dist" / "assets" / unrelated.name).exists()
    journal = json.loads(
        (current / "dist" / "frontend-compat-assets.json").read_text(encoding="utf-8")
    )
    assert journal["version"] == 1
    assert journal["currentReleaseId"] == "b" * 40
    assert journal["previousReleaseId"] == "a" * 40
    assert [entry["path"] for entry in journal["assets"]] == sorted(previous_assets)


def test_prepare_first_release_verifies_prunes_and_writes_empty_journal(tmp_path):
    current = tmp_path / "releases" / ("b" * 40)
    current_asset = "assets/app-NEWHASH1.js"
    build_host_asset = "assets/lazy-BUILDHOST.js"
    _write_release(
        current,
        "b" * 40,
        {
            current_asset: b"current app",
            build_host_asset: b"must not become production predecessor",
        },
        manifest_assets=(current_asset,),
    )

    result = prepare_frontend_asset_compatibility.prepare_compatibility_assets(
        current_release=current,
        expected_current_release_id="b" * 40,
    )

    assert result == {
        "currentReleaseId": "b" * 40,
        "previousReleaseId": None,
        "retainedAssetCount": 0,
    }
    assert (current / "dist" / current_asset).is_file()
    assert not (current / "dist" / build_host_asset).exists()
    journal = json.loads(
        current.joinpath("dist", "frontend-compat-assets.json").read_text(
            encoding="utf-8"
        )
    )
    assert journal["previousReleaseId"] is None
    assert journal["previousManifestSha256"] is None
    assert journal["previousSecureMarkerSha256"] is None
    assert journal["assets"] == []


def test_prepare_release_refuses_unexpected_current_release_id(tmp_path):
    current = tmp_path / "releases" / ("b" * 40)
    _write_release(current, "b" * 40, {"assets/app-NEWHASH1.js": b"new app"})

    with pytest.raises(RuntimeError, match="does not match the expected"):
        prepare_frontend_asset_compatibility.prepare_compatibility_assets(
            current_release=current,
            expected_current_release_id="c" * 40,
        )


def test_prepare_release_verifies_every_current_package_file_before_pruning(tmp_path):
    current = tmp_path / "releases" / ("b" * 40)
    _write_release(current, "b" * 40, {"assets/app-NEWHASH1.js": b"new app"})
    runtime_path = current / "backend" / "app.py"
    runtime_path.parent.mkdir(parents=True)
    runtime_bytes = b"print('packaged runtime')\n"
    runtime_path.write_bytes(runtime_bytes)
    package_manifest_path = current / "PRODUCTION_MANIFEST.json"
    package_manifest = json.loads(package_manifest_path.read_text(encoding="utf-8"))
    package_manifest["files"].append({
        "path": "backend/app.py",
        "sha256": hashlib.sha256(runtime_bytes).hexdigest(),
        "size": len(runtime_bytes),
    })
    package_manifest_path.write_text(json.dumps(package_manifest), encoding="utf-8")
    runtime_path.write_bytes(b"tampered after extraction\n")

    with pytest.raises(RuntimeError, match="production package file integrity mismatch"):
        prepare_frontend_asset_compatibility.prepare_compatibility_assets(
            current_release=current,
            expected_current_release_id="b" * 40,
        )


def test_prepare_release_refuses_in_place_or_unverified_sources(tmp_path):
    release = tmp_path / "release"
    _write_release(release, "a" * 40, {"assets/app-OLDHASH1.js": b"old app"})

    with pytest.raises(RuntimeError, match="distinct versioned directories"):
        prepare_frontend_asset_compatibility.prepare_compatibility_assets(
            current_release=release,
            previous_release=release,
        )

    current = tmp_path / "current"
    _write_release(current, "b" * 40, {"assets/app-NEWHASH1.js": b"new app"})
    (release / "dist" / "assets" / "app-OLDHASH1.js").write_bytes(b"tampered")
    with pytest.raises(RuntimeError, match="integrity mismatch"):
        prepare_frontend_asset_compatibility.prepare_compatibility_assets(
            current_release=current,
            previous_release=release,
        )


@pytest.mark.parametrize(
    "metadata_path",
    (
        Path("dist/.vite/manifest.json"),
        Path("dist/secure-build.json"),
    ),
)
@pytest.mark.parametrize("release_name", ("current", "previous"))
def test_prepare_release_refuses_tampered_packaged_metadata(
    tmp_path,
    metadata_path,
    release_name,
):
    previous = tmp_path / "previous"
    current = tmp_path / "current"
    _write_release(previous, "a" * 40, {"assets/app-OLDHASH1.js": b"old app"})
    _write_release(current, "b" * 40, {"assets/app-NEWHASH1.js": b"new app"})
    target = {"current": current, "previous": previous}[release_name] / metadata_path
    target.write_bytes(target.read_bytes() + b"\n")

    with pytest.raises(RuntimeError, match="release metadata integrity mismatch"):
        prepare_frontend_asset_compatibility.prepare_compatibility_assets(
            current_release=current,
            previous_release=previous,
        )


def test_prepare_release_prunes_packaged_assets_from_an_unrelated_predecessor(tmp_path):
    previous = tmp_path / "previous"
    current = tmp_path / "current"
    current_asset = "assets/app-NEWHASH1.js"
    unrelated_asset = "assets/lazy-UNRELATED.js"
    previous_asset = "assets/lazy-PREVIOUS.js"
    _write_release(previous, "a" * 40, {previous_asset: b"real production predecessor"})
    _write_release(
        current,
        "b" * 40,
        {
            current_asset: b"new app",
            unrelated_asset: b"prepackaged from another predecessor",
        },
        manifest_assets=(current_asset,),
    )

    prepare_frontend_asset_compatibility.prepare_compatibility_assets(
        current_release=current,
        previous_release=previous,
    )

    assert (current / "dist" / current_asset).is_file()
    assert (current / "dist" / previous_asset).is_file()
    assert not (current / "dist" / unrelated_asset).exists()
    assert sorted(
        entry.name for entry in current.joinpath("dist", "assets").iterdir()
    ) == ["app-NEWHASH1.js", "lazy-PREVIOUS.js"]


def test_prepare_release_reverses_the_grace_set_before_rollback(tmp_path):
    rollback = tmp_path / "rollback"
    serving = tmp_path / "serving"
    rollback_asset = "assets/app-ROLLBACK1.js"
    obsolete_asset = "assets/lazy-OBSOLETE1.js"
    serving_asset = "assets/app-SERVING01.js"
    _write_release(
        rollback,
        "a" * 40,
        {
            rollback_asset: b"rollback graph",
            obsolete_asset: b"older predecessor",
        },
        manifest_assets=(rollback_asset,),
    )
    _write_release(serving, "b" * 40, {serving_asset: b"currently served graph"})

    result = prepare_frontend_asset_compatibility.prepare_compatibility_assets(
        current_release=rollback,
        previous_release=serving,
    )

    assert result["currentReleaseId"] == "a" * 40
    assert result["previousReleaseId"] == "b" * 40
    assert sorted(
        entry.name for entry in rollback.joinpath("dist", "assets").iterdir()
    ) == ["app-ROLLBACK1.js", "app-SERVING01.js"]
    journal = json.loads(
        rollback.joinpath("dist", "frontend-compat-assets.json").read_text(
            encoding="utf-8"
        )
    )
    assert [record["path"] for record in journal["assets"]] == [serving_asset]


def test_deploy_prepared_release_uses_package_compatible_checksum_journal(
    monkeypatch,
    tmp_path,
):
    previous = tmp_path / "previous"
    current = tmp_path / "current"
    _write_release(previous, "a" * 40, {"assets/app-OLDHASH1.js": b"old app"})
    _write_release(current, "b" * 40, {"assets/app-NEWHASH1.js": b"new app"})

    prepare_frontend_asset_compatibility.prepare_compatibility_assets(
        current_release=current,
        previous_release=previous,
    )

    journal = json.loads(
        current.joinpath("dist", "frontend-compat-assets.json").read_text(
            encoding="utf-8"
        )
    )
    assert journal["currentManifestSha256"] == hashlib.sha256(
        current.joinpath("dist", ".vite", "manifest.json").read_bytes()
    ).hexdigest()
    assert journal["currentSecureMarkerSha256"] == hashlib.sha256(
        current.joinpath("dist", "secure-build.json").read_bytes()
    ).hexdigest()
    assert journal["previousManifestSha256"] == hashlib.sha256(
        previous.joinpath("dist", ".vite", "manifest.json").read_bytes()
    ).hexdigest()
    assert journal["previousSecureMarkerSha256"] == hashlib.sha256(
        previous.joinpath("dist", "secure-build.json").read_bytes()
    ).hexdigest()

    monkeypatch.setattr(package_production, "PROJECT_ROOT", current)
    package_production._validate_frontend_artifacts(
        current / "dist" / ".vite" / "manifest.json"
    )


def test_production_deploy_uses_versioned_release_and_retains_n_minus_one_assets():
    readme = (package_production.PROJECT_ROOT / "deploy" / "README.md").read_text(
        encoding="utf-8"
    )
    packaged_paths = {
        relative_path.as_posix()
        for _, relative_path in package_production.collect_runtime_source_files()
    }

    assert "scripts/prepare_frontend_asset_compatibility.py" in packaged_paths
    assert "Không giải nén hoặc build đè vào `/opt/biddingflow/current`" in readme
    assert readme.index("set -euo pipefail") < readme.index("unzip biddingflow-production.zip")
    assert "if [ -L /opt/biddingflow/current ]; then" in readme
    assert '[ -e "$NEW_RELEASE" ] || [ -L "$NEW_RELEASE" ]' in readme
    assert 'PREVIOUS_RELEASE="$(readlink -f /opt/biddingflow/current)"' in readme
    assert "prepare_frontend_asset_compatibility.py" in readme
    assert '--expected-current-release-id "$RELEASE_ID"' in readme
    assert readme.count(
        'python "$NEW_RELEASE/scripts/prepare_frontend_asset_compatibility.py"'
    ) == 1
    assert "--previous-release \"$PREVIOUS_RELEASE\"" in readme
    assert "ln -sfnT \"$NEW_RELEASE\" /opt/biddingflow/current.next" in readme
    assert "mv -Tf /opt/biddingflow/current.next /opt/biddingflow/current" in readme
    assert "rollback_failed_cutover" in readme
    assert '"$DEPLOY_SMOKE_SCRIPT" http://127.0.0.1:8000' in readme
    assert readme.index("unzip biddingflow-production.zip") < readme.index(
        'python "$NEW_RELEASE/scripts/backup.py" create'
    ) < readme.index(
        'DATABASE_AUTO_MIGRATE=false python "$NEW_RELEASE/scripts/manage_database.py"'
    ) < readme.index(
        'mv -Tf /opt/biddingflow/current.next /opt/biddingflow/current'
    )
    assert "--current-release \"$ROLLBACK_RELEASE\"" in readme
    assert '--expected-current-release-id "$ROLLBACK_RELEASE_ID"' in readme
    assert "--previous-release \"$CURRENT_RELEASE\"" in readme
    assert "restore_failed_rollback" in readme
    assert '"$ROLLBACK_SMOKE_SCRIPT" http://127.0.0.1:8000' in readme
