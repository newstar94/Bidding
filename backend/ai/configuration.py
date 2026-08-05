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


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


@dataclass(frozen=True)
class AiConfig:
    enabled: bool
    provider: str
    api_key: str
    base_url: str
    api_version: str
    provider_version: str
    auth_type: str
    model: str
    max_output_tokens: int
    request_timeout_seconds: int
    tool_timeout_seconds: int
    daily_request_limit: int
    daily_token_limit: int
    conversation_retention_days: int
    provider_store_responses: bool
    chat_include_usage: bool
    chat_max_tokens_field: str
    max_message_chars: int
    max_history_messages: int
    max_tool_calls_per_message: int
    knowledge_enabled: bool
    knowledge_top_k: int
    knowledge_min_score: float
    knowledge_max_context_chars: int
    knowledge_candidate_limit: int

    @property
    def public_capabilities(self) -> list[str]:
        if not self.enabled:
            return []
        return ["ai.chat", "ai.data_assistant", "ai.procurement_advice", "ai.app_help"]


def get_ai_config() -> AiConfig:
    provider = (
        str(os.environ.get("AI_PROVIDER", "openai")).strip().casefold().replace("-", "_")
        or "openai"
    )
    anthropic_providers = {"anthropic", "claude"}
    gemini_providers = {
        "gemini",
        "google",
        "gemini_interactions",
        "google_interactions",
        "gemini_generate_content",
        "google_generate_content",
    }
    azure_providers = {"azure", "azure_openai", "azure_openai_chat"}
    ollama_providers = {"ollama"}

    def first_value(*names: str, default: str = "") -> str:
        for name in names:
            if not name:
                continue
            value = str(os.environ.get(name, "")).strip()
            if value:
                return value
        return default

    if provider in anthropic_providers:
        api_key = first_value("AI_API_KEY", "ANTHROPIC_API_KEY")
        base_url = first_value("AI_BASE_URL", "ANTHROPIC_BASE_URL")
        provider_version = first_value(
            "AI_PROVIDER_VERSION", "ANTHROPIC_VERSION", default="2023-06-01"
        )
        default_model = ""
    elif provider in gemini_providers:
        api_key = first_value("AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")
        base_url = first_value("AI_BASE_URL", "GEMINI_BASE_URL")
        provider_version = first_value("AI_PROVIDER_VERSION", "GEMINI_API_REVISION")
        default_model = ""
    elif provider in azure_providers:
        api_key = first_value("AI_API_KEY", "AZURE_OPENAI_API_KEY", "OPENAI_API_KEY")
        base_url = first_value("AI_BASE_URL", "AZURE_OPENAI_ENDPOINT", "OPENAI_BASE_URL")
        provider_version = first_value("AI_PROVIDER_VERSION")
        default_model = ""
    elif provider in ollama_providers:
        api_key = first_value("AI_API_KEY", "OLLAMA_API_KEY")
        base_url = first_value("AI_BASE_URL", "OLLAMA_BASE_URL")
        provider_version = first_value("AI_PROVIDER_VERSION")
        default_model = ""
    else:
        # OPENAI_* remains a backwards-compatible fallback for OpenAI and all
        # Chat Completions-compatible gateways. New deployments can use the
        # vendor-neutral AI_API_KEY/AI_BASE_URL names.
        api_key = first_value("AI_API_KEY", "OPENAI_API_KEY")
        base_url = first_value(
            "AI_BASE_URL", "OPENAI_BASE_URL", default="https://api.openai.com/v1"
        )
        provider_version = first_value("AI_PROVIDER_VERSION")
        default_model = "gpt-5.6"

    return AiConfig(
        enabled=_env_bool("AI_ENABLED", False),
        provider=provider,
        api_key=api_key,
        base_url=base_url.rstrip("/"),
        api_version=first_value("AI_API_VERSION", "AZURE_OPENAI_API_VERSION"),
        provider_version=provider_version,
        auth_type=first_value(
            "AI_AUTH_TYPE",
            "AZURE_OPENAI_AUTH_TYPE" if provider in azure_providers else "",
            default="api_key" if provider in azure_providers else "bearer",
        ).casefold(),
        model=str(os.environ.get("AI_MODEL", default_model)).strip(),
        max_output_tokens=_env_int("AI_MAX_OUTPUT_TOKENS", 1200, 128, 8000),
        request_timeout_seconds=_env_int("AI_REQUEST_TIMEOUT_SECONDS", 45, 5, 120),
        tool_timeout_seconds=_env_int("AI_TOOL_TIMEOUT_SECONDS", 15, 2, 60),
        daily_request_limit=_env_int("AI_DAILY_REQUEST_LIMIT", 100, 1, 10000),
        daily_token_limit=_env_int("AI_DAILY_TOKEN_LIMIT", 100000, 1000, 5000000),
        conversation_retention_days=_env_int("AI_CONVERSATION_RETENTION_DAYS", 30, 1, 3650),
        provider_store_responses=_env_bool("AI_PROVIDER_STORE_RESPONSES", False),
        chat_include_usage=_env_bool("AI_CHAT_INCLUDE_USAGE", True),
        chat_max_tokens_field=(
            str(os.environ.get("AI_CHAT_MAX_TOKENS_FIELD", "max_tokens")).strip()
            if str(os.environ.get("AI_CHAT_MAX_TOKENS_FIELD", "max_tokens")).strip()
            in {"max_tokens", "max_completion_tokens"}
            else "max_tokens"
        ),
        max_message_chars=_env_int("AI_MAX_MESSAGE_CHARS", 4000, 100, 20000),
        max_history_messages=_env_int("AI_MAX_HISTORY_MESSAGES", 40, 4, 100),
        max_tool_calls_per_message=_env_int("AI_MAX_TOOL_CALLS_PER_MESSAGE", 4, 1, 10),
        knowledge_enabled=_env_bool("AI_KNOWLEDGE_ENABLED", True),
        knowledge_top_k=_env_int("AI_KNOWLEDGE_TOP_K", 5, 1, 10),
        knowledge_min_score=_env_float("AI_KNOWLEDGE_MIN_SCORE", 0.12, 0.0, 2.0),
        knowledge_max_context_chars=_env_int(
            "AI_KNOWLEDGE_MAX_CONTEXT_CHARS", 16000, 1000, 48000
        ),
        knowledge_candidate_limit=_env_int(
            "AI_KNOWLEDGE_CANDIDATE_LIMIT", 2000, 50, 5000
        ),
    )
