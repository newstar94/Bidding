from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from psycopg.pq import TransactionStatus

from backend.db.db_helper import PostgresConnection


@pytest.mark.parametrize("failure", ["commit", "rollback", "body"])
def test_exit_returns_connection_and_preserves_original_error(failure):
    original = RuntimeError(failure)
    raw = SimpleNamespace(
        info=SimpleNamespace(transaction_status=TransactionStatus.INTRANS),
        commit=Mock(),
        rollback=Mock(side_effect=RuntimeError("cleanup")),
    )
    if failure == "commit":
        raw.commit.side_effect = original
    elif failure == "rollback":
        raw.rollback.side_effect = [original, RuntimeError("cleanup")]
    pool = SimpleNamespace(putconn=Mock())
    connection = PostgresConnection(pool, raw)
    with pytest.raises(RuntimeError) as caught:
        if failure == "commit":
            connection.__exit__(None, None, None)
        else:
            with connection:
                raise original
    assert caught.value is original
    pool.putconn.assert_called_once_with(raw)
    assert connection.closed
    connection.close()
    pool.putconn.assert_called_once_with(raw)
