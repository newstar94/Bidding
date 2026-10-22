// Consistent, actionable error text for API failures shown to users.

export function formatRetryAfter(seconds) {
  const value = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (value < 60) return `${value} giây`;
  const minutes = Math.ceil(value / 60);
  return `${minutes} phút`;
}

/**
 * Return the server message, plus how long to wait for rate limits and a
 * support reference (request ID) when the server supplied one.
 */
export function describeApiError(data, fallback, { status = 0, includeReference = false } = {}) {
  const base = String(data?.error || data?.message || fallback || "Yêu cầu tới máy chủ thất bại.").trim();
  const parts = [base];
  const retryAfter = Number(data?.retry_after ?? data?.retryAfter);
  if ((status === 429 || data?.code === "rate_limit_exceeded") && Number.isFinite(retryAfter) && retryAfter > 0) {
    parts.push(`Vui lòng thử lại sau ${formatRetryAfter(retryAfter)}.`);
  }
  const reference = String(data?.requestId || "").trim();
  if (includeReference && /^[A-Za-z0-9._-]{1,128}$/.test(reference)) {
    parts.push(`Mã tra cứu: ${reference}`);
  }
  return parts.join(" ");
}
