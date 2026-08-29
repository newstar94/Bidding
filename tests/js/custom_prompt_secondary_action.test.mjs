import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

test("prompt secondary import action is accessible, responsive, and fills the field", async () => {
  const modalMarkup = await readFile(
    new URL("../../views/modals/modal_custom_dialog.html", import.meta.url),
    "utf8",
  );
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html><head><meta charset="utf-8">
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/generated-static-styles.css">
          <link rel="stylesheet" href="/views/css/ui-redesign.css">
          <link rel="stylesheet" href="/views/css/runtime-styles.css" data-runtime-styles>
        </head><body>${modalMarkup}</body></html>`);
        return;
      }
      const filePath = join(projectRoot, pathname.replace(/^\//, ""));
      const payload = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 375, height: 760 } });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(async () => {
      globalThis.lucide = { createIcons() {} };
      const modal = document.getElementById("modal-custom-dialog");
      modal.removeAttribute("inert");
      modal.setAttribute("aria-hidden", "false");
      const { BiddingView } = await import("/frontend/app/BiddingView.js");
      const view = new BiddingView({});
      void view.customPrompt(
        "Chọn thời gian mở thầu",
        "Chọn thời gian cho gói thầu kiểm thử.",
        "",
        "dd/MM/yyyy HH:mm",
        false,
        null,
        "text",
        {
          inputLabel: "Thời gian mở thầu",
          secondaryAction: {
            label: "Lấy dữ liệu mở thầu tự động",
            icon: "cloud-download",
            description: "Tự điền dữ liệu vào biên bản mở thầu.",
            run: async () => ({
              value: "07/08/2026 09:00",
              status: "Đã tự động lấy dữ liệu của 1 nhà thầu.",
            }),
          },
        },
      );
    });

    const action = page.locator('[aria-describedby="dialog-prompt-secondary-status"]');
    assert.equal(await action.textContent(), " Lấy dữ liệu mở thầu tự động");
    assert.equal(await page.locator('label[for="dialog-prompt-input"]').textContent(), "Thời gian mở thầu");
    await action.click();
    await page.waitForFunction(() => (
      document.getElementById("dialog-prompt-secondary-status")?.textContent
        === "Đã tự động lấy dữ liệu của 1 nhà thầu."
    ));
    assert.equal(await page.locator("#dialog-prompt-input").inputValue(), "07/08/2026 09:00");
    const layout = await page.locator("#modal-custom-dialog .modal-card").evaluate((card) => {
      const actionButton = card.querySelector('[aria-describedby="dialog-prompt-secondary-status"]');
      const cardRect = card.getBoundingClientRect();
      return {
        actionHeight: actionButton.getBoundingClientRect().height,
        cardLeft: cardRect.left,
        cardRight: cardRect.right,
        viewportWidth: document.documentElement.clientWidth,
        overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    assert.ok(layout.actionHeight >= 44);
    assert.ok(layout.cardLeft >= 0);
    assert.ok(layout.cardRight <= layout.viewportWidth);
    assert.equal(layout.overflows, false);
    await page.locator("#btn-dialog-cancel").click();
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("reused custom dialog renders the newly requested Lucide icon", async () => {
  const modalMarkup = await readFile(
    new URL("../../views/modals/modal_custom_dialog.html", import.meta.url),
    "utf8",
  );
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html><head><meta charset="utf-8">
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/generated-static-styles.css">
          <link rel="stylesheet" href="/views/css/ui-redesign.css">
          <link rel="stylesheet" href="/views/css/runtime-styles.css" data-runtime-styles>
        </head><body>${modalMarkup}</body></html>`);
        return;
      }
      const filePath = join(projectRoot, pathname.replace(/^\//, ""));
      const payload = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.addScriptTag({ url: "/views/vendor/lucide/lucide.min.js" });
    await page.evaluate(async () => {
      const modal = document.getElementById("modal-custom-dialog");
      modal.removeAttribute("inert");
      modal.setAttribute("aria-hidden", "false");
      const { BiddingView } = await import("/frontend/app/BiddingView.js");
      globalThis.dialogTestView = new BiddingView({});
      globalThis.dialogTestResult = globalThis.dialogTestView.customConfirm(
        "First dialog",
        "Warning icon",
        "alert-triangle",
      );
    });

    const dialogIcon = page.locator("#dialog-icon");
    await dialogIcon.waitFor({ state: "attached" });
    assert.equal(await dialogIcon.evaluate((icon) => icon.tagName), "svg");
    assert.equal(await dialogIcon.getAttribute("data-lucide"), "alert-triangle");
    assert.ok((await dialogIcon.getAttribute("class"))?.includes("lucide-alert-triangle"));

    await page.locator("#btn-dialog-cancel").click();
    assert.equal(await page.evaluate(() => globalThis.dialogTestResult), false);
    await page.evaluate(() => {
      globalThis.dialogTestResult = globalThis.dialogTestView.customConfirm(
        "Second dialog",
        "Danger icon",
        "trash-2",
      );
    });

    await dialogIcon.waitFor({ state: "attached" });
    assert.equal(await dialogIcon.evaluate((icon) => icon.tagName), "svg");
    assert.equal(await dialogIcon.getAttribute("data-lucide"), "trash-2");
    assert.ok((await dialogIcon.getAttribute("class"))?.includes("lucide-trash-2"));
    await page.locator("#btn-dialog-cancel").click();
    assert.equal(await page.evaluate(() => globalThis.dialogTestResult), false);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
