// Capture script execution independently of PerformanceObserver: Chromium may
// omit both Long Task and LoAF entries for the first document task on Linux.
export async function startStartupScriptTrace(page, { diagnostic = false } = {}) {
  const session = await page.context().newCDPSession(page);
  await session.send("Tracing.start", {
    categories: diagnostic
      ? "devtools.timeline,v8,toplevel,blink.user_timing,disabled-by-default-devtools.timeline"
      : "devtools.timeline,v8,blink.user_timing",
    transferMode: "ReturnAsStream",
  });
  return async () => {
    let stream;
    try {
      const completed = new Promise(resolve => session.once("Tracing.tracingComplete", resolve));
      await session.send("Tracing.end");
      ({ stream } = await completed);
      const chunks = [];
      for (;;) {
        const chunk = await session.send("IO.read", { handle: stream });
        chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, "base64") : Buffer.from(chunk.data));
        if (chunk.eof) break;
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      try { if (stream) await session.send("IO.close", { handle: stream }); }
      finally { await session.detach(); }
    }
  };
}

export function startupScriptsFromTrace(trace, loaderHiddenMs) {
  const events = trace.traceEvents || [];
  const cutoff = events.findLast(event => event.name === "bf:loader:hidden");
  if (!cutoff) throw new Error("Startup trace is missing the loader cutoff mark");
  return events.filter(event => event.name === "EvaluateScript"
    && event.ph === "X" && event.pid === cutoff.pid && event.tid === cutoff.tid
    && event.ts <= cutoff.ts && event.dur >= 50_000)
    .map(event => ({
      startTime: (event.ts - cutoff.ts) / 1000 + loaderHiddenMs,
      duration: event.dur / 1000,
      attribution: [],
      source: "cdp-script",
    }));
}
