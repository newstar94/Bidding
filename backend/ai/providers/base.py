"""Shared provider contract, transport, and canonical response helpers."""

from __future__ import annotations

from collections.abc import Iterable
import json
import socket
from typing import Protocol
import urllib.error
import urllib.parse
import urllib.request

from backend.ai.configuration import AiConfig
from backend.ai.errors import ai_error


class ProviderAdapter(Protocol):
    """Stable seam consumed by the conversation service."""

    def stream_response(
        self,
        *,
        input_items: list[dict],
        instructions: str,
        tools: list[dict],
    ) -> Iterable[dict]: ...


def require_api_key(config: AiConfig) -> str:
    if not config.api_key:
        raise ai_error(
            "AI_PROVIDER_UNAVAILABLE",
            "AI provider chưa được cấu hình API key ở backend.",
        )
    return config.api_key


def require_model(config: AiConfig) -> str:
    if not config.model:
        raise ai_error(
            "AI_PROVIDER_UNAVAILABLE",
            "AI provider chưa được cấu hình AI_MODEL ở backend.",
        )
    return config.model


def endpoint(base_url: str, suffix: str) -> str:
    base = str(base_url or "").strip().rstrip("/")
    normalized_suffix = str(suffix or "").strip("/")
    if not normalized_suffix:
        return base
    if base.casefold().endswith(f"/{normalized_suffix.casefold()}"):
        return base
    return f"{base}/{normalized_suffix}"


def add_query(url: str, **values: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    query.update({key: value for key, value in values.items() if value})
    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(query), parsed.fragment)
    )


def json_request(url: str, body: dict, headers: dict[str, str]) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        headers=headers,
        method="POST",
    )


def stream_http(
    request: urllib.request.Request,
    *,
    timeout_seconds: int,
    parser,
) -> Iterable[dict]:
    """Open a bounded HTTP stream and map transport errors to the public contract."""

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            yield from parser(response)
    except urllib.error.HTTPError as exc:
        try:
            if exc.code == 429:
                raise ai_error("AI_RATE_LIMITED", "AI provider đang giới hạn tần suất.") from exc
            if exc.code in {408, 504}:
                raise ai_error("AI_PROVIDER_TIMEOUT", "AI provider phản hồi quá thời gian.") from exc
            raise ai_error("AI_PROVIDER_UNAVAILABLE", "AI provider tạm thời không khả dụng.") from exc
        finally:
            exc.close()
    except (TimeoutError, socket.timeout) as exc:
        raise ai_error("AI_PROVIDER_TIMEOUT", "AI provider phản hồi quá thời gian.") from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise ai_error("AI_PROVIDER_TIMEOUT", "AI provider phản hồi quá thời gian.") from exc
        raise ai_error("AI_PROVIDER_UNAVAILABLE", "Không thể kết nối AI provider.") from exc
    except OSError as exc:
        raise ai_error("AI_PROVIDER_UNAVAILABLE", "Không thể kết nối AI provider.") from exc


def _decode_line(raw_line) -> str:
    if isinstance(raw_line, bytes):
        return raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
    return str(raw_line).rstrip("\r\n")


def _decode_event(data_lines: list[str], event_name: str) -> dict | None:
    payload = "\n".join(data_lines)
    if payload == "[DONE]":
        return None
    try:
        value = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError("AI provider trả về SSE JSON không hợp lệ.") from exc
    if not isinstance(value, dict):
        raise ValueError("AI provider trả về SSE payload không phải object.")
    if event_name and "type" not in value and "event_type" not in value:
        value["_event"] = event_name
    return value


def iter_sse(response) -> Iterable[dict]:
    """Parse standards-compliant SSE, including multiline data fields."""

    data_lines: list[str] = []
    event_name = ""
    for raw_line in response:
        line = _decode_line(raw_line)
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[6:].lstrip()
            continue
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
            continue
        if line or not data_lines:
            continue
        value = _decode_event(data_lines, event_name)
        data_lines = []
        event_name = ""
        if value is None:
            return
        yield value
    if data_lines:
        value = _decode_event(data_lines, event_name)
        if value is not None:
            yield value


def iter_ndjson(response) -> Iterable[dict]:
    """Parse Ollama-style newline-delimited JSON streams."""

    for raw_line in response:
        line = _decode_line(raw_line).strip()
        if not line:
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError("AI provider trả về NDJSON không hợp lệ.") from exc
        if not isinstance(value, dict):
            raise ValueError("AI provider trả về NDJSON payload không phải object.")
        yield value


def call_item(call_id: str, name: str, arguments: str = "", **metadata) -> dict:
    item = {
        "type": "function_call",
        "id": f"fc_{call_id}",
        "call_id": call_id,
        "name": name,
        "arguments": arguments,
    }
    item.update(metadata)
    return item


def message_item(text: str) -> dict:
    return {
        "type": "message",
        "role": "assistant",
        "content": [{"type": "output_text", "text": text}],
    }


def completed_event(text: str, calls: list[dict], usage: dict | None = None) -> dict:
    output = []
    if text:
        output.append(message_item(text))
    output.extend(calls)
    response = {"output": output}
    if usage:
        response["usage"] = {
            "input_tokens": max(0, int(usage.get("input_tokens") or 0)),
            "output_tokens": max(0, int(usage.get("output_tokens") or 0)),
        }
    return {"type": "response.completed", "response": response}
