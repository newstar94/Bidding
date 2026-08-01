import json

import pytest

from scripts import verify_overload_recovery as overload


def test_target_guard_allows_loopback_and_refuses_remote_without_opt_in():
    assert overload.build_target_url(
        "http://127.0.0.1:8080",
        "/health/live",
        allow_remote_target=False,
    ) == "http://127.0.0.1:8080/health/live"

    with pytest.raises(overload.LoadTestConfigurationError, match="explicit"):
        overload.build_target_url(
            "https://bid.example.vn",
            "/health/live",
            allow_remote_target=False,
        )

    assert overload.build_target_url(
        "https://bid.example.vn",
        "/health/live",
        allow_remote_target=True,
    ) == "https://bid.example.vn/health/live"


@pytest.mark.parametrize(
    "base_url,path",
    [
        ("ftp://127.0.0.1", "/health/live"),
        ("http://user:password@127.0.0.1", "/health/live"),
        ("http://127.0.0.1/admin", "/health/live"),
        ("http://127.0.0.1:not-a-port", "/health/live"),
        ("http://127.0.0.1", "health/live"),
    ],
)
def test_target_guard_rejects_ambiguous_urls(base_url, path):
    with pytest.raises(overload.LoadTestConfigurationError):
        overload.build_target_url(
            base_url,
            path,
            allow_remote_target=False,
        )


def test_burst_summary_reports_statuses_errors_and_nearest_rank_percentiles():
    summary = overload.summarize_results(
        [
            overload.RequestResult(200, 0.010),
            overload.RequestResult(429, 0.020),
            overload.RequestResult(503, 0.030),
            overload.RequestResult(None, 0.100, "TimeoutError"),
        ]
    )

    assert summary == {
        "requests": 4,
        "statuses": {"200": 1, "429": 1, "503": 1},
        "errors": {"TimeoutError": 1},
        "latency_ms": {"p50": 20.0, "p95": 100.0, "p99": 100.0, "max": 100.0},
    }


def test_recovery_requires_three_consecutive_successes(monkeypatch):
    results = iter(
        [
            overload.RequestResult(503, 0.001),
            overload.RequestResult(200, 0.001),
            overload.RequestResult(503, 0.001),
            overload.RequestResult(200, 0.001),
            overload.RequestResult(200, 0.001),
            overload.RequestResult(200, 0.001),
        ]
    )
    monkeypatch.setattr(overload, "request_once", lambda *_args: next(results))
    monkeypatch.setattr(overload.time, "sleep", lambda _seconds: None)

    recovered, attempts, _seconds = overload.wait_for_recovery(
        "http://127.0.0.1:8080/health/ready",
        timeout_seconds=2,
        request_timeout_seconds=1,
        interval_seconds=0.05,
    )

    assert recovered is True
    assert attempts == 6


def test_cli_accepts_controlled_shedding_and_recovery(monkeypatch, capsys):
    monkeypatch.setattr(
        overload,
        "run_burst",
        lambda *_args, **_kwargs: [
            overload.RequestResult(200, 0.01),
            overload.RequestResult(429, 0.02),
            overload.RequestResult(503, 0.03),
        ],
    )
    monkeypatch.setattr(
        overload,
        "wait_for_recovery",
        lambda *_args, **_kwargs: (True, 3, 0.5),
    )

    exit_code = overload.main(
        [
            "--base-url",
            "http://127.0.0.1:8080",
            "--requests",
            "3",
            "--concurrency",
            "2",
            "--require-shedding",
        ]
    )

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert payload["shedding_responses"] == 2
    assert payload["recovery"]["recovered"] is True


def test_cli_fails_when_required_shedding_is_absent(monkeypatch, capsys):
    monkeypatch.setattr(
        overload,
        "run_burst",
        lambda *_args, **_kwargs: [overload.RequestResult(200, 0.01)],
    )
    monkeypatch.setattr(
        overload,
        "wait_for_recovery",
        lambda *_args, **_kwargs: (True, 3, 0.1),
    )

    exit_code = overload.main(
        [
            "--base-url",
            "http://127.0.0.1:8080",
            "--requests",
            "1",
            "--concurrency",
            "1",
            "--require-shedding",
        ]
    )

    assert exit_code == 4
    assert json.loads(capsys.readouterr().out)["shedding_responses"] == 0


def test_cli_refuses_excessive_remote_load_before_sending(monkeypatch, capsys):
    def should_not_run(*_args, **_kwargs):
        raise AssertionError("traffic must not be sent")

    monkeypatch.setattr(overload, "run_burst", should_not_run)

    exit_code = overload.main(
        [
            "--base-url",
            "https://bid.example.vn",
            "--allow-remote-target",
            "--concurrency",
            "129",
        ]
    )

    assert exit_code == 2
    assert "between 1 and 128" in capsys.readouterr().out
