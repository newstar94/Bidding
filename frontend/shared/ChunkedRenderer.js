const ACTIVE_RENDERS = new WeakMap();

function defaultSchedule(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(callback, 0);
}

export function cancelChunkedRender(owner) {
  const active = ACTIVE_RENDERS.get(owner);
  if (!active) return false;
  active.cancelled = true;
  ACTIVE_RENDERS.delete(owner);
  return true;
}

/**
 * Progressively renders a sequence while keeping each main-thread slice
 * bounded. The caller owns DOM semantics; this module owns cancellation,
 * adaptive chunk sizing, yielding and instrumentation.
 */
export function renderChunkedSequence(owner, items, renderChunk, options = {}) {
  if (!owner || typeof renderChunk !== "function") {
    throw new TypeError("Chunked render requires an owner and renderChunk callback.");
  }
  cancelChunkedRender(owner);
  const rows = Array.isArray(items) ? items : [];
  const schedule = options.scheduleFrame || defaultSchedule;
  const now = options.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const budgetMs = Math.max(1, Math.min(Number(options.budgetMs) || 12, 40));
  const maxChunkSize = Math.max(1, Number(options.chunkSize) || 10);
  const minChunkSize = Math.max(1, Math.min(maxChunkSize, Number(options.minChunkSize) || 1));
  const active = { cancelled: false };
  ACTIVE_RENDERS.set(owner, active);
  let index = 0;
  let chunkSize = maxChunkSize;
  const chunkDurations = [];

  const promise = new Promise((resolve, reject) => {
    const finish = (cancelled) => {
      if (ACTIVE_RENDERS.get(owner) === active) ACTIVE_RENDERS.delete(owner);
      options.onComplete?.({ cancelled, chunkDurations: [...chunkDurations] });
      resolve({ cancelled, chunkDurations });
    };
    const run = () => {
      if (active.cancelled || options.isCurrent?.() === false) {
        finish(true);
        return;
      }
      const startIndex = index;
      const endIndex = Math.min(rows.length, startIndex + chunkSize);
      const startedAt = now();
      try {
        renderChunk(rows.slice(startIndex, endIndex), startIndex, endIndex);
      } catch (error) {
        if (ACTIVE_RENDERS.get(owner) === active) ACTIVE_RENDERS.delete(owner);
        reject(error);
        return;
      }
      index = endIndex;
      const durationMs = Math.max(0, now() - startedAt);
      chunkDurations.push(durationMs);
      options.onChunk?.({ startIndex, endIndex, durationMs });
      if (durationMs > 0) {
        chunkSize = Math.max(
          minChunkSize,
          Math.min(maxChunkSize, Math.floor(chunkSize * budgetMs / durationMs)),
        );
      }
      if (index >= rows.length) {
        finish(false);
        return;
      }
      schedule(run);
    };
    if (!rows.length) {
      finish(false);
      return;
    }
    run();
  });
  promise.cancel = () => {
    if (ACTIVE_RENDERS.get(owner) === active) active.cancelled = true;
  };
  return promise;
}
