// Browser-only experiment to isolate font layout cost; not a product font change.
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/scripts/measure_startup.mjs")) return loaded;
    let source = String(loaded.source);
    const anchor = "  const cpuBefore = hostCpuSnapshot();";
    if (!source.includes(anchor)) throw new Error("Font probe anchor changed");
    source = source.replace(anchor, anchor + `
  await page.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const sheet = document.querySelector("link[data-runtime-styles]")?.sheet;
      if (!sheet) throw new Error("Font probe requires runtime stylesheet");
      sheet.insertRule("body, body * { font-family: Arial, sans-serif !important; }", sheet.cssRules.length);
    }, { once: true });
  });
`);
    console.error("[DIAG-startup-font] System-font experiment; not production performance evidence.");
    return { ...loaded, source };
  },
});
