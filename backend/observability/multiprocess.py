"""File-backed aggregation for the repository's custom process metrics.

Each Uvicorn worker publishes one atomic snapshot.  Scrapers sum live worker
gauges and all lifetime counters.  When a worker exits, its snapshot is
atomically converted to a counter-only archive so worker recycling neither
loses nor double-counts completed work.  A systemd invocation identifier keeps
snapshots from different service starts isolated.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
import re
import secrets
import time
from typing import Callable, Mapping


_FORMAT = "biddingflow-multiprocess-metrics"
_VERSION = 1
_SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9_.-]{1,96}$")
_MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024
_MAX_SERIES_PER_CATEGORY = 50_000
_CATEGORIES = (
    "counters",
    "liveSums",
    "lifetimeMax",
    "liveMax",
    "liveMin",
    "latest",
)


def series_key(name: object, *labels: object) -> str:
    """Encode one bounded metric identity without delimiter collisions."""

    return json.dumps(
        [str(name), *(str(label) for label in labels)],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def split_series_key(value: str) -> tuple[str, ...]:
    decoded = json.loads(value)
    if not isinstance(decoded, list) or not decoded:
        raise ValueError("Invalid multiprocess metric series key.")
    return tuple(str(item) for item in decoded)


def _safe_component(value: object, *, name: str) -> str:
    text = str(value or "").strip()
    if not _SAFE_COMPONENT.fullmatch(text):
        raise ValueError(f"Invalid {name} for multiprocess metrics.")
    return text


def configured_directory() -> Path | None:
    value = str(os.environ.get("BIDDING_METRICS_MULTIPROCESS_DIR", "")).strip()
    return Path(value).resolve() if value else None


def configured_instance_id() -> str | None:
    value = str(
        os.environ.get("BIDDING_METRICS_INSTANCE_ID")
        or os.environ.get("INVOCATION_ID")
        or ""
    ).strip()
    return _safe_component(value, name="instance id") if value else None


def enabled() -> bool:
    return configured_directory() is not None and configured_instance_id() is not None


def _process_start_token(pid: int) -> str | None:
    try:
        raw = Path(f"/proc/{int(pid)}/stat").read_text(encoding="ascii")
        remainder = raw[raw.rfind(")") + 2 :].split()
        return _safe_component(remainder[19], name="process start token")
    except (OSError, ValueError, IndexError):
        if int(pid) == os.getpid():
            return _safe_component(
                str(int(time.time_ns())), name="process start token"
            )
        return None


_SELF_START_TOKEN = _process_start_token(os.getpid()) or str(time.time_ns())


def current_worker_identity() -> tuple[int, str]:
    return os.getpid(), _SELF_START_TOKEN


def _worker_alive(pid: int, start_token: str) -> bool:
    observed = _process_start_token(pid)
    return observed is not None and secrets.compare_digest(observed, start_token)


def _number(value: object) -> float | int:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Multiprocess metric values must be finite.")
    return int(number) if number.is_integer() else number


def _normalize_snapshot(snapshot: Mapping[str, object]) -> dict[str, object]:
    normalized: dict[str, object] = {}
    for category in _CATEGORIES:
        source = snapshot.get(category) or {}
        if not isinstance(source, Mapping):
            raise ValueError(f"Multiprocess metric category {category} must be a map.")
        if len(source) > _MAX_SERIES_PER_CATEGORY:
            raise ValueError(f"Multiprocess metric category {category} is too large.")
        if category == "latest":
            latest = {}
            for key, sample in source.items():
                if not isinstance(sample, Mapping):
                    raise ValueError("Latest multiprocess samples require timestamp/value.")
                latest[str(key)] = {
                    "timestamp": _number(sample.get("timestamp", 0)),
                    "value": _number(sample.get("value", 0)),
                }
            normalized[category] = latest
        else:
            normalized[category] = {
                str(key): _number(value) for key, value in source.items()
            }
    return normalized


def _worker_path(directory: Path, instance_id: str, pid: int, start_token: str) -> Path:
    return directory / f"worker-{instance_id}-{pid}-{start_token}.json"


def publish_snapshot(
    snapshot: Mapping[str, object],
    *,
    directory: str | Path | None = None,
    instance_id: str | None = None,
    pid: int | None = None,
    start_token: str | None = None,
) -> Path | None:
    """Atomically replace this worker's absolute metric snapshot."""

    target_directory = Path(directory).resolve() if directory else configured_directory()
    target_instance = (
        _safe_component(instance_id, name="instance id")
        if instance_id is not None
        else configured_instance_id()
    )
    if target_directory is None or target_instance is None:
        return None
    worker_pid = int(os.getpid() if pid is None else pid)
    worker_token = _safe_component(
        start_token if start_token is not None else _SELF_START_TOKEN,
        name="process start token",
    )
    target_directory.mkdir(parents=True, exist_ok=True, mode=0o750)
    payload = {
        "format": _FORMAT,
        "version": _VERSION,
        "instanceId": target_instance,
        "pid": worker_pid,
        "startToken": worker_token,
        "updatedAt": time.time(),
        "archived": False,
        **_normalize_snapshot(snapshot),
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    if len(encoded) > _MAX_SNAPSHOT_BYTES:
        raise ValueError("Multiprocess metric snapshot is too large.")
    target = _worker_path(
        target_directory, target_instance, worker_pid, worker_token
    )
    temporary = target.with_name(
        f".{target.name}.{os.getpid()}.{secrets.token_hex(6)}.tmp"
    )
    try:
        with temporary.open("xb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    return target


def _read_snapshot(path: Path, instance_id: str) -> dict[str, object] | None:
    try:
        if path.stat().st_size > _MAX_SNAPSHOT_BYTES:
            return None
        payload = json.loads(path.read_text(encoding="utf-8"))
        if (
            payload.get("format") != _FORMAT
            or payload.get("version") != _VERSION
            or payload.get("instanceId") != instance_id
        ):
            return None
        payload.update(_normalize_snapshot(payload))
        payload["pid"] = int(payload["pid"])
        payload["startToken"] = _safe_component(
            payload["startToken"], name="process start token"
        )
        return payload
    except (OSError, UnicodeError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _archive_dead_worker(path: Path, payload: dict[str, object]) -> None:
    instance_id = str(payload["instanceId"])
    archive = path.with_name(
        f"archive-{instance_id}-{payload['pid']}-{payload['startToken']}.json"
    )
    archived = {
        **payload,
        "archived": True,
        "liveSums": {},
        "liveMax": {},
        "liveMin": {},
    }
    encoded = json.dumps(
        archived,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    temporary = archive.with_name(
        f".{archive.name}.{os.getpid()}.{secrets.token_hex(6)}.tmp"
    )
    try:
        with temporary.open("xb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.replace(temporary, archive)
            path.unlink(missing_ok=True)
        except FileNotFoundError:
            pass
    finally:
        temporary.unlink(missing_ok=True)


def aggregate_snapshots(
    *,
    directory: str | Path | None = None,
    instance_id: str | None = None,
    worker_alive: Callable[[int, str], bool] | None = None,
) -> dict[str, object] | None:
    """Aggregate one deployment instance without counting a shard twice."""

    target_directory = Path(directory).resolve() if directory else configured_directory()
    target_instance = (
        _safe_component(instance_id, name="instance id")
        if instance_id is not None
        else configured_instance_id()
    )
    if target_directory is None or target_instance is None:
        return None
    alive = worker_alive or _worker_alive
    documents: list[tuple[dict[str, object], bool]] = []
    for path in sorted(target_directory.glob(f"archive-{target_instance}-*.json")):
        if payload := _read_snapshot(path, target_instance):
            documents.append((payload, False))
    for path in sorted(target_directory.glob(f"worker-{target_instance}-*.json")):
        payload = _read_snapshot(path, target_instance)
        if payload is None:
            continue
        is_live = alive(int(payload["pid"]), str(payload["startToken"]))
        if not is_live:
            _archive_dead_worker(path, payload)
        documents.append((payload, is_live))

    result: dict[str, object] = {
        "counters": {},
        "liveSums": {},
        "lifetimeMax": {},
        "liveMax": {},
        "liveMin": {},
        "latest": {},
        "workerCount": sum(1 for _payload, is_live in documents if is_live),
    }
    for payload, is_live in documents:
        for key, value in payload["counters"].items():
            result["counters"][key] = result["counters"].get(key, 0) + value
        for key, value in payload["lifetimeMax"].items():
            result["lifetimeMax"][key] = max(
                result["lifetimeMax"].get(key, value), value
            )
        for key, sample in payload["latest"].items():
            current = result["latest"].get(key)
            if current is None or sample["timestamp"] > current["timestamp"]:
                result["latest"][key] = sample
        if not is_live:
            continue
        for key, value in payload["liveSums"].items():
            result["liveSums"][key] = result["liveSums"].get(key, 0) + value
        for key, value in payload["liveMax"].items():
            result["liveMax"][key] = max(result["liveMax"].get(key, value), value)
        for key, value in payload["liveMin"].items():
            result["liveMin"][key] = min(result["liveMin"].get(key, value), value)
    return result
