import json


EVALUATION_METADATA_SCHEMA_VERSION = 1
MAX_EVALUATION_METADATA_BYTES = 64 * 1024


def _decode_evaluation_metadata(value):
    if value in (None, ""):
        return {}
    try:
        metadata = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Evaluation metadata must be valid JSON.") from exc
    if not isinstance(metadata, dict):
        raise ValueError("Evaluation metadata must be a JSON object.")
    # Metadata is a JSON contract. Round-tripping creates an isolated plain
    # object and rejects values that could never be persisted as JSON.
    try:
        return json.loads(json.dumps(metadata, ensure_ascii=False))
    except (TypeError, ValueError) as exc:
        raise ValueError("Evaluation metadata must contain JSON values only.") from exc


def _validate_metadata_size(metadata):
    encoded = json.dumps(
        metadata, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    if len(encoded) > MAX_EVALUATION_METADATA_BYTES:
        raise ValueError("Evaluation metadata exceeds the 64 KiB limit.")


def migrate_evaluation_metadata(value):
    metadata = _decode_evaluation_metadata(value)
    version = metadata.get("schemaVersion")
    if version in (None, 0):
        metadata["schemaVersion"] = EVALUATION_METADATA_SCHEMA_VERSION
    elif version != EVALUATION_METADATA_SCHEMA_VERSION:
        raise ValueError("Evaluation metadata schemaVersion is not supported.")
    _validate_metadata_size(metadata)
    return metadata


def parse_evaluation_metadata(value, *, require_version=True):
    # ``require_version`` remains for caller compatibility. Missing/version-0
    # legacy metadata is migrated; unknown future schemas always fail closed.
    del require_version
    return migrate_evaluation_metadata(value)


def parse_evaluation_metadata_for_display(value):
    try:
        return {
            "metadata": parse_evaluation_metadata(value),
            "error": None,
            "canPersist": True,
            "raw": value,
        }
    except ValueError as exc:
        return {
            "metadata": {
                "schemaVersion": EVALUATION_METADATA_SCHEMA_VERSION,
            },
            "error": exc,
            "canPersist": False,
            "raw": value,
        }


def dump_evaluation_metadata(metadata):
    normalized = parse_evaluation_metadata(metadata)
    return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
