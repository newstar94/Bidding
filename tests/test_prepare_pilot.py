"""The one-click pilot launcher prepares database, frontend and schema."""

import json
from pathlib import Path

import pytest

from scripts import prepare_pilot


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def frontend(tmp_path, monkeypatch):
    marker = tmp_path / "secure-build.json"
    commands = []
    monkeypatch.setattr(prepare_pilot, "MARKER", marker)
    monkeypatch.delenv("APP_RELEASE_ID", raising=False)
    monkeypatch.setattr(prepare_pilot.shutil, "which", lambda name: f"/bin/{name}")
    monkeypatch.setattr(prepare_pilot, "_source_release_id", lambda _node: "a" * 64)

    def run(command, *, failure):
        commands.append(command)
        marker.write_text(json.dumps({"releaseId": "a" * 64}), encoding="utf-8")

    monkeypatch.setattr(prepare_pilot, "_run", run)
    return marker, commands


def test_current_bundle_is_not_rebuilt(frontend):
    marker, commands = frontend
    marker.write_text(json.dumps({"releaseId": "a" * 64}), encoding="utf-8")
    prepare_pilot.ensure_frontend_built()
    assert commands == []


@pytest.mark.parametrize("content", [None, "{}", "not json", json.dumps({"releaseId": "b" * 64})])
def test_missing_or_stale_bundle_is_rebuilt(frontend, content):
    marker, commands = frontend
    if content is not None:
        marker.write_text(content, encoding="utf-8")
    prepare_pilot.ensure_frontend_built()
    assert len(commands) == 1
    assert commands[0][1:] == ["run", "build:secure"]


def test_pinned_release_id_never_rebuilds(frontend, monkeypatch):
    _marker, commands = frontend
    monkeypatch.setenv("APP_RELEASE_ID", "c" * 40)
    prepare_pilot.ensure_frontend_built()
    assert commands == []


def test_build_that_does_not_match_sources_fails(frontend, monkeypatch):
    marker, _commands = frontend
    monkeypatch.setattr(prepare_pilot, "_run", lambda *_args, **_kwargs: None)
    with pytest.raises(prepare_pilot.PilotPreparationError, match="không khớp"):
        prepare_pilot.ensure_frontend_built()
    assert not marker.exists()


def test_failed_step_stops_before_later_steps(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(prepare_pilot, "load_env", lambda _root: None)

    def failing_database():
        calls.append("database")
        raise prepare_pilot.PilotPreparationError("PostgreSQL lỗi")

    monkeypatch.setattr(prepare_pilot, "ensure_database_running", failing_database)
    monkeypatch.setattr(prepare_pilot, "ensure_frontend_built", lambda: calls.append("frontend"))
    monkeypatch.setattr(prepare_pilot, "ensure_schema_current", lambda: calls.append("schema"))
    assert prepare_pilot.main() == 1
    assert calls == ["database"]
    assert "PostgreSQL lỗi" in capsys.readouterr().err


def test_launcher_prepares_before_opening_the_tunnel():
    launcher = (PROJECT_ROOT / "KHOI_DONG_PILOT.bat").read_text(encoding="utf-8")
    prepare = launcher.index("scripts\\prepare_pilot.py")
    assert prepare < launcher.index("'start','Cloudflared'")
    assert prepare < launcher.index("run_demo_server.ps1")
    assert "goto :prepare_error" in launcher
