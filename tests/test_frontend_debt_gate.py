from scripts.check_frontend_debt import (
    collect_debt_metrics,
    find_unauthorized_persist_and_sync_calls,
    find_unauthorized_synced_persist_calls,
    validate_debt_metrics,
)


def test_frontend_debt_gate_reports_only_increases(tmp_path):
    (tmp_path / "sample.css").write_text(
        ".a { color: #fff !important; }",
        encoding="utf-8",
    )
    (tmp_path / "sample.js").write_text(
        "model.state.items = []; setRuntimeStyle(node, 'display', 'none');",
        encoding="utf-8",
    )
    metrics = collect_debt_metrics(tmp_path)

    assert metrics == {
        "important": 1,
        "raw_colors": 1,
        "runtime_styles": 1,
        "inferred_actions": 0,
        "direct_state_writes": 1,
    }
    assert validate_debt_metrics(metrics, metrics) == []
    assert validate_debt_metrics(metrics, {**metrics, "important": 0}) == [
        "important increased from 0 to 1"
    ]


def test_frontend_debt_gate_rejects_new_synced_persist_data_callers(tmp_path):
    (tmp_path / "feature.js").write_text(
        'controller.model.persistData("goithau");',
        encoding="utf-8",
    )

    assert find_unauthorized_synced_persist_calls(tmp_path) == [
        "feature.js:1: persistData(goithau)"
    ]


def test_frontend_debt_gate_rejects_implicit_synced_persist_and_sync(tmp_path):
    (tmp_path / "feature.js").write_text(
        'persistAndSync(controller, ["goithau", "employees"]);',
        encoding="utf-8",
    )

    assert find_unauthorized_persist_and_sync_calls(tmp_path) == [
        "feature.js:1: explicit changes required"
    ]


def test_frontend_debt_gate_accepts_explicit_changes_and_local_only_calls(tmp_path):
    (tmp_path / "feature.js").write_text(
        '''persistAndSync(controller, "goithau", {
          changes: { upserts: { goithau: [record] } },
        });
        persistAndSync(controller, "employees");''',
        encoding="utf-8",
    )

    assert find_unauthorized_persist_and_sync_calls(tmp_path) == []


def test_frontend_debt_gate_rejects_legacy_opt_in_outside_allowlist(tmp_path):
    (tmp_path / "feature.js").write_text(
        '''persistAndSync(controller, "permissionmatrix", {
          allowLegacyPersistence: true,
        });''',
        encoding="utf-8",
    )

    assert find_unauthorized_persist_and_sync_calls(tmp_path) == [
        "feature.js:1: legacy opt-in outside allowlist"
    ]
