"""Cancellation must release AI resources at the actual stream boundaries."""

import asyncio
from types import SimpleNamespace

import pytest

from backend.ai import routes, service
from backend.ai.quota_service import TokenReservation
from backend.ai.types import AiRequestContext


@pytest.fixture
def stream_context(monkeypatch):
    context = AiRequestContext(
        user_id="user-1", organization_id="org-1", organization_name="Workspace",
        platform_role="user", membership_role="manager", scope_type="organization",
    )
    config = SimpleNamespace(
        enabled=True, max_message_chars=1000, max_history_messages=10,
        knowledge_enabled=False, web_search_enabled=False, max_output_tokens=100,
        max_tool_calls_per_message=3, model="fake-local",
        tool_timeout_seconds=5,
    )
    reservation = TokenReservation("reservation-1", "2026-10-06", "org-1", "user-1", 100)
    state = SimpleNamespace(context=context, config=config, reservation=reservation,
                            released=[], settled=[], settled_usage=[], estimates=[], provider_calls=[])

    async def read(function, *_args, **_kwargs):
        if function is service.get_conversation:
            return {"mode": "app_help"}
        if function is service.list_messages:
            return [{"role": "user", "content": "Hello"}]
        raise AssertionError(f"Unexpected read: {function}")

    async def write(function, *args, **_kwargs):
        if function is service.reserve_tokens:
            state.estimates.append(args[1])
            return reservation
        if function is service.release_token_reservation:
            state.released.append(args[0])
            return True
        if function is service.settle_token_reservation:
            state.settled.append(args[0])
            state.settled_usage.append(args[1:])
            return True
        if function is service.add_message:
            return "message-1"
        if function is service.record_tokens:
            return None
        raise AssertionError(f"Unexpected write: {function}")

    async def provider_events(*_args):
        state.provider_calls.append(True)
        yield {"type": "response.output_text.delta", "delta": "Hello"}
        yield {"type": "response.completed", "response": {
            "output": [], "usage": {"input_tokens": 1, "output_tokens": 1},
        }}

    monkeypatch.setattr(service, "get_ai_config", lambda: config)
    monkeypatch.setattr(service, "run_database_read", read)
    monkeypatch.setattr(service, "run_database_write", write)
    monkeypatch.setattr(service, "ResponsesProvider", lambda _config: object())
    monkeypatch.setattr(service, "_provider_event_stream", provider_events)
    monkeypatch.setattr(service, "audit_chat", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "increment", lambda *_args, **_kwargs: None)
    return state


def test_close_after_started_event_releases_unspent_reservation(stream_context):
    async def scenario():
        stream = service.stream_message(SimpleNamespace(), stream_context.context,
                                        "conversation-1", "Hello", quota_consumed=True)
        assert (await anext(stream))["type"] == "message.started"
        await stream.aclose()
        assert stream_context.released == [stream_context.reservation]
        assert stream_context.provider_calls == []

    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_count", [1, 2])
def test_cancel_while_reservation_commits_releases_result(monkeypatch, stream_context, cancel_count):
    async def scenario():
        started, finish = asyncio.Event(), asyncio.Event()
        original_write = service.run_database_write
        committed = []

        async def write(function, *args, **kwargs):
            if function is service.reserve_tokens:
                async def commit():
                    started.set()
                    await finish.wait()
                    committed.append(stream_context.reservation)
                    return stream_context.reservation

                # The real mutation lane shields work that can still commit.
                return await asyncio.shield(asyncio.create_task(commit()))
            return await original_write(function, *args, **kwargs)

        monkeypatch.setattr(service, "run_database_write", write)
        stream = service.stream_message(SimpleNamespace(), stream_context.context,
                                        "conversation-1", "Hello", quota_consumed=True)
        task = asyncio.create_task(anext(stream))
        await started.wait()
        for _ in range(cancel_count):
            task.cancel()
            await asyncio.sleep(0)
        finish.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        await stream.aclose()
        assert committed == [stream_context.reservation]
        assert stream_context.released == committed

    asyncio.run(scenario())


def test_completed_stream_settles_without_releasing(stream_context):
    async def scenario():
        events = [event async for event in service.stream_message(
            SimpleNamespace(), stream_context.context, "conversation-1", "Hello",
            quota_consumed=True,
        )]
        assert events[-1]["type"] == "message.completed"
        assert stream_context.settled == [stream_context.reservation]
        assert stream_context.released == []

    asyncio.run(scenario())


def test_partial_or_duplicate_usage_events_do_not_erase_observed_tokens(monkeypatch, stream_context):
    async def provider(*_args):
        yield {"type": "response.completed", "response": {
            "output": [], "usage": {"input_tokens": 10, "output_tokens": 5}}}
        yield {"type": "error", "usage": {"output_tokens": 2}}
    monkeypatch.setattr(service, "_provider_event_stream", provider)
    async def scenario():
        events = [event async for event in service.stream_message(
            SimpleNamespace(), stream_context.context, "conversation-1", "Hello", quota_consumed=True)]
        assert events[-1]["type"] == "message.failed"
        assert stream_context.settled_usage == [(10, 5)]
        assert stream_context.released == []
    asyncio.run(scenario())


def test_tool_argument_failure_preserves_completed_provider_usage(monkeypatch, stream_context):
    async def provider_events(*args):
        yield {"type": "response.output_item.added", "item": {
            "type": "function_call", "name": "query", "arguments": "invalid JSON", "call_id": "call-1",
        }}
        yield {"type": "response.completed", "response": {
            "output": [], "usage": {"input_tokens": 70, "output_tokens": 30},
        }}

    monkeypatch.setattr(service, "_provider_event_stream", provider_events)

    async def scenario():
        events = [event async for event in service.stream_message(
            SimpleNamespace(), stream_context.context, "conversation-1", "Hello", quota_consumed=True,
        )]
        assert events[-1]["code"] == "AI_TOOL_INVALID_ARGUMENTS"
        assert stream_context.settled_usage == [(70, 30)]
        assert stream_context.released == []

    asyncio.run(scenario())


def test_cancel_after_known_provider_usage_settles_actual_tokens(monkeypatch, stream_context):
    async def scenario():
        usage_seen = asyncio.Event()

        async def provider_events(*args):
            yield {"type": "response.completed", "response": {
                "output": [], "usage": {"input_tokens": 11, "output_tokens": 7},
            }}
            usage_seen.set()
            await asyncio.Event().wait()

        monkeypatch.setattr(service, "_provider_event_stream", provider_events)
        stream = service.stream_message(SimpleNamespace(), stream_context.context, "conversation-1", "Hello", quota_consumed=True)
        assert (await anext(stream))["type"] == "message.started"
        task = asyncio.create_task(anext(stream))
        await usage_seen.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await stream.aclose()
        assert stream_context.settled_usage == [(11, 7)]
        assert stream_context.released == []

    asyncio.run(scenario())


@pytest.mark.parametrize("terminal", ["error", "response.failed", "response.incomplete"])
def test_provider_failure_with_reported_usage_preserves_actual_tokens(monkeypatch, stream_context, terminal):
    async def provider_events(*args):
        yield {"type": terminal, "response": {"usage": {"input_tokens": 9, "output_tokens": 4}}}

    monkeypatch.setattr(service, "_provider_event_stream", provider_events)

    async def scenario():
        events = [event async for event in service.stream_message(
            SimpleNamespace(), stream_context.context, "conversation-1", "Hello", quota_consumed=True,
        )]
        assert events[-1]["code"] == "AI_PROVIDER_UNAVAILABLE"
        assert stream_context.settled_usage == [(9, 4)]
        assert stream_context.released == []

    asyncio.run(scenario())


def test_provider_without_reported_usage_releases_estimate_without_charging_it(monkeypatch, stream_context):
    async def provider_events(*args):
        yield {"type": "error"}

    monkeypatch.setattr(service, "_provider_event_stream", provider_events)

    async def scenario():
        events = [event async for event in service.stream_message(
            SimpleNamespace(), stream_context.context, "conversation-1", "Hello", quota_consumed=True,
        )]
        assert events[-1]["code"] == "AI_PROVIDER_UNAVAILABLE"
        assert stream_context.settled_usage == []
        assert stream_context.released == [stream_context.reservation]

    asyncio.run(scenario())


def _install_tool_round(monkeypatch, state):
    class ToolResult:
        summary = {"source": "x" * 2000}
        source_links = []
        record_count = 1

        def as_dict(self):
            return {"summary": self.summary}

    original_read, original_write = service.run_database_read, service.run_database_write

    async def read(function, *args, **kwargs):
        if function is service.execute_tool:
            return ToolResult(), {"duration_ms": 1, "arguments_redacted": {}}
        return await original_read(function, *args, **kwargs)

    async def write(function, *args, **kwargs):
        if function is service.add_tool_execution:
            return "execution-1"
        return await original_write(function, *args, **kwargs)

    async def provider_events(*args):
        state.provider_calls.append(len(state.provider_calls) + 1)
        output = []
        if len(state.provider_calls) == 1:
            call = {"type": "function_call", "name": "query", "arguments": "{}", "call_id": "call-1"}
            yield {"type": "response.output_item.added", "item": call}
            output = [call]
        else:
            yield {"type": "response.output_text.delta", "delta": "Final answer"}
        yield {"type": "response.completed", "response": {
            "output": output, "usage": {"input_tokens": 7, "output_tokens": 3},
        }}

    monkeypatch.setattr(service, "run_database_read", read)
    monkeypatch.setattr(service, "run_database_write", write)
    monkeypatch.setattr(service, "_provider_event_stream", provider_events)
    monkeypatch.setattr(service, "format_tool_result", lambda result: "x" * 2000)
    monkeypatch.setattr(service, "audit_tool_execution", lambda *args, **kwargs: None)


def test_next_provider_round_reserves_updated_tool_history_before_fetch(monkeypatch, stream_context):
    _install_tool_round(monkeypatch, stream_context)

    async def scenario():
        events = [event async for event in service.stream_message(
            SimpleNamespace(), stream_context.context, "conversation-1", "Hello", quota_consumed=True,
        )]
        assert events[-1]["type"] == "message.completed"
        assert stream_context.provider_calls == [1, 2]
        assert len(stream_context.estimates) == 2
        assert stream_context.estimates[1] > stream_context.estimates[0]
        assert stream_context.settled_usage == [(7, 3), (7, 3)]
        assert stream_context.released == []

    asyncio.run(scenario())


def test_next_round_quota_rejection_stops_provider_and_keeps_prior_usage(monkeypatch, stream_context):
    _install_tool_round(monkeypatch, stream_context)
    original_write = service.run_database_write
    attempts = []

    async def write(function, *args, **kwargs):
        if function is service.reserve_tokens:
            attempts.append(args[1])
            if len(attempts) == 2:
                raise service.ai_error("AI_QUOTA_EXCEEDED", "No quota for the next provider round")
        return await original_write(function, *args, **kwargs)

    monkeypatch.setattr(service, "run_database_write", write)

    async def scenario():
        events = [event async for event in service.stream_message(
            SimpleNamespace(), stream_context.context, "conversation-1", "Hello", quota_consumed=True,
        )]
        assert events[-1]["code"] == "AI_QUOTA_EXCEEDED"
        assert stream_context.provider_calls == [1]
        assert len(attempts) == 2
        assert attempts[1] > attempts[0]
        assert stream_context.settled_usage == [(7, 3)]
        assert stream_context.released == []

    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_count", [1, 2])
def test_route_transport_cancellation_stops_pending_next_event(monkeypatch, stream_context, cancel_count):
    async def scenario():
        started, closing, finish, closed = (asyncio.Event() for _ in range(4))
        increments = []

        async def provider_stream(*_args, **_kwargs):
            try:
                started.set()
                await asyncio.Event().wait()
                yield {"type": "never-reached"}
            finally:
                closing.set()
                await finish.wait()
                closed.set()

        async def authenticated(_request):
            return stream_context.context, None

        async def read_body(_request):
            return {"content": "Hello"}, None

        async def no_database(*_args, **_kwargs):
            return None

        class Request:
            path_params = {"conversation_id": "conversation-1"}

            async def is_disconnected(self):
                return False

        monkeypatch.setattr(routes, "_context_or_response", authenticated)
        monkeypatch.setattr(routes, "read_json_object", read_body)
        monkeypatch.setattr(routes, "run_database_read", no_database)
        monkeypatch.setattr(routes, "run_database_write", no_database)
        monkeypatch.setattr(routes, "stream_message", provider_stream)
        monkeypatch.setattr(routes, "increment", lambda name, value=1: increments.append((name, value)))
        response = await routes.send_ai_message_api(Request())
        task = asyncio.create_task(anext(response.body_iterator))
        await started.wait()
        task.cancel()
        await closing.wait()
        for _ in range(cancel_count - 1):
            task.cancel()
            await asyncio.sleep(0)
        finish.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert closed.is_set(), "The pending generator remains active after transport cancellation"
        assert ("ai_active_streams", -1) in increments

    asyncio.run(scenario())
