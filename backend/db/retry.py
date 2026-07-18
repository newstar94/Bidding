"""Bounded retry for short blocking database transactions."""

import time


def run_transaction_with_retry(
    database,
    operation,
    *,
    max_attempts=3,
    base_delay_seconds=0.01,
):
    """Run ``operation(connection, attempt)`` and retry transient failures.

    Callers must invoke this helper inside the bounded synchronous database
    lane. Operations must be idempotent within a rolled-back transaction and
    must not perform external side effects before commit.
    """
    attempts = max(1, min(5, int(max_attempts)))
    delay = max(0.0, min(0.25, float(base_delay_seconds)))
    last_error = None
    for attempt in range(1, attempts + 1):
        connection = database.get_connection()
        try:
            with database.transaction(connection):
                return operation(connection, attempt)
        except BaseException as error:
            last_error = error
            if attempt >= attempts or not database.is_retryable_error(error):
                raise
        finally:
            connection.close()
        if delay:
            time.sleep(delay * attempt)
    raise last_error
