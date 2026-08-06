"""Deterministic provider used by local smoke tests and automated tests."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from decimal import Decimal, InvalidOperation
import json
import re
from zoneinfo import ZoneInfo

from backend.ai.configuration import AiConfig


class FakeAdapter:
    def __init__(self, config: AiConfig):
        self.config = config

    def stream_response(
        self,
        *,
        input_items: list[dict],
        instructions: str,
        tools: list[dict],
    ) -> Iterable[dict]:
        del instructions
        direct_answer = _answer_from_tool_output(input_items)
        if direct_answer is not None:
            yield from _fake_answer_events(direct_answer)
            return
        latest_user = ""
        for item in reversed(input_items):
            if item.get("role") == "user":
                latest_user = str(item.get("content") or "")
                break
        function_output = next(
            (item for item in reversed(input_items) if item.get("type") == "function_call_output"),
            None,
        )
        if function_output and function_output.get("output"):
            text = (
                "Mình đã truy vấn dữ liệu trong workspace hiện tại. Backend đã tính số liệu "
                "deterministic và đính kèm bộ lọc cùng nguồn ở bên dưới."
            )
        else:
            tool_call = _fake_tool_call(latest_user, tools)
            if tool_call:
                yield from _fake_call_events(tool_call)
                return
            text = (
                "Mình có thể hỗ trợ tra cứu dữ liệu BiddingFlow, hướng dẫn thao tác và tư vấn "
                "có nguồn khi kho tài liệu đã được cấu hình."
            )
        yield {"type": "response.created", "response": {"id": "fake_response"}}
        for chunk in _chunks(text, 48):
            yield {"type": "response.output_text.delta", "delta": chunk}
        yield {
            "type": "response.completed",
            "response": {
                "output": [
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": text}],
                    }
                ],
                "usage": {"input_tokens": 0, "output_tokens": 0},
            },
        }


def _answer_from_tool_output(input_items: list[dict]) -> str | None:
    output_item = next(
        (item for item in reversed(input_items)
         if item.get('type') == 'function_call_output' and item.get('output')),
        None,
    )
    if output_item is None:
        return None
    try:
        payload = json.loads(str(output_item.get('output') or '{}'))
    except (json.JSONDecodeError, TypeError, ValueError):
        return 'Mình chưa đọc được kết quả dữ liệu. Vui lòng thử lại.'
    summary = payload.get('summary') if isinstance(payload, dict) else {}
    if not isinstance(summary, dict):
        summary = {}
    tool_call = next(
        (item for item in reversed(input_items) if item.get('type') == 'function_call'),
        {},
    )
    tool_name = str(tool_call.get('name') or '')
    question = next(
        (str(item.get('content') or '') for item in reversed(input_items) if item.get('role') == 'user'),
        '',
    ).casefold()
    count = _as_count(summary.get('recordCount'))
    if tool_name == 'describe_workspace_schema':
        return f'Workspace hiện có {count} bảng nghiệp vụ được phép tra cứu, kèm cột và quan hệ khóa ngoại.'
    if tool_name == 'query_workspace':
        entity_label = str(summary.get('entityLabel') or 'bản ghi')
        return _count_answer(count, entity_label)
    if tool_name == 'search_workspace':
        return _count_answer(count, str(summary.get('entityLabel') or 'record'))
    if tool_name in {'aggregate_packages', 'list_packages'}:
        if 'hôm nay' in question or 'hom nay' in question:
            if count == 0:
                return 'Hôm nay không có gói thầu nào cần mở thầu.'
            return f'Hôm nay có {count} gói thầu cần mở thầu.'
        return _count_answer(count, 'gói thầu')
    aggregate_value = summary.get('value')
    if tool_name == 'aggregate_contracts' and aggregate_value is not None:
        year = re.search(r'20\d{2}', question)
        period = f' năm {year.group(0)}' if year else ''
        return f'Tổng giá trị hợp đồng đã thanh lý{period} là {_format_currency(aggregate_value)} ₫.'
    nouns = {'list_plans': 'kế hoạch', 'aggregate_plans': 'kế hoạch',
             'list_contracts': 'hợp đồng', 'aggregate_contracts': 'hợp đồng'}
    return _count_answer(count, nouns.get(tool_name, 'bản ghi'))


def _as_count(value: object) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _count_answer(count: int, noun: str) -> str:
    if count == 0:
        return f'Không có {noun} nào phù hợp với yêu cầu.'
    return f'Có {count} {noun} phù hợp với yêu cầu.'


def _format_currency(value: object) -> str:
    try:
        amount = Decimal(str(value or 0))
    except (InvalidOperation, TypeError, ValueError):
        return str(value or 0)
    return f'{amount:,.0f}'.replace(',', '.')


def _fake_answer_events(text: str) -> Iterable[dict]:
    yield {'type': 'response.created', 'response': {'id': 'fake_response'}}
    for chunk in _chunks(text, 48):
        yield {'type': 'response.output_text.delta', 'delta': chunk}
    yield {
        'type': 'response.completed',
        'response': {
            'output': [{'type': 'message', 'role': 'assistant',
                        'content': [{'type': 'output_text', 'text': text}]}],
            'usage': {'input_tokens': 0, 'output_tokens': 0},
        },
    }


def _fake_call_events(tool_call: dict) -> Iterable[dict]:
    arguments = json.dumps(tool_call["arguments"], ensure_ascii=False, separators=(",", ":"))
    item = {
        "type": "function_call",
        "id": "fake_fc",
        "call_id": "fake_call",
        "name": tool_call["name"],
        "arguments": arguments,
    }
    yield {
        "type": "response.output_item.added",
        "output_index": 0,
        "item": {**item, "arguments": ""},
    }
    yield {"type": "response.function_call_arguments.delta", "output_index": 0, "delta": arguments}
    yield {
        "type": "response.function_call_arguments.done",
        "output_index": 0,
        "arguments": arguments,
        "item_id": "fake_fc",
    }
    yield {"type": "response.output_item.done", "output_index": 0, "item": item}
    yield {
        "type": "response.completed",
        "response": {
            "output": [item],
            "usage": {"input_tokens": 0, "output_tokens": 0},
        },
    }


def _chunks(value: str, size: int) -> Iterable[str]:
    for offset in range(0, len(value), size):
        yield value[offset : offset + size]


def _fake_tool_call(question: str, tools: list[dict]) -> dict | None:
    available = {item.get("name") for item in tools}
    lowered = question.casefold()
    today = datetime.now(ZoneInfo("Asia/Bangkok")).date().isoformat()
    if any(term in lowered for term in ("bảng trong db", "bảng trong database", "cột", "quan hệ bảng", "schema")) and "describe_workspace_schema" in available:
        return {
            "name": "describe_workspace_schema",
            "arguments": {"query": "", "includeRelationships": True, "limit": 50},
        }
    if "nhà thầu" in lowered and "query_workspace" in available and any(
        term in lowered for term in ("danh sách", "liệt kê", "tên", "mã số thuế", "địa chỉ", "email", "số điện thoại")
    ):
        fields = ["name", "code", "taxCode"]
        if "địa chỉ" in lowered:
            fields.append("address")
        if "email" in lowered:
            fields.append("email")
        return {
            "name": "query_workspace",
            "arguments": {
                "entity": "contractors",
                "operation": "list",
                "fields": fields,
                "query": "",
                "status": "",
                "packageId": "",
                "limit": 20,
            },
        }
    if "chủ đầu tư" in lowered and "query_workspace" in available and any(
        term in lowered for term in ("danh sách", "liệt kê", "tên", "mã số thuế", "địa chỉ", "email", "số điện thoại")
    ):
        fields = ["name", "code", "taxCode"]
        if "địa chỉ" in lowered:
            fields.append("address")
        if "email" in lowered:
            fields.append("email")
        return {
            "name": "query_workspace",
            "arguments": {
                "entity": "investors",
                "operation": "list",
                "fields": fields,
                "query": "",
                "status": "",
                "packageId": "",
                "limit": 20,
            },
        }
    if "nhà thầu" in lowered and "search_workspace" in available:
        return {
            "name": "search_workspace",
            "arguments": {"entity": "contractors", "operation": "count", "query": "", "status": "", "packageId": "", "limit": 20},
        }
    if "chủ đầu tư" in lowered and "search_workspace" in available:
        return {
            "name": "search_workspace",
            "arguments": {"entity": "investors", "operation": "count", "query": "", "status": "", "packageId": "", "limit": 20},
        }
    if "chuyên gia" in lowered and "search_workspace" in available:
        return {
            "name": "search_workspace",
            "arguments": {
                "entity": "experts",
                "operation": "count",
                "query": "",
                "status": "",
                "packageId": "",
                "limit": 20,
            },
        }
    if "hợp đồng" in lowered and "thanh lý" in lowered and "aggregate_contracts" in available:
        year = re.search(r"20\d{2}", question)
        selected_year = year.group(0) if year else str(datetime.now().year)
        return {
            "name": "aggregate_contracts",
            "arguments": {
                "metric": "sum_liquidation_value",
                "dateField": "liquidation_date",
                "dateFrom": f"{selected_year}-01-01",
                "dateTo": f"{selected_year}-12-31",
                "statuses": [],
                "groupBy": "none",
                "limit": 20,
            },
        }
    if ("hôm nay" in lowered or "hom nay" in lowered) and "aggregate_packages" in available:
        return {
            "name": "aggregate_packages",
            "arguments": {
                "metric": "count",
                "dateField": "thoi_gian_mo_thau",
                "dateFrom": today,
                "dateTo": today,
                "statuses": [],
                "groupBy": "none",
                "limit": 20,
            },
        }
    if "gói" in lowered and "aggregate_packages" in available:
        return {
            "name": "aggregate_packages",
            "arguments": {
                "metric": "count",
                "dateField": None,
                "dateFrom": None,
                "dateTo": None,
                "statuses": [],
                "groupBy": "none",
                "limit": 20,
            },
        }
    return None
