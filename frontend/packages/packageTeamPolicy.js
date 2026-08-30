import { normalizeStatus } from "./LifecyclePolicy.js";

/**
 * Expert and appraisal teams remain mutable through the contractor-selection
 * result. Cancelled packages and explicitly read-only views stay immutable.
 */
export function packageTeamsAreEditable(status, isReadOnly = false) {
  return !isReadOnly && normalizeStatus(status) !== "CANCELLED";
}
