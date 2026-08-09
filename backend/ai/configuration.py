"""Centralized, backend-only AI configuration.

The provider is intentionally disabled by default.  No API key or model name
is exposed to the browser; the frontend receives only capability metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import os
import re
import urllib.parse


def _env_bool(name: str, default: bool, environ=None) -> bool:
    environ = os.environ if environ is None else environ
    value = str(environ.get(name, "true" if default else "false")).strip().casefold()
    return value in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int, maximum: int, environ=None) -> int:
    environ = os.environ if environ is None else environ
    try:
        value = int(str(environ.get(name, default)).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _env_float(name: str, default: float, minimum: float, maximum: float, environ=None) -> float:
    environ = os.environ if environ is None else environ
    try:
        value = float(str(environ.get(name, default)).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _env_domains(name: str, default: tuple[str, ...], environ=None) -> tuple[str, ...]:
    environ = os.environ if environ is None else environ
    values = str(environ.get(name, "")).split(",")
    domains: list[str] = []
    for value in values:
        domain = value.strip().casefold().rstrip(".")
        if not domain or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", domain):
            continue
        if domain not in domains:
            domains.append(domain)
    return tuple(domains) or default


def _env_hosts(name: str, environ=None) -> tuple[str, ...]:
    return _env_domains(name, (), environ)


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
    provider_allowed_hosts: tuple[str, ...]
    provider_proxy_url: str
    provider_allowed_proxy_hosts: tuple[str, ...]
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
    web_search_enabled: bool
    web_search_provider: str
    web_search_api_key: str
    web_search_base_url: str
    web_search_provider_allowed_hosts: tuple[str, ...]
    web_search_proxy_url: str
    web_search_allowed_proxy_hosts: tuple[str, ...]
    web_search_model: str
    web_search_timeout_seconds: int
    web_search_allowed_domains: tuple[str, ...]

    @property
    def public_capabilities(self) -> list[str]:
        if not self.enabled:
            return []
        return ["ai.chat", "ai.data_assistant", "ai.procurement_advice", "ai.app_help"]


def get_ai_config(environ=None) -> AiConfig:
    environ = os.environ if environ is None else environ
    provider = (
        str(environ.get("AI_PROVIDER", "openai")).strip().casefold().replace("-", "_")
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
    default_provider_hosts = {
        "openai": ("api.openai.com",),
        "openai_responses": ("api.openai.com",),
        "responses": ("api.openai.com",),
        "openai_chat": ("api.openai.com",),
        "openai_compatible": ("api.openai.com",),
        "chat_completions": ("api.openai.com",),
        **{name: ("api.anthropic.com",) for name in anthropic_providers},
        **{name: ("generativelanguage.googleapis.com",) for name in gemini_providers},
    }

    def first_value(*names: str, default: str = "") -> str:
        for name in names:
            if not name:
                continue
            value = str(environ.get(name, "")).strip()
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

    config = AiConfig(
        enabled=_env_bool("AI_ENABLED", False, environ),
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
        model=str(environ.get("AI_MODEL", default_model)).strip(),
        max_output_tokens=_env_int("AI_MAX_OUTPUT_TOKENS", 1200, 128, 8000, environ),
        request_timeout_seconds=_env_int("AI_REQUEST_TIMEOUT_SECONDS", 45, 5, 120, environ),
        provider_allowed_hosts=tuple(dict.fromkeys((
            *default_provider_hosts.get(provider, ()),
            *_env_hosts("AI_PROVIDER_ALLOWED_HOSTS", environ),
        ))),
        provider_proxy_url=first_value("AI_PROVIDER_PROXY_URL").rstrip("/"),
        provider_allowed_proxy_hosts=_env_hosts(
            "AI_PROVIDER_ALLOWED_PROXY_HOSTS",
            environ,
        ),
        tool_timeout_seconds=_env_int("AI_TOOL_TIMEOUT_SECONDS", 15, 2, 60, environ),
        daily_request_limit=_env_int("AI_DAILY_REQUEST_LIMIT", 100, 1, 10000, environ),
        daily_token_limit=_env_int("AI_DAILY_TOKEN_LIMIT", 100000, 1000, 5000000, environ),
        conversation_retention_days=_env_int("AI_CONVERSATION_RETENTION_DAYS", 30, 1, 3650, environ),
        provider_store_responses=_env_bool("AI_PROVIDER_STORE_RESPONSES", False, environ),
        chat_include_usage=_env_bool("AI_CHAT_INCLUDE_USAGE", True, environ),
        chat_max_tokens_field=(
            str(environ.get("AI_CHAT_MAX_TOKENS_FIELD", "max_tokens")).strip()
            if str(environ.get("AI_CHAT_MAX_TOKENS_FIELD", "max_tokens")).strip()
            in {"max_tokens", "max_completion_tokens"}
            else "max_tokens"
        ),
        max_message_chars=_env_int("AI_MAX_MESSAGE_CHARS", 4000, 100, 20000, environ),
        max_history_messages=_env_int("AI_MAX_HISTORY_MESSAGES", 40, 4, 100, environ),
        max_tool_calls_per_message=_env_int("AI_MAX_TOOL_CALLS_PER_MESSAGE", 4, 1, 10, environ),
        knowledge_enabled=_env_bool("AI_KNOWLEDGE_ENABLED", True, environ),
        knowledge_top_k=_env_int("AI_KNOWLEDGE_TOP_K", 5, 1, 10, environ),
        knowledge_min_score=_env_float("AI_KNOWLEDGE_MIN_SCORE", 0.12, 0.0, 2.0, environ),
        knowledge_max_context_chars=_env_int(
            "AI_KNOWLEDGE_MAX_CONTEXT_CHARS", 16000, 1000, 48000, environ
        ),
        knowledge_candidate_limit=_env_int(
            "AI_KNOWLEDGE_CANDIDATE_LIMIT", 2000, 50, 5000, environ
        ),
        web_search_enabled=_env_bool("AI_WEB_SEARCH_ENABLED", False, environ),
        web_search_provider=(
            str(environ.get("AI_WEB_SEARCH_PROVIDER", "gemini_grounding"))
            .strip()
            .casefold()
            .replace("-", "_")
            or "gemini_grounding"
        ),
        web_search_api_key=first_value(
            "AI_WEB_SEARCH_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "AI_API_KEY"
        ),
        web_search_base_url=first_value(
            "AI_WEB_SEARCH_BASE_URL", "GEMINI_BASE_URL", default=""
        ).rstrip("/"),
        web_search_provider_allowed_hosts=tuple(dict.fromkeys((
            "generativelanguage.googleapis.com",
            *_env_hosts("AI_WEB_SEARCH_PROVIDER_ALLOWED_HOSTS", environ),
        ))),
        web_search_proxy_url=first_value("AI_WEB_SEARCH_PROXY_URL").rstrip("/"),
        web_search_allowed_proxy_hosts=_env_hosts(
            "AI_WEB_SEARCH_ALLOWED_PROXY_HOSTS",
            environ,
        ),
        web_search_model=first_value("AI_WEB_SEARCH_MODEL", default=str(environ.get("AI_MODEL", default_model)).strip()),
        web_search_timeout_seconds=_env_int("AI_WEB_SEARCH_TIMEOUT_SECONDS", 20, 5, 60, environ),
        web_search_allowed_domains=_env_domains(
            "AI_WEB_SEARCH_ALLOWED_DOMAINS",
            (
                "vanban.chinhphu.vn",
                "vbpl.vn",
                "muasamcong.gov.vn",
                "muasamcong.mpi.gov.vn",
            ),
            environ,
        ),
    )
    if config.provider in azure_providers:
        azure_host = (urllib.parse.urlsplit(config.base_url).hostname or "").casefold().rstrip(".")
        if re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.openai\.azure\.com",
            azure_host,
        ):
            config = replace(config, provider_allowed_hosts=(azure_host,))
        else:
            config = replace(config, provider_allowed_hosts=())
        if config.enabled and not config.base_url:
            raise ValueError("Azure OpenAI provider URL is required when AI is enabled.")
    if config.enabled and config.provider != "fake" and config.base_url:
        from backend.ai.providers.url_policy import (
            validate_loopback_url,
            validate_outbound_url,
        )

        if config.provider == "ollama":
            validate_loopback_url(config.base_url, label="Ollama provider")
        else:
            validate_outbound_url(
                config.base_url,
                allowed_hosts=config.provider_allowed_hosts,
            )
    if config.enabled and config.provider_proxy_url:
        from backend.ai.providers.url_policy import validate_outbound_url

        validate_outbound_url(
            config.provider_proxy_url,
            allowed_hosts=config.provider_allowed_proxy_hosts,
            label="AI provider proxy",
        )
    if config.web_search_enabled and config.web_search_base_url:
        from backend.ai.providers.url_policy import validate_outbound_url

        validate_outbound_url(
            config.web_search_base_url,
            allowed_hosts=config.web_search_provider_allowed_hosts,
            label="AI web-search provider",
        )
    if config.web_search_enabled and config.web_search_proxy_url:
        from backend.ai.providers.url_policy import validate_outbound_url

        validate_outbound_url(
            config.web_search_proxy_url,
            allowed_hosts=config.web_search_allowed_proxy_hosts,
            label="AI web-search proxy",
        )
    return config
