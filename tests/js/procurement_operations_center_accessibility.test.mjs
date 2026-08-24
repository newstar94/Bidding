import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("operations center is keyboard reachable and has no serious axe violations", async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Trung tâm</title>
          <meta name="bf-procurement-case-enabled" content="true">
          <meta name="bf-work-calendar-enabled" content="true">
          <meta name="bf-work-calendar-connectors-enabled" content="true">
          <meta name="bf-work-calendar-google-enabled" content="true">
          <meta name="bf-work-calendar-microsoft-enabled" content="true">
          <meta name="bf-bulk-export-enabled" content="true">
        </head><body><main><div data-procurement-center>
          <header class="procurement-center__header"><h2>Trung tâm hồ sơ và tác vụ</h2>
          <div class="procurement-center__tabs" role="tablist" aria-label="Khu vực tác vụ">
          <button role="tab" aria-selected="true" data-center-tab="cases">Hồ sơ</button>
          <button role="tab" aria-selected="false" data-center-tab="calendar">Lịch</button>
          <button role="tab" aria-selected="false" data-center-tab="bulk">Xuất hàng loạt</button></div></header>
          <section role="tabpanel" data-center-panel="cases" aria-label="Hồ sơ"></section>
          <section role="tabpanel" data-center-panel="calendar" aria-label="Lịch" hidden></section>
          <section role="tabpanel" data-center-panel="bulk" aria-label="Xuất hàng loạt" hidden></section>
        </div></main></body></html>`);
        return;
      }
      const payload = await readFile(join(root, pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": extname(pathname) === ".css" ? "text/css" : "text/javascript" });
      response.end(payload);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      globalThis.fetch = async (input) => {
        const url = String(input);
        const payload = url.includes("legacy-clarifications")
          ? { items: [] }
          : { items: [{ id: "case-1", caseNo: "LR-01", subject: "Làm rõ", caseType: "CLARIFICATION", state: "DRAFT", packageName: "Gói 1" }] };
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      };
      const module = await import("/frontend/procurement-cases/ProcurementOperationsCenter.js");
      await module.mountProcurementOperationsCenter(document.querySelector("[data-procurement-center]"), {
        packages: [{ id: "pkg-1", maGoiThau: "GT-01", tenGoiThau: "Gói 1" }],
      });
    });
    await page.getByRole("button", { name: "Tải lại" }).focus();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Tải lại");
    const results = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(results.violations.filter((item) => ["serious", "critical"].includes(item.impact)), []);

    const disabledStateCount = await page.evaluate(async () => {
      document.querySelectorAll('meta[name^="bf-"]').forEach((meta) => {
        meta.content = "false";
      });
      const center = document.createElement("div");
      center.dataset.procurementCenter = "";
      center.innerHTML = `<div role="tablist">
        <button role="tab" data-center-tab="cases">Hồ sơ</button>
        <button role="tab" data-center-tab="calendar">Lịch</button>
        <button role="tab" data-center-tab="bulk">Xuất hàng loạt</button>
      </div>
      <section data-center-panel="cases"></section>
      <section data-center-panel="calendar"></section>
      <section data-center-panel="bulk"></section>`;
      document.body.append(center);
      const module = await import("/frontend/procurement-cases/ProcurementOperationsCenter.js");
      for (let index = 0; index < 5; index += 1) {
        await module.mountProcurementOperationsCenter(center);
      }
      return [...center.querySelectorAll(".pc-card")].filter(
        (card) => card.textContent.includes("Các tính năng trung tâm hiện đang tắt."),
      ).length;
    });
    assert.equal(disabledStateCount, 1);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
