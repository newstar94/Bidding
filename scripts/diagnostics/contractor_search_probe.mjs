// Opt-in Node loader for a reduced reproduction, never a full-lifecycle verdict.
// NODE_OPTIONS=--import=./scripts/diagnostics/contractor_search_probe.mjs
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/scripts/verify_full_lifecycle.mjs")) return loaded;
    let source = String(loaded.source);
    const boundary = '  mark("contractor-created");';
    const start = source.indexOf(boundary);
    const cleanup = source.lastIndexOf("} finally {");
    const pageSetup = '  nextPage.setDefaultTimeout(20_000);';
    const searchWait = '  await waitForVisibleRowText(page, "#nhathau-table tbody tr", `Nhà thầu ${runId}`);';
    if (start < 0 || cleanup <= start || !source.includes(pageSetup) || !source.includes(searchWait)) {
      throw new Error("Diagnostic source anchors changed; refusing to run a different reproduction.");
    }
    source = source.slice(0, start) + `
  if (pageErrors.length || httpErrors.length) throw new Error("Diagnostic browser/HTTP errors occurred.");
  console.log("[DIAG-contractor-search] Reduced contractor search completed; NOT a full lifecycle pass.");
` + source.slice(cleanup);
    source = 'const diagnosticSessions = new WeakMap(); let diagnosticPauseTimer;\n' + source;
    source = source.replace(pageSetup, pageSetup + `
  const diagnosticSession = await nextPage.context().newCDPSession(nextPage);
  diagnosticSessions.set(nextPage, diagnosticSession);
  await diagnosticSession.send("Debugger.enable");
  diagnosticSession.on("Debugger.paused", async ({ callFrames }) => {
    console.log("[DIAG-contractor-search] stack " + JSON.stringify(callFrames.slice(0, 16).map(frame => ({
      functionName: frame.functionName, location: frame.location,
      url: frame.url.split("?")[0],
    }))));
    await diagnosticSession.send("Debugger.resume").catch(() => {});
  });
`);
    source = source.replace(searchWait, `
  console.log("[DIAG-contractor-search] Contractor submitted; search filled; waiting for visible result.");
  diagnosticPauseTimer = setTimeout(() => {
    void diagnosticSessions.get(page).send("Debugger.pause").catch(error =>
      console.log("[DIAG-contractor-search] Pause failed: " + error.name));
  }, 5000);
  try {
${searchWait}
  } finally { clearTimeout(diagnosticPauseTimer); }
`);
    console.log("[DIAG-contractor-search] Reduced lifecycle prefix with one debugger stack probe; not CI evidence.");
    return { ...loaded, source };
  },
});
