import json
import re
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_biddingflow_product_version_is_2_0_everywhere():
    package = json.loads(_read("package.json"))
    package_lock = json.loads(_read("package-lock.json"))
    pyproject = tomllib.loads(_read("pyproject.toml"))

    assert package["version"] == "2.0.0"
    assert package_lock["version"] == "2.0.0"
    assert package_lock["packages"][""]["version"] == "2.0.0"
    assert pyproject["project"]["version"] == "2.0.0"
    assert "Hệ Thống Đấu Thầu v2.0" in _read("views/components/sidebar.html")
    assert "Hệ Thống Đấu Thầu v2.0" in _read("views/components/auth_overlay.html")


def test_internal_asset_cache_versions_are_2_0():
    index = _read("views/index.html")
    versioned_assets = re.findall(
        r'(?:src|href)="([^"]+)\?v=([^"&]+)(?:&amp;[^"]*)?"',
        index,
    )
    app_owned_vendor_assets = {
        "/vendor/route-shell.js",
        "/vendor/initial-route.js",
        "/vendor/lucide/lucide-shim.js",
    }
    internal_versions = [
        version
        for path, version in versioned_assets
        if path.startswith(("/frontend/", "/css/")) or path in app_owned_vendor_assets
    ]

    assert internal_versions
    assert set(internal_versions) == {"2.0"}


def test_external_library_versions_are_not_relabelled_as_app_version():
    assert "/vendor/lucide/lucide.min.js?v=1.21.0.1" in _read("frontend/app/app.js")
    assert "/vendor/xlsx/xlsx.full.min.js?v=0.20.3" in _read(
        "frontend/shared/externalAssets.js"
    )
