"""Ollama /api/chat NDJSON adapter."""

from __future__ import annotations

from collections.abc import Iterable
import json

from backend.ai.configuration import AiConfig
from backend.ai.providers.base import (
    call_item,
    completed_event,
    endpoint,
    iter_ndjson,
    json_request,
    require_model,
    stream_http,
)
from backend.ai.providers.conversion import chat_messages, chat_tools


class OllamaAdapter:
    default_base_url = "http://127.0.0.1:11434"

    def __init__(self, config: AiConfig):
        self.config = config
        self._request_sequence = 0

    def _url(self) -> str:
        return endpoint(self.config.base_url or self.default_base_url, "api/chat")

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/x-ndjson"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    def _body(self, input_items: list[dict], instructions: str, tools: list[dict]) -> dict:
        body = {
            "model": require_model(self.config),
            "messages": chat_messages(input_items, instructions, ollama=True),
            "tools": chat_tools(tools),
            "options": {"num_predict": self.config.max_output_tokens},
            "stream": True,
        }
        if not tools:
            body.pop("tools")
        return body

    def stream_response(
        self,
        *,
        input_items: list[dict],
        instructions: str,
        tools: list[dict],
    ) -> Iterable[dict]:
        self._request_sequence += 1
        request = json_request(
            self._url(),
            self._body(input_items, instructions, tools),
            self._headers(),
        )
        raw_events = stream_http(
            request,
            timeout_seconds=self.config.request_timeout_seconds,
            parser=iter_ndjson,
        )
        yield from normalize_ollama_stream(raw_events, request_sequence=self._request_sequence)


def normalize_ollama_stream(raw_events: Iterable[dict], *, request_sequence: int = 1) -> Iterable[dict]:
    text_parts: list[str] = []
    calls: dict[int, dict] = {}
    usage: dict[str, int] = {}
    yielded_created = False
    for event in raw_events:
        if event.get("error"):
            yield {"type": "error", "error": event["error"]}
            return
        if not yielded_created:
            yield {
                "type": "response.created",
                "response": {"id": f"ollama_{request_sequence}"},
            }
            yielded_created = True
        message = event.get("message") if isinstance(event.get("message"), dict) else {}
        text = message.get("content")
        if text:
            text = str(text)
            text_parts.append(text)
            yield {"type": "response.output_text.delta", "delta": text}
        native_calls = message.get("tool_calls")
        if isinstance(native_calls, list):
            for fallback_index, native_call in enumerate(native_calls):
                if not isinstance(native_call, dict):
                    continue
                function = native_call.get("function")
                function = function if isinstance(function, dict) else {}
                index = int(function.get("index") if function.get("index") is not None else fallback_index)
                is_new = index not in calls
                state = calls.setdefault(
                    index,
                    {
                        "call_id": str(native_call.get("id") or f"ollama_{request_sequence}_{index}"),
                        "name": "",
                        "arguments": "",
                        "arguments_object": {},
                    },
                )
                if function.get("name"):
                    state["name"] = str(function["name"])
                native_arguments = function.get("arguments")
                if isinstance(native_arguments, dict):
                    state["arguments_object"].update(native_arguments)
                    arguments = json.dumps(
                        state["arguments_object"], ensure_ascii=False, separators=(",", ":")
                    )
                    state["arguments"] = arguments
                else:
                    fragment = str(native_arguments or "")
                    state["arguments"] += fragment
                    arguments = fragment
                if is_new:
                    yield {
                        "type": "response.output_item.added",
                        "output_index": index,
                        "item": call_item(state["call_id"], state["name"]),
                    }
                if arguments:
                    yield {
                        "type": "response.function_call_arguments.delta",
                        "output_index": index,
                        "delta": arguments,
                    }
        if event.get("done"):
            usage = {
                "input_tokens": int(event.get("prompt_eval_count") or 0),
                "output_tokens": int(event.get("eval_count") or 0),
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
