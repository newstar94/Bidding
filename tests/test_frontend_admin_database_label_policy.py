from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_super_admin_package_features_use_postgresql_label():
    source = (ROOT / "frontend/admin/SystemUserView.js").read_text(encoding="utf-8")
    dashboard = (ROOT / "views/tabs/tab_superadmin_dashboard.html").read_text(encoding="utf-8")
    panel = (ROOT / "views/tabs/tab_superadmin.html").read_text(encoding="utf-8")

    assert "Đồng bộ dữ liệu PostgreSQL tự động" in source
    assert "Đồng bộ dữ liệu SQLite động" not in source
    assert "Trạng thái CSDL" in dashboard
    assert "(PostgreSQL)" in dashboard
    assert "(SQLite)" not in dashboard
    assert "Đồng bộ dữ liệu PostgreSQL tự động" in panel
    assert "Đồng bộ dữ liệu SQLite" not in panel


def test_super_admin_recent_organization_table_uses_matching_render_target():
    source = (ROOT / "frontend/app/DashboardView.js").read_text(encoding="utf-8")
    dashboard = (ROOT / "views/tabs/tab_superadmin_dashboard.html").read_text(encoding="utf-8")

    assert 'id="sad-recent-orgs-tbody"' in dashboard
    assert 'getElementById("sad-recent-orgs-tbody")' in source
    assert "sa-org-list-tbody" not in source
