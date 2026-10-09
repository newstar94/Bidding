"""Anthropic Messages API adapter."""

from __future__ import annotations

from collections.abc import Iterable
import json

from backend.ai.configuration import AiConfig
from backend.ai.providers.base import (
    call_item,
    completed_event,
    endpoint,
    iter_sse,
    json_request,
    merge_reported_counters,
    require_api_key,
    require_model,
    stream_http,
)
from backend.ai.providers.conversion import anthropic_messages, anthropic_tools


class AnthropicAdapter:
    default_base_url = "https://api.anthropic.com/v1"

    def __init__(self, config: AiConfig):
        self.config = config

    def _url(self) -> str:
        return endpoint(self.config.base_url or self.default_base_url, "messages")

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": require_api_key(self.config),
            "anthropic-version": self.config.provider_version or "2023-06-01",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

    def _body(self, input_items: list[dict], instructions: str, tools: list[dict]) -> dict:
        body = {
            "model": require_model(self.config),
            "max_tokens": self.config.max_output_tokens,
            "system": instructions,
            "messages": anthropic_messages(input_items),
            "tools": anthropic_tools(tools),
            "stream": True,
        }
        if not tools:
            body.pop("tools")
        if not instructions:
            body.pop("system")
        return body

    def stream_response(
        self,
        *,
        input_items: list[dict],
        instructions: str,
        tools: list[dict],
    ) -> Iterable[dict]:
        request = json_request(
            self._url(),
            self._body(input_items, instructions, tools),
            self._headers(),
        )
        raw_events = stream_http(
            request,
            timeout_seconds=self.config.request_timeout_seconds,
            parser=iter_sse,
            allowed_hosts=self.config.provider_allowed_hosts,
            proxy_url=self.config.provider_proxy_url,
            allowed_proxy_hosts=self.config.provider_allowed_proxy_hosts,
        )
        yield from normalize_anthropic_stream(raw_events)


def _anthropic_input_tokens(usage: dict) -> int:
    return sum(
        max(0, int(usage.get(name) or 0))
        for name in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
    )


def normalize_anthropic_stream(raw_events: Iterable[dict]) -> Iterable[dict]:
    text_parts: list[str] = []
    calls: dict[int, dict] = {}
    finished_calls: set[int] = set()
    usage: dict[str, int] = {}
    native_totals: dict[str, int] = {}
    completed = False

    def finish_call(index: int) -> Iterable[dict]:
        if index in finished_calls or index not in calls:
            return
        state = calls[index]
        item = call_item(state["call_id"], state["name"], state["arguments"])
        state["item"] = item
        finished_calls.add(index)
        yield {
            "type": "response.function_call_arguments.done",
            "output_index": index,
            "arguments": state["arguments"],
            "item_id": item["id"],
        }
        yield {"type": "response.output_item.done", "output_index": index, "item": item}

    for event in raw_events:
        event_type = str(event.get("type") or event.get("_event") or "")
        message = event.get("message") if isinstance(event.get("message"), dict) else {}
        native_usage = message.get("usage") if event_type == "message_start" else event.get("usage")
        if isinstance(native_usage, dict) and merge_reported_counters(
            native_totals, native_usage,
            ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"),
        ):
            usage = {
                "input_tokens": _anthropic_input_tokens(native_totals),
                "output_tokens": native_totals.get("output_tokens", 0),
            }
            yield {"type": "response.usage", "usage": dict(usage)}
        if event_type == "error" or event.get("error"):
            yield {"type": "error", "error": event.get("error") or event,
                   **({"usage": dict(usage)} if usage else {})}
            return
        if event_type == "message_start":
            yield {"type": "response.created", "response": {"id": str(message.get("id") or "")}}
        elif event_type == "content_block_start":
            index = int(event.get("index") or 0)
            block = event.get("content_block") if isinstance(event.get("content_block"), dict) else {}
            block_type = str(block.get("type") or "")
            if block_type == "text" and block.get("text"):
                text = str(block["text"])
                text_parts.append(text)
                yield {"type": "response.output_text.delta", "delta": text}
            elif block_type == "tool_use":
                initial_input = block.get("input") if isinstance(block.get("input"), dict) else {}
                initial_arguments = (
                    json.dumps(initial_input, ensure_ascii=False, separators=(",", ":"))
                    if initial_input
                    else ""
                )
                calls[index] = {
                    "call_id": str(block.get("id") or f"anthropic_{index}"),
                    "name": str(block.get("name") or ""),
                    "arguments": initial_arguments,
                }
                yield {
                    "type": "response.output_item.added",
                    "output_index": index,
                    "item": call_item(calls[index]["call_id"], calls[index]["name"]),
                }
                if initial_arguments:
                    yield {
                        "type": "response.function_call_arguments.delta",
                        "output_index": index,
                        "delta": initial_arguments,
                    }
        elif event_type == "content_block_delta":
            index = int(event.get("index") or 0)
            delta = event.get("delta") if isinstance(event.get("delta"), dict) else {}
            delta_type = str(delta.get("type") or "")
            if delta_type == "text_delta" and delta.get("text"):
                text = str(delta["text"])
                text_parts.append(text)
                yield {"type": "response.output_text.delta", "delta": text}
            elif delta_type == "input_json_delta" and index in calls:
                fragment = str(delta.get("partial_json") or "")
                if fragment:
                    calls[index]["arguments"] += fragment
                    yield {
                        "type": "response.function_call_arguments.delta",
                        "output_index": index,
                        "delta": fragment,
                    }
        elif event_type == "content_block_stop":
            yield from finish_call(int(event.get("index") or 0))
        elif event_type == "message_stop":
            for index in sorted(calls):
                yield from finish_call(index)
            completed_calls = [calls[index]["item"] for index in sorted(calls)]
            yield completed_event("".join(text_parts), completed_calls, usage)
            completed = True
    if not completed:
        for index in sorted(calls):
            yield from finish_call(index)
        completed_calls = [calls[index]["item"] for index in sorted(calls)]
        yield completed_event("".join(text_parts), completed_calls, usage)
