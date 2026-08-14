from backend import app as app_module


def test_production_view_allows_public_auth_visual():
    assert app_module._is_production_view_asset_allowed(
        "assets/auth-procurement-visual-v2.webp"
    )


def test_production_view_allows_public_brand_icon():
    assert app_module._is_production_view_asset_allowed("assets/favicon.png")


def test_production_view_does_not_broaden_asset_access():
    assert not app_module._is_production_view_asset_allowed("assets/private.webp")
    assert not app_module._is_production_view_asset_allowed("assets/config.json")
