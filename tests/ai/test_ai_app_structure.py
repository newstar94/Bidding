from backend.ai.app_structure import search_app_structure
from backend.ai.tools import tool_definitions_for_mode
from backend.ai.types import AiRequestContext


def context(*, platform_role="employee"):
    return AiRequestContext(
        user_id="user-1",
        organization_id="org-1",
        organization_name="HCP",
        platform_role=platform_role,
        membership_role="employee",
        scope_type="organization",
        permissions={
            "kehoach": "view",
            "goithau": "view",
            "hopdong": "view",
            "chudautu": "view",
            "nhathau": "view",
            "chuyengia": "view",
        },
    )


def test_app_help_exposes_structure_search_tool_only_for_app_help():
    app_help_names = {item["name"] for item in tool_definitions_for_mode("app_help")}
    data_names = {item["name"] for item in tool_definitions_for_mode("data")}
    procurement_names = {item["name"] for item in tool_definitions_for_mode("procurement_advice")}

    assert "search_app_structure" in app_help_names
    assert "search_app_structure" not in data_names
    assert "search_app_structure" not in procurement_names


def test_app_structure_search_discovers_routes_from_application_files():
    result = search_app_structure(context(), "gói thầu", current_route="/tong-quan", limit=5)

    assert result.tool_name == "search_app_structure"
    assert any(record["route"] == "/goi-thau" for record in result.records)
    assert any("Gói thầu" in record["title"] for record in result.records)
    assert all("records" not in record for record in result.records)


def test_app_structure_search_prefers_list_route_for_create_questions():
    result = search_app_structure(context(), "tạo gói thầu mới", current_route="/tong-quan", limit=5)

    assert result.records[0]["route"] == "/goi-thau"


def test_app_structure_search_filters_admin_routes_for_non_admin_users():
    result = search_app_structure(context(), "quản lý tài khoản", current_route="/tong-quan", limit=5)

    assert not any(record["route"] == "/quan-ly-tai-khoan" for record in result.records)
