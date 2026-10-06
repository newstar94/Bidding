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
    )
    reservation = TokenReservation("reservation-1", "2026-10-06", "org-1", "user-1", 100)
    state = SimpleNamespace(context=context, config=config, reservation=reservation,
                            released=[], settled=[], provider_calls=[])

    async def read(function, *_args, **_kwargs):
        if function is service.get_conversation:
            return {"mode": "app_help"}
        if function is service.list_messages:
            return [{"role": "user", "content": "Hello"}]
        raise AssertionError(f"Unexpected read: {function}")

    async def write(function, *args, **_kwargs):
        if function is service.reserve_tokens:
            return reservation
        if function is service.release_token_reservation:
            state.released.append(args[0])
            return True
        if function is service.settle_token_reservation:
            state.settled.append(args[0])
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
