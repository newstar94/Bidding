function matchesResponse(response, { status, method, pathname }) {
  try {
    return response?.status?.() === status
      && response?.request?.().method?.() === method
      && new URL(response.url()).pathname === pathname;
  } catch {
    return false;
  }
}

export function isExpectedTelemetryBackpressure(response) {
  return matchesResponse(response, {
    status: 429,
    method: "POST",
    pathname: "/api/client-errors",
  });
}

export function isExpectedTelemetryAuthFailure(response) {
  return [401, 403].includes(response?.status?.())
    && matchesResponse(response, {
      status: response.status(),
      method: "POST",
      pathname: "/api/usage-analytics/events",
    });
}

export function isExpectedSyncReset(response, body) {
  if (!matchesResponse(response, {
    status: 409,
    method: "GET",
    pathname: "/api/sync/delta",
  })) return false;
  try {
    const rawBody = typeof body === "string" ? body.trim() : body;
    // A handled visibility/full-sync reset may be emitted without a response
    // body when the browser begins a navigation and aborts body delivery after
    // the status line. The endpoint, method and 409 status still identify the
    // same reset seam; unrelated 409s remain visible because the match above is
    // intentionally exact.
    if (rawBody === "") return true;
    const payload = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    return payload?.requiresFullSync === true;
  } catch {
    return false;
  }
}
