from scripts.legal_versioning_inventory import (
    summarize_target_bindings,
    verify_source_hash_rows,
)


def test_legal_inventory_counts_unbound_status_and_stale_facts_without_backfill():
    report = summarize_target_bindings(7, [
        ("RESOLVED", 2, 2),
        ("AMBIGUOUS", 1, 1),
        ("UNRESOLVED", 3, 2),
        ("MANUAL_REVIEW_REQUIRED", 1, 1),
        ("FUTURE_STATUS", 1, 1),
    ])
    assert report == {
        "totalLiveTargets": 7,
        "boundTargets": 5,
        "legacyUnboundTargets": 2,
        "statusCounts": {
            "RESOLVED": 1,
            "AMBIGUOUS": 1,
            "UNRESOLVED": 1,
            "MANUAL_REVIEW_REQUIRED": 1,
        },
        "unexpectedStatusCounts": {"FUTURE_STATUS": 1},
        "bindingsWithStaleTargetFacts": 1,
    }


def test_legal_inventory_hash_check_reports_ids_without_source_content():
    import hashlib

    content = "Nội dung pháp lý bất biến"
    relations = "[]"
    rows = [
        (
            "liv-ok", content, hashlib.sha256(content.encode()).hexdigest(),
            relations, hashlib.sha256(relations.encode()).hexdigest(),
        ),
        ("liv-bad", content, "0" * 64, relations, "1" * 64),
    ]
    assert verify_source_hash_rows(rows) == [{
        "instrumentVersionId": "liv-bad",
        "failures": ["CONTENT_SHA256_MISMATCH", "RELATION_SHA256_MISMATCH"],
    }]
