import { reportLotJsonRecovery } from "../shared/releaseDiagnostics.js";

const LOT_PARSE_CONTEXTS = new Set([
  "award_command",
  "legacy_award_command",
  "package_pricing_command",
  "evaluation_scope_command",
  "award_approval_markup",
  "award_history",
  "award_view_model",
  "award_panel",
  "package_table",
  "package_form",
  "evaluation_scope",
  "low_price_rules",
]);

const normalizeContext = (value) => {
  const context = String(value || "unknown");
  return LOT_PARSE_CONTEXTS.has(context) ? context : "unknown";
};

const inputKindOf = (value) => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
};

export class LotListParseError extends Error {
  constructor(code, { context, inputKind } = {}) {
    const boundedContext = normalizeContext(context);
    super(`Lot list is invalid (${code}) in ${boundedContext}; expected a JSON array.`);
    this.name = "LotListParseError";
    this.code = code;
    this.context = boundedContext;
    this.inputKind = String(inputKind || "unknown").slice(0, 16);
  }
}

export function parseLotListStrict(value, { context = "unknown" } = {}) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  if (typeof value !== "string") {
    throw new LotListParseError("UNSUPPORTED_TYPE", {
      context,
      inputKind: inputKindOf(value),
    });
  }
  if (!value.trim()) return [];

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LotListParseError("MALFORMED_JSON", {
      context,
      inputKind: "string",
    });
  }
  if (!Array.isArray(parsed)) {
    throw new LotListParseError("EXPECTED_ARRAY", {
      context,
      inputKind: "string",
    });
  }
  return parsed;
}

export function parseLotListForDisplay(value, {
  context = "unknown",
  onRecover = reportLotJsonRecovery,
} = {}) {
  try {
    return parseLotListStrict(value, { context });
  } catch (error) {
    if (!(error instanceof LotListParseError)) throw error;
    const event = Object.freeze({
      code: error.code,
      context: error.context,
      inputKind: error.inputKind,
    });
    try {
      void onRecover?.(event);
    } catch {
      // Telemetry must never turn a display-only recovery into a rendering failure.
    }
    return [];
  }
}
