import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { withRouteFixtureNavigation } from "../../scripts/route_fixture_navigation.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const template = await readFile(join(root, "views/components/landing_page.html"), "utf8");
const deferredSelector = ".landing-page main > section:not(.landing-hero), .landing-footer";
const moduleURL = "/frontend/landing/LandingPage.js";
let server;
let browser;
let axBrowser;
let origin;

function landingHTML(baseline) {
  // The comparison removes only the optimization, never the product's styles,
  // content, fonts, session behavior, or commercial presentation.
  const referenceStyle = baseline
    ? `<style>${deferredSelector}{content-visibility:visible!important;contain-intrinsic-block-size:none!important}</style>`
    : "";
  return `<!doctype html><html lang="vi" data-bf-shell="landing" data-trial-full-access="false"><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="bf-app-debug" content="false">
    <link rel="preload" href="/vendor/fonts/plus-jakarta-sans-vietnamese.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/vendor/fonts/plus-jakarta-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" data-bf-shell-styles="landing" href="/css/landing-shell.css">
    ${referenceStyle}<title>Landing layout regression</title>
    </head><body>${template}<script type="module" src="/qa-bootstrap.js"></script></body></html>`;
}

before(async () => {
  browser = await chromium.launch({ headless: true });
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/qa-bootstrap.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(`import { bootstrapLandingPage } from "${moduleURL}";
          await bootstrapLandingPage({ valid: false });
          window.__landingBootstrapComplete = true;`);
        return;
      }
      if (pathname === "/api/public/commercial/offers") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ releaseId: "layout-test", releaseChecksum: "layout-checksum", offers: [], creditPacks: [], quotaWarnings: [] }));
        return;
      }
      if (!( /^\/(?:frontend|css|vendor|assets)\//u.test(pathname)
        || pathname === "/node_modules/dompurify/dist/purify.es.mjs") || pathname.includes("..")) {
        response.writeHead(404).end();
        return;
      }
      const relative = /^(?:\/css\/|\/vendor\/|\/assets\/)/u.test(pathname)
        ? join("views", pathname.slice(1)) : pathname.slice(1);
      const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".webp": "image/webp", ".svg": "image/svg+xml" };
      response.writeHead(200, { "content-type": types[extname(pathname)] || "application/octet-stream" });
      response.end(await readFile(join(root, relative)));
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await browser?.close();
  await axBrowser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 2000;
      let lastY = window.scrollY;
      let stableFrames = 0;
      const check = () => {
        const y = window.scrollY;
        stableFrames = y === lastY ? stableFrames + 1 : 0;
        lastY = y;
        if (stableFrames >= 4) resolve();
        else if (performance.now() > deadline) reject(new Error("native scrolling did not settle"));
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  });
}

async function loadLanding(width = 1280, { baseline = false, hash = "", browserOverride } = {}) {
  const context = await (browserOverride || browser).newContext({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
  try {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  const url = `${origin}/${baseline ? "?baseline=1" : ""}${hash}`;
  const navigate = ({ targetURL = url, reload = false, back = false } = {}) => withRouteFixtureNavigation(page, {
    url: targetURL, html: landingHTML(baseline), navigation: back ? "back" : reload ? "reload" : "goto",
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  }, async () => {
    try {
      await page.waitForFunction(() => window.__landingBootstrapComplete === true
        && !document.querySelector("#landing-pricing-grid")?.hasAttribute("aria-busy"), null, { timeout: 10000 });
    } catch (error) {
      const state = await page.evaluate(() => ({ ready: window.__landingBootstrapComplete, scripts: [...document.scripts].map((node) => node.src), busy: document.querySelector("#landing-pricing-grid")?.getAttribute("aria-busy"), resources: performance.getEntriesByType("resource").map((entry) => entry.name) }));
      throw new Error(`Landing source bootstrap failed: ${errors.join("; ") || error.message}; ${JSON.stringify(state)}`);
    }
    await settle(page);
  });
  await navigate();
  return { context, page, errors, navigate };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function sectionSnapshot(page, index) {
  return page.evaluate(({ selector, index }) => {
    const node = [...document.querySelectorAll(selector)][index];
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const heading = node.querySelector("h2");
    const textStyle = heading && getComputedStyle(heading);
    return {
      top: rect.top, width: rect.width, height: rect.height,
      display: style.display, visibility: style.visibility, opacity: style.opacity,
      text: node.textContent.replace(/\s+/gu, " ").trim(),
      headingStyle: textStyle && {
        fontFamily: textStyle.fontFamily, fontSize: textStyle.fontSize,
        fontWeight: textStyle.fontWeight, lineHeight: textStyle.lineHeight,
        letterSpacing: textStyle.letterSpacing, color: textStyle.color,
      },
      childRects: [...node.querySelectorAll("h2, p, article")].map((child) => {
        const childRect = child.getBoundingClientRect();
        return { x: childRect.x - rect.x, y: childRect.y - rect.y, width: childRect.width, height: childRect.height };
      }),
      links: [...node.querySelectorAll("a")].map((link) => ({ href: link.getAttribute("href"), text: link.textContent.trim() })),
      autoVisible: node.checkVisibility({ contentVisibilityAuto: true }),
    };
  }, { selector: deferredSelector, index });
}

async function visitSection(page, index) {
  const align = () => page.evaluate(({ selector, index }) => {
    document.documentElement.style.scrollBehavior = "auto";
    [...document.querySelectorAll(selector)][index].scrollIntoView({ block: "start", behavior: "instant" });
  }, { selector: deferredSelector, index });
  await align();
  await settle(page);
  // Skipped sections become measurable on first entry; align again against
  // their real height, especially for the footer at the document's clamp.
  await align();
  await settle(page);
}

async function visibleTextSnapshot(page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector(".landing-page"), NodeFilter.SHOW_TEXT);
    const result = [];
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.textContent.trim() || !text.parentElement.checkVisibility({ contentVisibilityAuto: true })) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      const rects = [...range.getClientRects()]
        .filter((rect) => rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth)
        .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
      if (!rects.length) continue;
      const style = getComputedStyle(text.parentElement);
      result.push({ text: text.textContent, rects, style: {
        fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
        fontStyle: style.fontStyle, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
        textTransform: style.textTransform, color: style.color,
      } });
    }
    return result;
  });
}

async function visiblePaintSnapshot(page, index) {
  return page.evaluate(({ selector, index }) => {
    const region = [...document.querySelectorAll(selector)][index];
    const header = document.querySelector(".landing-header");
    const properties = ["display", "visibility", "position", "width", "height", "top", "right", "bottom", "left",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft",
      "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
      "color", "backgroundColor", "backgroundImage", "opacity",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
      "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
      "borderRadius", "boxShadow", "textShadow", "transform", "filter", "clipPath", "fill", "stroke", "strokeWidth", "content"];
    const paint = (style) => Object.fromEntries(properties.map((property) => [property, style[property]]));
    return [header, ...header.querySelectorAll("*"), region, ...region.querySelectorAll("*")].flatMap((node) => {
      if (!node.checkVisibility({ contentVisibilityAuto: true })) return [];
      const rect = node.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return [];
      return [{ element: `${node.tagName}.${node.getAttribute("class") || ""}`,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style: paint(getComputedStyle(node)), before: paint(getComputedStyle(node, "::before")), after: paint(getComputedStyle(node, "::after")),
        vector: node instanceof SVGElement ? Object.fromEntries(node.getAttributeNames().sort().map((name) => [name, node.getAttribute(name)])) : null,
      }];
    });
  }, { selector: deferredSelector, index });
}

async function screenshotDifference(page, actual, reference, textAreas = [], vectorAreas = [], region = null) {
  if (actual.equals(reference)) return { pixels: 0, invalidEdges: 0 };
  return page.evaluate(async ([actualBase64, referenceBase64, textAreas, vectorAreas, region]) => {
    const decode = async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
    };
    const first = await decode(actualBase64);
    const second = await decode(referenceBase64);
    if (first.width !== second.width || first.height !== second.height) return { dimensionsDiffer: true };
    let pixels = 0; let invalidEdges = 0; const invalidSamples = [];
    const inNeighborColorRange = (source, reference, x, y, radius = 1, antialiasLevels = 3) => {
      const offset = (y * first.width + x) * 4;
      let isEdge = false;
      const equivalentColors = [0, 1, 2, 3].every((channel) => {
        let minimum = 255; let maximum = 0;
        for (let adjacentY = Math.max(0, y - radius); adjacentY <= Math.min(first.height - 1, y + radius); adjacentY += 1) {
          for (let adjacentX = Math.max(0, x - radius); adjacentX <= Math.min(first.width - 1, x + radius); adjacentX += 1) {
            const color = reference[(adjacentY * first.width + adjacentX) * 4 + channel];
            minimum = Math.min(minimum, color); maximum = Math.max(maximum, color);
          }
        }
        if (minimum !== maximum) isEdge = true;
        return source[offset + channel] >= minimum - antialiasLevels && source[offset + channel] <= maximum + antialiasLevels;
      });
      return equivalentColors && isEdge;
    };
    let minX = first.width; let minY = first.height; let maxX = -1; let maxY = -1;
    for (let offset = 0; offset < first.data.length; offset += 4) {
      if ([0, 1, 2, 3].every((channel) => first.data[offset + channel] === second.data[offset + channel])) continue;
      pixels += 1;
      const x = (offset / 4) % first.width;
      const y = Math.floor(offset / 4 / first.width);
      if (region && (y < region.top || y >= region.bottom)) continue;
      const onePixelEdge = inNeighborColorRange(first.data, second.data, x, y)
        && inNeighborColorRange(second.data, first.data, x, y);
      const withinVerifiedGlyph = textAreas.some((rect) => x >= Math.floor(rect.x) - 2 && x <= Math.ceil(rect.x + rect.width) + 2
        && y >= Math.floor(rect.y) - 2 && y <= Math.ceil(rect.y + rect.height) + 2);
      const glyphRasterCorner = !onePixelEdge && withinVerifiedGlyph
        && inNeighborColorRange(first.data, second.data, x, y, 3)
        && inNeighborColorRange(second.data, first.data, x, y, 3);
      const withinVerifiedVector = vectorAreas.some((rect) => x >= Math.floor(rect.x) - 2 && x <= Math.ceil(rect.x + rect.width) + 2
        && y >= Math.floor(rect.y) - 2 && y <= Math.ceil(rect.y + rect.height) + 2);
      const vectorRasterEdge = !onePixelEdge && withinVerifiedVector
        && inNeighborColorRange(first.data, second.data, x, y, 2)
        && inNeighborColorRange(second.data, first.data, x, y, 2);
      if (!onePixelEdge && !glyphRasterCorner && !vectorRasterEdge) {
        invalidEdges += 1;
        if (invalidSamples.length < 8) invalidSamples.push({ x, y, withinVerifiedGlyph,
          nearbyText: textAreas.filter((rect) => x >= rect.x - 6 && x <= rect.x + rect.width + 6 && y >= rect.y - 6 && y <= rect.y + rect.height + 6),
          first: [...first.data.slice(offset, offset + 4)], second: [...second.data.slice(offset, offset + 4)] });
      }
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { pixels, invalidEdges, invalidSamples, minX, minY, maxX, maxY };
  }, [actual.toString("base64"), reference.toString("base64"), textAreas, vectorAreas, region]);
}

async function captureViewportOverscan(page, width) {
  const session = await page.context().newCDPSession(page);
  try {
    const { visualViewport } = await session.send("Page.getLayoutMetrics");
    const { data } = await session.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: visualViewport.pageX, y: visualViewport.pageY, width, height: 802, scale: 1 },
    });
    return Buffer.from(data, "base64");
  } finally { await session.detach(); }
}

async function captureStableSection(page, width, index) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await visitSection(page, index);
    // Text/vector metrics themselves can make skipped descendant content
    // measurable. Settle their native scroll anchoring before capturing.
    await visibleTextSnapshot(page);
    await visiblePaintSnapshot(page, index);
    await settle(page);
    await visitSection(page, index);
    const before = await page.evaluate(() => scrollY);
    const png = await captureViewportOverscan(page, width);
    await settle(page);
    const after = await page.evaluate(() => scrollY);
    if (before === after) return png;
  }
  throw new Error("screenshot sampling kept changing the viewport scroll anchor");
}

test("cold landing skips far-offscreen layout without hiding or removing accessible content", async () => {
  // Native screen-reader AX mode is required: the default headless CDP AX
  // snapshot can omit unrendered subtrees even after Accessibility.enable.
  // Visual/history tests and the separate performance gate use normal mode.
  axBrowser = await chromium.launch({ headless: true, args: ["--force-renderer-accessibility"] });
  const { context, page, errors } = await loadLanding(1280, { browserOverride: axBrowser });
  try {
    const state = await page.evaluate(() => {
      const footer = document.querySelector(".landing-footer");
      const style = getComputedStyle(footer);
      return {
        count: document.querySelectorAll("main > section").length,
        contentVisibility: style.contentVisibility,
        skipped: !footer.querySelector("a[href]").checkVisibility({ contentVisibilityAuto: true }),
        display: style.display, visibility: style.visibility, opacity: style.opacity,
        hidden: footer.hidden, ariaHidden: footer.getAttribute("aria-hidden"),
        text: footer.textContent, linkCount: footer.querySelectorAll("a[href]").length,
      };
    });
    assert.equal(state.contentVisibility, "auto", "the production rule must defer below-hero layout");
    assert.equal(state.skipped, true, "far-offscreen footer must actually be skipped by the browser");
    assert.equal(state.count, 7);
    assert.notEqual(state.display, "none");
    assert.equal(state.visibility, "visible");
    assert.equal(state.opacity, "1");
    assert.equal(state.hidden, false);
    assert.notEqual(state.ariaHidden, "true");
    assert.match(state.text, /Điều khoản và chính sách/u);
    assert.equal(state.linkCount, 3);
    const session = await context.newCDPSession(page);
    try {
      const { nodes } = await session.send("Accessibility.getFullAXTree");
      const names = nodes.filter((node) => !node.ignored).map((node) => node.name?.value || "");
      const { root: documentNode } = await session.send("DOM.getDocument");
      const { nodeId } = await session.send("DOM.querySelector", { nodeId: documentNode.nodeId, selector: '.landing-footer a[href="/legal"]' });
      const direct = await session.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
      assert.ok(names.includes("Điều khoản và chính sách"), `skipped footer must remain in the accessibility tree; direct=${JSON.stringify(direct.nodes)}`);
      assert.ok(names.includes("Trả cho năng lực đội ngũ thực sự dùng. Mở rộng khi vận hành cần thêm."), "skipped pricing heading remains accessible");
    } finally { await session.detach(); }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const width of [320, 768, 1280]) {
  test(`deferred landing preserves initial and section viewport pixels, typography and geometry at ${width}px`, { timeout: 60000 }, async () => {
    const optimized = await loadLanding(width);
    let baseline;
    try {
      baseline = await loadLanding(width, { baseline: true });
      const initialDifference = await screenshotDifference(optimized.page,
        await optimized.page.screenshot({ animations: "disabled", caret: "hide" }),
        await baseline.page.screenshot({ animations: "disabled", caret: "hide" }), []);
      assert.equal(initialDifference.pixels, 0, `initial viewport must stay visually identical: ${JSON.stringify(initialDifference)}`);
      const count = await optimized.page.locator(deferredSelector).count();
      assert.equal(count, 7);
      for (let index = 0; index < count; index += 1) {
        const actualScreenshot = await captureStableSection(optimized.page, width, index);
        const referenceScreenshot = await captureStableSection(baseline.page, width, index);
        const actual = await sectionSnapshot(optimized.page, index);
        const reference = await sectionSnapshot(baseline.page, index);
        assert.equal(actual.autoVisible, true, `section ${index} must render when reached`);
        assert.ok(actual.height > 0 && actual.width > 0);
        assert.deepEqual(actual, reference, `section ${index} content/style/geometry at ${width}px`);
        // Extra pixels are sampled, never compared as visible content: glyphs
        // at the bottom boundary still need a complete raster neighborhood.
        const actualText = await visibleTextSnapshot(optimized.page);
        assert.deepEqual(actualText, await visibleTextSnapshot(baseline.page), "all visible glyph line rectangles, text, font and color must be unchanged");
        const actualPaint = await visiblePaintSnapshot(optimized.page, index);
        assert.deepEqual(actualPaint, await visiblePaintSnapshot(baseline.page, index),
          "all visible DOM and pseudo-element paint styles, geometry and SVG attributes must be unchanged");
        const screenState = (page) => page.evaluate(({ selector, index }) => ({
          y: window.scrollY, width: document.documentElement.clientWidth,
          sectionTop: [...document.querySelectorAll(selector)][index].getBoundingClientRect().top,
          headerClass: document.querySelector(".landing-header").className,
        }), { selector: deferredSelector, index });
        const difference = await screenshotDifference(optimized.page, actualScreenshot, referenceScreenshot, actualText.flatMap(({ rects }) => rects),
          actualPaint.filter((node) => node.vector).map((node) => node.rect),
          { top: Math.max(0, Math.ceil(actual.top)), bottom: 800 });
        // Paint containment may snap text antialiasing by one device pixel.
        // Equivalent edges in BOTH images allow one raster pixel. Only verified
        // verified text-line bounds allow three pixels for glyph-corner hinting,
        // and exact SVG path/stroke bounds allow two pixels for vector edges;
        // fonts/styles/line geometry stay exact. Flat pixels have no tolerance,
        // and there is no overall differing-pixel count/ratio allowance.
        assert.equal(difference.invalidEdges, 0, `section ${index} viewport pixels at ${width}px; difference=${JSON.stringify(difference)} actual=${JSON.stringify(await screenState(optimized.page))} reference=${JSON.stringify(await screenState(baseline.page))}`);
      }
      if (width === 1280) {
        await visitSection(optimized.page, 0);
        // Negative controls exercise the same text/paint parity snapshots used
        // above; rereading the deliberately mutated attribute is not a guard.
        const snapshot = async () => ({
          text: await visibleTextSnapshot(optimized.page),
          paint: await visiblePaintSnapshot(optimized.page, 0),
        });
        const original = await snapshot();
        for (const kind of ["font", "color", "geometry", "svg-path", "svg-stroke"]) {
          const prior = await optimized.page.evaluate((kind) => {
            // Header remains painted even if proof descendants retain a
            // content-visibility skip decision immediately after revisiting.
            const selector = kind.startsWith("svg") ? ".landing-header .landing-icon path" : ".landing-header-cta [data-landing-app-label]";
            const node = document.querySelector(selector);
            const attribute = kind === "svg-path" ? "d" : kind === "svg-stroke" ? "stroke-width" : "style";
            const value = node.getAttribute(attribute);
            if (kind === "font") node.style.setProperty("font-size", `${parseFloat(getComputedStyle(node).fontSize) + 2}px`, "important");
            if (kind === "color") node.style.setProperty("color", "rgb(1, 2, 3)", "important");
            if (kind === "geometry") node.style.setProperty("transform", "translateX(1px)", "important");
            if (kind === "svg-path") node.setAttribute(attribute, "M0 0L20 20");
            if (kind === "svg-stroke") node.setAttribute(attribute, "9");
            return { selector, attribute, value };
          }, kind);
          try {
            await settle(optimized.page);
            assert.notDeepEqual(await snapshot(), original, `${kind} negative control must be detected despite raster tolerance`);
          } finally {
            await optimized.page.evaluate(({ selector, attribute, value }) => {
              const node = document.querySelector(selector);
              if (value === null) node.removeAttribute(attribute);
              else node.setAttribute(attribute, value);
            }, prior);
            await settle(optimized.page);
          }
        }
        assert.deepEqual(await snapshot(), original, "negative controls must restore the original fixture exactly");
      }
      assert.deepEqual(optimized.errors, []);
      assert.deepEqual(baseline.errors, []);
    } finally { await optimized.context.close(); await baseline?.context.close(); }
  });
}

test("initial pricing hash, native fragment navigation and actual reload resolve the real target", async () => {
  const inspect = async (baseline) => {
    const { context, page, navigate } = await loadLanding(1280, { hash: "#bang-gia", baseline });
    try {
      const readTarget = () => page.evaluate((selector) => ({
        hash: location.hash,
        top: document.getElementById("bang-gia").getBoundingClientRect().top,
        headingVisible: document.getElementById("landing-pricing-title").checkVisibility({ contentVisibilityAuto: true }),
        layoutModes: [...document.querySelectorAll(selector)].map((node) => getComputedStyle(node).contentVisibility),
      }), deferredSelector);
      const initial = await readTarget();
      await page.evaluate(() => {
        history.replaceState(history.state, "", "/");
        document.documentElement.style.scrollBehavior = "auto";
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await settle(page);
      await page.locator('.landing-hero-actions a[href="#bang-gia"]').click();
      await settle(page);
      const native = await readTarget();
      await navigate({ targetURL: page.url(), reload: true });
      assert.equal(await page.evaluate(() => performance.getEntriesByType("navigation")[0].type), "reload");
      return { initial, native, reload: await readTarget() };
    } finally { await context.close(); }
  };
  const actual = await inspect(false);
  const reference = await inspect(true);
  for (const phase of ["initial", "native", "reload"]) {
    const state = actual[phase];
    assert.equal(state.hash, "#bang-gia");
    assert.ok(state.top >= -1 && state.top <= 100,
      `${phase} pricing target actual=${state.top} baseline=${reference[phase].top}`);
    assert.equal(state.headingVisible, true);
    assert.ok(state.layoutModes.every((mode) => mode === "visible"), "fragment targeting must use canonical predecessor geometry");
    assert.ok(Math.abs(state.top - reference[phase].top) <= 1);
  }
});

test("back-forward saved scroll is restored against canonical layout without requiring a fragment", async () => {
  const baseline = await loadLanding(1280, { baseline: true });
  let optimized;
  try {
    optimized = await loadLanding(1280);
    const savedY = await baseline.page.evaluate(() => document.getElementById("bang-gia").getBoundingClientRect().top + window.scrollY + 180);
    const state = await optimized.page.evaluate(async ({ url, savedY }) => {
      history.replaceState({ retainedKey: "unrelated-state", bfLandingScrollY: savedY }, "", "/");
      const { restoreLandingFragment } = await import(url);
      const restored = restoreLandingFragment({ navigationType: "back_forward" });
      return { restored, hash: location.hash, retainedKey: history.state.retainedKey };
    }, { url: moduleURL, savedY });
    await settle(optimized.page);
    assert.equal(state.restored, true);
    assert.equal(state.hash, "");
    assert.equal(state.retainedKey, "unrelated-state");
    const actual = await optimized.page.evaluate(() => ({
      y: window.scrollY,
      pricingTop: document.getElementById("bang-gia").getBoundingClientRect().top,
    }));
    assert.ok(Math.abs(actual.y - savedY) <= 1, `restored y ${actual.y}, canonical saved ${savedY}`);
    assert.ok(Math.abs(actual.pricingTop + 180) <= 1, `canonical pricing position ${actual.pricingTop}`);
  } finally { await baseline.context.close(); await optimized?.context.close(); }
});

test("actual pagehide and native Back retain the viewport after jumping over deferred sections", async () => {
  const optimized = await loadLanding(1280);
  let baseline;
  try {
    baseline = await loadLanding(1280, { baseline: true });
    await optimized.page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      document.getElementById("bang-gia").scrollIntoView({ block: "start", behavior: "instant" });
    });
    await settle(optimized.page);
    const before = await optimized.page.evaluate(() => ({
      y: scrollY, top: document.getElementById("bang-gia").getBoundingClientRect().top,
      hash: location.hash,
    }));
    assert.equal(before.hash, "");
    const canonicalPricingY = await baseline.page.evaluate(() => document.getElementById("bang-gia").getBoundingClientRect().top + scrollY);
    await withRouteFixtureNavigation(optimized.page, {
      url: `${origin}/away`, html: "<!doctype html><title>History destination</title><body>Another document</body>",
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    }, async () => {});
    await optimized.navigate({ back: true });
    const after = await optimized.page.evaluate(() => ({
      y: scrollY, top: document.getElementById("bang-gia").getBoundingClientRect().top,
      hash: location.hash, savedY: history.state?.bfLandingScrollY,
      navigationType: performance.getEntriesByType("navigation")[0].type,
    }));
    assert.equal(after.hash, "");
    assert.equal(after.navigationType, "back_forward");
    assert.ok(Math.abs(after.top - before.top) <= 1,
      `native Back must preserve the content viewport; before=${JSON.stringify(before)} after=${JSON.stringify(after)} canonicalPricingY=${canonicalPricingY}`);
    assert.ok(Math.abs(after.savedY - (canonicalPricingY - before.top)) <= 1,
      "pagehide must record a canonical coordinate, not a deferred estimate");
  } finally { await optimized.context.close(); await baseline?.context.close(); }
});

test("numeric scrollbar jump records a canonical history coordinate and restores the same section viewport", async () => {
  const results = [];
  for (const fraction of [0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) {
  const optimized = await loadLanding(1280);
  let baseline;
  try {
    baseline = await loadLanding(1280, { baseline: true });
    await optimized.page.evaluate((fraction) => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo({ top: document.documentElement.scrollHeight * fraction, behavior: "instant" });
    }, fraction);
    await settle(optimized.page);
    const before = await optimized.page.evaluate((selector) => {
      const nodes = [...document.querySelectorAll(selector)];
      const index = nodes.findIndex((node) => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > 100 && rect.top < innerHeight
          && node.querySelector("h2,a")?.checkVisibility({ contentVisibilityAuto: true });
      });
      return { index, y: scrollY, top: nodes[index].getBoundingClientRect().top, hash: location.hash };
    }, deferredSelector);
    const canonicalAnchorY = await baseline.page.evaluate(({ selector, index }) =>
      [...document.querySelectorAll(selector)][index].getBoundingClientRect().top + scrollY,
    { selector: deferredSelector, index: before.index });
    await withRouteFixtureNavigation(optimized.page, {
      url: `${origin}/away`, html: "<!doctype html><title>History destination</title><body>Another document</body>",
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    }, async () => {});
    await optimized.navigate({ back: true });
    const after = await optimized.page.evaluate(({ selector, index }) => ({
      y: scrollY, top: [...document.querySelectorAll(selector)][index].getBoundingClientRect().top,
      hash: location.hash, savedY: history.state?.bfLandingScrollY,
    }), { selector: deferredSelector, index: before.index });
    assert.equal(before.hash, ""); assert.equal(after.hash, "");
    results.push({ fraction, before, after, canonicalAnchorY,
      viewportChanged: Math.abs(after.top - before.top) > 1,
      estimatedCoordinate: Math.abs(after.savedY - (canonicalAnchorY - before.top)) > 1 });
  } finally { await optimized.context.close(); await baseline?.context.close(); }
  }
  assert.deepEqual(results.filter((state) => state.viewportChanged), [], `native Back changed the content viewport: ${JSON.stringify(results)}`);
  assert.deepEqual(results.filter((state) => state.estimatedCoordinate), [], `pagehide persisted estimates: ${JSON.stringify(results)}`);
});

test("proof sticky behavior, native keyboard scrolling and the skip link survive deferred layout", async () => {
  const { context, page } = await loadLanding();
  try {
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.className), "landing-skip-link");
    await page.keyboard.press("Enter");
    await settle(page);
    assert.equal(await page.evaluate(() => location.hash), "#landing-main");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("#landing-main"))), true,
      "skip navigation must advance keyboard focus into main content");
    await page.evaluate(() => {
      history.replaceState(history.state, "", "/");
      document.documentElement.style.scrollBehavior = "auto";
      document.activeElement?.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.keyboard.press("PageDown");
    await page.waitForFunction(() => window.scrollY > 0);
    await settle(page);
    const proofIndex = await page.locator(deferredSelector).evaluateAll((nodes) => nodes.findIndex((node) => node.classList.contains("landing-proof")));
    await visitSection(page, proofIndex);
    const readSticky = (page) => page.evaluate(() => {
      const intro = document.querySelector(".landing-proof-intro");
      const style = getComputedStyle(intro);
      const root = document.querySelector(".landing-proof");
      const y = root.getBoundingClientRect().top + window.scrollY;
      return {
        position: style.position, top: parseFloat(style.top), y,
        actualTop: intro.getBoundingClientRect().top,
        introHeight: intro.getBoundingClientRect().height,
        parentHeight: intro.parentElement.getBoundingClientRect().height,
      };
    });
    const sticky = await readSticky(page);
    assert.equal(sticky.position, "sticky");
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), sticky.y + 220);
    await settle(page);
    const actual = await readSticky(page);
    const baseline = await loadLanding(1280, { baseline: true });
    try {
      await visitSection(baseline.page, proofIndex);
      const referenceStart = await readSticky(baseline.page);
      await baseline.page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), referenceStart.y + 220);
      await settle(baseline.page);
      const reference = await readSticky(baseline.page);
      assert.deepEqual(actual, reference, "paint containment must preserve the original proof sticky geometry");
    } finally { await baseline.context.close(); }
  } finally { await context.close(); }
});
