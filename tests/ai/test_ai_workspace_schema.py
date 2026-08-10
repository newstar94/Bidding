import pytest

from backend.ai.errors import AiError
from backend.ai.tool_registry import tool_definitions, validate_tool_arguments
from backend.ai.types import AiRequestContext
from backend.ai.workspace_schema import describe_workspace_schema, query_workspace_records


def _context(permissions=None):
    return AiRequestContext(
        user_id="manager-1",
        organization_id="org-1",
        organization_name="HTD",
        platform_role="user",
        membership_role="manager",
        scope_type="organization",
        active_role="manager",
        permissions=permissions or {
            "kehoach": "edit",
            "goithau": "edit",
            "hopdong": "edit",
            "nhathau": "edit",
            "chudautu": "edit",
            "chuyengia": "edit",
            "thongtinmothau": "edit",
        },
    )


def test_schema_describes_business_columns_and_foreign_key_relationships():
    result = describe_workspace_schema(_context(), query="goi_thau", include_relationships=True, limit=10)

    package = next(record for record in result.records if record["entity"] == "packages")
    assert package["table"] == "goi_thau"
    assert {"id", "ke_hoach_id", "nha_thau_trung_thau_id"}.issubset(package["columns"])
    targets = {item["targetEntity"] for item in package["relationships"]}
    assert {"plans", "contractors"}.issubset(targets)


def test_schema_only_exposes_tables_with_current_module_permission():
    with pytest.raises(AiError) as error:
        describe_workspace_schema(_context({"goithau": "view"}), query="chu_dau_tu", include_relationships=True, limit=10)

    assert error.value.code == "AI_SCHEMA_NOT_FOUND"


def test_schema_tool_is_data_only_and_has_strict_arguments():
    names = {item["name"] for item in tool_definitions("data")}
    assert "describe_workspace_schema" in names
    arguments = {"query": "", "includeRelationships": True, "limit": 50}
    assert validate_tool_arguments("data", "describe_workspace_schema", arguments) == arguments


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


def test_query_workspace_selects_allowlisted_columns_and_keeps_organization_scope():
    cursor = Cursor([{"name": "HTD", "taxCode": "0101"}])

    result = query_workspace_records(
        cursor,
        _context(),
        {
            "entity": "investors",
            "operation": "list",
            "fields": ["name", "taxCode"],
            "query": "",
            "status": "",
            "packageId": "",
            "limit": 20,
        },
    )

    assert result.records == [{"name": "HTD", "taxCode": "0101"}]
    assert "SELECT record.ten_chu_dau_tu AS \"name\", record.ma_so_thue AS \"taxCode\"" in cursor.statement
    assert "FROM chu_dau_tu AS record" in cursor.statement
    assert "record.organization_id = ?" in cursor.statement
    assert cursor.parameters == ("org-1", 20)


def test_query_workspace_normalizes_vietnamese_cancelled_package_status():
    cursor = Cursor([{"record_count": 4}])

    result = query_workspace_records(
        cursor,
        _context(),
        {
            "entity": "packages",
            "operation": "count",
            "fields": [],
            "query": "",
            "status": "Hủy thầu",
            "packageId": "",
            "limit": 20,
        },
    )

    assert result.summary["recordCount"] == 4
    assert "CANCELLED" in cursor.parameters
    assert "Hủy thầu" not in cursor.parameters


def test_query_workspace_rejects_fields_outside_schema():
    with pytest.raises(AiError) as error:
        query_workspace_records(
            Cursor([]),
            _context(),
            {
                "entity": "investors",
                "operation": "list",
                "fields": ["password"],
                "query": "",
                "status": "",
                "packageId": "",
                "limit": 20,
            },
        )

    assert error.value.code == "AI_TOOL_INVALID_ARGUMENTS"


def test_query_workspace_is_registered_with_bounded_arguments():
    names = {item["name"] for item in tool_definitions("data")}
    assert "query_workspace" in names
    arguments = {
        "entity": "investors",
        "operation": "list",
        "fields": ["name", "taxCode"],
        "query": "",
        "status": "",
        "packageId": "",
        "limit": 50,
    }
    assert validate_tool_arguments("data", "query_workspace", arguments) == arguments

    with pytest.raises(AiError) as error:
        validate_tool_arguments(
            "data",
            "query_workspace",
            {**arguments, "limit": 51},
        )
    assert error.value.code == "AI_TOOL_INVALID_ARGUMENTS"
