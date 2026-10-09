"""Reported provider usage must survive adapter errors and stream cancellation."""

import asyncio
from dataclasses import replace
import threading
import time
from types import SimpleNamespace

import pytest

from backend.ai import service
from backend.ai.configuration import get_ai_config
from backend.ai.providers.anthropic import normalize_anthropic_stream
from backend.ai.providers.gemini_generate_content import normalize_gemini_generate_content_stream
from backend.ai.providers.gemini_interactions import normalize_gemini_interactions_stream
from backend.ai.providers.ollama import normalize_ollama_stream
from backend.ai.providers.openai_chat import normalize_chat_stream
from backend.ai.providers import openai_responses
from backend.ai.quota_service import TokenReservation
from backend.ai.types import AiRequestContext


CASES = [
    pytest.param(normalize_chat_stream,
                 {"usage": {"prompt_tokens": 70, "completion_tokens": 40}, "choices": []},
                 {"choices": [{"delta": {"content": "Partial"}}]},
                 {"type": "error", "error": {"message": "failed"}}, id="openai-chat"),
    pytest.param(normalize_anthropic_stream,
                 {"type": "message_start", "message": {
                     "id": "m-1", "usage": {"input_tokens": 70, "output_tokens": 40}}},
                 {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Partial"}},
                 {"type": "error", "error": {"message": "failed"}}, id="anthropic"),
    pytest.param(normalize_gemini_generate_content_stream,
                 {"usageMetadata": {"promptTokenCount": 70, "candidatesTokenCount": 40}},
                 {"candidates": [{"content": {"parts": [{"text": "Partial"}]}}]},
                 {"error": {"message": "failed"}}, id="gemini-generate"),
    pytest.param(normalize_gemini_interactions_stream,
                 {"event_type": "interaction.created", "interaction": {
                     "id": "i-1", "usage": {"total_input_tokens": 70, "total_output_tokens": 40}}},
                 {"event_type": "step.delta", "delta": {"type": "text", "text": "Partial"}},
                 {"event_type": "interaction.failed", "error": {"message": "failed"}}, id="gemini-interactions"),
    pytest.param(normalize_ollama_stream,
                 {"done": True, "prompt_eval_count": 70, "eval_count": 40},
                 {"message": {"content": "Partial"}},
                 {"error": "failed"}, id="ollama"),
]


def observed_usage(event):
    return (event.get("response") or {}).get("usage") or event.get("usage") or {}


@pytest.mark.parametrize("normalize,usage_event,text_event,error_event", CASES)
def test_adapter_preserves_usage_before_native_error(normalize, usage_event, text_event, error_event):
    events = list(normalize([usage_event, error_event]))
    assert any(observed_usage(event) == {"input_tokens": 70, "output_tokens": 40}
               for event in events[:-1])
    assert events[-1]["type"] == "error"
    assert observed_usage(events[-1]) == {"input_tokens": 70, "output_tokens": 40}


@pytest.mark.parametrize("normalize,usage_event,text_event,error_event", CASES)
def test_native_error_without_usage_does_not_create_token_usage(normalize, usage_event, text_event, error_event):
    events = list(normalize([text_event, error_event]))
    assert all(not observed_usage(event) for event in events)


@pytest.mark.parametrize("normalize,usage_event,text_event,error_event", CASES)
def test_adapter_completion_without_reported_usage_keeps_usage_unknown(normalize, usage_event, text_event, error_event):
    events = list(normalize([text_event]))
    assert events[-1]["type"] == "response.completed"
    assert all(not observed_usage(event) for event in events)


@pytest.mark.parametrize("normalize,native,expected", [
    (normalize_chat_stream, [
        {"usage": {"prompt_tokens": 70, "completion_tokens": 40}},
        {"usage": {"prompt_tokens": 72}},
        {"usage": {"prompt_tokens": 50, "completion_tokens": 20}},
    ], {"input_tokens": 72, "output_tokens": 40}),
    (normalize_anthropic_stream, [
        {"type": "message_start", "message": {"usage": {
            "input_tokens": 70, "cache_creation_input_tokens": 10,
            "cache_read_input_tokens": 5, "output_tokens": 40}}},
        {"type": "message_delta", "usage": {"input_tokens": 75}},
        {"type": "message_delta", "usage": {"cache_creation_input_tokens": 5, "output_tokens": 20}},
    ], {"input_tokens": 90, "output_tokens": 40}),
    (normalize_gemini_generate_content_stream, [
        {"usageMetadata": {"promptTokenCount": 70, "toolUsePromptTokenCount": 10,
                           "candidatesTokenCount": 30, "thoughtsTokenCount": 10}},
        {"usageMetadata": {"promptTokenCount": 75, "candidatesTokenCount": 33}},
        {"usageMetadata": {"promptTokenCount": 50, "candidatesTokenCount": 20}},
    ], {"input_tokens": 85, "output_tokens": 43}),
    (normalize_gemini_interactions_stream, [
        {"event_type": "interaction.created", "interaction": {"usage": {
            "total_input_tokens": 70, "total_output_tokens": 30,
            "total_thought_tokens": 10, "total_tool_use_tokens": 5}}},
        {"event_type": "interaction.completed", "interaction": {"usage": {"total_output_tokens": 33}}},
        {"event_type": "interaction.completed", "interaction": {"usage": {"total_output_tokens": 20}}},
    ], {"input_tokens": 70, "output_tokens": 48}),
    (normalize_gemini_interactions_stream, [
        {"event_type": "interaction.created", "interaction": {"usage": {
            "total_input_tokens": 70, "total_output_tokens": 30, "total_thought_tokens": 10}}},
        {"event_type": "interaction.completed", "interaction": {"usage": {
            "prompt_tokens": 75, "completion_tokens": 33}}},
    ], {"input_tokens": 75, "output_tokens": 43}),
    (normalize_ollama_stream, [
        {"done": True, "prompt_eval_count": 70, "eval_count": 40},
        {"done": True, "prompt_eval_count": 72},
        {"done": True, "prompt_eval_count": 50, "eval_count": 20},
    ], {"input_tokens": 72, "output_tokens": 40}),
], ids=["openai-chat", "anthropic-cache", "gemini-generate-thoughts", "gemini-interactions-thoughts", "gemini-interactions-aliases", "ollama"])
def test_partial_duplicate_or_lower_native_counters_keep_observed_totals(normalize, native, expected):
    events = list(normalize(native))
    assert observed_usage(events[-1]) == expected
    assert observed_usage(events[0]) != expected, "Usage snapshots must not alias later updates"


@pytest.mark.parametrize("terminal", ["error", "interaction.failed", "interaction.cancelled"])
def test_gemini_terminal_event_keeps_usage_reported_on_the_same_event(terminal):
    events = list(normalize_gemini_interactions_stream([{
        "event_type": terminal, "error": {"message": "failed"},
        "interaction": {"usage": {"total_input_tokens": 9, "total_output_tokens": 4}},
    }]))
    assert events[-1]["type"] == "error"
    assert observed_usage(events[-1]) == {"input_tokens": 9, "output_tokens": 4}


@pytest.fixture
def accounting_stream(monkeypatch):
    context = AiRequestContext(
        user_id="user-1", organization_id="org-1", organization_name="Workspace",
        platform_role="user", membership_role="manager", scope_type="organization",
    )
    config = SimpleNamespace(
        enabled=True, max_message_chars=1000, max_history_messages=10,
        knowledge_enabled=False, web_search_enabled=False, max_output_tokens=100,
        max_tool_calls_per_message=3, model="fake-local", tool_timeout_seconds=5,
    )
    reservation = TokenReservation("reservation-1", "2026-10-09", "org-1", "user-1", 100)
    state = SimpleNamespace(context=context, config=config, reservation=reservation,
                            settled=[], released=[], provider=None)

    async def read(function, *_args, **_kwargs):
        if function is service.get_conversation:
            return {"mode": "app_help"}
        if function is service.list_messages:
            return [{"role": "user", "content": "Hello"}]
        raise AssertionError(f"Unexpected read: {function}")

    async def write(function, *args, **_kwargs):
        if function is service.reserve_tokens:
            return reservation
        if function is service.settle_token_reservation:
            state.settled.append(args[1:])
            return True
        if function is service.release_token_reservation:
            state.released.append(args[0])
            return True
        if function is service.add_message:
            return "message-1"
        if function is service.record_tokens:
            return None
        raise AssertionError(f"Unexpected write: {function}")

    monkeypatch.setattr(service, "get_ai_config", lambda: config)
    monkeypatch.setattr(service, "run_database_read", read)
    monkeypatch.setattr(service, "run_database_write", write)
    monkeypatch.setattr(service, "ResponsesProvider", lambda _config: state.provider)
    monkeypatch.setattr(service, "audit_chat", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "increment", lambda *_args, **_kwargs: None)
    return state


class NormalizedProvider:
    def __init__(self, normalize, native_events):
        self.normalize = normalize
        self.native_events = native_events
        self.cancelled = threading.Event()

    def stream_response(self, **_kwargs):
        return self.normalize(self.native_events())

    def cancel(self):
        self.cancelled.set()


@pytest.mark.parametrize("normalize,usage_event,text_event,error_event", CASES)
def test_real_adapter_and_service_settle_observed_usage_on_failure(
    accounting_stream, normalize, usage_event, text_event, error_event,
):
    state = accounting_stream
    state.provider = NormalizedProvider(normalize, lambda: iter([usage_event, text_event, error_event]))

    async def scenario():
        events = [event async for event in service.stream_message(
            SimpleNamespace(), state.context, "conversation-1", "Hello", quota_consumed=True,
        )]
        assert events[-1]["type"] == "message.failed"
        assert state.settled == [(70, 40)]
        assert state.released == []

    asyncio.run(scenario())


@pytest.mark.parametrize("reported", [True, False], ids=["known-usage", "unknown-usage"])
@pytest.mark.parametrize("normalize,usage_event,text_event,error_event", CASES)
def test_real_adapter_and_service_cancel_preserves_only_reported_usage(
    accounting_stream, normalize, usage_event, text_event, error_event, reported,
):
    state = accounting_stream

    def native_events():
        if reported:
            yield usage_event
        yield text_event
        assert state.provider.cancelled.wait(timeout=5), "provider must be cancelled"

    state.provider = NormalizedProvider(normalize, native_events)

    async def scenario():
        stream = service.stream_message(
            SimpleNamespace(), state.context, "conversation-1", "Hello", quota_consumed=True,
        )
        assert (await anext(stream))["type"] == "message.started"
        assert (await anext(stream))["type"] == "message.delta"
        pending = asyncio.create_task(anext(stream))
        await asyncio.sleep(0)
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        await stream.aclose()
        assert state.settled == ([(70, 40)] if reported else [])
        assert state.released == ([] if reported else [state.reservation])

    asyncio.run(scenario())


@pytest.mark.parametrize("normalize,usage_event,text_event,error_event", CASES)
def test_real_adapter_transport_failure_after_reported_usage_keeps_accounting(
    accounting_stream, normalize, usage_event, text_event, error_event,
):
    state = accounting_stream

    def native_events():
        yield usage_event
        raise OSError("stream interrupted")

    state.provider = NormalizedProvider(normalize, native_events)

    async def scenario():
        events = [event async for event in service.stream_message(
            SimpleNamespace(), state.context, "conversation-1", "Hello", quota_consumed=True,
        )]
        assert events[-1]["type"] == "message.failed"
        assert state.settled == [(70, 40)]
        assert state.released == []

    asyncio.run(scenario())


@pytest.mark.parametrize("terminal", ["error", "response.failed", "response.incomplete"])
@pytest.mark.parametrize("reported", [True, False], ids=["known-usage", "unknown-usage"])
def test_openai_responses_adapter_and_service_keep_terminal_usage(
    monkeypatch, accounting_stream, terminal, reported,
):
    state = accounting_stream
    terminal_event = {"type": terminal, "response": {
        **({"usage": {"input_tokens": 9, "output_tokens": 4}} if reported else {}),
    }}
    monkeypatch.setattr(openai_responses, "stream_http", lambda *_args, **_kwargs: iter([terminal_event]))
    state.provider = openai_responses.OpenAIResponsesAdapter(replace(
        get_ai_config(), api_key="test-only-provider-key", model="test-model",
    ))

    async def scenario():
        events = [event async for event in service.stream_message(
            SimpleNamespace(), state.context, "conversation-1", "Hello", quota_consumed=True,
        )]
        assert events[-1]["type"] == "message.failed"
        assert state.settled == ([(9, 4)] if reported else [])
        assert state.released == ([] if reported else [state.reservation])

    asyncio.run(scenario())


@pytest.mark.parametrize("shutdown", ["close", "cancel"])
@pytest.mark.parametrize("normalize,usage_event,text_event,error_event", CASES)
def test_queued_observed_usage_is_settled_even_if_service_never_receives_it(
    accounting_stream, normalize, usage_event, text_event, error_event, shutdown,
):
    state = accounting_stream
    queued = threading.Event()
    native_usage_event = usage_event
    if normalize is normalize_anthropic_stream:
        native_usage_event = {"type": "message_delta", "usage": usage_event["message"]["usage"]}
    elif normalize is normalize_gemini_interactions_stream:
        native_usage_event = {**usage_event, "event_type": "interaction.completed"}

    def native_events():
        yield text_event
        yield native_usage_event
        queued.set()
        assert state.provider.cancelled.wait(timeout=5), "provider must be stopped during cleanup"

    state.provider = NormalizedProvider(normalize, native_events)

    async def scenario():
        stream = service.stream_message(
            SimpleNamespace(), state.context, "conversation-1", "Hello", quota_consumed=True,
        )
        assert (await anext(stream))["type"] == "message.started"
        assert (await anext(stream))["type"] == "message.delta"
        assert await asyncio.to_thread(queued.wait, 1), "actual usage must reach the producer queue"
        if shutdown == "close":
            await stream.aclose()
        else:
            close_task = asyncio.create_task(stream.aclose())
            await asyncio.sleep(0)
            close_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await close_task
        assert state.settled == [(70, 40)]
        assert state.released == []
        assert state.provider.cancelled.is_set()

    try:
        asyncio.run(scenario())
    finally:
        state.provider.cancel()


@pytest.mark.parametrize("cancel_count", [0, 1, 2])
def test_blocked_producer_cleanup_is_bounded_and_late_usage_cannot_change_settled_snapshot(
    monkeypatch, accounting_stream, cancel_count,
):
    state = accounting_stream
    queued, release_producer, stopped = (threading.Event() for _ in range(3))
    handles = []
    original_bridge = service._provider_event_stream

    def bridge(*args):
        handle = original_bridge(*args)
        handles.append(handle)
        return handle

    def native_events():
        try:
            yield {"choices": [{"delta": {"content": "Partial"}}]}
            yield {"usage": {"prompt_tokens": 70, "completion_tokens": 40}, "choices": []}
            queued.set()
            # Simulate network I/O which the provider's cancel hook cannot abort.
            assert release_producer.wait(timeout=5)
            yield {"usage": {"prompt_tokens": 80, "completion_tokens": 50}, "choices": []}
        finally:
            stopped.set()

    state.provider = NormalizedProvider(normalize_chat_stream, native_events)
    monkeypatch.setattr(service, "_provider_event_stream", bridge)
    monkeypatch.setattr(service, "_PROVIDER_STOP_TIMEOUT_SECONDS", 0.05)

    async def scenario():
        stream = service.stream_message(
            SimpleNamespace(), state.context, "conversation-1", "Hello", quota_consumed=True,
        )
        assert (await anext(stream))["type"] == "message.started"
        assert (await anext(stream))["type"] == "message.delta"
        assert await asyncio.to_thread(queued.wait, 1)
        closing = asyncio.create_task(stream.aclose())
        for _ in range(cancel_count):
            await asyncio.sleep(0.005)
            closing.cancel()
        started = time.monotonic()
        if cancel_count:
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(closing, timeout=1)
        else:
            await asyncio.wait_for(closing, timeout=1)
        assert time.monotonic() - started < 1
        assert state.settled == [(70, 40)]
        assert state.released == []
        assert not stopped.is_set(), "cleanup must not wait for an uninterruptible provider"
        assert handles[0].observed_usage() == {"input_tokens": 70, "output_tokens": 40}
        release_producer.set()
        assert await asyncio.to_thread(stopped.wait, 1)
        assert handles[0].observed_usage() == {"input_tokens": 70, "output_tokens": 40}
        assert state.settled == [(70, 40)], "producer completion must not create another ledger write"

    try:
        asyncio.run(scenario())
    finally:
        release_producer.set()
        state.provider.cancel()
