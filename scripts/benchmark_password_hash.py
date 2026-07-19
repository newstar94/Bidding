"""Benchmark the configured Argon2id cost on the deployment host."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.auth.auth_helper import hash_password, verify_password


def _percentile(values, percentile):
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * percentile)))
    return ordered[index]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--max-p95-ms", type=float, default=1000.0)
    parser.add_argument("--min-p50-ms", type=float, default=30.0)
    args = parser.parse_args()
    if not 3 <= args.samples <= 50:
        raise SystemExit("--samples must be between 3 and 50")

    password = "Argon2 deployment benchmark 2026!"
    hash_times = []
    verify_times = []
    for _ in range(args.samples):
        started = time.perf_counter()
        encoded = hash_password(password)
        hash_times.append((time.perf_counter() - started) * 1000)
        started = time.perf_counter()
        if not verify_password(encoded, password):
            raise SystemExit("Argon2 verification failed")
        verify_times.append((time.perf_counter() - started) * 1000)

    payload = {
        "algorithm": "argon2id",
        "samples": args.samples,
        "hash_p50_ms": round(statistics.median(hash_times), 1),
        "hash_p95_ms": round(_percentile(hash_times, 0.95), 1),
        "verify_p50_ms": round(statistics.median(verify_times), 1),
        "verify_p95_ms": round(_percentile(verify_times, 0.95), 1),
    }
    print(json.dumps(payload, separators=(",", ":")))
    if payload["hash_p95_ms"] > args.max_p95_ms:
        raise SystemExit("Argon2 hashing exceeds the deployment latency budget")
    if payload["hash_p50_ms"] < args.min_p50_ms:
        raise SystemExit("Argon2 hashing is below the minimum deployment work budget")


if __name__ == "__main__":
    main()
