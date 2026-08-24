import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if (extname(pathname) === ".js") return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "application/octet-stream";
}

async function withPage(run) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Legal binding</title>
          <meta name="bf-legal-versioning-enabled" content="true">
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
        </head><body><main><div id="actions"></div></main></body></html>`);
        return;
      }
      const payload = await readFile(join(root, pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  let context;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await run(page);
  } finally {
    await context?.close();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("legal binding panel resolves exact target and shows hash-verified citations", async () => {
  await withPage(async (page) => {
    await page.evaluate(async () => {
      const module = await import("/frontend/legal-versioning/LegalBindingPanel.js");
      window.__writes = [];
      const read = async (url) => {
        if (url.endsWith("/sources")) return {
          sources: [{
            documentType: "LAW",
            documentNumber: "01/2026/QH",
            title: "Luật đấu thầu thử nghiệm",
            effectiveFrom: "2026-01-01",
            effectiveTo: null,
            contentSha256: "a".repeat(64),
            sourceUri: "https://example.test/legal/01",
          }],
        };
        return {
          bindingRevision: 0,
          status: "UNRESOLVED",
          reason: "LEGACY_NOT_BACKFILLED",
          profileVersionId: null,
        };
      };
      const write = async (url, body) => {
        window.__writes.push({ url, body });
        return {
          bindingRevision: 1,
          targetRowVersion: 7,
          status: "RESOLVED",
          reason: "EXACT_EFFECTIVE_INTERVAL",
          anchorDate: "2026-02-01",
          anchorSource: "ke_hoach_lcnt.ngay_phe_duyet",
          profileVersionId: "profile-v1",
        };
      };
      module.bindLegalBindingAction(document.getElementById("actions"), {
        targetType: "plan", targetId: "plan-a", targetRowVersion: 7,
        canResolve: true, read, write,
      });
      window.__assistantTargets = [];
      window.addEventListener("bf:assistant-target", (event) => window.__assistantTargets.push(event.detail));
    });
    await page.getByRole("button", { name: "Pháp lý" }).click();
    const dialog = page.getByRole("dialog", { name: "Ràng buộc pháp lý lịch sử" });
    await dialog.getByText("Chưa xác định", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Resolve và ghi binding" }).click();
    await dialog.getByText("Đã xác định", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Hỏi trợ lý về tuân thủ" }).click();
    assert.deepEqual(await page.evaluate(() => window.__assistantTargets), [{
      targetType: "kehoach", targetId: "plan-a", versionId: "plan-a",
    }]);
    assert.deepEqual(await page.evaluate(() => window.__writes), [{
      url: "/api/legal-versioning/plan/plan-a/binding/resolve",
      body: { expectedBindingRevision: 0, expectedTargetRowVersion: 7 },
    }]);
    await dialog.getByRole("button", { name: "Xem nguồn chính xác" }).click();
    await dialog.getByText("Luật đấu thầu thử nghiệm").waitFor();
    assert.equal(
      await dialog.getByRole("link", { name: "Mở nguồn chính thức" }).getAttribute("href"),
      "https://example.test/legal/01",
    );
    const axe = await new AxeBuilder({ page }).include("#legal-binding-modal").analyze();
    assert.deepEqual(axe.violations, []);

    await page.setViewportSize({ width: 320, height: 760 });
    const mobile = await dialog.evaluate((node) => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      buttons: [...node.querySelectorAll("button")].map((item) => item.getBoundingClientRect().height),
    }));
    assert.equal(mobile.overflow, false);
    assert.ok(mobile.buttons.every((height) => height >= 44));
  });
});

test("read-only actor has no resolve control", async () => {
  await withPage(async (page) => {
    await page.evaluate(async () => {
      const module = await import("/frontend/legal-versioning/LegalBindingPanel.js");
      module.openLegalBindingPanel({
        targetType: "package", targetId: "package-a", targetRowVersion: 2,
        canResolve: false,
        read: async () => ({
          bindingRevision: 0, status: "UNRESOLVED",
          reason: "MISSING_OR_INVALID_ANCHOR", profileVersionId: null,
        }),
      });
    });
    const dialog = page.getByRole("dialog", { name: "Ràng buộc pháp lý lịch sử" });
    await dialog.getByText("Chưa xác định", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Resolve và ghi binding" }).isHidden(), true);
  });
});
