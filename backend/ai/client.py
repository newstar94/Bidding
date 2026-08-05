"""Compatibility facade over the protocol-specific AI provider registry."""

from __future__ import annotations

from collections.abc import Iterable

from backend.ai.configuration import AiConfig
from backend.ai.providers.base import iter_sse as _iter_sse
from backend.ai.providers.registry import create_provider


class ResponsesProvider:
    """Preserve the original service interface while delegating by protocol."""

    def __init__(self, config: AiConfig):
        self.config = config
        self.adapter = None

    def stream_response(
        self,
        *,
        input_items: list[dict],
        instructions: str,
        tools: list[dict],
    ) -> Iterable[dict]:
        if self.adapter is None:
            self.adapter = create_provider(self.config)
        yield from self.adapter.stream_response(
            input_items=input_items,
            instructions=instructions,
            tools=tools,
        )


__all__ = ["ResponsesProvider", "_iter_sse"]
