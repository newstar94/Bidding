import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}

async function withCopyPage(run) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html lang="vi"><body>
          <table><tbody id="dictionary-table-body"><tr><td>
            <button type="button" id="copy-variable" class="btn-copy-var" data-copy="{ma_cdt}">
              Sao chép
            </button>
          </td></tr></tbody></table>
        </body></html>`);
        return;
      }
      const payload = await readFile(join(projectRoot, pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await run(page);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Word-variable copy recovers when the Clipboard API fails transiently", async () => {
  await withCopyPage(async (page) => {
    await page.evaluate(async () => {
      window.__nativeClipboardWrites = [];
      window.__fallbackClipboardWrites = [];
      window.__copyAlerts = [];
      let attempt = 0;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          async writeText(text) {
            attempt += 1;
            if (attempt === 1) throw new DOMException("Clipboard is temporarily unavailable", "NotAllowedError");
            window.__nativeClipboardWrites.push(text);
          },
        },
      });
      document.execCommand = (command) => {
        if (command !== "copy") return false;
        const active = document.activeElement;
        const selectedText = active instanceof HTMLTextAreaElement
          ? active.value.slice(active.selectionStart, active.selectionEnd)
          : document.getSelection()?.toString() || "";
        window.__fallbackClipboardWrites.push(selectedText);
        return true;
      };
      const { setupCopyVariableEvents } = await import("/frontend/documents/WordIntegration.js");
      setupCopyVariableEvents.call({
        view: {
          customAlert(title, message, icon) {
            window.__copyAlerts.push({ title, message, icon });
          },
        },
      });
    });

    await page.locator("#copy-variable").click();
    await page.waitForFunction(
      () => window.__fallbackClipboardWrites.length === 1,
      null,
      { timeout: 1000 },
    );
    assert.deepEqual(await page.evaluate(() => window.__fallbackClipboardWrites), ["{ma_cdt}"]);
    assert.equal(await page.evaluate(() => window.__copyAlerts.length), 1);

    await page.locator("#copy-variable").click();
    await page.waitForFunction(() => window.__nativeClipboardWrites.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__nativeClipboardWrites), ["{ma_cdt}"]);
    assert.equal(await page.evaluate(() => window.__copyAlerts.length), 2);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    });
    await page.locator("#copy-variable").click();
    await page.waitForFunction(() => window.__fallbackClipboardWrites.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__fallbackClipboardWrites), [
      "{ma_cdt}",
      "{ma_cdt}",
    ]);
    assert.equal(await page.evaluate(() => window.__copyAlerts.length), 3);
  });
});

test("Word-variable copy stays bound after dictionary rows rerender", async () => {
  await withCopyPage(async (page) => {
    await page.evaluate(async () => {
      window.__nativeClipboardWrites = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          async writeText(text) {
            window.__nativeClipboardWrites.push(text);
          },
        },
      });
      const { setupCopyVariableEvents } = await import("/frontend/documents/WordIntegration.js");
      setupCopyVariableEvents.call({ view: {} });
      document.getElementById("dictionary-table-body").innerHTML = `
        <tr><td><button type="button" id="copy-variable-next" class="btn-copy-var" data-copy="{ten_cdt}">
          Sao chép
        </button></td></tr>`;
    });

    await page.locator("#copy-variable-next").click();
    await page.waitForTimeout(0);
    assert.deepEqual(await page.evaluate(() => window.__nativeClipboardWrites), ["{ten_cdt}"]);
  });
});
