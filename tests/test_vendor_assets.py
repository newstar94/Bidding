from scripts.audit_vendor_assets import audit_vendor_assets


def test_vendored_assets_match_security_manifest() -> None:
    verified = audit_vendor_assets()
    assert "views/vendor/xlsx/xlsx.full.min.js" in verified
