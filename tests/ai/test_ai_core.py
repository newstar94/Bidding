import json
import asyncio
import threading
import time
from pathlib import Path

import pytest

from backend.ai.client import ResponsesProvider, _iter_sse
from backend.ai.configuration import get_ai_config
from backend.ai.errors import AiError
from backend.ai.redaction import redact_json
from backend.ai.tool_registry import tool_definitions, validate_tool_arguments
from backend.analytics.semantic_registry import get_metric, supported_metrics
from backend.analytics.aggregation_engine import aggregate_entity, list_entity
from backend.ai.types import AiRequestContext
from backend.ai.metrics import render_prometheus_lines
from backend.ai.service import _PROVIDER_EVENT_QUEUE_SIZE, _provider_event_stream
from backend.ai import routes as ai_routes
from backend.ai import service as ai_service
from backend.ai.tools.reports import execute_report_tool
from backend.shared.domain_enums import CONTRACT_STATUS_LABELS, PACKAGE_STATUS_LABELS


def test_ai_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AI_ENABLED", raising=False)
    assert get_ai_config().enabled is False


def test_ai_config_reads_model_from_one_backend_setting(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_MODEL", "test-model")
    monkeypatch.setenv("AI_PROVIDER_STORE_RESPONSES", "false")
    config = get_ai_config()
    assert config.enabled is True
    assert config.model == "test-model"
    assert config.provider_store_responses is False


def test_tool_schemas_are_strict_and_read_only():
    definitions = tool_definitions("data")
    assert definitions
    assert all(item["parameters"]["additionalProperties"] is False for item in definitions)
    assert not any(item["name"].startswith(("create_", "update_", "delete_")) for item in definitions)


def test_contract_status_tools_preserve_workspace_defined_labels():
    definitions = {item["name"]: item for item in tool_definitions("data")}

    aggregate_statuses = definitions["aggregate_contracts"]["parameters"]["properties"]["statuses"]
    list_status = definitions["list_contracts"]["parameters"]["properties"]["status"]
    search_status = definitions["search_workspace"]["parameters"]["properties"]["status"]
    query_status = definitions["query_workspace"]["parameters"]["properties"]["status"]

    assert all(
        "người dùng tự đặt" in schema["description"]
        for schema in (aggregate_statuses, list_status, search_status, query_status)
    )


def test_tool_arguments_reject_unknown_scope_fields():
    with pytest.raises(AiError) as error:
        validate_tool_arguments(
            "data",
            "aggregate_contracts",
            {
                "metric": "sum_contract_value",
                "dateField": "signed_date",
                "dateFrom": None,
                "dateTo": None,
                "statuses": [],
                "groupBy": "none",
                "limit": 20,
                "organization_id": "other-org",
            },
        )
    assert error.value.code == "AI_TOOL_INVALID_ARGUMENTS"


def test_semantic_registry_is_static():
    assert "sum_liquidation_value" in supported_metrics("contracts")
    metric = get_metric("contracts", "sum_liquidation_value")
    assert metric.value_column == "gia_tri"
    assert metric.date_column == "ngay_thanh_ly"
    with pytest.raises(ValueError):
        get_metric("contracts", "sum_sql_fragment")


def test_redaction_removes_secrets_and_keeps_bounded_shape():
    value = redact_json({"api_key": "hidden", "mode": "data", "nested": {"password": "secret"}})
    assert "hidden" not in value
    assert "secret" not in value
    assert "data" in value


def test_fake_provider_streams_without_network(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "fake")
    config = get_ai_config()
    provider = ResponsesProvider(config)
    tools = [{"name": "aggregate_packages"}]
    events = list(provider.stream_response(input_items=[{"role": "user", "content": "Có bao nhiêu gói?"}], instructions="", tools=tools))
    assert any(event["type"] == "response.function_call_arguments.done" for event in events)


def test_provider_event_stream_completes_and_forwards_events():
    class Provider:
        adapter = None

        def stream_response(self, **_kwargs):
            yield {"type": "one"}
            yield {"type": "two"}

    async def collect():
        return [event async for event in _provider_event_stream(Provider(), [], "", [])]

    assert asyncio.run(collect()) == [{"type": "one"}, {"type": "two"}]


def test_provider_worker_limit_fails_without_spawning_another_thread(monkeypatch):
    class FullSlots:
        def acquire(self, **_kwargs):
            return False

    monkeypatch.setattr(ai_service, "_PROVIDER_THREAD_SLOTS", FullSlots())
    with pytest.raises(AiError) as error:
        ai_service._provider_event_stream(object(), [], "", [])
    assert error.value.code == "AI_PROVIDER_UNAVAILABLE"


def test_provider_event_stream_forwards_provider_exception():
    class Provider:
        adapter = None

        def stream_response(self, **_kwargs):
            yield {"type": "before-error"}
            raise ValueError("provider failed")

    async def collect():
        stream = _provider_event_stream(Provider(), [], "", [])
        assert await anext(stream) == {"type": "before-error"}
        with pytest.raises(AiError) as error:
            await anext(stream)
        return error.value.code

    assert asyncio.run(collect()) == "AI_PROVIDER_UNAVAILABLE"


def test_provider_event_stream_cancellation_stops_worker_and_calls_abort():
    stopped = threading.Event()

    class Provider:
        adapter = None

        def __init__(self):
            self.aborted = threading.Event()
            self.produced = 0

        def abort(self):
            self.aborted.set()

        def stream_response(self, **_kwargs):
            try:
                while not self.aborted.is_set():
                    self.produced += 1
                    yield {"index": self.produced}
            finally:
                stopped.set()

    provider = Provider()

    async def cancel_early():
        stream = _provider_event_stream(provider, [], "", [])
        await anext(stream)
        await stream.aclose()

    asyncio.run(cancel_early())
    assert provider.aborted.wait(1)
    assert stopped.wait(1)
    assert provider.produced <= _PROVIDER_EVENT_QUEUE_SIZE + 2


def test_repeated_provider_disconnects_do_not_accumulate_workers():
    baseline = sum(
        thread.name == "bidding-ai-provider" for thread in threading.enumerate()
    )

    class Provider:
        adapter = None

        def __init__(self):
            self.cancelled = threading.Event()

        def cancel(self):
            self.cancelled.set()

        def stream_response(self, **_kwargs):
            while not self.cancelled.is_set():
                yield {"type": "delta"}

    async def disconnect(provider):
        stream = _provider_event_stream(provider, [], "", [])
        await anext(stream)
        await stream.aclose()

    for _ in range(12):
        asyncio.run(disconnect(Provider()))
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        active = sum(
            thread.name == "bidding-ai-provider" for thread in threading.enumerate()
        )
        if active <= baseline:
            break
        time.sleep(0.01)
    assert active <= baseline


def test_ai_route_disconnect_closes_stream_and_releases_active_metric(monkeypatch):
    closed = threading.Event()
    increments = []

    class Request:
        path_params = {"conversation_id": "conversation-1"}

        async def is_disconnected(self):
            return True

    async def provider_stream(*_args, **_kwargs):
        try:
            await asyncio.sleep(10)
            yield {"type": "never-reached"}
        finally:
            closed.set()

    context = AiRequestContext(
        user_id="user-1",
        organization_id="org-1",
        organization_name="HTD",
        platform_role="user",
        membership_role="manager",
        scope_type="organization",
        active_role="manager",
        permissions={"goithau": "view"},
    )
    monkeypatch.setattr(ai_routes, "_context_or_response", lambda _request: asyncio.sleep(0, result=(context, None)))
    async def read_json(_request):
        return {"content": "hello", "route": "/"}, None

    monkeypatch.setattr(ai_routes, "read_json_object", read_json)
    monkeypatch.setattr(ai_routes, "run_database_read", lambda *args, **kwargs: asyncio.sleep(0, result=None))
    monkeypatch.setattr(ai_routes, "run_database_write", lambda *args, **kwargs: asyncio.sleep(0, result=None))
    monkeypatch.setattr(ai_routes, "stream_message", provider_stream)
    monkeypatch.setattr(ai_routes, "increment", lambda name, value=1: increments.append((name, value)))

    async def consume_response():
        response = await ai_routes.send_ai_message_api(Request())
        async for _chunk in response.body_iterator:
            pass

    asyncio.run(consume_response())
    assert closed.wait(1)
    assert ("ai_active_streams", 1) in increments
    assert ("ai_active_streams", -1) in increments


def test_fake_provider_uses_workspace_search_for_unmodeled_business_entities(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "fake")
    events = list(
        ResponsesProvider(get_ai_config()).stream_response(
            input_items=[{"role": "user", "content": "Hiện tại có mấy chuyên gia?"}],
            instructions="",
            tools=tool_definitions("data"),
        )
    )
    done = next(event for event in events if event["type"] == "response.function_call_arguments.done")
    assert json.loads(done["arguments"]) == {
        "entity": "experts",
        "operation": "count",
        "query": "",
        "status": "",
        "packageId": "",
        "limit": 20,
    }


def test_fake_provider_uses_schema_tool_for_schema_questions(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "fake")
    events = list(
        ResponsesProvider(get_ai_config()).stream_response(
            input_items=[{"role": "user", "content": "Liệt kê các bảng, cột và quan hệ trong database"}],
            instructions="",
            tools=tool_definitions("data"),
        )
    )
    done = next(event for event in events if event["type"] == "response.function_call_arguments.done")
    assert next(event for event in events if event["type"] == "response.output_item.done")["item"]["name"] == "describe_workspace_schema"
    assert json.loads(done["arguments"]) == {
        "query": "",
        "includeRelationships": True,
        "limit": 50,
    }


def test_fake_provider_uses_structured_query_for_explicit_workspace_fields(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "fake")
    events = list(
        ResponsesProvider(get_ai_config()).stream_response(
            input_items=[{"role": "user", "content": "Liệt kê tên và mã số thuế nhà thầu"}],
            instructions="",
            tools=tool_definitions("data"),
        )
    )
    done = next(event for event in events if event["type"] == "response.function_call_arguments.done")
    assert json.loads(done["arguments"]) == {
        "entity": "contractors",
        "operation": "list",
        "fields": ["name", "code", "taxCode"],
        "query": "",
        "status": "",
        "packageId": "",
        "limit": 20,
    }


def test_fake_provider_answers_tool_result_without_filter_metadata(monkeypatch):
    monkeypatch.setenv('AI_PROVIDER', 'fake')
    items = [{'role': 'user', 'content': 'Hom nay co may goi can mo thau?'},
             {'type': 'function_call', 'name': 'aggregate_packages'},
             {'type': 'function_call_output', 'output': json.dumps({'summary': {'recordCount': 0}})}]
    events = list(ResponsesProvider(get_ai_config()).stream_response(
        input_items=items, instructions='', tools=[]))
    answer = ''.join(event.get('delta', '') for event in events)
    assert answer == 'H\u00f4m nay kh\u00f4ng c\u00f3 g\u00f3i th\u1ea7u n\u00e0o c\u1ea7n m\u1edf th\u1ea7u.'


def test_sse_parser_handles_typed_events():
    class Response:
        def __iter__(self):
            yield b"event: response.output_text.delta\n"
            yield b'data: {"type":"response.output_text.delta","delta":"Xin chao"}\n'
            yield b"\n"

    assert list(_iter_sse(Response())) == [{"type": "response.output_text.delta", "delta": "Xin chao"}]


def test_aggregate_without_group_returns_summary_without_group_key_lookup():
    class Cursor:
        def execute(self, _query, _parameters):
            return self

        def fetchall(self):
            return [{"record_count": 3, "aggregate_value": 0}]

    context = AiRequestContext(
        user_id="user-1",
        organization_id="org-1",
        organization_name="Smoke workspace",
        platform_role="user",
        membership_role="manager",
        scope_type="organization",
        active_role="manager",
        permissions={"goithau": "view"},
    )
    result = aggregate_entity(
        Cursor(),
        context,
        "packages",
        {
            "metric": "count",
            "dateField": None,
            "dateFrom": None,
            "dateTo": None,
            "statuses": [],
            "groupBy": "none",
            "limit": 20,
        },
    )
    assert result.summary["recordCount"] == 3
    assert result.records == []


@pytest.mark.parametrize(
    ("entity", "permission", "table_name"),
    [
        ("packages", "goithau", "goi_thau"),
        ("plans", "kehoach", "ke_hoach_lcnt"),
        ("contracts", "hopdong", "hop_dong"),
    ],
)
def test_ai_list_and_aggregate_share_latest_only_semantics(
    entity, permission, table_name
):
    class Cursor:
        def __init__(self):
            self.queries = []

        def execute(self, query, parameters):
            self.queries.append((" ".join(str(query).split()), tuple(parameters)))
            return self

        def fetchall(self):
            if "aggregate_value" in self.queries[-1][0]:
                return [{"record_count": 1, "aggregate_value": 0}]
            return []

    context = AiRequestContext(
        user_id="user-1",
        organization_id="org-1",
        organization_name="HTD",
        platform_role="user",
        membership_role="manager",
        scope_type="organization",
        active_role="manager",
        permissions={permission: "view"},
    )
    cursor = Cursor()
    aggregate_entity(
        cursor,
        context,
        entity,
        {
            "metric": "count",
            "dateField": None,
            "dateFrom": None,
            "dateTo": None,
            "statuses": [],
            "groupBy": "none",
            "limit": 20,
        },
    )
    list_entity(
        cursor,
        context,
        entity,
        {
            "dateField": None,
            "dateFrom": None,
            "dateTo": None,
            "status": "",
            "limit": 20,
        },
    )

    assert all(
        f"{table_name}.is_latest = 1" in query
        for query, _parameters in cursor.queries
    )


@pytest.mark.parametrize(
    ("entity", "permission", "provided_status", "query_status"),
    [
        *(("packages", "goithau", label, code) for code, label in PACKAGE_STATUS_LABELS.items()),
        *(("packages", "goithau", label.lower(), code) for code, label in PACKAGE_STATUS_LABELS.items()),
        *(("packages", "goithau", code.lower(), code) for code in PACKAGE_STATUS_LABELS),
        *(("contracts", "hopdong", label, label) for label in CONTRACT_STATUS_LABELS.values()),
        *(("contracts", "hopdong", label.lower(), label.lower()) for label in CONTRACT_STATUS_LABELS.values()),
        ("contracts", "hopdong", "Chờ nghiệm thu nội bộ", "Chờ nghiệm thu nội bộ"),
        ("plans", "kehoach", "kế hoạch", "Kế hoạch"),
        ("plans", "kehoach", "DỰ TOÁN VÀ KẾ HOẠCH", "Dự toán và kế hoạch"),
        ("packages", "goithau", "huy thau", "CANCELLED"),
    ],
)
def test_aggregate_normalizes_every_supported_status(
    entity,
    permission,
    provided_status,
    query_status,
):
    class Cursor:
        def __init__(self):
            self.parameters = ()
            self.query = ""

        def execute(self, query, parameters):
            self.query = " ".join(str(query).split())
            self.parameters = tuple(parameters)
            return self

        def fetchall(self):
            return [{"record_count": 4, "aggregate_value": 0}]

    cursor = Cursor()
    result = aggregate_entity(
        cursor,
        AiRequestContext(
            user_id="user-1",
            organization_id="org-1",
            organization_name="HTD",
            platform_role="user",
            membership_role="manager",
            scope_type="organization",
            active_role="manager",
            permissions={permission: "view"},
        ),
        entity,
        {
            "metric": "count",
            "dateField": None,
            "dateFrom": None,
            "dateTo": None,
            "statuses": [provided_status],
            "groupBy": "none",
            "limit": 20,
        },
    )

    assert result.summary["recordCount"] == 4
    assert query_status in cursor.parameters
    if entity == "contracts":
        assert "LOWER(hop_dong.trang_thai_hop_dong) IN (LOWER(?))" in cursor.query


def test_ai_metrics_expose_required_duration_series():
    metrics = "\n".join(render_prometheus_lines())
    assert "ai_request_duration_seconds" in metrics
    assert "ai_tool_duration_seconds" in metrics


def test_dashboard_tool_validates_year_before_querying():
    with pytest.raises(AiError) as error:
        execute_report_tool(None, None, "get_organization_dashboard", {"year": 1999})
    assert error.value.code == "AI_TOOL_INVALID_ARGUMENTS"


def test_evaluation_dataset_has_one_hundred_cases():
    path = Path(__file__).with_name("evaluation_dataset.jsonl")
    cases = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(cases) >= 100
    assert len({case["id"] for case in cases}) == len(cases)
