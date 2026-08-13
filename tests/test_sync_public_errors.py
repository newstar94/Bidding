import json

from backend.sync.public_errors import public_sync_item_error
from backend.sync.serializer import rollback_sync_response


class _Connection:
    def __init__(self):
        self.rolled_back = False

    def rollback(self):
        self.rolled_back = True


class _ConstraintError(Exception):
    sqlstate = "23503"


def test_unexpected_database_error_is_redacted_and_does_not_echo_record_id():
    error = _ConstraintError(
        'insert violates constraint "fk_secret" DETAIL: Key (id)=(foreign-id)'
    )

    public = public_sync_item_error(
        error,
        table_name="goi_thau",
        record_id="foreign-id",
        correlation_id="request-123",
    )

    assert public == {
        "code": "SYNC_ITEM_WRITE_FAILED",
        "message": "Không thể lưu bản ghi đồng bộ.",
        "retryable": False,
        "correlationId": "request-123",
    }
    assert "foreign-id" not in json.dumps(public)
    assert "constraint" not in json.dumps(public).lower()


def test_rollback_response_sanitizes_untrusted_errors_at_serialization_boundary():
    connection = _Connection()
    response = rollback_sync_response(
        connection,
        [{
            "table": "goi_thau",
            "id": "foreign-id",
            "message": "column secret_column violates check constraint secret_check",
        }],
        "Không thể đồng bộ.",
        correlation_id="request-456",
    )
    payload = json.loads(response.body)

    assert connection.rolled_back is True
    assert payload["errors"] == [{
        "code": "SYNC_ITEM_WRITE_FAILED",
        "message": "Không thể lưu bản ghi đồng bộ.",
        "retryable": False,
        "correlationId": "request-456",
    }]
    assert "foreign-id" not in response.body.decode()
    assert "secret" not in response.body.decode()
