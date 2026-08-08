from dataclasses import replace
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
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "legacy-secret")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://legacy.example/v1")
    value = get_ai_config()
    assert value.api_key == "legacy-secret"
    assert value.base_url == "https://legacy.example/v1"


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
    def fail(_request, timeout):
        del timeout
        raise urllib.error.HTTPError("https://provider.example", 429, "limited", {}, None)

    monkeypatch.setattr(urllib.request, "urlopen", fail)
    request = urllib.request.Request("https://provider.example")
    with pytest.raises(AiError) as error:
        list(stream_http(request, timeout_seconds=10, parser=iter_sse))
    assert error.value.code == "AI_RATE_LIMITED"


def test_transport_timeout_maps_to_public_timeout_error(monkeypatch):
    def fail(_request, timeout):
        del timeout
        raise TimeoutError("slow provider")

    monkeypatch.setattr(urllib.request, "urlopen", fail)
    request = urllib.request.Request("https://provider.example")
    with pytest.raises(AiError) as error:
        list(stream_http(request, timeout_seconds=10, parser=iter_sse))
    assert error.value.code == "AI_PROVIDER_TIMEOUT"
