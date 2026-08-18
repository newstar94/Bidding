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

export function isExpectedSyncReset(response, body) {
  if (!matchesResponse(response, {
    status: 409,
    method: "GET",
    pathname: "/api/sync/delta",
  })) return false;
  try {
    const payload = typeof body === "string" ? JSON.parse(body) : body;
    return payload?.requiresFullSync === true;
  } catch {
    return false;
  }
}
