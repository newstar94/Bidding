import pytest

from backend.ai.errors import AiError
from backend.ai.tool_registry import tool_definitions, validate_tool_arguments
from backend.ai.types import AiRequestContext
from backend.ai.workspace_search import search_workspace_records


def context(*, permissions=None, membership_role="manager"):
    return AiRequestContext(
        user_id="user-1",
        organization_id="org-1",
        organization_name="HTD",
        platform_role="user",
        membership_role=membership_role,
        scope_type="organization",
        active_role=membership_role,
        permissions=permissions or {
            "chuyengia": "view",
            "goithau": "view",
            "kehoach": "view",
            "hopdong": "view",
            "nhathau": "view",
            "chudautu": "view",
            "thongtinmothau": "view",
        },
    )


class Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.statement = ""
        self.parameters = ()

    def execute(self, statement, parameters=()):
        self.statement = " ".join(str(statement).split())
        self.parameters = tuple(parameters)
        return self

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


def test_workspace_search_counts_experts_in_current_workspace():
    cursor = Cursor([{"record_count": 7}])

    result = search_workspace_records(
        cursor,
        context(),
        {"entity": "experts", "operation": "count", "query": "", "status": "", "packageId": "", "limit": 20},
    )

    assert result.summary == {"recordCount": 7, "entity": "experts", "entityLabel": "chuyên gia"}
    assert "FROM chuyen_gia" in cursor.statement
    assert "organization_id = ?" in cursor.statement
    assert "is_latest = 1" in cursor.statement
    assert "so_cccd" not in cursor.statement
    assert "org-1" in cursor.parameters


def test_workspace_search_counts_cancelled_packages_from_vietnamese_status_label():
    cursor = Cursor([{"record_count": 4}])

    result = search_workspace_records(
        cursor,
        context(),
        {
            "entity": "packages",
            "operation": "count",
            "query": "",
            "status": "Hủy thầu",
            "packageId": "",
            "limit": 20,
        },
    )

    assert result.summary["recordCount"] == 4
    assert "record.trang_thai = ?" in cursor.statement
    assert "CANCELLED" in cursor.parameters
    assert "Hủy thầu" not in cursor.parameters


def test_workspace_search_treats_provider_wildcards_as_empty_filters():
    cursor = Cursor([{"record_count": 7}])

    result = search_workspace_records(
        cursor,
        context(),
        {"entity": "experts", "operation": "count", "query": "*", "status": "*", "packageId": "*", "limit": 20},
    )

    assert result.summary["recordCount"] == 7
    assert "LIKE ?" not in cursor.statement
    assert cursor.parameters == ("org-1",)


def test_workspace_search_lists_safe_expert_fields_and_source_link():
    cursor = Cursor(
        [
            {
                "id": "cg-1",
                "ho_ten": "Nguyễn Văn A",
                "so_chung_chi": "CC-01",
                "ngay_cap_chung_chi": "2025-01-02",
                "don_vi_cap_chung_chi": "Bộ Xây dựng",
            }
        ]
    )

    result = search_workspace_records(
        cursor,
        context(),
        {"entity": "experts", "operation": "list", "query": "Nguyễn", "status": "", "packageId": "", "limit": 20},
    )

    assert result.records == [
        {
            "id": "cg-1",
            "name": "Nguyễn Văn A",
            "certificateNumber": "CC-01",
            "certificateIssuedDate": "2025-01-02",
            "certificateIssuer": "Bộ Xây dựng",
        }
    ]
    assert result.source_links == [{"type": "list", "label": "Mở danh sách chuyên gia", "url": "/chuyen-gia"}]
    assert "LIKE ?" in cursor.statement
    assert "%nguyễn%" in cursor.parameters


def test_workspace_search_requires_module_permission():
    with pytest.raises(AiError) as error:
        search_workspace_records(
            Cursor([]),
            context(permissions={"goithau": "view"}),
            {"entity": "experts", "operation": "count", "query": "", "status": "", "packageId": "", "limit": 20},
        )
    assert error.value.code == "AI_PERMISSION_DENIED"


def test_workspace_search_is_the_only_generic_data_tool():
    data_names = {item["name"] for item in tool_definitions("data")}
    assert "search_workspace" in data_names
    search_definition = next(item for item in tool_definitions("data") if item["name"] == "search_workspace")
    entities = search_definition["parameters"]["properties"]["entity"]["enum"]
    assert {"experts", "contractors", "investors", "packages", "plans", "contracts"}.issubset(entities)
    assert "search_workspace" not in {item["name"] for item in tool_definitions("app_help")}
    assert "search_workspace" not in {item["name"] for item in tool_definitions("procurement_advice")}

    arguments = {"entity": "experts", "operation": "count", "query": "", "status": "", "packageId": "", "limit": 20}
    assert validate_tool_arguments("data", "search_workspace", arguments) == arguments
