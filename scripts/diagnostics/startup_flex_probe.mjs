// Experimental browser-only sizing variant; does not edit shipped CSS.
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/scripts/measure_startup.mjs")) return loaded;
    let source = String(loaded.source);
    const anchor = "  const cpuBefore = hostCpuSnapshot();";
    if (!source.includes(anchor)) throw new Error("Flex probe anchor changed");
    source = source.replace(anchor, anchor + `
  await page.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const sheet = document.querySelector("link[data-runtime-styles]")?.sheet;
      if (!sheet) throw new Error("Flex probe requires the existing runtime stylesheet");
      sheet.insertRule(".main-content { min-width: 0; }", sheet.cssRules.length);
    }, { once: true });
  });
`);
    console.error("[DIAG-startup-flex] Experimental min-width only; not production performance evidence.");
    return { ...loaded, source };
  },
});
