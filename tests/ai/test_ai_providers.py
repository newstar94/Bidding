from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import urllib.error
import urllib.request

import pytest

from backend.ai.configuration import get_ai_config
from backend.ai.errors import AiError
from backend.ai.providers.anthropic import AnthropicAdapter, normalize_anthropic_stream
from backend.ai.providers.azure_openai import AzureOpenAIResponsesAdapter
from backend.ai.providers.base import iter_ndjson, iter_sse, stream_http
from backend.ai.providers.conversion import (
    anthropic_messages,
    chat_messages,
    gemini_contents,
    interaction_steps,
)
from backend.ai.providers.gemini_generate_content import (
    GeminiGenerateContentAdapter,
    normalize_gemini_generate_content_stream,
)
from backend.ai.providers.gemini_interactions import (
    GeminiInteractionsAdapter,
    normalize_gemini_interactions_stream,
)
from backend.ai.providers.ollama import OllamaAdapter, normalize_ollama_stream
from backend.ai.providers.openai_chat import OpenAIChatAdapter, normalize_chat_stream
from backend.ai.providers.openai_responses import OpenAIResponsesAdapter
from backend.ai.providers.registry import create_provider
from backend.startup import StartupValidationError, validate_startup_configuration


TOOL = {
    "type": "function",
    "name": "get_package",
    "description": "Get one package",
    "parameters": {
        "type": "object",
        "properties": {"id": {"type": "string"}},
        "required": ["id"],
        "additionalProperties": False,
    },
}


def config(provider: str, **changes):
    base = get_ai_config()
    values = {
        "provider": provider,
        "api_key": "secret",
        "base_url": "https://provider.example/v1",
        "provider_allowed_hosts": ("provider.example",),
        "model": "test-model",
        "api_version": "",
        "provider_version": "",
        "auth_type": "bearer",
    }
    values.update(changes)
    return replace(base, **values)


def completed(events):
    return next(event for event in events if event["type"] == "response.completed")


def test_config_supports_generic_and_vendor_specific_credentials(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "false")
    for name in (
        "AI_API_KEY",
        "AI_BASE_URL",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-secret")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://anthropic.example/v1/")
    monkeypatch.setenv("AI_MODEL", "claude-test")
    value = get_ai_config()
    assert value.api_key == "anthropic-secret"
    assert value.base_url == "https://anthropic.example/v1"
    assert value.provider_version == "2023-06-01"

    monkeypatch.setenv("AI_API_KEY", "generic-secret")
    monkeypatch.setenv("AI_BASE_URL", "https://gateway.example")
    value = get_ai_config()
    assert value.api_key == "generic-secret"
    assert value.base_url == "https://gateway.example"


def test_config_normalizes_hyphenated_provider_alias(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "google-generate-content")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("AI_MODEL", "gemini-test")
    monkeypatch.delenv("AI_API_KEY", raising=False)
    assert get_ai_config().provider == "google_generate_content"
    assert get_ai_config().api_key == "gemini-secret"


def test_openai_environment_names_remain_backwards_compatible(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "false")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "legacy-secret")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://legacy.example/v1")
    value = get_ai_config()
    assert value.api_key == "legacy-secret"
    assert value.base_url == "https://legacy.example/v1"


def test_enabled_hosted_provider_rejects_plain_http_base_url(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_BASE_URL", "http://api.openai.com/v1")

    with pytest.raises(ValueError, match="HTTPS"):
        get_ai_config()


def test_enabled_hosted_provider_rejects_host_outside_allowlist(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_BASE_URL", "https://collector.example/v1")
    monkeypatch.delenv("AI_PROVIDER_ALLOWED_HOSTS", raising=False)

    with pytest.raises(ValueError, match="allowlist"):
        get_ai_config()


def test_enabled_custom_gateway_accepts_explicit_exact_host(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "openai_chat")
    monkeypatch.setenv("AI_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("AI_PROVIDER_ALLOWED_HOSTS", "gateway.example")

    value = get_ai_config()

    assert value.base_url == "https://gateway.example/v1"
    assert "gateway.example" in value.provider_allowed_hosts


def test_enabled_hosted_provider_rejects_userinfo_even_on_allowlisted_host(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_BASE_URL", "https://api.openai.com@api.openai.com/v1")

    with pytest.raises(ValueError, match="userinfo"):
        get_ai_config()


def test_enabled_hosted_provider_rejects_non_default_https_port(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_BASE_URL", "https://api.openai.com:8443/v1")

    with pytest.raises(ValueError, match="port"):
        get_ai_config()


def test_enabled_ollama_rejects_non_loopback_endpoint(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "ollama")
    monkeypatch.setenv("AI_BASE_URL", "http://collector.example:11434")

    with pytest.raises(ValueError, match="loopback"):
        get_ai_config()


def test_enabled_azure_accepts_canonical_resource_host(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "azure_openai")
    monkeypatch.setenv("AI_BASE_URL", "https://biddingflow.openai.azure.com")
    monkeypatch.delenv("AI_PROVIDER_ALLOWED_HOSTS", raising=False)

    assert get_ai_config().base_url == "https://biddingflow.openai.azure.com"


def test_enabled_azure_requires_endpoint_at_startup(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "azure_openai")
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    monkeypatch.delenv("AZURE_OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)

    with pytest.raises(ValueError, match="Azure.*URL"):
        get_ai_config()


def test_startup_rejects_unsafe_ai_provider_configuration(monkeypatch):
    monkeypatch.setattr(
        "backend.startup.database_requires_admin_bootstrap",
        lambda _database: False,
    )
    environ = {
        "APP_ENV": "development",
        "DATABASE_URL": "postgresql://runtime:secret@127.0.0.1/biddingflow",
        "AI_ENABLED": "true",
        "AI_PROVIDER": "openai",
        "AI_BASE_URL": "https://collector.example/v1",
    }

    with pytest.raises(StartupValidationError, match="AI provider"):
        validate_startup_configuration(object(), environ)


def test_enabled_provider_rejects_proxy_without_proxy_allowlist(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_PROVIDER_PROXY_URL", "https://proxy.example")
    monkeypatch.delenv("AI_PROVIDER_ALLOWED_PROXY_HOSTS", raising=False)

    with pytest.raises(ValueError, match="proxy.*allowlist"):
        get_ai_config()


def test_transport_uses_only_explicit_proxy_policy(monkeypatch):
    captured = {}

    class EmptyResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __iter__(self):
            return iter(())

    def safe_open(request, *, timeout, proxy_url=""):
        captured.update(
            url=request.full_url,
            timeout=timeout,
            proxy_url=proxy_url,
        )
        return EmptyResponse()

    monkeypatch.setattr(
        "backend.ai.providers.base.open_outbound_request",
        safe_open,
    )
    monkeypatch.setenv("HTTPS_PROXY", "https://ambient-proxy.example")

    request = urllib.request.Request("https://api.openai.com/v1/responses")
    list(
        stream_http(
            request,
            timeout_seconds=10,
            parser=iter_sse,
            allowed_hosts=("api.openai.com",),
            proxy_url="https://approved-proxy.example",
            allowed_proxy_hosts=("approved-proxy.example",),
        )
    )

    assert captured == {
        "url": "https://api.openai.com/v1/responses",
        "timeout": 10,
        "proxy_url": "https://approved-proxy.example",
    }


def test_transport_rejects_proxy_host_before_network(monkeypatch):
    def must_not_open(*_args, **_kwargs):
        raise AssertionError("unapproved proxy reached the network")

    monkeypatch.setattr(
        "backend.ai.providers.base.open_outbound_request",
        must_not_open,
    )
    request = urllib.request.Request("https://api.openai.com/v1/responses")

    with pytest.raises(AiError) as error:
        list(
            stream_http(
                request,
                timeout_seconds=10,
                parser=iter_sse,
                allowed_hosts=("api.openai.com",),
                proxy_url="https://collector.example",
                allowed_proxy_hosts=("approved-proxy.example",),
            )
        )
    assert error.value.code == "AI_PROVIDER_UNAVAILABLE"


@pytest.mark.parametrize(
    ("name", "adapter_type"),
    [
        ("openai", OpenAIResponsesAdapter),
        ("openai-compatible", OpenAIChatAdapter),
        ("claude", AnthropicAdapter),
        ("google", GeminiInteractionsAdapter),
        ("google-generate-content", GeminiGenerateContentAdapter),
        ("ollama", OllamaAdapter),
        ("azure", AzureOpenAIResponsesAdapter),
    ],
)
def test_registry_resolves_protocol_aliases(name, adapter_type):
    assert isinstance(create_provider(config(name)), adapter_type)


def test_registry_rejects_unknown_provider():
    with pytest.raises(AiError) as error:
        create_provider(config("unknown-vendor"))
    assert error.value.code == "AI_PROVIDER_UNAVAILABLE"


def test_chat_stream_normalizes_text_tool_calls_and_usage():
    raw = [
        {"id": "chat-1", "choices": [{"delta": {"content": "Đang "}}]},
        {
            "id": "chat-1",
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call-1",
                                "function": {"name": "get_package", "arguments": '{"id":'},
                            }
                        ]
                    }
                }
            ],
        },
        {
            "id": "chat-1",
            "choices": [
                {"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '"P1"}'}}]}}
            ],
        },
        {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 5}},
    ]
    events = list(normalize_chat_stream(raw))
    assert [event["delta"] for event in events if event["type"] == "response.output_text.delta"] == ["Đang "]
    done = next(event for event in events if event["type"] == "response.function_call_arguments.done")
    assert done["arguments"] == '{"id":"P1"}'
    final = completed(events)["response"]
    assert final["output"][-1]["call_id"] == "call-1"
    assert final["usage"] == {"input_tokens": 12, "output_tokens": 5}


def test_anthropic_stream_normalizes_blocks_and_cumulative_usage():
    raw = [
        {
            "type": "message_start",
            "message": {"id": "msg-1", "usage": {"input_tokens": 10, "output_tokens": 1}},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": "Tra cứu "},
        },
        {
            "type": "content_block_start",
            "index": 1,
            "content_block": {"type": "tool_use", "id": "tool-1", "name": "get_package", "input": {}},
        },
        {
            "type": "content_block_delta",
            "index": 1,
            "delta": {"type": "input_json_delta", "partial_json": '{"id":"P1"}'},
        },
        {"type": "content_block_stop", "index": 1},
        {"type": "message_delta", "usage": {"output_tokens": 7}},
        {"type": "message_stop"},
    ]
    events = list(normalize_anthropic_stream(raw))
    final = completed(events)["response"]
    assert final["output"][-1]["call_id"] == "tool-1"
    assert final["usage"] == {"input_tokens": 10, "output_tokens": 7}


def test_gemini_interactions_stream_normalizes_argument_deltas():
    raw = [
        {"event_type": "interaction.created", "interaction": {"id": "int-1"}},
        {
            "event_type": "step.start",
            "index": 0,
            "step": {"type": "thought"},
        },
        {
            "event_type": "step.delta",
            "index": 0,
            "delta": {"type": "thought_signature", "signature": "signed-context"},
        },
        {"event_type": "step.stop", "index": 0},
        {
            "event_type": "step.start",
            "index": 3,
            "step": {"type": "function_call", "id": "gem-call", "name": "get_package", "arguments": {}},
        },
        {
            "event_type": "step.delta",
            "index": 3,
            "delta": {"type": "arguments_delta", "arguments": '{"id":"P1"}'},
        },
        {"event_type": "step.stop", "index": 3},
        {
            "event_type": "interaction.completed",
            "interaction": {
                "status": "requires_action",
                "usage": {"total_input_tokens": 20, "total_output_tokens": 4},
            },
        },
    ]
    events = list(normalize_gemini_interactions_stream(raw))
    final = completed(events)["response"]
    assert final["output"][0]["call_id"] == "gem-call"
    assert final["usage"] == {"input_tokens": 20, "output_tokens": 4}
    history = final["output"][0]["provider_data"]["gemini_interaction_steps"]
    assert history[0] == {"type": "thought", "signature": "signed-context"}
    assert history[1] == {
        "type": "function_call",
        "id": "gem-call",
        "name": "get_package",
        "arguments": {"id": "P1"},
    }
    continued = interaction_steps([
        final["output"][0],
        {"type": "function_call_output", "call_id": "gem-call", "output": '{"ok":true}'},
    ])
    assert continued[0] == {"type": "thought", "signature": "signed-context"}
    assert continued[1]["type"] == "function_call"
    assert continued[2]["type"] == "function_result"
    assert continued[2]["name"] == "get_package"


def test_gemini_generate_content_preserves_thought_signature():
    raw = [
        {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "functionCall": {"id": "g1", "name": "get_package", "args": {"id": "P1"}},
                                "thoughtSignature": "signed-context",
                            }
                        ]
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 8, "candidatesTokenCount": 3},
        }
    ]
    events = list(normalize_gemini_generate_content_stream(raw))
    call = completed(events)["response"]["output"][0]
    assert call["provider_data"]["thoughtSignature"] == "signed-context"
    contents = gemini_contents(
        [call, {"type": "function_call_output", "call_id": "g1", "output": '{"ok":true}'}]
    )
    assert contents[0]["parts"][0]["thoughtSignature"] == "signed-context"
    assert contents[1]["parts"][0]["functionResponse"]["id"] == "g1"


def test_ollama_stream_normalizes_ndjson_tool_call_and_usage():
    raw = [
        {
            "message": {
                "role": "assistant",
                "tool_calls": [
                    {"function": {"index": 0, "name": "get_package", "arguments": {"id": "P1"}}}
                ],
            },
            "done": False,
        },
        {"message": {"role": "assistant", "content": "Xong"}, "done": True, "prompt_eval_count": 9, "eval_count": 2},
    ]
    events = list(normalize_ollama_stream(raw, request_sequence=2))
    final = completed(events)["response"]
    assert final["output"][-1]["call_id"] == "ollama_2_0"
    assert final["usage"] == {"input_tokens": 9, "output_tokens": 2}


def test_continuation_history_is_converted_for_each_protocol():
    history = [
        {"role": "user", "content": "Gói P1?"},
        {"type": "function_call", "call_id": "c1", "name": "get_package", "arguments": '{"id":"P1"}'},
        {"type": "function_call_output", "call_id": "c1", "output": '{"name":"Gói 1"}'},
    ]
    chat = chat_messages(history, "policy")
    assert chat[-2]["tool_calls"][0]["id"] == "c1"
    assert chat[-1] == {"role": "tool", "tool_call_id": "c1", "content": '{"name":"Gói 1"}'}

    claude = anthropic_messages(history)
    assert claude[-2]["content"][0]["type"] == "tool_use"
    assert claude[-1]["content"][0]["tool_use_id"] == "c1"

    steps = interaction_steps(history)
    assert steps[-2]["type"] == "function_call"
    assert steps[-1]["type"] == "function_result"
    assert steps[-1]["call_id"] == "c1"


def test_provider_request_shapes_and_azure_auth():
    chat = OpenAIChatAdapter(config("openai_chat"))
    chat_body = chat._body([{"role": "user", "content": "Hi"}], "policy", [TOOL])
    assert chat_body["messages"][0] == {"role": "system", "content": "policy"}
    assert chat_body["tools"][0]["function"]["parameters"]["additionalProperties"] is False

    anthropic = AnthropicAdapter(config("anthropic", provider_version="2023-06-01"))
    assert anthropic._headers()["anthropic-version"] == "2023-06-01"
    assert anthropic._body([{"role": "user", "content": "Hi"}], "policy", [TOOL])["tools"][0]["input_schema"] == TOOL["parameters"]

    gemini = GeminiInteractionsAdapter(config("gemini"))
    gemini_body = gemini._body([{"role": "user", "content": "Hi"}], "policy", [TOOL])
    assert gemini_body["store"] is False
    assert gemini_body["tools"][0]["type"] == "function"

    azure = AzureOpenAIResponsesAdapter(
        config(
            "azure_openai",
            base_url="https://resource.openai.azure.com",
            api_version="v1",
            auth_type="api_key",
        )
    )
    assert azure._url() == "https://resource.openai.azure.com/openai/v1/responses?api-version=v1"
    assert azure._headers()["api-key"] == "secret"


class LinesResponse:
    def __init__(self, lines):
        self.lines = lines

    def __iter__(self):
        return iter(self.lines)


def test_stream_parsers_fail_closed_on_malformed_payloads():
    with pytest.raises(ValueError):
        list(iter_sse(LinesResponse([b"data: {broken}\n", b"\n"])))
    with pytest.raises(ValueError):
        list(iter_ndjson(LinesResponse([b"{broken}\n"])))


def test_http_429_maps_to_public_rate_limit_error(monkeypatch):
    def fail(_request, *, timeout, proxy_url=""):
        del timeout, proxy_url
        raise urllib.error.HTTPError("https://provider.example", 429, "limited", {}, None)

    monkeypatch.setattr("backend.ai.providers.base.open_outbound_request", fail)
    request = urllib.request.Request("https://provider.example")
    with pytest.raises(AiError) as error:
        list(stream_http(request, timeout_seconds=10, parser=iter_sse))
    assert error.value.code == "AI_RATE_LIMITED"


def test_transport_timeout_maps_to_public_timeout_error(monkeypatch):
    def fail(_request, *, timeout, proxy_url=""):
        del timeout, proxy_url
        raise TimeoutError("slow provider")

    monkeypatch.setattr("backend.ai.providers.base.open_outbound_request", fail)
    request = urllib.request.Request("https://provider.example")
    with pytest.raises(AiError) as error:
        list(stream_http(request, timeout_seconds=10, parser=iter_sse))
    assert error.value.code == "AI_PROVIDER_TIMEOUT"


def test_transport_rejects_request_host_before_network(monkeypatch):
    def must_not_open(*_args, **_kwargs):
        raise AssertionError("unsafe provider request reached the network")

    monkeypatch.setattr(urllib.request, "urlopen", must_not_open)
    request = urllib.request.Request("https://collector.example/v1/responses")
    with pytest.raises(AiError) as error:
        list(
            stream_http(
                request,
                timeout_seconds=10,
                parser=iter_sse,
                allowed_hosts=("api.openai.com",),
            )
        )
    assert error.value.code == "AI_PROVIDER_UNAVAILABLE"


def test_provider_adapter_applies_configured_host_policy(monkeypatch):
    def must_not_open(*_args, **_kwargs):
        raise AssertionError("unsafe adapter request reached the network")

    monkeypatch.setattr(urllib.request, "urlopen", must_not_open)
    adapter = OpenAIResponsesAdapter(
        config(
            "openai",
            base_url="https://collector.example/v1",
            provider_allowed_hosts=("api.openai.com",),
        )
    )

    with pytest.raises(AiError) as error:
        list(
            adapter.stream_response(
                input_items=[{"role": "user", "content": "hello"}],
                instructions="policy",
                tools=[],
            )
        )
    assert error.value.code == "AI_PROVIDER_UNAVAILABLE"


def test_provider_adapter_passes_approved_proxy_to_transport(monkeypatch):
    captured = {}

    class EmptyResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __iter__(self):
            return iter(())

    def safe_open(request, *, timeout, proxy_url=""):
        captured.update(url=request.full_url, timeout=timeout, proxy_url=proxy_url)
        return EmptyResponse()

    monkeypatch.setattr(
        "backend.ai.providers.base.open_outbound_request",
        safe_open,
    )
    adapter = OpenAIResponsesAdapter(
        config(
            "openai",
            base_url="https://api.openai.com/v1",
            provider_allowed_hosts=("api.openai.com",),
            provider_proxy_url="https://approved-proxy.example",
            provider_allowed_proxy_hosts=("approved-proxy.example",),
        )
    )

    list(
        adapter.stream_response(
            input_items=[{"role": "user", "content": "hello"}],
            instructions="policy",
            tools=[],
        )
    )

    assert captured["proxy_url"] == "https://approved-proxy.example"


@pytest.mark.parametrize(
    "provider",
    (
        "openai_chat",
        "anthropic",
        "gemini_interactions",
        "gemini_generate_content",
        "azure_openai",
        "azure_openai_chat",
    ),
)
def test_every_hosted_provider_adapter_applies_host_policy(monkeypatch, provider):
    def must_not_open(*_args, **_kwargs):
        raise AssertionError("unsafe adapter request reached the network")

    monkeypatch.setattr(urllib.request, "urlopen", must_not_open)
    adapter = create_provider(
        config(
            provider,
            base_url="https://collector.example/v1",
            provider_allowed_hosts=("provider.example",),
        )
    )

    with pytest.raises(AiError) as error:
        list(
            adapter.stream_response(
                input_items=[{"role": "user", "content": "hello"}],
                instructions="policy",
                tools=[],
            )
        )
    assert error.value.code == "AI_PROVIDER_UNAVAILABLE"


def test_ollama_adapter_rechecks_loopback_policy_at_request_time(monkeypatch):
    def must_not_open(*_args, **_kwargs):
        raise AssertionError("unsafe Ollama request reached the network")

    monkeypatch.setattr(urllib.request, "urlopen", must_not_open)
    adapter = OllamaAdapter(
        config("ollama", base_url="http://collector.example:11434")
    )

    with pytest.raises(AiError) as error:
        list(
            adapter.stream_response(
                input_items=[{"role": "user", "content": "hello"}],
                instructions="policy",
                tools=[],
            )
        )
    assert error.value.code == "AI_PROVIDER_UNAVAILABLE"


def test_transport_blocks_redirect_before_reaching_redirected_host():
    class RedirectHandler(BaseHTTPRequestHandler):
        redirected_target_reached = False

        def do_GET(self):
            if self.path == "/start":
                self.send_response(302)
                self.send_header(
                    "Location",
                    f"http://localhost:{self.server.server_port}/target",
                )
                self.end_headers()
                return
            type(self).redirected_target_reached = True
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/start"
        )
        with pytest.raises(AiError) as error:
            list(
                stream_http(
                    request,
                    timeout_seconds=10,
                    parser=lambda _response: (),
                    allow_loopback_http=True,
                )
            )
        assert error.value.code == "AI_PROVIDER_UNAVAILABLE"
        assert RedirectHandler.redirected_target_reached is False
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_transport_ignores_ambient_proxy_environment(monkeypatch):
    class OkHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_args):
            return

    monkeypatch.setenv("HTTP_PROXY", "http://ambient-proxy.invalid")
    monkeypatch.setenv("HTTPS_PROXY", "https://ambient-proxy.invalid")
    monkeypatch.setattr(
        urllib.request,
        "getproxies",
        lambda: (_ for _ in ()).throw(
            AssertionError("ambient proxy discovery must remain disabled")
        ),
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), OkHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/health"
        )
        assert list(
            stream_http(
                request,
                timeout_seconds=10,
                parser=lambda _response: (),
                allow_loopback_http=True,
            )
        ) == []
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
