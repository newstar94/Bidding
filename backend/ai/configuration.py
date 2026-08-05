"""Centralized, backend-only AI configuration.

The provider is intentionally disabled by default.  No API key or model name
is exposed to the browser; the frontend receives only capability metadata.
"""

from __future__ import annotations

from dataclasses import dataclass
import os


def _env_bool(name: str, default: bool) -> bool:
    value = str(os.environ.get(name, "true" if default else "false")).strip().casefold()
    return value in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


@dataclass(frozen=True)
class AiConfig:
    enabled: bool
    provider: str
    api_key: str
    base_url: str
    model: str
    max_output_tokens: int
    request_timeout_seconds: int
    tool_timeout_seconds: int
    daily_request_limit: int
    daily_token_limit: int
    conversation_retention_days: int
    provider_store_responses: bool
    max_message_chars: int
    max_history_messages: int
    max_tool_calls_per_message: int

    @property
    def public_capabilities(self) -> list[str]:
        if not self.enabled:
            return []
        return ["ai.chat", "ai.data_assistant", "ai.procurement_advice", "ai.app_help"]


def get_ai_config() -> AiConfig:
    return AiConfig(
        enabled=_env_bool("AI_ENABLED", False),
        provider=str(os.environ.get("AI_PROVIDER", "openai")).strip().casefold() or "openai",
        api_key=str(os.environ.get("OPENAI_API_KEY", "")).strip(),
        base_url=str(os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")).strip().rstrip("/"),
        model=str(os.environ.get("AI_MODEL", "gpt-5.6")).strip() or "gpt-5.6",
        max_output_tokens=_env_int("AI_MAX_OUTPUT_TOKENS", 1200, 128, 8000),
        request_timeout_seconds=_env_int("AI_REQUEST_TIMEOUT_SECONDS", 45, 5, 120),
        tool_timeout_seconds=_env_int("AI_TOOL_TIMEOUT_SECONDS", 15, 2, 60),
        daily_request_limit=_env_int("AI_DAILY_REQUEST_LIMIT", 100, 1, 10000),
        daily_token_limit=_env_int("AI_DAILY_TOKEN_LIMIT", 100000, 1000, 5000000),
        conversation_retention_days=_env_int("AI_CONVERSATION_RETENTION_DAYS", 30, 1, 3650),
        provider_store_responses=_env_bool("AI_PROVIDER_STORE_RESPONSES", False),
        max_message_chars=_env_int("AI_MAX_MESSAGE_CHARS", 4000, 100, 20000),
        max_history_messages=_env_int("AI_MAX_HISTORY_MESSAGES", 40, 4, 100),
        max_tool_calls_per_message=_env_int("AI_MAX_TOOL_CALLS_PER_MESSAGE", 4, 1, 10),
    )
