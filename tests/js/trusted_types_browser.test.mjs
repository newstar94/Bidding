import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

test("shipped DOMPurify and the real Trusted Types wrapper retain safe rendering", async (t) => {
  const sources = new Map(await Promise.all([
    "/frontend/shared/trustedTypes.js",
    "/frontend/shared/runtimeStyles.js",
    "/node_modules/dompurify/dist/purify.es.mjs",
  ].map(async (url) => [url, await readFile(new URL(`../../${url.slice(1)}`, import.meta.url))])));
  const server = http.createServer((request, response) => {
    const source = sources.get(request.url);
    if (source) {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(source);
      return;
    }
    const headers = { "content-type": "text/html; charset=utf-8" };
    if (request.url === "/") {
      headers["content-security-policy"] = "default-src 'self'; script-src 'self'; require-trusted-types-for 'script'; trusted-types biddingflow-html biddingflow-dompurify";
    }
    response.writeHead(200, headers);
    response.end('<!doctype html><html><body><div id="output"></div></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await t.test("sanitizes through the production wrapper under enforced Trusted Types", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(origin);
        const result = await page.evaluate(async () => {
          const { trustedHTML } = await import("/frontend/shared/trustedTypes.js");
          const output = document.getElementById("output");
          output.innerHTML = trustedHTML('<p>Tiếng Việt &amp; dữ liệu đầy đủ</p><table><tbody><tr><td>Ngân hàng</td></tr></tbody></table>');
          const safeText = output.textContent;
          const tableCell = output.querySelector("td")?.textContent;
          const fragment = String(trustedHTML('<tr><td>CCCD</td></tr>'));
          const escaped = String(trustedHTML('<span>&lt;img src=x onerror=&quot;bad()&quot;&gt;</span>'));
          let rejected = 0;
          for (const payload of ['<img onerror="bad()">', '<a href="javascript:bad()">link</a>', '<iframe src="/private"></iframe>']) {
            try { trustedHTML(payload); } catch { rejected += 1; }
          }
          const sanitized = String(trustedHTML('<p>allowed</p>'));
          return { safeText, tableCell, fragment, escaped, rejected, sanitized };
        });
        assert.equal(result.safeText, "Tiếng Việt & dữ liệu đầy đủNgân hàng");
        assert.equal(result.tableCell, "Ngân hàng");
        assert.equal(result.fragment, "<tr><td>CCCD</td></tr>");
        assert.match(result.escaped, /&lt;img/);
        assert.equal(result.rejected, 3);
        assert.equal(result.sanitized, "<p>allowed</p>");
      } finally {
        await page.close();
      }
    });
    for (const hook of ["afterSanitizeElements", "afterSanitizeAttributes"]) {
      await t.test(`${hook} neutralizes handlers on a hook-detached live subtree`, async () => {
        const page = await browser.newPage();
        try {
          await page.goto(`${origin}/library`);
          const result = await page.evaluate(async (hookName) => {
            const { default: DOMPurify } = await import("/node_modules/dompurify/dist/purify.es.mjs");
            const root = document.createElement("div");
            root.innerHTML = '<section id="detach"><img onerror="window.__xss=1"></section>';
            document.body.append(root);
            const child = root.querySelector("img");
            DOMPurify.addHook(hookName, (node) => {
              if (node.id === "detach") node.remove();
            });
            try {
              DOMPurify.sanitize(root, { IN_PLACE: true });
              return { detached: !root.querySelector("section"), handler: child.getAttribute("onerror"), version: DOMPurify.version };
            } finally {
              DOMPurify.removeAllHooks();
              root.remove();
            }
          }, hook);
          assert.equal(result.version, "3.4.16");
          assert.equal(result.detached, true);
          assert.equal(result.handler, null);
        } finally {
          await page.close();
        }
      });
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
