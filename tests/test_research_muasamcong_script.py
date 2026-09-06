import scripts.research_muasamcong as research_module
from scripts.research_muasamcong import summarize_artifact


def test_research_summary_contains_only_bounded_diagnostics():
    artifact = {
        "framework": "vue2",
        "driver": "vue2",
        "capabilities": {"vue2": True, "genericSearchUi": True},
        "networkResponses": [{
            "url": "https://example.test/path?token=secret",
            "body": {"token": "must-not-log"},
        }],
        "vueStateCandidates": [{"notifyNo": "IB2600000002"}],
        "domCandidates": [],
        "metrics": {"totalMs": 42, "navigationMs": 10},
        "diagnostics": {"extractorSelected": "vue-state"},
    }

    summary = summarize_artifact(
        artifact, code="IB2600000002", kind="PACKAGE"
    )

    assert summary == {
        "code": "IB2600000002",
        "kind": "PACKAGE",
        "framework": "vue2",
        "driver": "vue2",
        "capabilities": {"vue2": True, "genericSearchUi": True},
        "networkResponseCount": 1,
        "vueCandidateCount": 1,
        "domCandidateCount": 0,
        "matchingCandidates": 1,
        "extractorSelected": "vue-state",
        "metrics": {"totalMs": 42, "navigationMs": 10},
    }
    assert "token" not in str(summary).casefold()
    assert "url" not in str(summary).casefold()


def test_live_cli_loads_the_project_environment_before_launch(
    tmp_path, monkeypatch, capsys
):
    (tmp_path / ".env").write_text(
        "PROCUREMENT_LOOKUP_ENABLED=true\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("PROCUREMENT_LOOKUP_ENABLED", raising=False)
    monkeypatch.delenv("BIDDING_DATABASE_PROFILE", raising=False)
    monkeypatch.setattr(research_module, "PROJECT_ROOT", tmp_path)

    def fake_live_artifact(code, kind):
        assert code == "PL2600000001"
        assert kind == "PLAN"
        assert research_module.os.environ["PROCUREMENT_LOOKUP_ENABLED"] == "true"
        return {}

    monkeypatch.setattr(research_module, "_live_artifact", fake_live_artifact)

    assert research_module.main(["PL2600000001", "--live"]) == 0
    assert '"code": "PL2600000001"' in capsys.readouterr().out
