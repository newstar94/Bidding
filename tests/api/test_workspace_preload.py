import json

from backend import app as app_module


def test_workspace_preload_is_omitted_for_anonymous_sessions():
    assert app_module._workspace_preload_tag({"valid": False}) == ""


def test_debug_workspace_preload_uses_source_module(monkeypatch):
    monkeypatch.setattr(app_module, "APP_DEBUG", True)

    tag = app_module._workspace_preload_tag({"valid": True})

    assert 'href="/frontend/app/workspaceBootstrap.js"' in tag
    assert 'href="/frontend/app/BiddingModel.js"' in tag
    assert 'href="/frontend/app/BiddingView.js"' in tag


def test_bundle_workspace_preload_includes_manifest_dependencies(monkeypatch, tmp_path):
    manifest_dir = tmp_path / "dist" / ".vite"
    manifest_dir.mkdir(parents=True)
    manifest = {
        "frontend/app/workspaceBootstrap.js": {
            "file": "assets/workspace.js",
            "imports": ["_shared.js"],
        },
        "_shared.js": {
            "file": "assets/shared.js",
            "imports": [],
        },
    }
    (manifest_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(app_module, "APP_DEBUG", False)
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))

    tag = app_module._workspace_preload_tag({"valid": True})

    assert 'href="/dist/assets/workspace.js"' in tag
    assert 'href="/dist/assets/shared.js"' in tag


def test_single_bundle_workspace_preload_uses_app_entry(monkeypatch, tmp_path):
    manifest_dir = tmp_path / "dist" / ".vite"
    manifest_dir.mkdir(parents=True)
    manifest = {
        "frontend/app/app.js": {
            "file": "assets/appbundle.js",
            "isEntry": True,
        },
    }
    (manifest_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(app_module, "APP_DEBUG", False)
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))

    tag = app_module._workspace_preload_tag({"valid": True})

    assert tag == '<link rel="modulepreload" href="/dist/assets/appbundle.js">'
