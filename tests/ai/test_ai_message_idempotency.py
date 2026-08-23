from backend.ai import conversation_repository
from backend.ai.types import AiRequestContext
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES


class _Result:
    def __init__(self, row=None):
        self.row = row

    def fetchone(self):
        return self.row


class _Connection:
    def __init__(self):
        self.messages = {}

    def execute(self, statement, parameters=()):
        if "INSERT INTO ai_messages" in statement:
            message_id, _organization_id, _conversation_id, role, content, *_rest = parameters
            request_id = parameters[-1]
            row = self.messages.setdefault(
                request_id,
                {"id": message_id, "role": role, "content": content},
            )
            return _Result(row)
        return _Result()

    def commit(self):
        pass

    def close(self):
        pass


def _context():
    return AiRequestContext(
        user_id="user-1",
        organization_id="org-1",
        organization_name="HCP",
        platform_role="user",
        membership_role="manager",
        scope_type="organization",
        permissions={"goithau": "view"},
    )


def test_add_message_reuses_one_user_message_for_the_same_client_request(monkeypatch):
    connection = _Connection()
    monkeypatch.setattr(
        conversation_repository.database,
        "get_connection",
        lambda: connection,
    )

    first = conversation_repository.add_message(
        _context(),
        "conversation-1",
        "user",
        "Các hình thức lựa chọn nhà thầu",
        client_request_id="air-stable-request-1",
    )
    second = conversation_repository.add_message(
        _context(),
        "conversation-1",
        "user",
        "Các hình thức lựa chọn nhà thầu",
        client_request_id="air-stable-request-1",
    )

    assert first == second
    assert len(connection.messages) == 1


def test_ai_message_idempotency_is_part_of_fresh_and_upgrade_schemas():
    assert "client_request_id" in SCHEMA_DINH_NGHIA["ai_messages"]["columns"]
    assert any(item.name == "add_ai_message_idempotency" for item in UPGRADES)
    assert DB_SCHEMA_VERSION >= 62
