import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  page.__specialistDiagnostics = [];
  const record = (entry) => {
    page.__specialistDiagnostics.push(entry);
    if (page.__specialistDiagnostics.length > 40) page.__specialistDiagnostics.shift();
  };
  page.on("pageerror", (error) => record({ event: "pageerror", message: error.message }));
  page.on("requestfailed", (request) => record({ event: "requestfailed",
    method: request.method(), url: request.url().split("?")[0], error: request.failure()?.errorText }));
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) record({ event: "navigation", url: frame.url().split("?")[0] });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach("specialist-runtime-diagnostics", {
      body: JSON.stringify(page.__specialistDiagnostics || [], null, 2), contentType: "application/json",
    });
  }
});

function fixture(action, payload) {
  const result = spawnSync(process.env.PYTHON || "python", ["scripts/lifecycle_e2e_fixture.py", action], {
    input: JSON.stringify(payload), encoding: "utf8", windowsHide: true, env: process.env,
  });
  if (result.status !== 0) throw new Error(`Specialist fixture ${action}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function ready(page) {
  await page.waitForFunction(() => (
    document.getElementById("btn-force-sync")?.dataset.startupReconciliationPhase === "RECONCILED"
  ));
}

test("view-permission specialist creates contractor with persisted stamp", async ({ page, browserName }) => {
  const syncTraffic = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== "/api/sync" || request.method() !== "POST") return;
    const body = request.postDataJSON();
    syncTraffic.push({ event: "request", tables: Object.keys(body || {}),
      contractors: body?.nhathau?.map((item) => ({ id: item.id, code: item.maNhaThau })) });
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/sync") syncTraffic.push({ event: "response", status: response.status() });
  });
  const runId = `specialist-${Date.now()}-${browserName}`;
  const account = { id: `${runId}-user`, username: runId, name: runId, email: `${runId}@example.test` };
  const payload = { runId, account, organizationId: `${runId}-org`,
    membershipRole: "employee", password: `Aa!9${randomBytes(12).toString("hex")}` };
  fixture("setup", payload);
  try {
    await page.goto("/dang-nhap", { waitUntil: "commit" });
    await page.locator("#login-username").fill(account.username);
    await page.locator("#login-password").fill(payload.password);
    await page.locator("#form-auth-login button[type='submit']").click();
    await expect(page.locator("#auth-overlay")).toBeHidden();
    await ready(page);
    await page.goto("/nha-thau", { waitUntil: "commit" });
    await ready(page);
    await expect(page.locator("#header-profile-role")).toContainText("Chuyên viên");
    await page.locator("#btn-add-nhathau").click();
    await expect(page.locator("#modal-nhathau.active")).toBeVisible();
    await page.locator("#nt-ma").fill(runId);
    await page.locator("#nt-ten").fill(`Nhà thầu ${runId}`);
    await page.locator("#nt-ngayapdung").fill("2026-01-01");
    await page.locator("#nt-danhxung").fill("Bà");
    await page.locator("#nt-nguoidaidien").fill("Nguyễn Thị Kiểm Thử");
    await page.locator("#nt-chucvudaidien").fill("Giám đốc");
    await page.locator("#nt-tinh").selectOption({ index: 1 }, { force: true });
    await page.waitForFunction(() => document.querySelector("#nt-xa")?.options.length > 1);
    await page.locator("#nt-xa").selectOption({ index: 1 }, { force: true });
    await page.locator("#nt-diachichitiet").fill("01 Đường kiểm thử");
    const permissionDiagnostics = await page.evaluate(async () => {
      const userId = sessionStorage.getItem("bf_user_id") || localStorage.getItem("bf_user_id");
      const organizationId = sessionStorage.getItem("bf_active_org") || localStorage.getItem("bf_active_org");
      const databases = await indexedDB.databases();
      const name = databases.find((entry) => entry.name?.includes(encodeURIComponent(userId)))?.name;
      if (!name) return { userId, organizationId, databaseNames: databases.map((entry) => entry.name) };
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!db.objectStoreNames.contains("permissionmatrix")) return { userId, organizationId, stores: [...db.objectStoreNames] };
        const permissions = await new Promise((resolve, reject) => {
          const request = db.transaction("permissionmatrix").objectStore("permissionmatrix").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const activeUser = JSON.parse(sessionStorage.getItem("bf_active_user") || localStorage.getItem("bf_active_user") || "null");
        return { userId, activeUserId: activeUser?.id, organizationId, permissions };
      } finally { db.close(); }
    });
    await expect(page.locator("#nt-anhdau"),
      `A view-permission specialist must be allowed to attach a stamp: ${JSON.stringify(permissionDiagnostics)}`,
    ).toBeEnabled();
    await page.locator("#nt-anhdau").setInputFiles("views/assets/favicon.png");
    await expect(page.locator("#nt-anh-preview-dau")).toBeVisible();
    const saved = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/sync"
      && response.request().method() === "POST"
      && response.request().postDataJSON()?.nhathau?.some((item) => item.maNhaThau === runId)
    ));
    await page.locator("#form-nhathau button[type='submit']").click();
    const response = await saved.catch(async (error) => {
      const state = await page.evaluate(() => ({
        path: location.pathname,
        sync: { ...document.getElementById("btn-force-sync")?.dataset },
        formPresent: Boolean(document.getElementById("form-nhathau")),
        toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.innerText),
        dialog: document.getElementById("modal-custom-dialog")?.innerText,
      }));
      throw new Error(`Contractor canonical response missing: ${JSON.stringify({ syncTraffic, state })}`, { cause: error });
    });
    const submitted = response.request().postDataJSON().nhathau.find((item) => item.maNhaThau === runId);
    expect(submitted.anhDau, "Submitted contractor must contain the selected stamp").toMatch(/^data:image\//);
    expect(response.ok(), await response.text()).toBe(true);
    await expect(page.locator("#modal-nhathau.active")).toBeHidden();
    await page.reload({ waitUntil: "commit" });
    await ready(page);
    const persisted = await page.evaluate(async (code) => {
      const response = await fetch(`/api/paginate?table=nhathau&page=1&pageSize=10&search=${encodeURIComponent(code)}`);
      if (!response.ok) throw new Error(`Contractor read failed: ${response.status}`);
      const data = await response.json();
      const item = data.items?.find((record) => record.maNhaThau === code);
      return { exists: Boolean(item), stamp: item?.anhDau || "" };
    }, runId);
    expect(persisted.exists).toBe(true);
    expect(persisted.stamp, "Server read must retain the uploaded stamp").toMatch(/^\/images\/nha_thau\//);
    await page.locator("#search-nhathau").fill(runId);
    const row = page.locator("#nhathau-table tbody tr").filter({ hasText: runId });
    await row.locator('[data-bf-action="edit-contractor"]').click();
    const stamp = page.locator("#nt-anh-preview-dau");
    await expect(stamp, `Server stamp path: ${persisted.stamp.split("?")[0]}`).toBeVisible();
    await expect.poll(() => stamp.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await stamp.getAttribute("src")).not.toMatch(/^data:/);
    // Keep the authenticated cookie but remove browser-stored identity. A fresh
    // document must restore identity from the server before using module rights.
    await page.evaluate(() => {
      sessionStorage.removeItem("bf_active_user");
      localStorage.removeItem("bf_active_user");
    });
    await page.reload({ waitUntil: "commit" });
    await ready(page);
    await expect.poll(() => page.evaluate(() => {
      const stored = sessionStorage.getItem("bf_active_user") || localStorage.getItem("bf_active_user");
      return stored ? JSON.parse(stored).id : null;
    })).toBe(account.id);
  } finally {
    await page.context().clearCookies();
    fixture("cleanup", payload);
  }
});

test("view-permission specialist creates a plan through the breakdown form", async ({ page, browserName }) => {
  const runId = `specialist-plan-${Date.now()}-${browserName}`;
  const account = { id: `${runId}-user`, username: runId, name: runId, email: `${runId}@example.test` };
  const payload = { runId, account, organizationId: `${runId}-org`, membershipRole: "employee",
    password: `Aa!9${randomBytes(12).toString("hex")}` };
  fixture("setup", payload);
  try {
    await page.goto("/dang-nhap", { waitUntil: "commit" });
    await page.locator("#login-username").fill(account.username);
    await page.locator("#login-password").fill(payload.password);
    await page.locator("#form-auth-login button[type='submit']").click();
    await expect(page.locator("#auth-overlay")).toBeHidden();
    await ready(page);
    await page.goto("/ke-hoach", { waitUntil: "commit" });
    await ready(page);
    await expect(page.locator("#header-profile-role")).toContainText("Chuyên viên");
    await page.locator("#btn-add-kehoach").click();
    await expect(page.locator("#modal-kehoach.active")).toBeVisible();
    await page.locator("#kh-ma").fill(runId);
    await page.locator("#kh-ten").fill(`Kế hoạch ${runId}`);
    await page.locator("#kh-loaihinh").selectOption({ label: "Dự toán mua sắm" }, { force: true });
    await page.locator("#kh-pheduyet").selectOption({ value: "Dự toán và kế hoạch" }, { force: true });
    await page.locator("#kh-duan").fill(`Dự toán ${runId}`);
    await page.locator("#kh-chudautuid").selectOption(`${runId}-owner`, { force: true });
    await page.locator("#kh-sototrinhdutoankehoach").fill(`${runId}/TTR`);
    await page.locator("#kh-ngaytrinhkehoach").fill("2026-01-01");
    await page.locator("#kh-quyetdinh").fill(`${runId}/QD`);
    await page.locator("#kh-ngaypheduyet").fill("2026-01-02");
    await page.locator("#kh-tongmuc").fill("1000000000");
    await page.locator("#form-kehoach button[type='submit']").click();
    await expect(page.locator("#modal-plan-breakdown.active")).toBeVisible();
    const saved = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/plans/finalize-draft" && response.request().method() === "POST"
      && response.request().postDataJSON()?.kehoach?.some((item) => item.maKeHoach === runId)
    ));
    await page.locator("#btn-save-plan-breakdown").click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBe(true);
    await expect(page.locator("#modal-plan-breakdown.active")).toBeHidden();
    await page.reload({ waitUntil: "commit" });
    await ready(page);
    await page.locator("#search-kehoach").fill(runId);
    await expect(page.locator("#kehoach-table tbody tr").filter({ hasText: runId })).toBeVisible();
    const planId = response.request().postDataJSON().kehoach.find((item) => item.maKeHoach === runId).id;
    const assignments = fixture("verify_assignments", payload).assignments;
    expect(assignments.filter((item) => item.type === "kehoach" && item.targetId === planId))
      .toEqual([{ type: "kehoach", targetId: planId, empId: account.id }]);
    await page.goto("/goi-thau", { waitUntil: "commit" });
    await ready(page);
    await page.locator("#btn-add-goithau").click();
    await expect(page.locator("#modal-goithau.active")).toBeVisible();
    await page.locator("#gt-ma").fill(`${runId}-GT`);
    await page.locator("#gt-kehoachid").selectOption(planId, { force: true });
    await page.locator("#gt-ten").fill(`Gói thầu ${runId}`);
    await page.locator("#gt-gia").fill("500000000");
    await page.locator("#gt-thoigian").fill("90 ngày");
    for (const [selector, label] of [
      ["#gt-linhvuc", "Hàng hóa"], ["#gt-hinhthuc", "Đấu thầu rộng rãi"],
      ["#gt-phuongthuc", "Một giai đoạn một túi hồ sơ"],
      ["#gt-phuongphapdanhgia", "Giá thấp nhất"], ["#gt-phanlo", "Không"],
    ]) await page.locator(selector).selectOption({ label }, { force: true });
    await page.locator("#gt-nguonvon").fill("Ngân sách nhà nước");
    await page.locator("#gt-thoigiantochuc").fill("45 ngày");
    await page.locator("#gt-thoigianbatdautochuc").fill("Quý IV/2026");
    await expect.poll(() => page.locator("#gt-nhanvienphutrach").evaluate(
      (select) => [...select.selectedOptions].map((option) => option.value),
    )).toEqual([account.id]);
    await page.locator('#to-chuyengia-tbody input[name="tochuyengia-select"]').first().check();
    await page.locator('#to-thamdinh-tbody input[name="tothamdinh-select"]').nth(1).check();
    const packageSaved = page.waitForResponse((result) => (
      new URL(result.url()).pathname === "/api/sync" && result.request().method() === "POST"
      && result.request().postDataJSON()?.goithau?.some((item) => item.maGoiThau === `${runId}-GT`)
    ));
    await page.locator("#form-goithau button[type='submit']").click();
    const packageResponse = await packageSaved;
    expect(packageResponse.ok(), await packageResponse.text()).toBe(true);
    await expect(page.locator("#modal-goithau.active")).toBeHidden();
    const packageId = packageResponse.request().postDataJSON().goithau.find((item) => item.maGoiThau === `${runId}-GT`).id;
    expect(fixture("verify_assignments", payload).assignments.filter(
      (item) => item.type === "goithau" && item.targetId === packageId,
    )).toEqual([{ type: "goithau", targetId: packageId, empId: account.id }]);
    await page.goto("/hop-dong", { waitUntil: "commit" });
    await ready(page);
    await page.locator("#btn-add-hopdong").click();
    await expect(page.locator("#modal-hopdong.active")).toBeVisible();
    await expect.poll(() => page.locator("#hd-nhanvienphutrach").evaluate(
      (select) => [...select.selectedOptions].map((option) => option.value),
    ), { message: "Contract creator must be selected immediately after opening" }).toEqual([account.id]);
    await page.locator("#hd-so").fill(`${runId}/HD`);
    await page.locator("#hd-ten").fill(`Hợp đồng ${runId}`);
    await page.locator("#hd-ngayky").fill("2026-01-03");
    await page.locator("#hd-chudautuid").selectOption(`${runId}-owner`, { force: true });
    await page.locator("#hd-nhathauid").selectOption(`${runId}-contractor`, { force: true });
    await page.locator("#hd-giatri").fill("450000000");
    await page.locator("#hd-loai").selectOption({ label: "Trọn gói" }, { force: true });
    await page.locator("#hd-phanloai").selectOption({ label: "Khác" }, { force: true });
    await page.locator("#hd-songay").fill("90 ngày");
    await page.locator("#hd-coqdchidinh").selectOption({ value: "0" }, { force: true });
    await page.locator("#hd-kehoachid").selectOption(planId, { force: true });
    await page.locator(`input[name="hd-goithau-checkbox"][value="${packageId}"]`).check();
    const contractAssigneeState = await page.locator("#hd-nhanvienphutrach").evaluate((select) => ({
      options: [...select.options].map((option) => ({ value: option.value, selected: option.selected })),
      disabled: select.disabled,
    }));
    await expect.poll(() => page.locator("#hd-nhanvienphutrach").evaluate(
      (select) => [...select.selectedOptions].map((option) => option.value),
    ), { message: JSON.stringify(contractAssigneeState) }).toEqual([account.id]);
    await page.locator("#hd-trangthai-hopdong").selectOption({ label: "Đang thực hiện" }, { force: true });
    const invalidContractFields = await page.locator("#form-hopdong").evaluate((form) => (
      [...form.querySelectorAll(":invalid")].map((field) => ({
        id: field.id, value: field.value, message: field.validationMessage,
      }))
    ));
    expect(invalidContractFields, "Contract form must be valid before waiting for persistence").toEqual([]);
    const contractSaved = page.waitForResponse((result) => (
      new URL(result.url()).pathname === "/api/sync" && result.request().method() === "POST"
      && result.request().postDataJSON()?.hopdong?.some((item) => item.soHopDong === `${runId}/HD`)
    ));
    await page.locator("#form-hopdong button[type='submit']").click();
    const contractResponse = await contractSaved.catch(async (error) => {
      const diagnostic = await page.evaluate(() => ({
        url: location.pathname,
        formPresent: Boolean(document.getElementById("form-hopdong")),
        submitState: document.getElementById("form-hopdong")?.dataset.submitState || "",
        invalid: [...document.querySelectorAll("#form-hopdong :invalid")].map((field) => ({
          id: field.id, value: field.value, message: field.validationMessage,
        })),
        dialog: document.getElementById("modal-custom-dialog")?.innerText || "",
        toasts: [...document.querySelectorAll(".bf-toast")].map((toast) => toast.innerText),
        contractor: document.getElementById("hd-nhathauid")?.value,
        contractorVersion: document.getElementById("hd-nhathau-version-select")?.value,
      }));
      throw new Error(`Contract create did not reach canonical response: ${JSON.stringify(diagnostic)}`, { cause: error });
    });
    expect(contractResponse.ok(), await contractResponse.text()).toBe(true);
    await expect(page.locator("#modal-hopdong.active")).toBeHidden();
    const contractId = contractResponse.request().postDataJSON().hopdong.find((item) => item.soHopDong === `${runId}/HD`).id;
    expect(fixture("verify_assignments", payload).assignments.filter(
      (item) => item.type === "hopdong" && item.targetId === contractId,
    )).toEqual([{ type: "hopdong", targetId: contractId, empId: account.id }]);
    await page.reload({ waitUntil: "commit" });
    await ready(page);
    await page.locator("#search-hopdong").fill(`${runId}/HD`);
    await expect(page.locator("#hopdong-table tbody tr").filter({ hasText: `${runId}/HD` })).toBeVisible();
  } finally {
    await page.context().clearCookies();
    fixture("cleanup", payload);
  }
});
