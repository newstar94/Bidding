// Messages and labels are normalized by the server before crossing the wire.

export function presentAutomaticDataMessage(message, fallback = "") {
  return String(message ?? fallback);
}

export function presentAutomaticDataLabel(value) {
  return String(value ?? "");
}
