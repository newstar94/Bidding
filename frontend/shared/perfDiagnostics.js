export function perfDebugEnabled() {
  if (typeof localStorage !== "undefined" && localStorage.getItem("bf_perf_debug") === "true") return true;
  if (typeof window !== "undefined") {
    return new URLSearchParams(window.location.search).get("bf_perf_debug") === "true";
  }
  return false;
}

export function perfNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function reportPerf(payload) {
  if (perfDebugEnabled()) console.info("[bf-perf]", payload);
}

export function beginTablePerf(tabName, query) {
  const startedAt = perfNow();
  let dataCompletedAt = startedAt;
  let dataResult = {};
  return {
    dataComplete(result = {}) {
      dataCompletedAt = perfNow();
      dataResult = result || {};
    },
    complete() {
      const completedAt = perfNow();
      const payload = {
        phase: "table-complete",
        tabName,
        query,
        cold: !dataResult.cacheHit && !dataResult.localSnapshot,
        data: Math.round(dataCompletedAt - startedAt),
        render: Math.round(completedAt - dataCompletedAt),
        total: Math.round(completedAt - startedAt),
        cacheHit: Boolean(dataResult.cacheHit),
        prefetched: Boolean(dataResult.prefetched),
        inFlightDeduped: Boolean(dataResult.inFlightDeduped),
        localSnapshot: Boolean(dataResult.localSnapshot),
      };
      reportPerf(payload);
      return payload;
    },
  };
}
