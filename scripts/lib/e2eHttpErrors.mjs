export function isExpectedTelemetryBackpressure(response) {
  try {
    return response?.status?.() === 429
      && response?.request?.().method?.() === "POST"
      && new URL(response.url()).pathname === "/api/client-errors";
  } catch {
    return false;
  }
}
