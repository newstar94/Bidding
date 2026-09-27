import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("conflict center handles independent drafts, discard errors, and a refreshed 409", async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<!doctype html><html><head><link rel="stylesheet" href="/views/css/tokens.css"><link rel="stylesheet" href="/views/css/variables.css"><link rel="stylesheet" href="/views/css/base.css"><link rel="stylesheet" href="/views/css/components.css"></head><body><button id="before">Mở</button></body></html>');
        return;
      }
      const payload = await readFile(join(root, pathname.slice(1)));
      response.writeHead(200, {
        "content-type": [".js", ".mjs"].includes(extname(pathname)) ? "text/javascript" : "text/plain",
      });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const failedRequests = [];
    page.on("response", (response) => {
      if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
    });
    page.on("requestfailed", (request) => failedRequests.push(`${request.failure()?.errorText} ${request.url()}`));
    page.on("console", (message) => { if (message.type() === "error") failedRequests.push(message.text()); });
    page.on("pageerror", (error) => failedRequests.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator("#before").focus();
    await page.evaluate(async () => {
      const { openConflictCenter } = await import("/frontend/app/ConflictCenter.js");
      const drafts = [
        { id: "draft-1", entityType: "goithau", recordId: "GT-1", createdAt: 1700000000, expiresAt: 1800000000 },
        { id: "draft-2", entityType: "goithau", recordId: "GT-2", createdAt: 1700000001, expiresAt: 1800000000 },
      ];
      const state = { drafts, previewCalls: [], discardCalls: [], resolveCalls: [], toasts: [], syncStateCalls: [], discardFails: true, resolveConflicts: true, token: "workspace-A" };
      window.conflictState = state;
      window.confirm = () => true;
      const model = {
        getWorkspaceToken: () => state.token,
        refreshConflictRecoveryDrafts: async () => state.drafts.slice(),
        previewConflictRecoveryDraft: async (id) => {
          state.previewCalls.push(id);
          return {
            draft: { entityType: "goithau" },
            resolutionAuthority: `authority-${state.previewCalls.length}`,
            fields: [
              { field: "tenGoiThau", status: "CONFLICT", base: "Gốc", local: `Tôi-${id}`, server: `Máy chủ-${id}`, requiresChoice: true },
              { field: "hinhThucLuaChon", status: "SERVER_ONLY", base: "Cũ", local: "Cũ", server: "Đấu thầu rộng rãi", requiresChoice: false },
            ],
          };
        },
        discardConflictRecoveryDraft: async (id) => {
          state.discardCalls.push(id);
          if (state.discardFails) {
            state.discardFails = false;
            throw new Error("Mất kết nối");
          }
          state.drafts = state.drafts.filter((draft) => draft.id !== id);
          return { status: "deleted" };
        },
        resolveConflictRecoveryDraft: async (id, preview, decisions) => {
          state.resolveCalls.push({ id, authority: preview.resolutionAuthority, decisions: { ...decisions } });
          if (state.resolveConflicts) {
            state.resolveConflicts = false;
            throw Object.assign(new Error("Đã đổi"), { status: 409 });
          }
          return { status: "resolved" };
        },
      };
      const controller = { model, view: { showToast: (...args) => state.toasts.push(args) }, updateSyncState: (value) => state.syncStateCalls.push(value) };
      window.conflictController = controller;
      window.openConflictCenter = openConflictCenter;
      await openConflictCenter(controller);
    }).catch((error) => { throw new Error(`${error.message}; requests: ${failedRequests.join(", ")}`); });

    const picker = page.getByRole("combobox", { name: "Chọn bản nháp xung đột" });
    for (const width of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const geometry = await page.locator(".conflict-center-dialog").evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, viewport: window.innerWidth, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth };
      });
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport, JSON.stringify(geometry));
      assert.ok(geometry.scrollWidth <= geometry.clientWidth, JSON.stringify(geometry));
    }
    assert.equal(await picker.locator("option").count(), 2);
    assert.equal(await page.getByText("Hình thức lựa chọn nhà thầu", { exact: true }).count(), 1);
    await picker.selectOption("draft-2");
    await page.getByText("Tôi-draft-2").waitFor();
    await page.getByRole("button", { name: "Bỏ bản nháp" }).click();
    await page.waitForFunction(() => window.conflictState.toasts.some((toast) => toast[0] === "Chưa thể bỏ bản nháp"));
    assert.equal(await page.getByRole("button", { name: "Bỏ bản nháp" }).isEnabled(), true);
    assert.equal(await picker.locator("option").count(), 2);

    await page.getByRole("button", { name: "Bỏ bản nháp" }).click();
    await page.waitForFunction(() => window.conflictState.drafts.length === 1);
    await page.getByText("Tôi-draft-1").waitFor();
    assert.equal(await picker.locator("option").count(), 1);
    await page.locator('[data-conflict-field="tenGoiThau"]').selectOption("LOCAL");
    await page.getByRole("button", { name: "Xác nhận hợp nhất" }).click();
    await page.waitForFunction(() => window.conflictState.toasts.some((toast) => toast[0] === "Dữ liệu máy chủ đã đổi"));
    assert.equal(await page.locator('[data-conflict-field="tenGoiThau"]').inputValue(), "");
    await page.locator('[data-conflict-field="tenGoiThau"]').selectOption("SERVER");
    await page.getByRole("button", { name: "Xác nhận hợp nhất" }).click();
    await page.locator(".conflict-center-dialog").waitFor({ state: "detached" });
    assert.equal(await page.locator("#before").evaluate((element) => document.activeElement === element), true);
    const state = await page.evaluate(() => window.conflictState);
    assert.deepEqual(state.discardCalls, ["draft-2", "draft-2"]);
    assert.deepEqual(state.resolveCalls.map(({ id, decisions }) => ({ id, decisions })), [
      { id: "draft-1", decisions: { tenGoiThau: "LOCAL" } },
      { id: "draft-1", decisions: { tenGoiThau: "SERVER" } },
    ]);
    assert.notEqual(state.resolveCalls[0].authority, state.resolveCalls[1].authority);
    assert.deepEqual(state.syncStateCalls, []);

    await page.evaluate(async () => {
      const state = window.conflictState;
      state.toastCountBeforeSwitch = state.toasts.length;
      window.conflictController.model.resolveConflictRecoveryDraft = () => new Promise((resolve) => {
        state.finishPendingResolve = resolve;
      });
      await window.openConflictCenter(window.conflictController);
    });
    await page.getByRole("button", { name: "Xác nhận hợp nhất" }).click();
    await page.waitForFunction(() => typeof window.conflictState.finishPendingResolve === "function");
    await page.evaluate(() => {
      window.conflictState.token = "workspace-B";
      window.conflictState.finishPendingResolve({ status: "resolved" });
    });
    await page.locator(".conflict-center-dialog").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.conflictState.toasts.length === window.conflictState.toastCountBeforeSwitch), true);

    await page.evaluate(async () => {
      window.conflictController.model.resolveConflictRecoveryDraft = async () => ({ status: "resolved" });
      await window.openConflictCenter(window.conflictController);
    });
    await page.keyboard.press("Escape");
    await page.locator(".conflict-center-dialog").waitFor({ state: "detached" });
    assert.equal(await page.locator("#before").evaluate((element) => document.activeElement === element), true);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
