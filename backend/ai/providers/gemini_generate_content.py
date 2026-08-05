"""Adapter for Gemini's fully supported legacy generateContent protocol."""

from __future__ import annotations

from collections.abc import Iterable
import json
import urllib.parse

from backend.ai.configuration import AiConfig
from backend.ai.providers.base import (
    add_query,
    call_item,
    completed_event,
    endpoint,
    iter_sse,
    json_request,
    require_api_key,
    require_model,
    stream_http,
)
from backend.ai.providers.conversion import gemini_contents, gemini_legacy_tools


class GeminiGenerateContentAdapter:
    default_base_url = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, config: AiConfig):
        self.config = config

    def _url(self) -> str:
        model = require_model(self.config).removeprefix("models/")
        model_path = urllib.parse.quote(model, safe="._-")
        suffix = f"models/{model_path}:streamGenerateContent"
        return add_query(endpoint(self.config.base_url or self.default_base_url, suffix), alt="sse")

    def _headers(self) -> dict[str, str]:
        return {
            "x-goog-api-key": require_api_key(self.config),
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

    def _body(self, input_items: list[dict], instructions: str, tools: list[dict]) -> dict:
        body = {
            "contents": gemini_contents(input_items),
            "systemInstruction": {"parts": [{"text": instructions}]},
            "tools": gemini_legacy_tools(tools),
            "generationConfig": {"maxOutputTokens": self.config.max_output_tokens},
        }
        if not instructions:
            body.pop("systemInstruction")
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
        yield from normalize_gemini_generate_content_stream(raw_events)


def _legacy_usage(native_usage: dict) -> dict[str, int]:
    return {
        "input_tokens": int(native_usage.get("promptTokenCount") or 0)
        + int(native_usage.get("toolUsePromptTokenCount") or 0),
        "output_tokens": int(native_usage.get("candidatesTokenCount") or 0)
        + int(native_usage.get("thoughtsTokenCount") or 0),
    }


def normalize_gemini_generate_content_stream(raw_events: Iterable[dict]) -> Iterable[dict]:
    text_parts: list[str] = []
    calls: list[dict] = []
    seen_calls: set[str] = set()
    usage: dict[str, int] = {}
    yielded_created = False
    for event in raw_events:
        if event.get("error"):
            yield {"type": "error", "error": event["error"]}
            return
        if not yielded_created:
            yield {"type": "response.created", "response": {"id": "gemini_generate_content"}}
            yielded_created = True
        native_usage = event.get("usageMetadata")
        if isinstance(native_usage, dict):
            usage = _legacy_usage(native_usage)
        candidates = event.get("candidates")
        if not isinstance(candidates, list):
            continue
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content") if isinstance(candidate.get("content"), dict) else {}
            parts = content.get("parts") if isinstance(content.get("parts"), list) else []
            for part in parts:
                if not isinstance(part, dict):
                    continue
                if part.get("text"):
                    text = str(part["text"])
                    text_parts.append(text)
                    yield {"type": "response.output_text.delta", "delta": text}
                native_call = part.get("functionCall")
                if not isinstance(native_call, dict):
                    continue
                arguments = native_call.get("args") if isinstance(native_call.get("args"), dict) else {}
                arguments_json = json.dumps(arguments, ensure_ascii=False, separators=(",", ":"))
                native_id = str(native_call.get("id") or "")
                dedupe_key = native_id or f"{native_call.get('name')}:{arguments_json}"
                if dedupe_key in seen_calls:
                    continue
                seen_calls.add(dedupe_key)
                index = len(calls)
                call_id = native_id or f"gemini_{index}"
                provider_data = {}
                if part.get("thoughtSignature"):
                    provider_data["thoughtSignature"] = part["thoughtSignature"]
                item = call_item(
                    call_id,
                    str(native_call.get("name") or ""),
                    arguments_json,
                    **({"provider_data": provider_data} if provider_data else {}),
                )
                calls.append(item)
                yield {
                    "type": "response.output_item.added",
                    "output_index": index,
                    "item": {**item, "arguments": ""},
                }
                yield {
                    "type": "response.function_call_arguments.delta",
                    "output_index": index,
                    "delta": arguments_json,
                }
                yield {
                    "type": "response.function_call_arguments.done",
                    "output_index": index,
                    "arguments": arguments_json,
                    "item_id": item["id"],
                }
                yield {"type": "response.output_item.done", "output_index": index, "item": item}
    yield completed_event("".join(text_parts), calls, usage)
