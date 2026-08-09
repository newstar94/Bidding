from pathlib import Path

from scripts.generate_schema_runtime import render_runtime_schema


def test_browser_schema_runtime_matches_backend_contract():
    target = Path("frontend/documents/schemaRuntime.js")

    assert target.read_text(encoding="utf-8") == render_runtime_schema()
