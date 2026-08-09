"""OpenAI Responses API adapter."""

from __future__ import annotations

from collections.abc import Iterable

from backend.ai.configuration import AiConfig
from backend.ai.providers.base import (
    endpoint,
    iter_sse,
    json_request,
    require_api_key,
    require_model,
    stream_http,
)


class OpenAIResponsesAdapter:
    default_base_url = "https://api.openai.com/v1"

    def __init__(self, config: AiConfig):
        self.config = config

    def _base_url(self) -> str:
        return self.config.base_url or self.default_base_url

    def _url(self) -> str:
        return endpoint(self._base_url(), "responses")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {require_api_key(self.config)}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

    def _body(self, input_items: list[dict], instructions: str, tools: list[dict]) -> dict:
        return {
            "model": require_model(self.config),
            "input": input_items,
            "instructions": instructions,
            "tools": tools,
            "parallel_tool_calls": False,
            "max_output_tokens": self.config.max_output_tokens,
            "store": self.config.provider_store_responses,
            "stream": True,
        }

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
        yield from stream_http(
            request,
            timeout_seconds=self.config.request_timeout_seconds,
            parser=iter_sse,
            allowed_hosts=self.config.provider_allowed_hosts,
            proxy_url=self.config.provider_proxy_url,
            allowed_proxy_hosts=self.config.provider_allowed_proxy_hosts,
        )
