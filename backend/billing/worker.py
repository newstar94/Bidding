"""Durable billing command, webhook and activation queue worker."""

from __future__ import annotations

import asyncio
import os
import time

from backend.commercial_policy.config import commercial_runtime_config
from backend.shared.async_io import BlockingIOBusyError, run_blocking_io
from backend.shared.idle_backoff import idle_poll_backoff_from_env
from backend.shared.logging_utils import log_error
from backend.usage_credits import UsageCreditService

from .activation import BillingActivationService
from .providers.base import PaymentProviderError
from .runtime import payment_provider_registry
from .service import ProviderCommandExecutor


WEBHOOK_LEASE_SECONDS = 60


def billing_worker_enabled(environment=None):
    """Keep draining old work when either checkout or activation is enabled."""
    config = commercial_runtime_config(os.environ if environment is None else environment)
    return (
        config.payment_checkout_enabled
        or config.payment_activation_enabled
        or config.procurement_credit_enforcement_enabled
    )


class BillingWorkProcessor:
    def __init__(
        self,
        database,
        *,
        environment=None,
        registry=None,
        clock=None,
        worker_id=None,
    ):
        self.database = database
        self.environment = os.environ if environment is None else environment
        self.registry = registry or payment_provider_registry()
        self.clock = clock or time.time
        self.worker_id = worker_id or f"billing-work-{id(self):x}"

    def process_next(self):
        """Process at most one row so the async loop remains cancellable."""
        config = commercial_runtime_config(self.environment)
        if config.payment_activation_enabled:
            claimed = self._claim_webhook()
            if claimed:
                self._process_webhook(claimed)
                return True
        command_id = self._next_command_id()
        if command_id:
            ProviderCommandExecutor(
                self.database,
                provider_registry=self.registry,
                clock=self.clock,
                worker_id=self.worker_id,
                environment=self.environment,
            ).execute(command_id)
            return True
        if config.payment_activation_enabled:
            order_id = self._next_paid_not_applied_order_id()
            if order_id:
                self._retry_activation(order_id)
                return True
        if config.procurement_credit_enforcement_enabled:
            if self._release_expired_usage_reservations():
                return True
        return False

    def _release_expired_usage_reservations(self):
        connection = self.database.get_connection()
        try:
            connection.execute("BEGIN")
            released = UsageCreditService(
                connection.cursor(), clock=self.clock
            ).release_expired_reservations(limit=100)
            connection.commit()
            return bool(released)
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _next_command_id(self):
        connection = self.database.get_connection()
        try:
            row = connection.execute(
                """SELECT id FROM billing_provider_commands
                    WHERE (status IN ('pending', 'retry') AND available_at <= ?)
                       OR (status = 'processing' AND lease_expires_at <= ?)
                    ORDER BY available_at, created_at, id LIMIT 1""",
                (int(self.clock()), int(self.clock())),
            ).fetchone()
            return str(row[0]) if row else None
        finally:
            connection.close()

    def _claim_webhook(self):
        connection = self.database.get_connection()
        now = int(self.clock())
        try:
            connection.execute("BEGIN")
            row = connection.execute(
                """SELECT event.*, profile.provider, profile.credential_reference,
                          profile.timeout_ms, profile.max_attempts
                     FROM payment_webhook_events AS event
                     JOIN payment_provider_profiles AS profile
                       ON profile.id = event.provider_profile_id
                    WHERE ((event.status IN ('pending', 'retry') AND event.available_at <= ?)
                       OR (event.status = 'processing' AND event.lease_expires_at <= ?))
                    ORDER BY event.available_at, event.created_at, event.id
                    LIMIT 1 FOR UPDATE OF event SKIP LOCKED""",
                (now, now),
            ).fetchone()
            if not row:
                connection.rollback()
                return None
            claimed = dict(row)
            claimed["attempt_count"] = int(claimed["attempt_count"]) + 1
            connection.execute(
                """UPDATE payment_webhook_events
                      SET status = 'processing', attempt_count = ?, locked_by = ?,
                          lease_expires_at = ?, last_error_code = NULL
                    WHERE id = ?""",
                (
                    claimed["attempt_count"],
                    self.worker_id,
                    now + WEBHOOK_LEASE_SECONDS,
                    claimed["id"],
                ),
            )
            connection.commit()
            return claimed
        finally:
            connection.close()

    def _process_webhook(self, claimed):
        try:
            provider = self.registry.resolve(claimed)
            import json

            signed = json.loads(claimed["signed_fields_json"])
            provider_result = provider.get_payment(int(signed.get("orderCode") or 0))
            connection = self.database.get_connection()
            try:
                connection.execute("BEGIN")
                BillingActivationService(connection.cursor(), clock=self.clock).apply_verified(
                    claimed["id"],
                    provider_result,
                    provider_profile_id=claimed["provider_profile_id"],
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()
        except PaymentProviderError as error:
            self._fail_webhook(claimed, error.code, retryable=error.retryable or error.outcome_unknown)
        except Exception as error:  # noqa: BLE001 - durable queue isolation boundary
            log_error(error, "billing_webhook_worker", level="WARN")
            self._fail_webhook(claimed, "WEBHOOK_PROCESSING_FAILED", retryable=True)

    def _fail_webhook(self, claimed, code, *, retryable):
        attempts = int(claimed["attempt_count"])
        max_attempts = max(1, int(claimed.get("max_attempts") or 3))
        status = "retry" if retryable and attempts < max_attempts else "dead"
        connection = self.database.get_connection()
        try:
            connection.execute("BEGIN")
            connection.execute(
                """UPDATE payment_webhook_events
                      SET status = ?, available_at = ?, lease_expires_at = NULL,
                          locked_by = NULL, last_error_code = ?
                    WHERE id = ? AND status = 'processing' AND locked_by = ?""",
                (
                    status,
                    int(self.clock()) + min(300, 2**attempts),
                    str(code)[:200],
                    claimed["id"],
                    self.worker_id,
                ),
            )
            connection.commit()
        finally:
            connection.close()

    def _next_paid_not_applied_order_id(self):
        connection = self.database.get_connection()
        try:
            row = connection.execute(
                """SELECT id FROM billing_orders
                    WHERE payment_state = 'verified_paid'
                      AND activation_state IN ('pending', 'retry')
                    ORDER BY updated_at, id LIMIT 1"""
            ).fetchone()
            return str(row[0]) if row else None
        finally:
            connection.close()

    def _retry_activation(self, order_id):
        connection = self.database.get_connection()
        try:
            connection.execute("BEGIN")
            BillingActivationService(connection.cursor(), clock=self.clock).activate_order(order_id)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def process_next_billing_work(database, *, environment=None, registry=None):
    return BillingWorkProcessor(
        database, environment=environment, registry=registry
    ).process_next()


async def run_billing_worker(database, *, environment=None, registry=None):
    """Continuously drain billing queues with graceful cancellation."""
    environment = os.environ if environment is None else environment
    if not billing_worker_enabled(environment):
        return
    processor = BillingWorkProcessor(
        database, environment=environment, registry=registry
    )
    backoff = idle_poll_backoff_from_env(
        "BILLING_WORKER_POLL_SECONDS",
        "BILLING_WORKER_MAX_POLL_SECONDS",
        default_initial=1.0,
    )
    while True:
        try:
            processed = await run_blocking_io(
                processor.process_next,
                timeout_seconds=35.0,
            )
        except BlockingIOBusyError:
            processed = False
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 - worker must isolate one bad row
            log_error(error, "billing_worker", level="WARN")
            processed = False
        if processed:
            backoff.reset()
        await asyncio.sleep(0.05 if processed else backoff.next_delay())
