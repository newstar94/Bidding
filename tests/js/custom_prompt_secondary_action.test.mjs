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

for (const scenario of ["pending", "reopen", "confirmation"]) {
const reopenPrompt = scenario === "reopen";
const testName = {
  pending: "prompt import keeps its dialog open on Escape while loading and blocks confirmation until settled",
  reopen: "reopened prompt keeps reused opening loading accessible and focused",
  confirmation: "custom confirmation above generic loading remains interactive for confirm and cancel",
}[scenario];
test(testName, async () => {
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
    if (scenario === "confirmation") {
      await page.evaluate(async () => {
        globalThis.lucide = { createIcons() {} };
        const { installDialogAccessibility } = await import("/frontend/shared/dialogAccessibility.js");
        installDialogAccessibility(document);
        const { BiddingView } = await import("/frontend/app/BiddingView.js");
        const { beginLongTaskLoading } = await import("/frontend/shared/LongTaskLoading.js");
        const view = new BiddingView({});
        globalThis.genericLoading = await beginLongTaskLoading({
          task: "package-delete",
          title: "Đang kiểm tra gói thầu",
          minimumVisibleMs: 0,
          exitTransitionMs: 0,
        });
        globalThis.openPendingConfirmation = () => {
          globalThis.confirmationResult = null;
          void view.customConfirm("Xác nhận xóa", "Xóa gói thầu vừa tải về?", "trash-2")
            .then((value) => { globalThis.confirmationResult = value; });
        };
        globalThis.openPendingConfirmation();
      });
      const dialog = page.locator("#modal-custom-dialog");
      const loading = page.locator("#app-long-task-loading");
      await dialog.waitFor({ state: "visible" });
      assert.equal(await dialog.evaluate((modal) => (
        Number(getComputedStyle(modal).zIndex)
          > Number(getComputedStyle(document.getElementById("app-long-task-loading")).zIndex)
      )), true);
      assert.deepEqual(await dialog.evaluate((modal) => ({
        inert: modal.inert,
        ariaHidden: modal.getAttribute("aria-hidden") === "true",
      })), { inert: false, ariaHidden: false }, "Confirmation above generic loading must remain interactive");
      await page.locator("#btn-dialog-ok").click();
      await page.waitForFunction(() => globalThis.confirmationResult === true);
      assert.equal(await loading.isVisible(), true);
      await page.evaluate(() => globalThis.openPendingConfirmation());
      await page.locator("#btn-dialog-cancel").click();
      await page.waitForFunction(() => globalThis.confirmationResult === false);
      await page.evaluate(() => globalThis.openPendingConfirmation());
      await dialog.waitFor({ state: "visible" });
      await page.evaluate(() => globalThis.genericLoading.close());
      await loading.waitFor({ state: "hidden" });
      assert.deepEqual(await dialog.evaluate((modal) => ({
        inert: modal.inert,
        ariaHidden: modal.getAttribute("aria-hidden") === "true",
      })), { inert: false, ariaHidden: false }, "Closing lower loading must keep the active confirmation interactive");
      await page.locator("#btn-dialog-cancel").click();
      await page.waitForFunction(() => globalThis.confirmationResult === false);
      return;
    }
    await page.evaluate(async () => {
      globalThis.lucide = { createIcons() {} };
      const { installDialogAccessibility } = await import("/frontend/shared/dialogAccessibility.js");
      installDialogAccessibility(document);
      const { BiddingView } = await import("/frontend/app/BiddingView.js");
      const view = new BiddingView({});
      globalThis.openOpeningPrompt = () => {
      globalThis.promptSettled = false;
      globalThis.openingFetchStarted = false;
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
            loading: {
              task: "procurement-opening",
              title: "Đang lấy dữ liệu mở thầu",
              minimumVisibleMs: 0,
              exitTransitionMs: 0,
            },
            run: () => {
              globalThis.openingFetchStarted = true;
              return new Promise((resolve, reject) => {
                globalThis.finishOpeningFetch = () => resolve({
                  value: "07/08/2026 09:00",
                  status: "Đã tự động lấy dữ liệu của 1 nhà thầu.",
                });
                globalThis.failOpeningFetch = () => reject(new Error("Source unavailable"));
              });
            },
          },
        },
      ).then(() => { globalThis.promptSettled = true; });
      };
      globalThis.openOpeningPrompt();
    });

    const action = page.locator('[aria-describedby="dialog-prompt-secondary-status"]');
    assert.equal(await action.textContent(), " Lấy dữ liệu mở thầu tự động");
    assert.equal(await page.locator('label[for="dialog-prompt-input"]').textContent(), "Thời gian mở thầu");
    await action.click();
    const loading = page.locator('#app-long-task-loading[data-task="procurement-opening"]');
    await loading.waitFor({ state: "visible", timeout: 3000 });
    await page.waitForFunction(() => globalThis.openingFetchStarted);
    assert.equal(await page.locator("#btn-dialog-ok").isDisabled(), true);
    assert.equal(await page.locator("#modal-custom-dialog").getAttribute("inert"), "");
    assert.equal(await loading.evaluate((overlay) => {
      const dialog = document.getElementById("modal-custom-dialog");
      const card = overlay.querySelector(".app-long-task-loading-card");
      const rect = card.getBoundingClientRect();
      return Number(getComputedStyle(overlay).zIndex) > Number(getComputedStyle(dialog).zIndex)
        && overlay.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true);
    if (!reopenPrompt) {
      await page.keyboard.press("Escape");
      assert.deepEqual(await page.evaluate(() => ({
        settled: globalThis.promptSettled,
        active: document.getElementById("modal-custom-dialog").classList.contains("active"),
      })), { settled: false, active: true }, "Escape must not dismiss the pending opening prompt");
    }
    await page.locator("#dialog-prompt-input").evaluate((input) => {
      input.value = "07/08/2026 08:00";
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    });
    assert.equal(await page.evaluate(() => globalThis.promptSettled), false);
    await page.evaluate(() => globalThis.finishOpeningFetch());
    await page.waitForFunction(() => (
      document.getElementById("dialog-prompt-secondary-status")?.textContent
        === "Đã tự động lấy dữ liệu của 1 nhà thầu."
    ));
    await loading.waitFor({ state: "hidden" });
    assert.equal(await page.locator("#btn-dialog-ok").isDisabled(), false);
    assert.equal(await page.locator("#modal-custom-dialog").getAttribute("inert"), null);
    assert.equal(await action.evaluate((button) => document.activeElement === button), true,
      "Successful opening lookup must restore focus to the secondary action");
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
    await page.evaluate(() => { globalThis.openingFetchStarted = false; });
    await action.click();
    await loading.waitFor({ state: "visible" });
    await page.waitForFunction(() => globalThis.openingFetchStarted);
    await page.evaluate(() => globalThis.failOpeningFetch());
    await loading.waitFor({ state: "hidden" });
    assert.equal(await page.locator("#btn-dialog-ok").isDisabled(), false);
    assert.equal(await page.locator("#modal-custom-dialog").getAttribute("inert"), null);
    assert.equal(await action.evaluate((button) => document.activeElement === button), true,
      "Failed opening lookup must restore focus to the secondary action");
    assert.match(await page.locator("#dialog-prompt-secondary-status").textContent(), /Không thể lấy dữ liệu/u);
    assert.equal(await page.locator("#dialog-prompt-input").inputValue(), "07/08/2026 09:00");
    await page.locator("#btn-dialog-cancel").click();
    if (reopenPrompt) {
      await page.locator("#dialog-prompt-container").waitFor({ state: "detached" });
      assert.equal(await loading.count(), 1);
      await page.evaluate(() => globalThis.openOpeningPrompt());
      await action.click();
      await loading.waitFor({ state: "visible" });
      await page.waitForFunction(() => globalThis.openingFetchStarted);
      assert.deepEqual(await loading.evaluate((overlay) => ({
        inert: overlay.inert,
        ariaHidden: overlay.getAttribute("aria-hidden") === "true",
        focused: overlay.contains(document.activeElement),
      })), { inert: false, ariaHidden: false, focused: true }, "Reused loading must remain accessible above the reopened prompt");
      await page.evaluate(() => globalThis.finishOpeningFetch());
      await loading.waitFor({ state: "hidden" });
      assert.equal(await page.locator("#btn-dialog-ok").isDisabled(), false);
      assert.equal(await page.locator("#modal-custom-dialog").getAttribute("inert"), null);
      await page.locator("#btn-dialog-cancel").click();
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
}

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
