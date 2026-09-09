// Opt-in lifecycle prefix through opening-save; not full CI evidence.
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/scripts/verify_full_lifecycle.mjs")) return loaded;
    let source = String(loaded.source);
    const end = source.indexOf('  mark("opening-saved");');
    const cleanup = source.lastIndexOf("} finally {");
    const anchor = "const configureLifecyclePage = async (nextPage) => {";
    if (end < 0 || cleanup <= end || !source.includes(anchor)) {
      throw new Error("Opening probe source anchors changed.");
    }
    source = source.slice(0, end) + `
  if (pageErrors.length || httpErrors.length) throw new Error("Opening probe recorded errors.");
  console.log("[DIAG-opening-transition] Opening persisted and evaluation visible; NOT full lifecycle success.");
` + source.slice(cleanup);
    source = source.replace(anchor, anchor + `
  await nextPage.addInitScript(() => {
    const history = [];
    globalThis.__openingVisibilityHistory = history;
    addEventListener("DOMContentLoaded", () => {
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const element = record.target;
          if (!["tab-goithau-detail", "detail-workflow-tabs-header", "detail-workflow-content-wrapper"].includes(element.id)) continue;
          history.push({ time: performance.now(), id: element.id, attribute: record.attributeName,
            value: element.getAttribute(record.attributeName), path: location.pathname });
          if (history.length > 40) history.shift();
        }
      });
      observer.observe(document.body, { subtree: true, attributes: true,
        attributeFilter: ["class", "style", "hidden", "data-rendered-workflow-tab", "data-rendered-package-status"] });
    }, { once: true });
  });
  nextPage.on("response", async response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    if (!["/api/sync", "/api/sync/delta", "/api/paginate", "/api/record"].includes(url.pathname)) return;
    try {
      const body = await response.json();
      const candidates = [...(body.goithau || []), ...(body.items || []), ...(body.record ? [body.record] : [])];
      const packages = candidates.filter(row => row.tenGoiThau?.includes(runId))
        .map(row => ({id: row.id, status: row.trangThai, rowVersion: row.rowVersion}));
      const versions = (body.rowVersions || []).filter(row => row.table === "goithau");
      if (packages.length || versions.length) console.log("[DIAG-opening-transition] response " + JSON.stringify({
        path: url.pathname, status: response.status(), packages, versions,
      }));
    } catch { /* Non-JSON response is reported by the original harness. */ }
  });
`);
    console.log("[DIAG-opening-transition] Prefix only; package IDs/status/versions only.");
    source = source.replace('process.stderr.write(`Opening visibility:',
      'console.log("[DIAG-opening-transition] history " + JSON.stringify(await readPageDiagnosticState(page, () => globalThis.__openingVisibilityHistory || [])));\\n    process.stderr.write(`Opening visibility:'.replace('\\n', '\n'));
    return { ...loaded, source };
  },
});
