import pytest

from backend.sync.evaluation_metadata import (
    EVALUATION_METADATA_SCHEMA_VERSION,
    dump_evaluation_metadata,
    migrate_evaluation_metadata,
    parse_evaluation_metadata,
    parse_evaluation_metadata_for_display,
)


def test_strict_evaluation_metadata_rejects_malformed_arrays_and_unknown_schemas():
    for value in ("{broken", "[]", [], {"schemaVersion": 99}):
        with pytest.raises(ValueError):
            parse_evaluation_metadata(value)
        with pytest.raises(ValueError):
            dump_evaluation_metadata(value)


def test_display_parser_reports_corruption_without_a_persistable_fallback():
    raw = "{broken"
    result = parse_evaluation_metadata_for_display(raw)

    assert result["canPersist"] is False
    assert result["raw"] == raw
    assert isinstance(result["error"], ValueError)
    assert result["metadata"] == {
        "schemaVersion": EVALUATION_METADATA_SCHEMA_VERSION,
    }


def test_metadata_migration_is_idempotent_and_preserves_1g2t_blocks():
    legacy = {
        "schemaVersion": 0,
        "is1G2T": True,
        "technical": {"saved": True, "criteria": [{"id": "criterion-1"}]},
        "financial": {"saved": False},
    }
    migrated = migrate_evaluation_metadata(legacy)

    assert migrated["schemaVersion"] == EVALUATION_METADATA_SCHEMA_VERSION
    assert migrated["technical"] == legacy["technical"]
    assert migrated["financial"] == legacy["financial"]
    assert migrate_evaluation_metadata(migrated) == migrated


def test_metadata_codec_rejects_payloads_larger_than_64_kib():
    with pytest.raises(ValueError, match="64 KiB"):
        dump_evaluation_metadata({"notes": "x" * (64 * 1024)})
