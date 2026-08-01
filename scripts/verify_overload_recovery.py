"""Bounded HTTP burst and recovery check for a deployed reverse proxy."""

from __future__ import annotations

import argparse
import concurrent.futures
import ipaddress
import json
import math
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlsplit


SHEDDING_STATUSES = frozenset({429, 503})
LOCAL_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "::1"})


class LoadTestConfigurationError(ValueError):
    """Raised before traffic is sent when the target or load is unsafe."""


@dataclass(frozen=True)
class RequestResult:
    status: int | None
    latency_seconds: float
    error: str = ""


def build_target_url(
    base_url: str,
    path: str,
    *,
    allow_remote_target: bool,
) -> str:
    """Return a safe target URL, requiring opt-in for non-loopback hosts."""

    try:
        parsed = urlsplit(str(base_url or "").strip().rstrip("/"))
        parsed.port
    except ValueError as exc:
        raise LoadTestConfigurationError(
            "--base-url is not a valid HTTP(S) origin."
        ) from exc
    hostname = str(parsed.hostname or "").rstrip(".").casefold()
    if (
        parsed.scheme not in {"http", "https"}
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise LoadTestConfigurationError(
            "--base-url must be one HTTP(S) origin without credentials or a path."
        )
    if not str(path or "").startswith("/") or "#" in path:
        raise LoadTestConfigurationError("Request paths must start with / and omit fragments.")

    is_loopback = hostname in LOCAL_HOSTNAMES
    try:
        is_loopback = ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        pass
    if not is_loopback and not allow_remote_target:
        raise LoadTestConfigurationError(
            "Remote targets require the explicit --allow-remote-target flag."
        )
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def request_once(url: str, timeout_seconds: float) -> RequestResult:
    """Issue one bounded GET and preserve HTTP shedding responses as results."""

    started_at = time.perf_counter()
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json,text/plain;q=0.9,*/*;q=0.1",
            "Connection": "close",
            "User-Agent": "BiddingFlow-Overload-Recovery-Check/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            response.read(1)
            status = int(response.status)
        error = ""
    except urllib.error.HTTPError as exc:
        status = int(exc.code)
        error = ""
        exc.close()
    except (OSError, TimeoutError, urllib.error.URLError) as exc:
        status = None
        error = type(exc).__name__
    return RequestResult(
        status=status,
        latency_seconds=max(0.0, time.perf_counter() - started_at),
        error=error,
    )


def run_burst(
    url: str,
    *,
    concurrency: int,
    request_count: int,
    timeout_seconds: float,
) -> list[RequestResult]:
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=concurrency,
        thread_name_prefix="overload-check",
    ) as executor:
        futures = [
            executor.submit(request_once, url, timeout_seconds)
            for _ in range(request_count)
        ]
        return [future.result() for future in concurrent.futures.as_completed(futures)]


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


def summarize_results(results: list[RequestResult]) -> dict[str, object]:
    statuses: dict[str, int] = {}
    errors: dict[str, int] = {}
    latencies = []
    for result in results:
        latencies.append(result.latency_seconds)
        if result.status is not None:
            key = str(result.status)
            statuses[key] = statuses.get(key, 0) + 1
        if result.error:
            errors[result.error] = errors.get(result.error, 0) + 1
    return {
        "requests": len(results),
        "statuses": dict(sorted(statuses.items())),
        "errors": dict(sorted(errors.items())),
        "latency_ms": {
            "p50": round(_percentile(latencies, 0.50) * 1000, 2),
            "p95": round(_percentile(latencies, 0.95) * 1000, 2),
            "p99": round(_percentile(latencies, 0.99) * 1000, 2),
            "max": round(max(latencies, default=0.0) * 1000, 2),
        },
    }


def wait_for_recovery(
    url: str,
    *,
    timeout_seconds: float,
    request_timeout_seconds: float,
    interval_seconds: float,
    consecutive_successes: int = 3,
) -> tuple[bool, int, float]:
    """Require repeated 2xx health responses before declaring recovery."""

    started_at = time.monotonic()
    deadline = started_at + timeout_seconds
    attempts = 0
    successful = 0
    while time.monotonic() <= deadline:
        attempts += 1
        result = request_once(url, request_timeout_seconds)
        if result.status is not None and 200 <= result.status < 300:
            successful += 1
            if successful >= consecutive_successes:
                return True, attempts, time.monotonic() - started_at
        else:
            successful = 0
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(interval_seconds, remaining))
    return False, attempts, time.monotonic() - started_at


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Send a bounded burst and verify readiness recovers without restart.",
    )
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--burst-path", default="/health/live")
    parser.add_argument("--recovery-path", default="/health/ready")
    parser.add_argument("--concurrency", type=int, default=64)
    parser.add_argument("--requests", type=int, default=1000)
    parser.add_argument("--request-timeout-seconds", type=float, default=5.0)
    parser.add_argument("--recovery-timeout-seconds", type=float, default=60.0)
    parser.add_argument("--recovery-interval-seconds", type=float, default=0.5)
    parser.add_argument("--require-shedding", action="store_true")
    parser.add_argument("--allow-remote-target", action="store_true")
    return parser


def _validate_load_arguments(args) -> None:
    remote = bool(args.allow_remote_target)
    max_concurrency = 128 if remote else 512
    max_requests = 10_000 if remote else 100_000
    if not 1 <= args.concurrency <= max_concurrency:
        raise LoadTestConfigurationError(
            f"--concurrency must be between 1 and {max_concurrency}."
        )
    if not 1 <= args.requests <= max_requests:
        raise LoadTestConfigurationError(
            f"--requests must be between 1 and {max_requests}."
        )
    if not 0.1 <= args.request_timeout_seconds <= 30:
        raise LoadTestConfigurationError(
            "--request-timeout-seconds must be between 0.1 and 30."
        )
    if not 1 <= args.recovery_timeout_seconds <= 600:
        raise LoadTestConfigurationError(
            "--recovery-timeout-seconds must be between 1 and 600."
        )
    if not 0.05 <= args.recovery_interval_seconds <= 10:
        raise LoadTestConfigurationError(
            "--recovery-interval-seconds must be between 0.05 and 10."
        )


def main(argv: list[str] | None = None) -> int:
    args = build_argument_parser().parse_args(argv)
    try:
        _validate_load_arguments(args)
        burst_url = build_target_url(
            args.base_url,
            args.burst_path,
            allow_remote_target=args.allow_remote_target,
        )
        recovery_url = build_target_url(
            args.base_url,
            args.recovery_path,
            allow_remote_target=args.allow_remote_target,
        )
    except LoadTestConfigurationError as exc:
        print(f"Overload check refused: {exc}")
        return 2

    results = run_burst(
        burst_url,
        concurrency=args.concurrency,
        request_count=args.requests,
        timeout_seconds=args.request_timeout_seconds,
    )
    summary = summarize_results(results)
    shedding_count = sum(
        int(summary["statuses"].get(str(status), 0))
        for status in SHEDDING_STATUSES
    )
    recovered, attempts, recovery_seconds = wait_for_recovery(
        recovery_url,
        timeout_seconds=args.recovery_timeout_seconds,
        request_timeout_seconds=args.request_timeout_seconds,
        interval_seconds=args.recovery_interval_seconds,
    )
    summary["shedding_responses"] = shedding_count
    summary["recovery"] = {
        "recovered": recovered,
        "attempts": attempts,
        "seconds": round(recovery_seconds, 2),
    }
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))

    if not recovered:
        return 3
    if args.require_shedding and shedding_count == 0:
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
