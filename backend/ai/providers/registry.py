"""Provider registry and aliases.

New vendors should be registered by protocol. Most hosted vendors implement
OpenAI Chat Completions, so they use ``openai_chat`` with their own
``AI_BASE_URL`` rather than requiring a brand-specific adapter.
"""

from __future__ import annotations

from collections.abc import Callable

from backend.ai.configuration import AiConfig
from backend.ai.errors import ai_error
from backend.ai.providers.anthropic import AnthropicAdapter
from backend.ai.providers.azure_openai import (
    AzureOpenAIChatAdapter,
    AzureOpenAIResponsesAdapter,
)
from backend.ai.providers.fake import FakeAdapter
from backend.ai.providers.gemini_generate_content import GeminiGenerateContentAdapter
from backend.ai.providers.gemini_interactions import GeminiInteractionsAdapter
from backend.ai.providers.ollama import OllamaAdapter
from backend.ai.providers.openai_chat import OpenAIChatAdapter
from backend.ai.providers.openai_responses import OpenAIResponsesAdapter


ProviderFactory = Callable[[AiConfig], object]

_FACTORIES: dict[str, ProviderFactory] = {
    "fake": FakeAdapter,
    "openai_responses": OpenAIResponsesAdapter,
    "openai_chat": OpenAIChatAdapter,
    "anthropic": AnthropicAdapter,
    "gemini_interactions": GeminiInteractionsAdapter,
    "gemini_generate_content": GeminiGenerateContentAdapter,
    "ollama": OllamaAdapter,
    "azure_openai": AzureOpenAIResponsesAdapter,
    "azure_openai_chat": AzureOpenAIChatAdapter,
}

_ALIASES = {
    "openai": "openai_responses",
    "responses": "openai_responses",
    "openai_compatible": "openai_chat",
    "chat_completions": "openai_chat",
    "anthropic": "anthropic",
    "claude": "anthropic",
    "gemini": "gemini_interactions",
    "google": "gemini_interactions",
    "google_interactions": "gemini_interactions",
    "google_generate_content": "gemini_generate_content",
    "azure": "azure_openai",
}


def canonical_provider_name(name: str) -> str:
    normalized = str(name or "").strip().casefold().replace("-", "_")
    return _ALIASES.get(normalized, normalized)


def supported_provider_names() -> tuple[str, ...]:
    return tuple(sorted(set(_FACTORIES) | set(_ALIASES)))


def register_provider(name: str, factory: ProviderFactory, *, aliases: tuple[str, ...] = ()) -> None:
    """Register an in-process adapter without changing the service layer."""

    canonical = canonical_provider_name(name)
    if not canonical:
        raise ValueError("Provider name không được để trống.")
    _FACTORIES[canonical] = factory
    for alias in aliases:
        normalized_alias = str(alias or "").strip().casefold().replace("-", "_")
        if normalized_alias:
            _ALIASES[normalized_alias] = canonical


def create_provider(config: AiConfig):
    name = canonical_provider_name(config.provider)
    factory = _FACTORIES.get(name)
    if factory is None:
        raise ai_error(
            "AI_PROVIDER_UNAVAILABLE",
            f"AI_PROVIDER '{config.provider}' chưa được hỗ trợ.",
        )
    return factory(config)

