"""Bounded mixed-workload HTTP benchmark for a disposable BiddingFlow stack."""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
import random
import statistics
import sys
import time
from uuid import uuid4

import httpx


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.env_utils import load_env


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) - 1) * percentile)))
    return ordered[index]


async def _login(client: httpx.AsyncClient) -> tuple[dict, dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(8):
        try:
            response = await client.get("/")
            response.raise_for_status()
            if client.cookies.get("csrf_token"):
                break
        except httpx.HTTPError as exc:
            last_error = exc
        await asyncio.sleep(min(2.0, 0.1 * (2**attempt)))
    csrf = client.cookies.get("csrf_token")
    if not csrf:
        raise RuntimeError("Could not establish a CSRF session") from last_error
    response = None
    for attempt in range(8):
        try:
            response = await client.post(
                "/api/auth/login",
                json={
                    "username": os.environ.get("ADMIN_USERNAME", "admin"),
                    "password": os.environ["ADMIN_PASSWORD"],
                    "remember": False,
                },
                headers={"X-CSRF-Token": csrf},
            )
        except httpx.HTTPError as exc:
            last_error = exc
            await asyncio.sleep(min(2.0, 0.1 * (2**attempt)))
            continue
        if response.status_code not in {429, 503}:
            break
        await asyncio.sleep(min(2.0, 0.1 * (2**attempt)))
    if response is None:
        raise RuntimeError("Could not complete load-test login") from last_error
    response.raise_for_status()
    payload = response.json()
    return payload, {
        "X-CSRF-Token": client.cookies["csrf_token"],
        "X-Active-Org": payload["active_org_id"],
    }


async def run_benchmark(base_url: str, concurrency: int, duration: float) -> dict:
    latencies: list[float] = []
    operation_latencies: dict[str, list[float]] = defaultdict(list)
    statuses: Counter[int] = Counter()
    operations: Counter[str] = Counter()
    errors: Counter[str] = Counter()
    slowest_requests: list[dict] = []
    connection_warmup_latencies: list[float] = []
    stop_at = 0.0
    start_gate = asyncio.Event()
    all_ready = asyncio.Event()
    ready_lock = asyncio.Lock()
    ready_count = 0
    login_gate = asyncio.Semaphore(2)
    warmup_gate = asyncio.Semaphore(4)

    async def worker(worker_id: int) -> None:
        nonlocal ready_count
        request_sequence = 0
        try:
            async with httpx.AsyncClient(
                base_url=base_url,
                timeout=httpx.Timeout(15),
                limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
            ) as login_client:
                async with login_gate:
                    _login_payload, headers = await _login(login_client)
                cookies = dict(login_client.cookies)

            # Establish each workload connection before the timed window.
            async with httpx.AsyncClient(
                base_url=base_url,
                timeout=httpx.Timeout(15),
                limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
                cookies=cookies,
            ) as client:
                warmup_started = time.perf_counter()
                last_error = None
                async with warmup_gate:
                    for attempt in range(8):
                        try:
                            warmup_response = await client.get("/health/live")
                            warmup_response.raise_for_status()
                            break
                        except httpx.HTTPError as exc:
                            last_error = exc
                            await asyncio.sleep(
                                min(2.0, 0.1 * (2**attempt))
                            )
                    else:
                        raise RuntimeError(
                            "Could not warm a workload connection"
                        ) from last_error
                connection_warmup_latencies.append(
                    time.perf_counter() - warmup_started
                )
                async with ready_lock:
                    ready_count += 1
                    if ready_count == concurrency:
                        all_ready.set()
                await start_gate.wait()

                while time.monotonic() < stop_at:
                    request_sequence += 1
                    choice = random.random()
                    if choice < 0.70:
                        operation, method, path, body = "sync_version", "GET", "/api/sync-version", None
                    elif choice < 0.95:
                        operation, method, path, body = "initial_data", "GET", "/api/get-all-data", None
                    else:
                        operation, method, path = "sync_write", "POST", "/api/sync"
                        body = {
                            "clientMutationId": uuid4().hex,
                            "chudautu": [
                                {
                                    "id": f"cdt-load-{worker_id}-{uuid4().hex}",
                                    "tenChuDauTu": "Load test",
                                    "ngayApDung": "2026-07-19",
                                }
                            ],
                        }
                    started = time.perf_counter()
                    try:
                        response = await client.request(
                            method, path, json=body, headers=headers
                        )
                        elapsed = time.perf_counter() - started
                        latencies.append(elapsed)
                        operation_latencies[operation].append(elapsed)
                        statuses[response.status_code] += 1
                        operations[operation] += 1
                        slowest_requests.append({
                            "durationMs": round(elapsed * 1000, 2),
                            "operation": operation,
                            "worker": worker_id,
                            "sequence": request_sequence,
                            "status": response.status_code,
                        })
                        slowest_requests.sort(
                            key=lambda item: item["durationMs"],
                            reverse=True,
                        )
                        del slowest_requests[20:]
                        if response.status_code >= 400:
                            error_code = "unknown"
                            try:
                                payload = response.json()
                                if isinstance(payload, dict) and payload.get("code"):
                                    error_code = str(payload["code"])
                            except (ValueError, TypeError):
                                pass
                            errors[f"http_{response.status_code}:{error_code}"] += 1
                    except Exception as exc:
                        elapsed = time.perf_counter() - started
                        latencies.append(elapsed)
                        errors[exc.__class__.__name__] += 1
                        slowest_requests.append({
                            "durationMs": round(elapsed * 1000, 2),
                            "operation": operation,
                            "worker": worker_id,
                            "sequence": request_sequence,
                            "error": exc.__class__.__name__,
                        })
                        slowest_requests.sort(
                            key=lambda item: item["durationMs"],
                            reverse=True,
                        )
                        del slowest_requests[20:]
        except Exception as exc:
            async with ready_lock:
                ready_count += 1
                if ready_count == concurrency:
                    all_ready.set()
            errors[f"setup:{exc.__class__.__name__}"] += 1

    tasks = [asyncio.create_task(worker(index)) for index in range(concurrency)]
    await asyncio.wait_for(all_ready.wait(), timeout=300)
    stop_at = time.monotonic() + duration
    start_gate.set()
    started = time.monotonic()
    await asyncio.gather(*tasks)
    elapsed = time.monotonic() - started
    total = sum(statuses.values()) + sum(
        count for name, count in errors.items() if not name.startswith("http_")
    )
    return {
        "durationSeconds": round(elapsed, 3),
        "concurrency": concurrency,
        "requests": total,
        "requestsPerSecond": round(total / elapsed, 2) if elapsed else 0,
        "latencyMs": {
            "p50": round(_percentile(latencies, 0.50) * 1000, 2),
            "p95": round(_percentile(latencies, 0.95) * 1000, 2),
            "p99": round(_percentile(latencies, 0.99) * 1000, 2),
            "max": round(max(latencies, default=0) * 1000, 2),
        },
        "statuses": dict(sorted(statuses.items())),
        "operations": dict(sorted(operations.items())),
        "operationLatencyMs": {
            operation: {
                "p50": round(_percentile(values, 0.50) * 1000, 2),
                "p95": round(_percentile(values, 0.95) * 1000, 2),
                "p99": round(_percentile(values, 0.99) * 1000, 2),
            }
            for operation, values in sorted(operation_latencies.items())
        },
        "errors": dict(sorted(errors.items())),
        "slowestRequests": slowest_requests,
        "connectionWarmupLatencyMs": {
            "p50": round(
                _percentile(connection_warmup_latencies, 0.50) * 1000,
                2,
            ),
            "p95": round(
                _percentile(connection_warmup_latencies, 0.95) * 1000,
                2,
            ),
            "p99": round(
                _percentile(connection_warmup_latencies, 0.99) * 1000,
                2,
            ),
            "max": round(
                max(connection_warmup_latencies, default=0) * 1000,
                2,
            ),
        },
    }


def main() -> int:
    load_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:18083")
    parser.add_argument("--concurrency", type=int, default=32)
    parser.add_argument("--duration", type=float, default=30)
    parser.add_argument("--output")
    args = parser.parse_args()
    result = asyncio.run(
        run_benchmark(
            args.base_url.rstrip("/"),
            max(1, min(500, args.concurrency)),
            max(1, args.duration),
        )
    )
    text = json.dumps(result, ensure_ascii=False, indent=2)
    print(text)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
