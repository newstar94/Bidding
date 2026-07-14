import json


EVALUATION_METADATA_SCHEMA_VERSION = 1
MAX_EVALUATION_METADATA_BYTES = 64 * 1024


def parse_evaluation_metadata(value, *, require_version=True):
    if value in (None, ""):
        return {"schemaVersion": EVALUATION_METADATA_SCHEMA_VERSION}
    try:
        metadata = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Evaluation metadata must be valid JSON.") from exc
    if not isinstance(metadata, dict):
        raise ValueError("Evaluation metadata must be a JSON object.")
    encoded = json.dumps(metadata, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_EVALUATION_METADATA_BYTES:
        raise ValueError("Evaluation metadata exceeds the 64 KiB limit.")
    version = metadata.get("schemaVersion")
    if require_version and version != EVALUATION_METADATA_SCHEMA_VERSION:
        raise ValueError("Evaluation metadata schemaVersion is not supported.")
    if version is None:
        metadata["schemaVersion"] = EVALUATION_METADATA_SCHEMA_VERSION
    return metadata


def dump_evaluation_metadata(metadata):
    normalized = parse_evaluation_metadata(metadata, require_version=False)
    return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
