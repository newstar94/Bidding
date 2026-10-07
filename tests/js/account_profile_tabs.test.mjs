import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));
const summary = {
  subscription: { packageId: "personal-connected", packageName: "Cá nhân Nâng cao", status: "active", startsAt: 1791407641, expiresAt: 1822943641, variant: "connected", billingCycle: "yearly", sourceOrderPublicId: "order-personal-paid", sourceOrderPaymentState: "verified_paid" },
  usage: { total: 1000, used: 14, reserved: 2, available: 984, nextExpiryAt: 1822943641 },
};
const order = { publicId: "order-personal-paid", ownerKind: "account", operation: "purchase", totalAmount: 2000, paymentState: "verified_paid", activationState: "applied", checkoutState: "open", createdAt: "2026-10-08 05:00:00", paymentConfirmedAt: 1791411241, item: { displayName: "Cá nhân Nâng cao", skuCode: "personal.connected.yearly", variant: "connected", billingCycle: "yearly", credits: 1000 } };

async function fixture(callback, { subscriptionSummary = summary, failSummary = false, failHistory = false, trial = false, payment = "" } = {}) {
  const template = await readFile(join(root, "views/tabs/tab_profile.html"), "utf8");
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"${trial ? ' data-trial-full-access="true"' : ""}><head><link rel="stylesheet" href="/views/css/app.css"><title>Tài khoản</title></head><body><main style="padding:32px;overflow:auto;height:100vh">${template.replace('class="tab-pane"', 'class="tab-pane active"')}</main></body></html>`);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        requests.push({ path: url.pathname, page: url.searchParams.get("page"), owner: request.headers["x-active-org"] });
        const failed = url.pathname.endsWith("account-summary") ? failSummary : failHistory;
        response.writeHead(failed ? 503 : 200, { "content-type": "application/json" });
        response.end(JSON.stringify(failed ? { error: "Unavailable" } : url.pathname.endsWith("account-summary") ? subscriptionSummary : { orders: [Number(url.searchParams.get("page")) === 2 ? { ...order, publicId: "order-personal-older", item: { ...order.item, displayName: "Cá nhân Cơ bản", variant: "internal" } } : order], pagination: { page: Number(url.searchParams.get("page")) || 1, pageSize: 10, total: 11, totalPages: 2 } }));
        return;
      }
      const pathname = url.pathname.startsWith("/vendor/") ? `views${url.pathname}` : url.pathname;
      response.writeHead(200, { "content-type": extname(pathname) === ".css" ? "text/css" : [".js", ".mjs"].includes(extname(pathname)) ? "text/javascript" : "application/octet-stream" });
      response.end(await readFile(join(root, pathname.replace(/^\//u, ""))));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, timezoneId: "Asia/Ho_Chi_Minh" });
    await page.goto(`http://127.0.0.1:${server.address().port}/${payment ? `?payment=${payment}` : ""}`);
    await page.evaluate(async () => {
      sessionStorage.setItem("bf_active_org", "organization-active");
      window.profileActions = [];
      window.profileController = { model: { state: { activeuser: { id: "user-personal", activeOrganizationId: "organization-active", organizations: [{ id: "organization-active", name: "Đơn vị", scope_type: "organization", status: "active" }, { id: "personal:user-personal", name: "Cá nhân", scope_type: "personal", status: "active" }] } } }, view: { createIconsScoped() {} }, async switchWorkspaceContext(id) { window.profileActions.push(["workspace", id]); this.model.state.activeuser.activeOrganizationId = id; }, async switchTab(tab) { window.profileActions.push(["tab", tab]); } };
      const module = await import("/frontend/billing/AccountProfile.js");
      await module.mountAccountProfile(window.profileController);
    });
    await callback(page, requests);
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}

test("account tabs defer reads, preserve forms and show personal facts even in an organization", async () => {
  await fixture(async (page, requests) => {
    assert.equal(requests.length, 0);
    await page.locator("#profile-fullname").fill("Tên đang chỉnh sửa");
    await page.getByRole("tab", { name: "Gói và thanh toán" }).click();
    await page.locator("#profile-personal-packages").waitFor();
    await page.locator("#profile-payment-summary").getByText("Đã kích hoạt", { exact: true }).waitFor();
    assert.equal(await page.locator(".account-profile__usage-number").innerText(), "984 lượt còn lại");
    assert.equal(await page.locator("#profile-account-billing").getByText("Cá nhân Nâng cao", { exact: true }).count(), 1);
    assert.equal(await page.locator("#profile-account-billing").getByText("Hàng năm", { exact: true }).count(), 1);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.owner === "organization-active"), "server selects personal owner independently of the active organization header");
    await page.getByRole("tab", { name: "Hồ sơ cá nhân" }).click();
    assert.equal(await page.locator("#profile-fullname").inputValue(), "Tên đang chỉnh sửa");
    await page.getByRole("tab", { name: "Gói và thanh toán" }).click();
    assert.equal(requests.length, 2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    await mkdir(join(root, "artifacts"), { recursive: true });
    await page.screenshot({ path: join(root, "artifacts/account-profile-billing-desktop.png"), fullPage: true, animations: "disabled" });
    await page.locator("#profile-personal-packages").click();
    assert.deepEqual(await page.evaluate(() => window.profileActions), [["workspace", "personal:user-personal"], ["tab", "commercial-storefront"]]);
  });
});

test("history keyboard navigation and pagination keep full IDs, variant and payment states", async () => {
  await fixture(async (page, requests) => {
    const tab = page.getByRole("tab", { name: "Hồ sơ cá nhân" });
    await tab.focus(); await tab.press("End");
    await page.locator("#profile-purchase-history-status").getByText("Hiển thị 1–1 / 11 giao dịch cá nhân.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "Lịch sử mua cá nhân" }).getAttribute("aria-selected"), "true");
    const row = page.locator("#profile-purchase-history-body");
    assert.equal(await row.getByText("order-personal-paid", { exact: true }).count(), 1);
    assert.match(await row.innerText(), /Nâng cao · Hàng năm · 1\.000 lượt/u);
    await page.getByRole("button", { name: "Trang lịch sử sau" }).click();
    await row.getByText("order-personal-older", { exact: true }).waitFor();
    assert.match(await row.innerText(), /Cơ bản · Hàng năm/u);
    assert.equal(requests[1].page, "2");
    assert.equal(await page.getByRole("button", { name: "Trang lịch sử sau" }).isDisabled(), true);
    await page.screenshot({ path: join(root, "artifacts/account-profile-history-desktop.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("tab", { name: "Lịch sử mua cá nhân" }).press("Home");
    assert.equal(await tab.getAttribute("aria-selected"), "true");
  });
});

test("account loading failures and empty subscription stay actionable", async () => {
  await fixture(async (page) => {
    await page.getByRole("tab", { name: "Gói và thanh toán" }).click();
    await page.getByText("Không thể tải gói và số dư. Bấm Làm mới để thử lại.", { exact: true }).waitFor();
    assert.equal(await page.locator("#profile-billing-refresh").isEnabled(), true);
    assert.equal(await page.locator("#profile-account-billing").getAttribute("aria-busy"), null);
    await page.getByRole("tab", { name: "Lịch sử mua cá nhân" }).click();
    await page.getByText("Không thể tải lịch sử mua. Bấm Làm mới để thử lại.", { exact: true }).waitFor();
    assert.equal(await page.locator("#profile-purchase-history-table").isVisible(), false);
  }, { failSummary: true, failHistory: true });
  await fixture(async (page) => {
    await page.getByRole("tab", { name: "Gói và thanh toán" }).click();
    await page.getByText("Gói miễn phí", { exact: true }).waitFor();
    assert.equal(await page.locator("#profile-personal-packages").isEnabled(), true);
  }, { subscriptionSummary: { subscription: null, usage: { total: 0, used: 0, reserved: 0, available: 0 } } });
});

test("payment callbacks reveal purchase result and trial retains commercial visibility contract", async () => {
  await fixture(async (page) => {
    await page.locator("#profile-purchase-history-body").getByText("Đã kích hoạt", { exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "Lịch sử mua cá nhân" }).getAttribute("aria-selected"), "true");
  }, { payment: "result" });
  await fixture(async (page, requests) => {
    assert.equal(requests.length, 0);
    assert.equal(await page.getByRole("tab").count(), 1);
    assert.equal(await page.locator("#form-profile-update").isVisible(), true);
  }, { trial: true });
});
