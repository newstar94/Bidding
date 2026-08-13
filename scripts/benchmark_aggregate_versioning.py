"""Repeatable in-memory benchmark for aggregate clone/validation envelopes."""

from __future__ import annotations

import argparse
import json
import time
import tracemalloc
from pathlib import Path

from backend.versioning.aggregate_snapshot import snapshot_plan_aggregate
from backend.versioning.aggregate_validator import validate_generated_aggregate_graph


def fixture(record_count: int):
    package_count = max(1, record_count // 4)
    state = {
        "goithau": [],
        "goithauhanghoa": [],
        "thongtinmothau": [],
        "hanghoaduthaunhathau": [],
        "assignments": [],
    }
    for index in range(package_count):
        package_id = f"package-{index}"
        goods_id = f"goods-{index}"
        opening_id = f"opening-{index}"
        state["goithau"].append({
            "id": package_id,
            "rootId": package_id,
            "keHoachId": "plan-source",
            "phienBan": 0,
            "isLatest": 1,
            "phanLoList": [],
        })
        state["goithauhanghoa"].append({
            "id": goods_id, "goiThauId": package_id,
        })
        state["thongtinmothau"].append({
            "id": opening_id, "goiThauId": package_id,
        })
        state["hanghoaduthaunhathau"].append({
            "id": f"bidder-goods-{index}",
            "goiThauId": package_id,
            "thongTinMoThauId": opening_id,
            "goiThauHangHoaId": goods_id,
        })
    return state


def run_case(record_count: int):
    state = fixture(record_count)
    counter = 0

    def create_id(kind):
        nonlocal counter
        counter += 1
        return f"target-{kind}-{counter}"

    tracemalloc.start()
    started = time.perf_counter()
    aggregate = snapshot_plan_aggregate(
        state,
        source_plan_id="plan-source",
        target_plan_id="plan-target",
        timestamp="2026-08-14 00:00:00",
        create_id=create_id,
    )
    payload = {
        "kehoach": [{"id": "plan-target", "isLatest": 1}],
        **{key: aggregate[key] for key in (
            "goithau", "goithauhanghoa", "thongtinmothau",
            "hanghoaduthaunhathau", "assignments",
        )},
    }
    validate_generated_aggregate_graph(payload)
    elapsed = time.perf_counter() - started
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    output_items = sum(len(value) for value in payload.values() if isinstance(value, list))
    return {
        "requestedRecords": record_count,
        "outputItems": output_items,
        "wallSeconds": round(elapsed, 4),
        "peakMiB": round(peak / (1024 * 1024), 2),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", default="2000,10000,25000")
    parser.add_argument("--output")
    args = parser.parse_args()
    result = {
        "benchmark": "aggregate-version-clone-validation",
        "cases": [run_case(int(value)) for value in args.sizes.split(",")],
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
