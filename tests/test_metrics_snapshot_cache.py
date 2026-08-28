from concurrent.futures import ThreadPoolExecutor
import threading
import time

from backend.observability import metrics


def test_concurrent_operational_scrapes_create_one_expensive_refresh(monkeypatch):
    metrics._reset_metrics_for_tests()
    calls = 0
    lock = threading.Lock()

    def collect():
        nonlocal calls
        with lock:
            calls += 1
        time.sleep(0.02)
        return {"postgres_database_bytes": 42}

    monkeypatch.setattr(metrics, "_collect_filesystem_metrics", collect)
    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(lambda _: metrics._filesystem_metrics(), range(20)))

    assert calls == 1
    assert all(result["postgres_database_bytes"] == 42 for result in results)
    assert all(result["_collection_success"] is True for result in results)


def test_failed_refresh_keeps_last_known_good_and_reports_failure(monkeypatch):
    metrics._reset_metrics_for_tests()
    monkeypatch.setattr(
        metrics,
        "_collect_filesystem_metrics",
        lambda: {"postgres_database_bytes": 99},
    )
    assert metrics.refresh_filesystem_metrics()["postgres_database_bytes"] == 99
    with metrics._lock:
        metrics._filesystem_snapshot["checked_at"] = 0
    monkeypatch.setattr(
        metrics,
        "_collect_filesystem_metrics",
        lambda: (_ for _ in ()).throw(RuntimeError("collector failed")),
    )
    snapshot = metrics._filesystem_metrics()
    assert snapshot["postgres_database_bytes"] == 99
    assert snapshot["_collection_success"] is False
