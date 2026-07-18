import json
from pathlib import Path

from scripts.benchmark_postgresql_queries import evaluate_budget, summarize_explain


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_postgresql_explain_summary_tracks_index_and_buffers():
    document = [
        {
            "Planning Time": 0.25,
            "Execution Time": 1.75,
            "Plan": {
                "Node Type": "Limit",
                "Actual Rows": 50,
                "Shared Hit Blocks": 2,
                "Plans": [
                    {
                        "Node Type": "Index Scan",
                        "Shared Hit Blocks": 8,
                        "Shared Read Blocks": 1,
                    }
                ],
            },
        }
    ]

    summary = summarize_explain(document)

    assert summary == {
        "planningMs": 0.25,
        "executionMs": 1.75,
        "actualRows": 50,
        "sharedHitBlocks": 10,
        "sharedReadBlocks": 1,
        "nodeTypes": ["Limit", "Index Scan"],
        "usesIndex": True,
    }


def test_postgresql_query_budget_fails_slow_or_unindexed_plan():
    measurement = {"executionMs": 31.0, "usesIndex": False}
    failures = evaluate_budget(
        "pagination",
        measurement,
        {"maxExecutionMs": 30.0, "requireIndex": True},
    )

    assert failures == [
        "pagination: execution 31.0 ms exceeds 30.0 ms",
        "pagination: plan does not use an index",
    ]


def test_postgresql_query_budget_accepts_plan_inside_contract():
    assert evaluate_budget(
        "deltaSync",
        {"executionMs": 3.5, "usesIndex": True},
        {"maxExecutionMs": 40.0, "requireIndex": True},
    ) == []


def test_postgresql_query_budget_covers_required_production_paths_and_ci():
    contract = json.loads(
        (PROJECT_ROOT / "load" / "postgresql-query-budgets.json").read_text(
            encoding="utf-8"
        )
    )
    assert contract["dataset"] == {"plans": 20_000, "packages": 100_000}
    assert set(contract["queries"]) == {
        "dashboard",
        "pagination",
        "deltaSync",
        "exportPackage",
    }
    assert all(
        contract["queries"][name]["requireIndex"]
        for name in ("pagination", "deltaSync", "exportPackage")
    )
    workflow = (PROJECT_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )
    assert "Enforce PostgreSQL query-plan budgets" in workflow
    assert "scripts/benchmark_postgresql_queries.py" in workflow
