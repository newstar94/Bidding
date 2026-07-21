import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _role_contexts():
    system_user_uri = (ROOT / "frontend" / "admin" / "SystemUserView.js").resolve().as_uri()
    dashboard_uri = (ROOT / "frontend" / "app" / "DashboardView.js").resolve().as_uri()
    controller_uri = (ROOT / "frontend" / "app" / "BiddingControllerUI.js").resolve().as_uri()
    script = f"""
        import {{ getRoleUiContext }} from {json.dumps(system_user_uri)};
        import {{ getDashboardRoleContext }} from {json.dumps(dashboard_uri)};
        import {{ dashboardTitleForRole }} from {json.dumps(controller_uri)};
        process.stdout.write(JSON.stringify({{
          managerShell: getRoleUiContext("manager"),
          employeeShell: getRoleUiContext("employee"),
          managerDashboard: getDashboardRoleContext("manager"),
          employeeDashboard: getDashboardRoleContext("employee"),
          managerTitle: dashboardTitleForRole("manager"),
          employeeTitle: dashboardTitleForRole("employee")
        }}));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(result.stdout)


def test_redundant_role_context_blocks_are_not_rendered():
    header = (ROOT / "views" / "components" / "header.html").read_text(encoding="utf-8")
    sidebar = (ROOT / "views" / "components" / "sidebar.html").read_text(encoding="utf-8")
    dashboard = (ROOT / "views" / "tabs" / "tab_dashboard.html").read_text(encoding="utf-8")

    assert 'id="header-role-context"' not in header
    assert 'id="sidebar-role-context"' not in sidebar
    assert 'id="dashboard-role-hero"' not in dashboard
    assert 'id="dashboard-role-capabilities"' not in dashboard
    assert 'id="header-profile-role"' in header
    assert 'id="sidebar-dashboard-label"' in sidebar


def test_manager_navigation_is_placed_after_shared_work_navigation():
    sidebar = (ROOT / "views" / "components" / "sidebar.html").read_text(encoding="utf-8")

    assert sidebar.index("Điều hành đơn vị") > sidebar.index("Hệ thống mẫu")
    assert sidebar.index('data-tab="managernhanvien"') > sidebar.index('data-tab="bieumau"')


def test_module_permissions_belong_to_organization_manager_ui_only():
    superadmin_modal = (ROOT / "views" / "modals" / "modal_detail_system_user.html").read_text(encoding="utf-8")
    manager_tab = (ROOT / "views" / "tabs" / "tab_managernhanvien.html").read_text(encoding="utf-8")
    manager_view = (ROOT / "frontend" / "admin" / "SystemUserView.js").read_text(encoding="utf-8")
    admin_controller = (ROOT / "frontend" / "admin" / "AdminUserController.js").read_text(encoding="utf-8")

    assert "Quyền theo phân hệ" not in superadmin_modal
    assert "data-permission-module" not in superadmin_modal
    assert "permissions: organizationId" not in admin_controller
    assert "Thông tin mở thầu" not in manager_tab
    assert 'getCellHtml("thongtinmothau")' not in manager_view
    assert '["", "view", "edit"].includes(matrix[moduleName])' in manager_view
    assert "Không truy cập" in manager_view
    assert "Thêm / Sửa có điều kiện" in manager_view
    assert "chỉ được sửa công việc đã được phân công" in manager_tab
    assert "kiểm tra lại tại API" in manager_tab
    assert "Chuyên viên không được xóa kể cả dữ liệu do mình tạo" in manager_tab


def test_role_context_keeps_role_specific_navigation_language():
    contexts = _role_contexts()

    assert contexts["managerShell"]["label"] == "Quản lý"
    assert contexts["managerShell"]["dashboardLabel"] == "Tổng quan đơn vị"
    assert contexts["employeeShell"]["label"] == "Chuyên viên"
    assert contexts["employeeShell"]["dashboardLabel"] == "Công việc của tôi"


def test_dashboard_language_differs_by_role():
    contexts = _role_contexts()

    assert contexts["managerTitle"] == "Tổng quan đơn vị"
    assert contexts["employeeTitle"] == "Công việc của tôi"
    assert contexts["managerDashboard"]["alertsTitle"] == "Cảnh báo toàn đơn vị"
    assert contexts["employeeDashboard"]["alertsTitle"] == "Cảnh báo công việc của tôi"
    assert contexts["managerDashboard"]["recentTitle"] != contexts["employeeDashboard"]["recentTitle"]


def test_role_styles_have_semantic_tokens_and_responsive_rules():
    variables = (ROOT / "views" / "css" / "variables.css").read_text(encoding="utf-8")
    styles = (ROOT / "views" / "css" / "ui-redesign.css").read_text(encoding="utf-8")

    for token in ("--role-super-admin", "--role-manager", "--role-employee"):
        assert token in variables
    assert 'body[data-active-role="manager"]' in styles
    assert 'body[data-active-role="employee"]' in styles
    assert ".dashboard-role-hero" not in styles
    assert ".dashboard-role-capabilities" not in styles
    assert ".header-role-context" not in styles
    assert ".sidebar-role-context" not in styles
    assert "@media (max-width: 480px)" in styles
    assert "@media (prefers-reduced-motion: reduce)" in styles


def test_role_ui_plan_is_stored_with_acceptance_criteria():
    plan = (ROOT / "docs" / "ROLE_BASED_UI_DIFFERENTIATION_PLAN.md").read_text(encoding="utf-8")

    assert "# Kế hoạch phân biệt giao diện theo vai trò" in plan
    assert "## 7. Tiêu chí nghiệm thu" in plan
    assert "không được xóa" in plan.casefold()
