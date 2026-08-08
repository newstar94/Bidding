export const EVALUATION_METADATA_SCHEMA_VERSION = 1;
export const MAX_EVALUATION_METADATA_BYTES = 64 * 1024;

function decodeMetadata(value) {
  let metadata;
  try {
    metadata = typeof value === "string"
      ? (value.trim() ? JSON.parse(value) : {})
      : value ?? {};
  } catch {
    throw new Error("Metadata đánh giá không phải JSON hợp lệ");
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Metadata đánh giá phải là object");
  }
  return structuredClone(metadata);
}

function assertMetadataSize(metadata) {
  const encoded = new TextEncoder().encode(JSON.stringify(metadata));
  if (encoded.byteLength > MAX_EVALUATION_METADATA_BYTES) {
    throw new Error("Metadata đánh giá vượt giới hạn 64 KiB");
  }
}

export function migrateEvaluationMetadata(value) {
  const metadata = decodeMetadata(value);
  const version = metadata.schemaVersion;
  if (version === undefined || version === null || version === 0) {
    metadata.schemaVersion = EVALUATION_METADATA_SCHEMA_VERSION;
  } else if (version !== EVALUATION_METADATA_SCHEMA_VERSION) {
    throw new Error(`Không hỗ trợ schemaVersion metadata đánh giá: ${version}`);
  }
  assertMetadataSize(metadata);
  return metadata;
}

export function parseEvaluationMetadataStrict(value) {
  return migrateEvaluationMetadata(value);
}

export function parseEvaluationMetadataForDisplay(value) {
  try {
    return {
      metadata: parseEvaluationMetadataStrict(value),
      error: null,
      canPersist: true,
      raw: value,
    };
  } catch (error) {
    return {
      metadata: { schemaVersion: EVALUATION_METADATA_SCHEMA_VERSION },
      error,
      canPersist: false,
      raw: value,
    };
  }
}

export function parseEvaluationMetadata(value) {
  return parseEvaluationMetadataStrict(value);
}

export function serializeEvaluationMetadata(value) {
  return JSON.stringify(parseEvaluationMetadataStrict(value));
}

export const parseStrict = parseEvaluationMetadataStrict;
export const parseForDisplay = parseEvaluationMetadataForDisplay;
export const serialize = serializeEvaluationMetadata;
export const migrate = migrateEvaluationMetadata;
