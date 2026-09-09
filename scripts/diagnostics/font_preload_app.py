"""Test-only font preload variant; no browser request interception."""
import json
import os
from pathlib import Path

if os.environ.get("APP_ENV") != "test":
    raise RuntimeError("Font preload experiment requires APP_ENV=test")

from backend import app as app_module
from backend.frontend_assets import validate_frontend_asset_path

dist = Path(app_module.project_root) / "dist"
manifest = json.loads((dist / ".vite" / "manifest.json").read_text(encoding="utf-8"))
font_links = []
for subset in ("latin", "vietnamese"):
    entry = manifest[f"views/vendor/fonts/plus-jakarta-sans-{subset}.woff2"]
    asset = validate_frontend_asset_path(dist, entry["file"])
    font_links.append(
        f'<link rel="preload" href="/dist/{asset}" as="font" type="font/woff2" crossorigin>'
    )

original_compile = app_module.compile_html


def compile_with_font_preloads(file_path):
    html = original_compile(file_path)
    return html.replace("</head>", "".join(font_links) + "</head>", 1)


app_module.compile_html = compile_with_font_preloads
app = app_module.app
