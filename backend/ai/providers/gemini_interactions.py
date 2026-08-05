"""Gemini Interactions API adapter (recommended Gemini protocol)."""

from __future__ import annotations

from collections.abc import Iterable
import json

from backend.ai.configuration import AiConfig
from backend.ai.providers.base import (
    call_item,
    completed_event,
    endpoint,
    add_query,
    iter_sse,
    json_request,
    require_api_key,
    require_model,
    stream_http,
)
from backend.ai.providers.conversion import interaction_steps, interaction_tools


class GeminiInteractionsAdapter:
    default_base_url = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, config: AiConfig):
        self.config = config

    def _url(self) -> str:
        return add_query(endpoint(self.config.base_url or self.default_base_url, "interactions"), alt="sse")

    def _headers(self) -> dict[str, str]:
        headers = {
            "x-goog-api-key": require_api_key(self.config),
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        if self.config.provider_version:
            headers["Api-Revision"] = self.config.provider_version
        return headers

    def _body(self, input_items: list[dict], instructions: str, tools: list[dict]) -> dict:
        body = {
            "model": require_model(self.config),
            "input": interaction_steps(input_items),
            "system_instruction": instructions,
            "tools": interaction_tools(tools),
            "generation_config": {"max_output_tokens": self.config.max_output_tokens},
            "store": self.config.provider_store_responses,
            "stream": True,
        }
        if not instructions:
            body.pop("system_instruction")
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
        yield from normalize_gemini_interactions_stream(raw_events)


def _interaction_usage(native_usage: dict) -> dict[str, int]:
    return {
        "input_tokens": int(
            native_usage.get("total_input_tokens")
            or native_usage.get("prompt_tokens")
            or native_usage.get("input_tokens")
            or 0
        ),
        "output_tokens": int(
            native_usage.get("total_output_tokens")
            or native_usage.get("completion_tokens")
            or native_usage.get("output_tokens")
            or 0
        )
        + int(native_usage.get("total_thought_tokens") or 0)
        + int(native_usage.get("total_tool_use_tokens") or 0),
    }


def normalize_gemini_interactions_stream(raw_events: Iterable[dict]) -> Iterable[dict]:
    text_parts: list[str] = []
    calls: dict[int, dict] = {}
    native_steps: dict[int, dict] = {}
    finished_calls: set[int] = set()
    usage: dict[str, int] = {}
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

    def completed_calls_with_history() -> list[dict]:
        completed_calls = [calls[index]["item"] for index in sorted(calls)]
        if not completed_calls:
            return completed_calls
        history: list[dict] = []
        for index in sorted(native_steps):
            step = dict(native_steps[index])
            if step.get("type") == "function_call" and index in calls:
                arguments = str(calls[index].get("arguments") or "{}")
                try:
                    step["arguments"] = json.loads(arguments)
                except json.JSONDecodeError:
                    step["arguments"] = {}
            history.append(step)
        if history:
            completed_calls[0]["provider_data"] = {
                "gemini_interaction_steps": history,
            }
            for item in completed_calls[1:]:
                item["provider_data"] = {
                    "gemini_interaction_history_replayed": True,
                }
        return completed_calls

    for event in raw_events:
        event_type = str(event.get("event_type") or event.get("type") or event.get("_event") or "")
        if event_type in {"error", "interaction.failed", "interaction.cancelled"} or event.get("error"):
            yield {"type": "error", "error": event.get("error") or event}
            return
        if event_type == "interaction.created":
            interaction = event.get("interaction") if isinstance(event.get("interaction"), dict) else {}
            yield {
                "type": "response.created",
                "response": {"id": str(interaction.get("id") or "")},
            }
        elif event_type == "step.start":
            index = int(event.get("index") or 0)
            step = event.get("step") if isinstance(event.get("step"), dict) else {}
            step_type = str(step.get("type") or "")
            native_steps[index] = dict(step)
            if step_type == "function_call":
                initial_arguments = step.get("arguments")
                arguments = (
                    json.dumps(initial_arguments, ensure_ascii=False, separators=(",", ":"))
                    if isinstance(initial_arguments, dict) and initial_arguments
                    else ""
                )
                calls[index] = {
                    "call_id": str(step.get("id") or f"gemini_{index}"),
                    "name": str(step.get("name") or ""),
                    "arguments": arguments,
                }
                yield {
                    "type": "response.output_item.added",
                    "output_index": index,
                    "item": call_item(calls[index]["call_id"], calls[index]["name"]),
                }
                if arguments:
                    yield {
                        "type": "response.function_call_arguments.delta",
                        "output_index": index,
                        "delta": arguments,
                    }
            elif step_type == "model_output":
                content = step.get("content") if isinstance(step.get("content"), list) else []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                        text = str(block["text"])
                        text_parts.append(text)
                        yield {"type": "response.output_text.delta", "delta": text}
        elif event_type == "step.delta":
            index = int(event.get("index") or 0)
            delta = event.get("delta") if isinstance(event.get("delta"), dict) else {}
            delta_type = str(delta.get("type") or "")
            native_step = native_steps.setdefault(index, {})
            if delta_type == "thought_signature" and delta.get("signature"):
                native_step["signature"] = str(delta["signature"])
            if delta_type == "text" and delta.get("text"):
                text = str(delta["text"])
                text_parts.append(text)
                content = native_step.setdefault("content", [])
                if isinstance(content, list):
                    if content and isinstance(content[-1], dict) and content[-1].get("type") == "text":
                        content[-1]["text"] = str(content[-1].get("text") or "") + text
                    else:
                        content.append({"type": "text", "text": text})
                yield {"type": "response.output_text.delta", "delta": text}
            elif delta_type == "arguments_delta" and index in calls:
                fragment = str(delta.get("arguments") or "")
                if fragment:
                    calls[index]["arguments"] += fragment
                    yield {
                        "type": "response.function_call_arguments.delta",
                        "output_index": index,
                        "delta": fragment,
                    }
        elif event_type == "step.stop":
            yield from finish_call(int(event.get("index") or 0))
        elif event_type == "interaction.completed":
            interaction = event.get("interaction") if isinstance(event.get("interaction"), dict) else {}
            native_usage = interaction.get("usage") if isinstance(interaction.get("usage"), dict) else {}
            usage = _interaction_usage(native_usage)
            for index in sorted(calls):
                yield from finish_call(index)
            completed_calls = completed_calls_with_history()
            yield completed_event("".join(text_parts), completed_calls, usage)
            completed = True
    if not completed:
        for index in sorted(calls):
            yield from finish_call(index)
        completed_calls = completed_calls_with_history()
        yield completed_event("".join(text_parts), completed_calls, usage)
