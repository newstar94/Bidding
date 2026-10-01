from __future__ import annotations

import os
from pathlib import Path

import pytest

from backend.source_module_preloads import resolve_source_preload_graph


def _write(root: Path, relative: str, source: str = "export const ready = true;") -> Path:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8")
    return target


def test_static_multiline_imports_and_reexports_are_breadth_first_and_deduplicated(tmp_path):
    _write(tmp_path, "frontend/app/entry.js", '''
        import "./side.js";
        import Default, {
            one as renamed,
            two,
        } from "../shared/named.js";
        import * as namespace from "./star.js";
        export { thing as alias } from "./reexport.js";
        export * from "./star.js";
        export * as bundle from "./namespace.mjs";
    ''')
    _write(tmp_path, "frontend/app/side.js", 'import "../shared/named.js";')
    for relative in ("frontend/shared/named.js", "frontend/app/star.js",
                     "frontend/app/reexport.js", "frontend/app/namespace.mjs"):
        _write(tmp_path, relative)
    assert resolve_source_preload_graph(tmp_path, ("frontend/app/entry.js",)) == (
        "frontend/app/entry.js", "frontend/app/side.js", "frontend/shared/named.js",
        "frontend/app/star.js", "frontend/app/reexport.js", "frontend/app/namespace.mjs",
    )


def test_comments_strings_templates_regex_and_dynamic_imports_are_not_dependencies(tmp_path):
    _write(tmp_path, "frontend/entry.js", r'''
        // import "./fake.js";
        /* export { fake } from "./fake.js"; */
        const string = 'import "./fake.js";';
        const template = `import "./fake.js"; ${`nested ${import('./dynamic.js')}`}`;
        const regex = /;import "\.\/fake.js";/;
        import("./dynamic.js");
        import /* comment */ ("./dynamic.js");
        const callback = () => import("./dynamic.js");
        const meta = import.meta.url;
        const member = object.import("./dynamic.js");
        export const deferred = () => import("./dynamic.js");
        import { real } /* interleaved comment */ from "./real.js";
    ''')
    for relative in ("frontend/fake.js", "frontend/dynamic.js", "frontend/real.js"):
        _write(tmp_path, relative)
    assert resolve_source_preload_graph(tmp_path, ("frontend/entry.js",)) == (
        "frontend/entry.js", "frontend/real.js",
    )


def test_external_absolute_missing_and_outside_module_paths_are_skipped(tmp_path):
    _write(tmp_path, "frontend/entry.js", '''
        import "https://example.com/module.js";
        import "/frontend/absolute.js";
        import "package-name";
        import "./missing.js";
        import "./real.js?version=1";
        import "../backend/private.js";
        import "../../outside.js";
        import "../views/shared.js";
    ''')
    _write(tmp_path, "frontend/absolute.js")
    _write(tmp_path, "frontend/real.js")
    _write(tmp_path, "backend/private.js")
    _write(tmp_path, "views/shared.js")
    assert resolve_source_preload_graph(tmp_path, ("frontend/entry.js",)) == (
        "frontend/entry.js", "views/shared.js",
    )
    assert resolve_source_preload_graph(tmp_path, ("../outside.js", "backend/private.js")) == ()


def test_source_symlink_escape_is_not_preloaded(tmp_path):
    outside = tmp_path / "outside"
    _write(outside, "escape.js")
    project = tmp_path / "project"
    _write(project, "frontend/entry.js", 'import "./escape.js";')
    link = project / "frontend/escape.js"
    try:
        link.symlink_to(outside / "escape.js")
    except OSError as error:
        pytest.skip(f"Symlinks unavailable on this host: {error}")
    assert resolve_source_preload_graph(project, ("frontend/entry.js",)) == (
        "frontend/entry.js",
    )


def test_resolved_path_escape_is_rejected_without_symlink_privileges(tmp_path, monkeypatch):
    project = tmp_path / "project"
    outside = _write(tmp_path, "outside/escape.js")
    _write(project, "frontend/entry.js", 'import "./escape.js";')
    alias = _write(project, "frontend/escape.js")
    original_resolve = Path.resolve

    def resolve(path, *args, **kwargs):
        if path == alias:
            return outside
        return original_resolve(path, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", resolve)
    assert resolve_source_preload_graph(project, ("frontend/entry.js",)) == (
        "frontend/entry.js",
    )


def test_dependency_edit_invalidates_cache_without_restart(tmp_path):
    _write(tmp_path, "frontend/entry.js", 'import "./child.js";')
    child = _write(tmp_path, "frontend/child.js", 'import "./old.js";')
    _write(tmp_path, "frontend/old.js")
    _write(tmp_path, "frontend/new.js")
    roots = ("frontend/entry.js",)
    assert resolve_source_preload_graph(tmp_path, roots)[-1] == "frontend/old.js"
    before = child.stat()
    child.write_text('import "./new.js";', encoding="utf-8")
    os.utime(child, ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000))
    assert resolve_source_preload_graph(tmp_path, roots) == (
        "frontend/entry.js", "frontend/child.js", "frontend/new.js",
    )
    child.unlink()
    assert resolve_source_preload_graph(tmp_path, roots) == ("frontend/entry.js",)


def test_cycles_and_duplicate_roots_produce_each_source_once(tmp_path):
    _write(tmp_path, "frontend/entry.js", 'import "./child.js";')
    _write(tmp_path, "frontend/child.js", 'export * from "./entry.js";')
    assert resolve_source_preload_graph(tmp_path, ("frontend/entry.js", "frontend/entry.js")) == (
        "frontend/entry.js", "frontend/child.js",
    )


def test_escaped_specifiers_and_invalid_named_clauses_fall_back_to_native_loading(tmp_path):
    _write(tmp_path, "frontend/entry.js", '''
        import "./\\u0066ake.js";
        export { (callback()) } from "./fake.js";
        import Real from "./real.js";
    ''')
    _write(tmp_path, "frontend/fake.js")
    _write(tmp_path, "frontend/real.js")
    assert resolve_source_preload_graph(tmp_path, ("frontend/entry.js",)) == (
        "frontend/entry.js", "frontend/real.js",
    )
