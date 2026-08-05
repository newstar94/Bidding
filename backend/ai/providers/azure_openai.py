"""Azure OpenAI adapters for Responses and Chat Completions protocols."""

from __future__ import annotations

import urllib.parse

from backend.ai.errors import ai_error
from backend.ai.providers.base import add_query, endpoint, require_api_key
from backend.ai.providers.openai_chat import OpenAIChatAdapter
from backend.ai.providers.openai_responses import OpenAIResponsesAdapter


def _azure_base_url(config) -> str:
    base = str(config.base_url or "").strip().rstrip("/")
    if not base:
        return ""
    parsed = urllib.parse.urlsplit(base)
    if parsed.hostname and parsed.hostname.casefold().endswith(".openai.azure.com"):
        path = parsed.path.rstrip("/")
        if not path:
            return endpoint(base, "openai/v1")
        if path.casefold() == "/openai":
            return endpoint(base, "v1")
    return base


class _AzureAuthMixin:
    def _base_url(self) -> str:
        base = _azure_base_url(self.config)
        if not base:
            raise ai_error(
                "AI_PROVIDER_UNAVAILABLE",
                "Azure OpenAI chưa được cấu hình AI_BASE_URL hoặc AZURE_OPENAI_ENDPOINT.",
            )
        return base

    def _headers(self) -> dict[str, str]:
        key = require_api_key(self.config)
        auth = (
            {"Authorization": f"Bearer {key}"}
            if self.config.auth_type == "bearer"
            else {"api-key": key}
        )
        return {**auth, "Content-Type": "application/json", "Accept": "text/event-stream"}

    def _url(self) -> str:
        url = super()._url()
        return add_query(url, **{"api-version": self.config.api_version})


class AzureOpenAIResponsesAdapter(_AzureAuthMixin, OpenAIResponsesAdapter):
    pass


class AzureOpenAIChatAdapter(_AzureAuthMixin, OpenAIChatAdapter):
    pass
