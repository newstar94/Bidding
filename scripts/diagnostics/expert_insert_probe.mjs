// Opt-in reduced lifecycle prefix; never a full workflow success verdict.
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/scripts/verify_full_lifecycle.mjs")) return loaded;
    let source = String(loaded.source);
    const boundary = '  mark("experts-created", { count: 2 });';
    const end = source.indexOf(boundary);
    const cleanup = source.lastIndexOf("} finally {");
    const anchor = '  nextPage.setDefaultTimeout(20_000);';
    if (end < 0 || cleanup <= end || !source.includes(anchor)) {
      throw new Error("Expert diagnostic source anchors changed.");
    }
    source = source.slice(0, end) + `
  await waitForPageCondition(page, () =>
    document.getElementById("btn-force-sync")?.dataset.syncState === "server-saved",
    null, { timeout: 20000 });
  if (httpErrors.length || pageErrors.length) throw new Error("Expert probe recorded an HTTP or page error.");
  console.log("[DIAG-expert-insert] Two expert creates settled; NOT a full lifecycle pass.");
` + source.slice(cleanup);
    source = source.replace(anchor, anchor + `
  nextPage.on("request", request => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/sync") return;
    const experts = request.postDataJSON()?.chuyengia || [];
    if (experts.length) console.log("[DIAG-expert-insert] outbound " + JSON.stringify(experts.map(row => ({
      id: row.id, rowVersion: row.rowVersion, expectedVersion: row.expectedVersion,
    }))));
  });
  nextPage.on("response", async response => {
    if (response.request().method() !== "POST" || new URL(response.url()).pathname !== "/api/sync") return;
    try {
      const body = await response.json();
      console.log("[DIAG-expert-insert] receipt " + JSON.stringify({status: response.status(),
        code: body.code, rowVersions: body.rowVersions}));
    } catch { console.log("[DIAG-expert-insert] unreadable receipt"); }
  });
`);
    console.log("[DIAG-expert-insert] Reduced two-expert prefix; IDs and version metadata only.");
    return { ...loaded, source };
  },
});
