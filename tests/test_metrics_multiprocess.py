import asyncio
import json
from pathlib import Path

import pytest

from backend.observability.multiprocess import (
    aggregate_snapshots,
    publish_snapshot,
    series_key,
)
from backend.observability import metrics


def _snapshot(*, requests, active, latency_max, checked_at, valid):
    return {
        "counters": {series_key("http_requests", "GET", "route", "200"): requests},
        "liveSums": {series_key("active_http"): active},
        "lifetimeMax": {series_key("database_phase_max", "scope", "phase"): latency_max},
        "liveMax": {series_key("event_loop_lag"): latency_max},
        "latest": {
            series_key("audit_valid"): {
                "timestamp": checked_at,
                "value": valid,
            }
        },
    }


def test_two_live_worker_snapshots_are_aggregated_without_double_count(tmp_path):
    publish_snapshot(
        _snapshot(requests=3, active=1, latency_max=0.4, checked_at=10, valid=0),
        directory=tmp_path,
        instance_id="deployment-1",
        pid=101,
        start_token="a",
    )
    publish_snapshot(
        _snapshot(requests=5, active=2, latency_max=0.7, checked_at=20, valid=1),
        directory=tmp_path,
        instance_id="deployment-1",
        pid=202,
        start_token="b",
    )

    aggregated = aggregate_snapshots(
        directory=tmp_path,
        instance_id="deployment-1",
        worker_alive=lambda _pid, _token: True,
    )

    assert aggregated["counters"][series_key("http_requests", "GET", "route", "200")] == 8
    assert aggregated["liveSums"][series_key("active_http")] == 3
    assert aggregated["lifetimeMax"][series_key("database_phase_max", "scope", "phase")] == 0.7
    assert aggregated["liveMax"][series_key("event_loop_lag")] == 0.7
    assert aggregated["latest"][series_key("audit_valid")]["value"] == 1
    assert aggregated["workerCount"] == 2


def test_dead_worker_is_archived_once_and_only_lifetime_values_survive(tmp_path):
    publish_snapshot(
        _snapshot(requests=4, active=3, latency_max=0.8, checked_at=30, valid=1),
        directory=tmp_path,
        instance_id="deployment-1",
        pid=303,
        start_token="c",
    )

    first = aggregate_snapshots(
        directory=tmp_path,
        instance_id="deployment-1",
        worker_alive=lambda _pid, _token: False,
    )
    second = aggregate_snapshots(
        directory=tmp_path,
        instance_id="deployment-1",
        worker_alive=lambda _pid, _token: False,
    )

    key = series_key("http_requests", "GET", "route", "200")
    assert first["counters"][key] == second["counters"][key] == 4
    assert first["liveSums"].get(series_key("active_http"), 0) == 0
    assert first["liveMax"].get(series_key("event_loop_lag"), 0) == 0
    assert first["lifetimeMax"][series_key("database_phase_max", "scope", "phase")] == 0.8
    assert first["latest"][series_key("audit_valid")]["value"] == 1
    assert first["workerCount"] == 0
    assert len(list(tmp_path.glob("archive-deployment-1-*.json"))) == 1
    assert not list(tmp_path.glob("worker-deployment-1-*.json"))


def test_archive_and_worker_copy_of_same_generation_are_not_double_counted(
    tmp_path,
):
    worker = publish_snapshot(
        _snapshot(requests=4, active=3, latency_max=0.8, checked_at=30, valid=1),
        directory=tmp_path,
        instance_id="deployment-1",
        pid=303,
        start_token="c",
    )
    payload = json.loads(Path(worker).read_text(encoding="utf-8"))
    payload.update({"archived": True, "liveSums": {}, "liveMax": {}, "liveMin": {}})
    archive = tmp_path / "archive-deployment-1-303-c.json"
    archive.write_text(json.dumps(payload), encoding="utf-8")

    aggregated = aggregate_snapshots(
        directory=tmp_path,
        instance_id="deployment-1",
        worker_alive=lambda _pid, _token: True,
    )

    key = series_key("http_requests", "GET", "route", "200")
    assert aggregated["counters"][key] == 4
    assert aggregated["liveSums"][series_key("active_http")] == 3


def test_concurrent_archive_rename_is_recovered_in_same_scrape(
    tmp_path, monkeypatch
):
    worker = publish_snapshot(
        _snapshot(requests=4, active=3, latency_max=0.8, checked_at=30, valid=1),
        directory=tmp_path,
        instance_id="deployment-1",
        pid=303,
        start_token="c",
    )
    archive = tmp_path / "archive-deployment-1-303-c.json"
    original_read_text = Path.read_text

    def rename_before_worker_read(path, *args, **kwargs):
        if path == worker and path.exists():
            path.replace(archive)
            raise FileNotFoundError(path)
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", rename_before_worker_read)

    aggregated = aggregate_snapshots(
        directory=tmp_path,
        instance_id="deployment-1",
        worker_alive=lambda _pid, _token: False,
    )

    key = series_key("http_requests", "GET", "route", "200")
    assert aggregated["counters"][key] == 4


def test_snapshots_from_previous_service_instance_are_ignored(tmp_path):
    publish_snapshot(
        _snapshot(requests=9, active=1, latency_max=1, checked_at=1, valid=1),
        directory=tmp_path,
        instance_id="old-deployment",
        pid=404,
        start_token="d",
    )

    aggregated = aggregate_snapshots(
        directory=tmp_path,
        instance_id="new-deployment",
        worker_alive=lambda _pid, _token: True,
    )

    assert aggregated["counters"] == {}
    assert aggregated["workerCount"] == 0


def test_publish_is_atomic_and_does_not_leave_partial_temp_files(tmp_path):
    path = publish_snapshot(
        _snapshot(requests=1, active=0, latency_max=0, checked_at=1, valid=1),
        directory=tmp_path,
        instance_id="deployment-1",
        pid=505,
        start_token="e",
    )

    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    assert payload["format"] == "biddingflow-multiprocess-metrics"
    assert not list(tmp_path.glob("*.tmp"))


def test_prometheus_renderer_exposes_sum_from_all_worker_shards(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("BIDDING_METRICS_MULTIPROCESS_DIR", str(tmp_path))
    monkeypatch.setenv("BIDDING_METRICS_INSTANCE_ID", "deployment-1")
    metrics._reset_metrics_for_tests()
    monkeypatch.setattr(
        metrics,
        "_filesystem_metrics",
        lambda: (_ for _ in ()).throw(OSError("not part of this seam")),
    )
    for pid, token, count in ((606, "f", 2), (707, "g", 5)):
        publish_snapshot(
            _snapshot(
                requests=count,
                active=0,
                latency_max=0,
                checked_at=0,
                valid=0,
            ),
            directory=tmp_path,
            instance_id="deployment-1",
            pid=pid,
            start_token=token,
        )

    rendered = metrics.render_prometheus()

    assert (
        'biddingflow_http_requests_total{method="GET",route="route",status="200"} 7'
        in rendered
    )
    assert "biddingflow_metrics_multiprocess_collection_success 1" in rendered


@pytest.mark.parametrize(
    "malformed_payload",
    (
        "{not-json",
        json.dumps({
            "format": "biddingflow-multiprocess-metrics",
            "version": 1,
            "instanceId": "deployment-1",
            "startToken": "broken",
        }),
        json.dumps({
            "format": "biddingflow-multiprocess-metrics",
            "version": 1,
            "instanceId": "deployment-1",
            "pid": 999,
            "startToken": "broken",
            "counters": {"not-a-series-key": 1},
        }),
    ),
    ids=("invalid-json", "missing-pid", "invalid-series-key"),
)
def test_malformed_worker_shard_marks_multiprocess_collection_failed(
    tmp_path, monkeypatch, malformed_payload
):
    monkeypatch.setenv("BIDDING_METRICS_MULTIPROCESS_DIR", str(tmp_path))
    monkeypatch.setenv("BIDDING_METRICS_INSTANCE_ID", "deployment-1")
    metrics._reset_metrics_for_tests()
    monkeypatch.setattr(
        metrics,
        "_filesystem_metrics",
        lambda: (_ for _ in ()).throw(OSError("not part of this seam")),
    )
    (tmp_path / "worker-deployment-1-999-broken.json").write_text(
        malformed_payload,
        encoding="utf-8",
    )

    rendered = metrics.render_prometheus()

    assert "biddingflow_metrics_multiprocess_collection_success 0" in rendered


def test_monitor_publishes_final_snapshot_when_worker_is_cancelled(monkeypatch):
    snapshots = []
    state = {"requests": 1}

    monkeypatch.setattr(metrics, "multiprocess_metrics_enabled", lambda: True)
    monkeypatch.setattr(
        metrics,
        "_local_multiprocess_snapshot",
        lambda _application: {
            "counters": {series_key("http_requests"): state["requests"]}
        },
    )
    monkeypatch.setattr(
        metrics,
        "publish_snapshot",
        lambda snapshot: snapshots.append(snapshot),
    )

    async def cancel_after_last_interval(_seconds):
        state["requests"] = 2
        raise asyncio.CancelledError

    monkeypatch.setattr(metrics.asyncio, "sleep", cancel_after_last_interval)

    try:
        asyncio.run(metrics.monitor_multiprocess_metrics(object()))
    except asyncio.CancelledError:
        pass

    assert [
        snapshot["counters"][series_key("http_requests")]
        for snapshot in snapshots
    ] == [1, 2]
