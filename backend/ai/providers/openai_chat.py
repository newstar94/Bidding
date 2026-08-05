"""Adapter for OpenAI Chat Completions and compatible vendor gateways."""

from __future__ import annotations

from collections.abc import Iterable

from backend.ai.configuration import AiConfig
from backend.ai.providers.base import (
    call_item,
    completed_event,
    endpoint,
    iter_sse,
    json_request,
    require_api_key,
    require_model,
    stream_http,
)
from backend.ai.providers.conversion import chat_messages, chat_tools


class OpenAIChatAdapter:
    default_base_url = "https://api.openai.com/v1"

    def __init__(self, config: AiConfig):
        self.config = config

    def _base_url(self) -> str:
        return self.config.base_url or self.default_base_url

    def _url(self) -> str:
        return endpoint(self._base_url(), "chat/completions")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {require_api_key(self.config)}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

    def _body(self, input_items: list[dict], instructions: str, tools: list[dict]) -> dict:
        body = {
            "model": require_model(self.config),
            "messages": chat_messages(input_items, instructions),
            "tools": chat_tools(tools),
            "tool_choice": "auto",
            "stream": True,
        }
        body[self.config.chat_max_tokens_field] = self.config.max_output_tokens
        if self.config.chat_include_usage:
            body["stream_options"] = {"include_usage": True}
        if not tools:
            body.pop("tools")
            body.pop("tool_choice")
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
        )
        yield from normalize_chat_stream(raw_events)


def normalize_chat_stream(raw_events: Iterable[dict]) -> Iterable[dict]:
    text_parts: list[str] = []
    calls: dict[int, dict] = {}
    usage: dict[str, int] = {}
    response_id = "chat"
    for event in raw_events:
        if event.get("error") or event.get("type") == "error":
            yield {"type": "error", "error": event.get("error") or event}
            return
        response_id = str(event.get("id") or response_id)
        native_usage = event.get("usage")
        if isinstance(native_usage, dict):
            usage = {
                "input_tokens": int(native_usage.get("prompt_tokens") or 0),
                "output_tokens": int(native_usage.get("completion_tokens") or 0),
            }
        choices = event.get("choices")
        if not isinstance(choices, list) or not choices:
            continue
        choice = choices[0] if isinstance(choices[0], dict) else {}
        delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}
        text = delta.get("content")
        if text:
            text = str(text)
            text_parts.append(text)
            yield {"type": "response.output_text.delta", "delta": text}
        native_calls = delta.get("tool_calls")
        if not isinstance(native_calls, list):
            continue
        for native_call in native_calls:
            if not isinstance(native_call, dict):
                continue
            index = int(native_call.get("index") or 0)
            function = native_call.get("function")
            function = function if isinstance(function, dict) else {}
            is_new = index not in calls
            state = calls.setdefault(
                index,
                {
                    "call_id": str(native_call.get("id") or f"{response_id}_{index}"),
                    "name": "",
                    "arguments": "",
                },
            )
            if native_call.get("id"):
                state["call_id"] = str(native_call["id"])
            if function.get("name"):
                state["name"] += str(function["name"])
            if is_new:
                yield {
                    "type": "response.output_item.added",
                    "output_index": index,
                    "item": call_item(state["call_id"], state["name"]),
                }
            argument_delta = str(function.get("arguments") or "")
            if argument_delta:
                state["arguments"] += argument_delta
                yield {
                    "type": "response.function_call_arguments.delta",
                    "output_index": index,
                    "delta": argument_delta,
                }
    completed_calls: list[dict] = []
    for index in sorted(calls):
        state = calls[index]
        item = call_item(state["call_id"], state["name"], state["arguments"])
        completed_calls.append(item)
        yield {
            "type": "response.function_call_arguments.done",
            "output_index": index,
            "arguments": state["arguments"],
            "item_id": item["id"],
        }
        yield {"type": "response.output_item.done", "output_index": index, "item": item}
    yield completed_event("".join(text_parts), completed_calls, usage)
