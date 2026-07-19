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
import time
from uuid import uuid4

import httpx


ROOT = Path(__file__).resolve().parents[1]


def _load_env() -> None:
    path = ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) - 1) * percentile)))
    return ordered[index]


async def _login(client: httpx.AsyncClient) -> tuple[dict, dict[str, str]]:
    await client.get("/")
    csrf = client.cookies.get("csrf_token")
    response = None
    for attempt in range(8):
        response = await client.post(
            "/api/auth/login",
            json={
                "username": os.environ.get("ADMIN_USERNAME", "admin"),
                "password": os.environ["ADMIN_PASSWORD"],
                "remember": False,
            },
            headers={"X-CSRF-Token": csrf},
        )
        if response.status_code not in {429, 503}:
            break
        await asyncio.sleep(min(2.0, 0.1 * (2**attempt)))
    assert response is not None
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
    stop_at = 0.0
    start_gate = asyncio.Event()
    all_ready = asyncio.Event()
    ready_lock = asyncio.Lock()
    ready_count = 0
    login_gate = asyncio.Semaphore(2)

    async def worker(worker_id: int) -> None:
        nonlocal ready_count
        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(15),
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
        ) as login_client:
            async with login_gate:
                _login_payload, headers = await _login(login_client)
            cookies = dict(login_client.cookies)

        async with ready_lock:
            ready_count += 1
            if ready_count == concurrency:
                all_ready.set()
        await start_gate.wait()

        # Open workload connections only after every virtual user has logged in.
        # Otherwise the first Uvicorn worker that becomes ready owns most of the
        # keep-alive connections and the benchmark measures an artificial
        # single-worker queue bottleneck instead of the multi-worker stack.
        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(15),
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
            cookies=cookies,
        ) as client:
            while time.monotonic() < stop_at:
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
                    latencies.append(time.perf_counter() - started)
                    errors[exc.__class__.__name__] += 1

    tasks = [asyncio.create_task(worker(index)) for index in range(concurrency)]
    await asyncio.wait_for(all_ready.wait(), timeout=120)
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
    }


def main() -> int:
    _load_env()
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
