"""Periodic audit-chain verification and checkpoint orchestration."""

from __future__ import annotations

import asyncio
import itertools
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from backend.observability.metrics import (
    record_audit_chain_verification,
    record_audit_checkpoint,
)
from backend.shared.audit_chain import (
    build_audit_checkpoint,
    inspect_audit_chain,
    inspect_audit_chain_against_checkpoint,
    set_audit_chain_health,
    write_audit_checkpoint,
)
from backend.shared.database_io import run_database_read
from backend.shared.logging_utils import log_structured_event
from backend.shared.paths import resolve_runtime_path


def _bounded_seconds(name, default, minimum, maximum):
    try:
        value = float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = float(default)
    return min(float(maximum), max(float(minimum), value))


def _checkpoint_destination():
    path = resolve_runtime_path("AUDIT_CHECKPOINT_DIR", allow_empty=True)
    return str(path) if path is not None else ""


def _latest_checkpoint(destination):
    directory = Path(destination).resolve()
    if not directory.is_dir():
        return None
    candidates = []
    with os.scandir(directory) as scanner:
        for entry in itertools.islice(scanner, 10_000):
            if (
                entry.is_file(follow_symlinks=False)
                and entry.name.startswith("audit-checkpoint-")
                and entry.name.endswith(".json")
            ):
                candidates.append((entry.name, Path(entry.path)))
    if not candidates:
        return None
    # Only installation-bound checkpoints are trusted. Older formats lack the
    # database installation identity and are deliberately outside this trust domain.
    for _name, path in sorted(candidates, reverse=True):
        if path.stat().st_size > 64 * 1024:
            raise RuntimeError("Audit checkpoint exceeds the structural size limit.")
        checkpoint = json.loads(path.read_text(encoding="utf-8"))
        if checkpoint.get("version") == 3:
            return checkpoint
    return None


def _inspect_database(
    database,
    checkpoint_destination=None,
    hmac_key=None,
    export_checkpoint=False,
    checkpoint_min_age_seconds=0,
):
    connection = None
    checkpoint = None
    pending_checkpoint = None
    checkpoint_leader = False
    try:
        connection = database.get_connection()
        if checkpoint_destination and export_checkpoint:
            leader_row = connection.execute(
                "SELECT pg_try_advisory_lock(hashtext('biddingflow-audit-checkpoint-export'))"
            ).fetchone()
            checkpoint_leader = bool(leader_row and leader_row[0])
            connection.commit()
        checkpoint = (
            _latest_checkpoint(checkpoint_destination)
            if checkpoint_destination
            else None
        )
        if checkpoint is not None and export_checkpoint and checkpoint_leader:
            try:
                created_at = datetime.fromisoformat(
                    str(checkpoint.get("createdAt") or "").replace(
                        "Z",
                        "+00:00",
                    )
                )
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)
                age_seconds = (
                    datetime.now(timezone.utc) - created_at.astimezone(timezone.utc)
                ).total_seconds()
                if age_seconds < max(0.0, float(checkpoint_min_age_seconds)):
                    export_checkpoint = False
            except (TypeError, ValueError):
                # Invalid timestamp is handled by checkpoint integrity/shape
                # verification; never use it to suppress a replacement.
                pass
        cursor = connection.cursor()
        verification = (
            inspect_audit_chain_against_checkpoint(
                cursor, checkpoint, hmac_key=hmac_key
            )
            if checkpoint is not None
            else inspect_audit_chain(cursor)
        )
        if (
            verification.valid
            and checkpoint_destination
            and export_checkpoint
            and checkpoint_leader
        ):
            pending_checkpoint = build_audit_checkpoint(
                cursor,
                hmac_key=hmac_key,
            )
        connection.commit()
        checkpoint_path = None
        if pending_checkpoint is not None:
            # The DB transaction is closed before filesystem I/O. The
            # session-level advisory lock still prevents another worker from
            # exporting the same cluster checkpoint concurrently.
            checkpoint_path = write_audit_checkpoint(
                pending_checkpoint,
                checkpoint_destination,
            )
        return verification, checkpoint_path
    finally:
        if connection is not None:
            if checkpoint_leader:
                try:
                    connection.execute(
                        "SELECT pg_advisory_unlock(hashtext('biddingflow-audit-checkpoint-export'))"
                    )
                    connection.commit()
                except Exception:
                    connection.rollback()
            connection.close()


async def monitor_audit_chain(database, application=None):
    """Verify immediately, then on a bounded cadence until cancelled."""

    interval = _bounded_seconds(
        "AUDIT_CHAIN_VERIFY_INTERVAL_SECONDS", 300, 30, 86_400
    )
    checkpoint_interval = _bounded_seconds(
        "AUDIT_CHECKPOINT_INTERVAL_SECONDS", 86_400, interval, 31 * 86_400
    )
    checkpoint_destination = _checkpoint_destination()
    hmac_key = str(os.environ.get("AUDIT_CHECKPOINT_HMAC_KEY", ""))
    last_checkpoint_at = 0.0
    while True:
        started = time.perf_counter()
        checkpoint_due = bool(
            checkpoint_destination
            and time.time() - last_checkpoint_at >= checkpoint_interval
        )
        try:
            verification, checkpoint_path = await run_database_read(
                _inspect_database,
                database,
                checkpoint_destination or None,
                hmac_key or None,
                checkpoint_due,
                checkpoint_interval,
                timeout_seconds=min(60.0, max(5.0, interval / 2)),
            )
            record_audit_chain_verification(
                "valid" if verification.valid else "invalid",
                time.perf_counter() - started,
                verification.row_count,
            )
            set_audit_chain_health("valid" if verification.valid else "invalid")
            if application is not None:
                application.state.ready = bool(
                    verification.valid
                    and getattr(application.state, "startup_complete", False)
                )
            if checkpoint_path is not None:
                last_checkpoint_at = time.time()
                record_audit_checkpoint("success")
            if not verification.valid:
                log_structured_event(
                    "security.audit_chain_invalid",
                    level="CRITICAL",
                    fields={
                        "reason": verification.failure or "unknown",
                        "rowCount": verification.row_count,
                    },
                    nonblocking=True,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            set_audit_chain_health("error")
            if application is not None:
                application.state.ready = False
            record_audit_chain_verification(
                "error", time.perf_counter() - started, 0
            )
            if checkpoint_due:
                record_audit_checkpoint("error")
            log_structured_event(
                "security.audit_chain_check_error",
                level="ERROR",
                fields={"exceptionType": exc.__class__.__name__},
                nonblocking=True,
            )
        await asyncio.sleep(interval)


async def verify_audit_chain_before_ready(database):
    """Fail startup until the chain and latest configured anchor verify."""

    checkpoint_destination = _checkpoint_destination()
    hmac_key = str(os.environ.get("AUDIT_CHECKPOINT_HMAC_KEY", ""))
    started = time.perf_counter()
    try:
        verification, checkpoint_path = await run_database_read(
            _inspect_database,
            database,
            checkpoint_destination or None,
            hmac_key or None,
            bool(checkpoint_destination),
            _bounded_seconds(
                "AUDIT_CHECKPOINT_INTERVAL_SECONDS",
                86_400,
                30,
                31 * 86_400,
            ),
            timeout_seconds=60.0,
        )
    except Exception:
        set_audit_chain_health("error")
        record_audit_chain_verification(
            "error", time.perf_counter() - started, 0
        )
        raise

    outcome = "valid" if verification.valid else "invalid"
    set_audit_chain_health(outcome)
    record_audit_chain_verification(
        outcome, time.perf_counter() - started, verification.row_count
    )
    if checkpoint_path is not None:
        record_audit_checkpoint("success")
    if not verification.valid:
        raise RuntimeError(
            "Audit chain failed startup verification "
            f"({verification.failure or 'unknown'})."
        )
    return verification
