from __future__ import annotations

import json
from pathlib import Path

import pytest


def _secure_marker() -> dict[str, object]:
    return {
        "version": 6,
        "releaseId": "a" * 40,
        "obfuscation": True,
        "deadCodeInjection": True,
        "transformedFiles": [
            {
                "file": "assets/app-abcdefgh.js",
                "inputBytes": 1,
                "outputBytes": 1,
                "inputSha256": "a" * 64,
                "outputSha256": "b" * 64,
            }
        ],
    }


def _write_fixture(
    root: Path,
    manifest: object,
    *,
    marker: object | None = None,
    assets: dict[str, bytes] | None = None,
) -> None:
    manifest_path = root / "dist" / ".vite" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    (root / "dist" / "secure-build.json").write_text(
        json.dumps(_secure_marker() if marker is None else marker), encoding="utf-8"
    )
    for relative_path, content in (assets or {}).items():
        asset_path = root / "dist" / relative_path
        asset_path.parent.mkdir(parents=True, exist_ok=True)
        asset_path.write_bytes(content)


def _valid_manifest() -> dict[str, object]:
    return {
        "frontend/app/app.js": {
            "file": "assets/app-abcdefgh.js",
            "css": ["assets/app-abcdefgh.css"],
            "imports": ["_shared.js"],
        },
        "views/css/landing-shell.css": {
            "file": "assets/landing-shell-abcdefgh.css",
        },
        "_shared.js": {"file": "assets/shared-abcdefgh.js"},
    }


def _valid_assets() -> dict[str, bytes]:
    return {
        "assets/app-abcdefgh.js": b"app",
        "assets/app-abcdefgh.css": b"styles",
        "assets/landing-shell-abcdefgh.css": b"landing styles",
        "assets/shared-abcdefgh.js": b"shared",
    }


def test_valid_production_manifest_resolves_only_hashed_assets(tmp_path: Path):
    from backend.frontend_assets import assert_production_frontend_ready

    _write_fixture(tmp_path, _valid_manifest(), assets=_valid_assets())

    assets = assert_production_frontend_ready(tmp_path)

    assert assets.app_file == "assets/app-abcdefgh.js"
    assert assets.stylesheets == ("assets/app-abcdefgh.css",)
    assert assets.landing_stylesheet == "assets/landing-shell-abcdefgh.css"
    assert assets.preload_files == (
        "assets/app-abcdefgh.js",
        "assets/shared-abcdefgh.js",
    )


@pytest.mark.parametrize(
    ("manifest", "marker", "expected_message"),
    [
        (None, None, "manifest is missing"),
        ("{not-json", None, "manifest is malformed"),
        ({}, None, "manifest must be a non-empty object"),
        ({"unexpected.js": {"file": "assets/app-abcdefgh.js"}}, None, "app entry is missing"),
        (
            _valid_manifest(),
            {"version": 6, "releaseId": "development"},
            "secure build marker is invalid",
        ),
    ],
)
def test_production_frontend_rejects_invalid_manifest_or_marker(
    tmp_path: Path,
    manifest: object,
    marker: object | None,
    expected_message: str,
):
    from backend.frontend_assets import FrontendAssetError, assert_production_frontend_ready

    if manifest is None:
        (tmp_path / "dist").mkdir()
        (tmp_path / "dist" / "secure-build.json").write_text(
            json.dumps(_secure_marker()), encoding="utf-8"
        )
    elif isinstance(manifest, str):
        manifest_path = tmp_path / "dist" / ".vite" / "manifest.json"
        manifest_path.parent.mkdir(parents=True)
        manifest_path.write_text(manifest, encoding="utf-8")
        (tmp_path / "dist" / "secure-build.json").write_text(
            json.dumps(_secure_marker()), encoding="utf-8"
        )
    else:
        _write_fixture(tmp_path, manifest, marker=marker, assets=_valid_assets())

    with pytest.raises(FrontendAssetError, match=expected_message):
        assert_production_frontend_ready(tmp_path)


@pytest.mark.parametrize(
    ("replacement", "expected_message"),
    [
        ("assets/missing-abcdefgh.js", "missing asset"),
        ("../outside.js", "unsafe asset path"),
        ("assets/appbundle.js", "content-hashed"),
    ],
)
def test_production_frontend_rejects_missing_unsafe_or_unhashed_assets(
    tmp_path: Path,
    replacement: str,
    expected_message: str,
):
    from backend.frontend_assets import FrontendAssetError, assert_production_frontend_ready

    manifest = _valid_manifest()
    manifest["frontend/app/app.js"]["file"] = replacement
    _write_fixture(tmp_path, manifest, assets=_valid_assets())

    with pytest.raises(FrontendAssetError, match=expected_message):
        assert_production_frontend_ready(tmp_path)


def test_production_frontend_rejects_missing_app_file_and_stylesheet(tmp_path: Path):
    from backend.frontend_assets import FrontendAssetError, assert_production_frontend_ready

    missing_app_file = _valid_manifest()
    del missing_app_file["frontend/app/app.js"]["file"]
    _write_fixture(tmp_path, missing_app_file, assets=_valid_assets())
    with pytest.raises(FrontendAssetError, match="app entry has no file"):
        assert_production_frontend_ready(tmp_path)

    missing_style = _valid_manifest()
    missing_style["frontend/app/app.js"]["css"] = ["assets/missing-abcdefgh.css"]
    _write_fixture(tmp_path, missing_style, assets=_valid_assets())
    with pytest.raises(FrontendAssetError, match="missing asset"):
        assert_production_frontend_ready(tmp_path)


def test_production_frontend_rejects_malformed_secure_marker(tmp_path: Path):
    from backend.frontend_assets import FrontendAssetError, assert_production_frontend_ready

    _write_fixture(tmp_path, _valid_manifest(), assets=_valid_assets())
    (tmp_path / "dist" / "secure-build.json").write_text("{broken", encoding="utf-8")

    with pytest.raises(FrontendAssetError, match="secure build marker is malformed"):
        assert_production_frontend_ready(tmp_path)


def test_non_production_html_can_keep_legacy_development_fallback(monkeypatch, tmp_path: Path):
    from backend import app as app_module

    views = tmp_path / "views"
    views.mkdir()
    index_path = views / "index.html"
    index_path.write_text(
        '<script type="module" src="/frontend/app/app.js"></script>', encoding="utf-8"
    )
    monkeypatch.setattr(app_module, "APP_DEBUG", False)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)

    compiled = app_module.compile_html(str(index_path))

    assert '/dist/assets/appbundle.js' in compiled


def test_production_html_never_falls_back_to_appbundle_when_manifest_is_invalid(
    monkeypatch, tmp_path: Path
):
    from backend import app as app_module
    from backend.frontend_assets import FrontendAssetError

    views = tmp_path / "views"
    views.mkdir()
    index_path = views / "index.html"
    index_path.write_text(
        '<script type="module" src="/frontend/app/app.js"></script>', encoding="utf-8"
    )
    (tmp_path / "dist" / ".vite").mkdir(parents=True)
    (tmp_path / "dist" / ".vite" / "manifest.json").write_text("{broken", encoding="utf-8")
    (tmp_path / "dist" / "secure-build.json").write_text(
        json.dumps(_secure_marker()), encoding="utf-8"
    )
    monkeypatch.setattr(app_module, "APP_DEBUG", False)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", True)
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)

    with pytest.raises(FrontendAssetError, match="manifest is malformed"):
        app_module.compile_html(str(index_path))
