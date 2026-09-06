import os
from pathlib import Path

import pytest

from backend import app as app_module


def _compile(monkeypatch, root: Path, include_path: str) -> str:
    index = root / "index.html"
    index.write_text(f"<!-- INCLUDE: {include_path} -->", encoding="utf-8")
    monkeypatch.setattr(app_module, "project_root", str(root))
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "_frontend_bundle_enabled", lambda: False)
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)
    return app_module.compile_html(str(index))


def test_compile_html_allows_normal_child_include(monkeypatch, tmp_path):
    root = tmp_path / "project"
    (root / "views").mkdir(parents=True)
    (root / "views" / "child.html").write_text("inside", encoding="utf-8")
    assert _compile(monkeypatch, root, "views/child.html") == "inside"


def test_compile_html_rejects_parent_traversal(monkeypatch, tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (tmp_path / "outside.html").write_text("outside", encoding="utf-8")
    compiled = _compile(monkeypatch, root, "../outside.html")
    assert "Path traversal denied" in compiled
    assert "outside" not in compiled.replace("../outside.html", "")


def test_compile_html_rejects_sibling_prefix_collision(monkeypatch, tmp_path):
    root = tmp_path / "project"
    sibling = tmp_path / "projectescape"
    root.mkdir()
    sibling.mkdir()
    (sibling / "secret.html").write_text("sibling-secret", encoding="utf-8")
    compiled = _compile(monkeypatch, root, "../projectescape/secret.html")
    assert "Path traversal denied" in compiled
    assert "sibling-secret" not in compiled


def test_compile_html_rejects_symlink_resolved_outside_root(monkeypatch, tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    outside = tmp_path / "outside.html"
    outside.write_text("symlink-secret", encoding="utf-8")
    link = root / "linked.html"
    try:
        link.symlink_to(outside)
    except OSError as exc:
        pytest.skip(f"Symlink creation is unavailable: {exc}")
    compiled = _compile(monkeypatch, root, "linked.html")
    assert "Path traversal denied" in compiled
    assert "symlink-secret" not in compiled


@pytest.mark.parametrize(
    "candidate",
    [
        lambda root: root / "views" / "child.html",
        lambda root: root / ".." / "outside.html",
    ],
)
def test_path_boundary_helper_handles_resolved_paths(tmp_path, candidate):
    root = tmp_path / "project"
    root.mkdir()
    expected = os.path.commonpath(
        (os.path.realpath(root), os.path.realpath(candidate(root)))
    ) == os.path.realpath(root)
    assert app_module._path_is_within_root(candidate(root), root) is expected
