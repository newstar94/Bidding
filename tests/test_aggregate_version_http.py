import asyncio
import json
from types import SimpleNamespace

from starlette.responses import JSONResponse

from backend.versioning import service
from backend.sync import service as sync_service
from backend.sync.command import SyncActorContext, SyncTransactionContext
from backend.versioning.command import AggregateVersionConflict


def test_http_adapter_dispatches_version_commands_to_the_sync_write_lane(monkeypatch):
    command = {
        "kind": "package",
        "sourceId": "package-1",
        "expectedRowVersion": 5,
        "changes": {},
        "clientMutationId": "version-command-1",
    }
    captured = {}

    async def read_json_object(_request):
        return command, None

    async def run_database_write(function, *args, **kwargs):
        captured.update({"function": function, "args": args, "kwargs": kwargs})
        return JSONResponse({"status": "success"})

    monkeypatch.setattr(service, "read_json_object", read_json_object)
    monkeypatch.setattr(service, "run_database_write", run_database_write)

    response = asyncio.run(service.process_aggregate_version_request(object()))

    assert response.status_code == 200
    assert captured["args"][1] == command
    assert captured["kwargs"] == {"aggregate_version_command": True}


class FakeConnection:
    def __init__(self):
        self.commands = []
        self.cursor_instance = object()
        self.rollback_count = 0
        self.closed = False

    def execute(self, command):
        self.commands.append(command)

    def cursor(self):
        return self.cursor_instance

    def rollback(self):
        self.rollback_count += 1

    def close(self):
        self.closed = True


def test_version_command_is_built_after_serializable_begin_and_conflicts_return_409(
    monkeypatch,
):
    request = SimpleNamespace(state=SimpleNamespace(), headers={})
    connection = FakeConnection()
    actor = SyncActorContext(
        request=request,
        role="Manager",
        user_id="user-1",
        organization_id="org-1",
        owner_type="organization",
        can_upload_workspace_assets=True,
    )

    monkeypatch.setattr(
        sync_service,
        "_resolve_sync_actor_context",
        lambda *_args: (actor, None),
    )
    monkeypatch.setattr(
        sync_service,
        "_prepare_sync_transaction",
        lambda *_args: (
            SyncTransactionContext(
                connection=connection,
                cursor=connection.cursor_instance,
                actor=actor,
                owner_type="organization",
                current_time="2026-08-08 10:00:00",
            ),
            None,
        ),
    )
    monkeypatch.setattr(sync_service.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        sync_service,
        "authorize_record_write",
        lambda *_args: SimpleNamespace(allowed=True, reason=""),
    )

    def build_payload(repository, organization_id, _command, *, timestamp):
        assert connection.commands == ["BEGIN ISOLATION LEVEL SERIALIZABLE"]
        assert repository.cursor is connection.cursor_instance
        assert organization_id == "org-1"
        assert timestamp == "2026-08-08 10:00:00"
        raise AggregateVersionConflict(6)

    monkeypatch.setattr(sync_service, "build_aggregate_version_payload", build_payload)

    response = sync_service.execute_sync_mutation(
        request,
        {
            "kind": "package",
            "sourceId": "package-1",
            "expectedRowVersion": 5,
            "changes": {},
            "clientMutationId": "version-command-1",
        },
        aggregate_version_command=True,
    )

    body = json.loads(response.body)
    assert response.status_code == 409
    assert body["code"] == "ROW_VERSION_CONFLICT"
    assert body["fields"]["currentVersion"] == 6
    assert connection.rollback_count == 1
    assert connection.closed is True
