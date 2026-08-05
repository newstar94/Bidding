"""Deterministic provider used by local smoke tests and automated tests."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
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

