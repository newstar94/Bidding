import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));
let browser, server;
before(async () => {
  const template = await readFile(join(root, "views/components/landing_page.html"), "utf8");
  const manifest = process.env.UI_QA_BUNDLE === "1"
    ? JSON.parse(await readFile(join(root, "dist/.vite/manifest.json"), "utf8")) : null;
  const stylesheet = manifest ? `/dist/${manifest['views/css/landing-shell.css'].file}` : '/views/css/landing-shell.css';
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi" data-bf-shell="landing"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${stylesheet}"></head><body>${template}</body></html>`);
        return;
      }
      const relative = /^(\/vendor\/|\/assets\/)/u.test(pathname) ? `views${pathname}` : pathname.slice(1);
      const bytes = await readFile(join(root, relative));
      response.writeHead(200, { "content-type": extname(pathname) === ".css" ? "text/css" : extname(pathname) === ".woff2" ? "font/woff2" : "application/octet-stream" });
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test("Vietnamese heading ink has separation between rendered lines", async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const failures = [];
  let pairs = 0;
  try {
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.fonts.check('800 48px "Plus Jakarta Sans"', 'Tiếng Việt')), 'Vietnamese font must be loaded');
      for (const heading of await page.locator("h1,h2,h3").all()) {
        await heading.scrollIntoViewIfNeeded();
        const result = await heading.evaluate(element => {
          const style = getComputedStyle(element);
          const context = document.createElement("canvas").getContext("2d");
          context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const lines = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const text = walker.currentNode;
            for (let index = 0; index < text.length; index++) {
              const range = document.createRange();
              range.setStart(text, index); range.setEnd(text, index + 1);
              const rect = range.getBoundingClientRect();
              if (!rect.width || !rect.height) continue;
              let line = lines.find(item => Math.abs(item.top - rect.top) < 1);
              if (!line) { line = { top: rect.top, text: "" }; lines.push(line); }
              line.text += text.textContent[index];
            }
          }
          lines.sort((a, b) => a.top - b.top);
          const gaps = lines.slice(1).map((line, index) => {
            const previous = lines[index];
            return line.top - previous.top
              - context.measureText(previous.text.trim()).actualBoundingBoxDescent
              - context.measureText(line.text.trim()).actualBoundingBoxAscent;
          });
          return { id: element.id || element.textContent.trim().slice(0, 50), font: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight, gaps };
        });
        pairs += result.gaps.length;
        if (result.gaps.some(gap => gap < 2)) failures.push({ width, ...result });
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflows at ${width}px`);
      if (process.env.HEADING_SCREENSHOTS === "1" && [390, 1440].includes(width)) {
        await mkdir(join(root, 'artifacts/heading-spacing'), { recursive: true });
        for (const id of ['landing-hero-title', 'landing-proof-title', 'landing-cta-title']) {
          await page.locator(`#${id}`).screenshot({ path: join(root, `artifacts/heading-spacing/${width}-${id}.png`) });
        }
      }
    }
    assert.ok(pairs >= 20, `Expected real wrapped headings, measured ${pairs} pairs`);
    assert.equal(failures.length, 0, `Adjacent Vietnamese glyphs touch or overlap: ${JSON.stringify(failures)}`);
  } finally { await page.close(); }
});
