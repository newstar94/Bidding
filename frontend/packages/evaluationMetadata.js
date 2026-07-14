export const EVALUATION_METADATA_SCHEMA_VERSION = 1;
export const MAX_EVALUATION_METADATA_BYTES = 64 * 1024;

export function parseEvaluationMetadata(value) {
  let metadata;
  try {
    metadata = typeof value === "string" ? (value.trim() ? JSON.parse(value) : {}) : value || {};
  } catch {
    throw new Error("Metadata đánh giá không phải JSON hợp lệ");
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Metadata đánh giá phải là object");
  }
  const version = metadata.schemaVersion ?? EVALUATION_METADATA_SCHEMA_VERSION;
  if (version !== EVALUATION_METADATA_SCHEMA_VERSION) {
    throw new Error(`Không hỗ trợ schemaVersion metadata đánh giá: ${version}`);
  }
  const normalized = { ...metadata, schemaVersion: EVALUATION_METADATA_SCHEMA_VERSION };
  const encoded = new TextEncoder().encode(JSON.stringify(normalized));
  if (encoded.byteLength > MAX_EVALUATION_METADATA_BYTES) {
    throw new Error("Metadata đánh giá vượt giới hạn 64 KiB");
  }
  return normalized;
}

export function serializeEvaluationMetadata(value) {
  return JSON.stringify(parseEvaluationMetadata(value));
}
