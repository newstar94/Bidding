"""Small Responses API client abstraction with a deterministic fake provider."""

from __future__ import annotations

from datetime import datetime
import json
import re
import urllib.error
import urllib.request
from typing import Iterable
from zoneinfo import ZoneInfo

from backend.ai.configuration import AiConfig
from backend.ai.errors import ai_error


class ResponsesProvider:
    def __init__(self, config: AiConfig):
        self.config = config

    def stream_response(self, *, input_items: list[dict], instructions: str, tools: list[dict]) -> Iterable[dict]:
        if self.config.provider == "fake":
            yield from self._fake_stream(input_items, tools)
            return
        if not self.config.api_key:
            raise ai_error("AI_PROVIDER_UNAVAILABLE", "AI provider chưa được cấu hình API key ở backend.")
        body = {
            "model": self.config.model,
            "input": input_items,
            "instructions": instructions,
            "tools": tools,
            "parallel_tool_calls": False,
            "max_output_tokens": self.config.max_output_tokens,
            "store": self.config.provider_store_responses,
            "stream": True,
        }
        request = urllib.request.Request(
            f"{self.config.base_url}/responses",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.config.request_timeout_seconds) as response:
                yield from _iter_sse(response)
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                raise ai_error("AI_RATE_LIMITED", "AI provider đang giới hạn tần suất.") from exc
            if exc.code in {408, 504}:
                raise ai_error("AI_PROVIDER_TIMEOUT", "AI provider phản hồi quá thời gian.") from exc
            raise ai_error("AI_PROVIDER_UNAVAILABLE", "AI provider tạm thời không khả dụng.") from exc
        except TimeoutError as exc:
            raise ai_error("AI_PROVIDER_TIMEOUT", "AI provider phản hồi quá thời gian.") from exc
        except OSError as exc:
            raise ai_error("AI_PROVIDER_UNAVAILABLE", "Không thể kết nối AI provider.") from exc

    def _fake_stream(self, input_items: list[dict], tools: list[dict]) -> Iterable[dict]:
        latest_user = ""
        for item in reversed(input_items):
            if item.get("role") == "user":
                latest_user = str(item.get("content") or "")
                break
        function_output = next((item for item in reversed(input_items) if item.get("type") == "function_call_output"), None)
        if function_output and function_output.get("output"):
            text = "Mình đã truy vấn dữ liệu trong workspace hiện tại. Backend đã tính số liệu deterministic và đính kèm bộ lọc cùng nguồn ở bên dưới."
        else:
            tool_call = _fake_tool_call(latest_user, tools)
            if tool_call:
                yield {"type": "response.output_item.added", "output_index": 0, "item": {"type": "function_call", "id": "fake_fc", "call_id": "fake_call", "name": tool_call["name"], "arguments": ""}}
                arguments = json.dumps(tool_call["arguments"], ensure_ascii=False, separators=(",", ":"))
                yield {"type": "response.function_call_arguments.delta", "output_index": 0, "delta": arguments}
                yield {"type": "response.function_call_arguments.done", "output_index": 0, "arguments": arguments, "item_id": "fake_fc"}
                yield {"type": "response.output_item.done", "output_index": 0, "item": {"type": "function_call", "id": "fake_fc", "call_id": "fake_call", "name": tool_call["name"], "arguments": arguments}}
                yield {"type": "response.completed", "response": {"output": [{"type": "function_call", "id": "fake_fc", "call_id": "fake_call", "name": tool_call["name"], "arguments": arguments}]}}
                return
            text = "Mình có thể hỗ trợ tra cứu dữ liệu BiddingFlow, hướng dẫn thao tác và tư vấn có nguồn khi kho tài liệu đã được cấu hình."
        yield {"type": "response.created", "response": {"id": "fake_response"}}
        for chunk in _chunks(text, 48):
            yield {"type": "response.output_text.delta", "delta": chunk}
        yield {"type": "response.completed", "response": {"output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}]}}


def _chunks(value: str, size: int) -> Iterable[str]:
    for offset in range(0, len(value), size):
        yield value[offset:offset + size]


def _fake_tool_call(question: str, tools: list[dict]) -> dict | None:
    available = {item.get("name") for item in tools}
    lowered = question.casefold()
    today = datetime.now(ZoneInfo("Asia/Bangkok")).date().isoformat()
    if "hợp đồng" in lowered and "thanh lý" in lowered and "aggregate_contracts" in available:
        year = re.search(r"20\d{2}", question)
        selected_year = year.group(0) if year else str(datetime.now().year)
        return {"name": "aggregate_contracts", "arguments": {"metric": "sum_liquidation_value", "dateField": "liquidation_date", "dateFrom": f"{selected_year}-01-01", "dateTo": f"{selected_year}-12-31", "statuses": [], "groupBy": "none", "limit": 20}}
    if ("hôm nay" in lowered or "hom nay" in lowered) and "aggregate_packages" in available:
        return {"name": "aggregate_packages", "arguments": {"metric": "count", "dateField": "thoi_gian_mo_thau", "dateFrom": today, "dateTo": today, "statuses": [], "groupBy": "none", "limit": 20}}
    if "gói" in lowered and "aggregate_packages" in available:
        return {"name": "aggregate_packages", "arguments": {"metric": "count", "dateField": None, "dateFrom": None, "dateTo": None, "statuses": [], "groupBy": "none", "limit": 20}}
    return None


def _iter_sse(response) -> Iterable[dict]:
    data_lines: list[str] = []
    for raw_line in response:
        line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
            continue
        if line or not data_lines:
            continue
        payload = "\n".join(data_lines)
        data_lines = []
        if payload == "[DONE]":
            return
        try:
            value = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            yield value
    if data_lines:
        try:
            value = json.loads("\n".join(data_lines))
        except json.JSONDecodeError:
            return
        if isinstance(value, dict):
            yield value
