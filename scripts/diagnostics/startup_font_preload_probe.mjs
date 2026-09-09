// Browser-only hashed-font preload experiment; preserves shipped font files.
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/scripts/measure_startup.mjs")) return loaded;
    let source = String(loaded.source);
    const anchor = "  const cpuBefore = hostCpuSnapshot();";
    if (!source.includes(anchor)) throw new Error("Font preload probe anchor changed");
    source = source.replace(anchor, `
  const manifest = JSON.parse(await fs.readFile("dist/.vite/manifest.json", "utf8"));
  const links = ["latin", "vietnamese"].map(subset => {
    const file = manifest["views/vendor/fonts/plus-jakarta-sans-" + subset + ".woff2"]?.file;
    if (!/^assets\\/[A-Za-z0-9_-]+\\.woff2$/.test(file || "")) throw new Error("Invalid fixture font asset");
    return '<link rel="preload" href="/dist/' + file + '" as="font" type="font/woff2" crossorigin>';
  }).join("");
  await page.route(baseURL + route, async intercepted => {
    const response = await intercepted.fetch();
    const html = await response.text();
    await intercepted.fulfill({ response, body: html.replace("</head>", links + "</head>") });
  });
` + anchor);
    console.error("[DIAG-font-preload] Hashed-font preload experiment; not final CI evidence.");
    return { ...loaded, source };
  },
});
