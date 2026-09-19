from pathlib import Path


def test_chuan_hoa_routes_and_clients_are_removed():
    root = Path(__file__).resolve().parents[1]
    source = (root / "backend/app.py").read_text(encoding="utf-8")
    assert "platform_chuan_hoa_routes" not in source
    assert "chuan_hoa_public_proxy_routes" not in source
    for relative in (
        "backend/admin/platform_chuan_hoa_routes.py",
        "backend/integrations/chuan_hoa.py",
        "backend/integrations/chuan_hoa_public_proxy.py",
        "frontend/admin-platform/AdminChuanHoa.js",
    ):
        assert not (root / relative).exists()
