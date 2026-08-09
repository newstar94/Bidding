import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { createE2ETestClock } from "./e2e_test_clock.mjs";
import { isExpectedTelemetryBackpressure } from "./lib/e2eHttpErrors.mjs";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const testClock = createE2ETestClock();
const runId = `pairwise-${Date.now()}`;
const organizationId = `${runId}-org`;
const password = `Aa!9${randomBytes(12).toString("hex")}`;
const account = {
  id: `${runId}-manager-id`,
  username: `${runId}-manager`,
  email: `${runId}-manager@example.test`,
  name: `Pairwise manager ${runId}`,
};
const fixturePayload = { runId, organizationId, password, account };
const cases = [
  ["01", "Hàng hóa", "Đấu thầu rộng rãi", "Một giai đoạn một túi hồ sơ", "Giá thấp nhất", false],
  ["02", "Hàng hóa", "Đấu thầu hạn chế", "Một giai đoạn một túi hồ sơ", "Giá đánh giá", true],
  ["03", "Hàng hóa", "Đấu thầu rộng rãi", "Một giai đoạn hai túi hồ sơ", "Kết hợp giữa kỹ thuật và giá", false],
  ["04", "Hàng hóa", "Đấu thầu hạn chế", "Một giai đoạn hai túi hồ sơ", "Dựa trên kỹ thuật", true],
  ["05", "Xây lắp", "Đấu thầu rộng rãi", "Hai giai đoạn một túi hồ sơ", "Giá thấp nhất", false],
  ["06", "Xây lắp", "Đấu thầu hạn chế", "Hai giai đoạn hai túi hồ sơ", "Giá đánh giá", true],
  ["07", "Tư vấn", "Đấu thầu rộng rãi", "Một giai đoạn hai túi hồ sơ", "Kết hợp giữa kỹ thuật và giá", false],
  ["08", "Tư vấn", "Đấu thầu hạn chế", "Một giai đoạn hai túi hồ sơ", "Giá cố định", true],
  ["09", "Phi tư vấn", "Chào hàng cạnh tranh", "Một giai đoạn một túi hồ sơ", "Giá thấp nhất", true],
  ["10", "Phi tư vấn", "Đấu thầu rộng rãi", "Một giai đoạn hai túi hồ sơ", "Giá đánh giá", false],
  ["11", "Hỗn hợp", "Đấu thầu hạn chế", "Hai giai đoạn hai túi hồ sơ", "Dựa trên kỹ thuật", true],
  ["12", "Hỗn hợp", "Đấu thầu rộng rãi", "Hai giai đoạn một túi hồ sơ", "Giá đánh giá", false],
  ["13", "Hàng hóa", "Chỉ định thầu", "Một giai đoạn một túi hồ sơ", "Giá thấp nhất", false],
  ["14", "Xây lắp", "Chỉ định thầu rút gọn", "Không có", "", true],
  ["15", "Hỗn hợp", "Lựa chọn nhà thầu trong trường hợp đặc biệt", "Không có", "", false],
].map(([id, field, form, procedure, method, lots]) => ({ id, field, form, procedure, method, lots }));

function fixture(action) {
  const execution = spawnSync(
    process.env.PYTHON || "python",
    ["scripts/package_pairwise_fixture.py", action],
    {
      cwd: process.cwd(), env: process.env, input: JSON.stringify(fixturePayload),
      encoding: "utf8", windowsHide: true,
    },
  );
  if (execution.status !== 0) throw new Error(`Fixture ${action} failed: ${execution.stderr || execution.stdout}`);
  return JSON.parse(execution.stdout || "{}");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false" && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}

const select = (page, selector, label) => page.locator(selector).selectOption({ label }, { force: true });

async function createPackage(page, testCase, httpErrors) {
  await page.goto(`${baseURL}/goi-thau`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#btn-add-goithau").click();
  const modal = page.locator("#modal-goithau.active");
  await modal.waitFor({ state: "visible", timeout: 10_000 });
  const code = `${runId}-PKG-${testCase.id}`;
  const title = `Pairwise ${testCase.id} ${runId}`;
  await page.locator("#gt-ma").fill(code);
  await page.locator("#gt-kehoachid").selectOption({ index: 1 }, { force: true });
  await page.locator("#gt-ten").fill(title);
  await page.locator("#gt-gia").fill("500000000");
  await page.locator("#gt-thoigian").fill("90 ngày");
  await select(page, "#gt-linhvuc", testCase.field);
  await select(page, "#gt-hinhthuc", testCase.form);
  if (!await page.locator("#gt-phuongthuc").isDisabled()) {
    await select(page, "#gt-phuongthuc", testCase.procedure);
  } else {
    assert(await page.locator("#gt-phuongthuc").inputValue() === testCase.procedure, `${testCase.id}: wrong forced procedure`);
  }
  if (testCase.method) {
    const methodOptions = await page.locator("#gt-phuongphapdanhgia option").allTextContents();
    assert(methodOptions.includes(testCase.method), `${testCase.id}: method ${testCase.method} unavailable: ${methodOptions}`);
    await select(page, "#gt-phuongphapdanhgia", testCase.method);
    if (testCase.method === "Kết hợp giữa kỹ thuật và giá") {
      await page.locator("#gt-trongsokythuat").fill(testCase.field === "Tư vấn" ? "70" : "30");
    }
  } else {
    assert(await page.locator("#gt-phuongphapdanhgia-container").isHidden(), `${testCase.id}: evaluation method should be hidden`);
  }
  await select(page, "#gt-phanlo", testCase.lots ? "Có" : "Không");
  if (testCase.lots) {
    while (await page.locator("#phanlo-tbody tr").count() < 2) await page.locator("#btn-them-phanlo").click();
    for (let index = 0; index < 2; index += 1) {
      const row = page.locator("#phanlo-tbody tr").nth(index);
      await row.locator(".pl-code-input").fill(`${testCase.id}-L${index + 1}`);
      await row.locator(".pl-name-input").fill(`Lô ${index + 1} - ${testCase.id}`);
      await row.locator(".pl-price-input").fill("250000000");
      await row.locator(".pl-duration-input").fill("90 ngày");
    }
  }
  await page.locator("#gt-nguonvon").fill("Ngân sách nhà nước");
  await page.locator("#gt-thoigiantochuc").fill("45 ngày");
  await page.locator("#gt-thoigianbatdautochuc").fill(testClock.quarter());
  await page.locator("#gt-nhanvienphutrach").selectOption({ index: 1 }, { force: true });

  const expertSectionVisible = await page.locator("#to-chuyengia-section").isVisible();
  if (expertSectionVisible) await page.locator('#to-chuyengia-tbody input[name="tochuyengia-select"]').first().check();
  const appraisalSectionVisible = await page.locator("#to-thamdinh-section").isVisible();
  if (appraisalSectionVisible) await page.locator('#to-thamdinh-tbody input[name="tothamdinh-select"]').nth(1).check();

  await page.locator("#form-goithau button[type='submit']").click();
  try {
    await modal.waitFor({ state: "hidden", timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      invalid: [...document.querySelectorAll("#form-goithau :invalid")].map((element) => ({ id: element.id, value: element.value })),
      dialog: document.getElementById("modal-custom-dialog")?.innerText || "",
      formText: document.getElementById("form-goithau")?.innerText?.slice(0, 1200) || "",
    }));
    throw new Error(`${testCase.id}: package modal did not close: ${JSON.stringify(diagnostics)}; HTTP=${JSON.stringify(httpErrors)}; ${error.message}`);
  }
  await page.locator("#search-goithau").fill(title);
  await page.getByText(title, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
}

let browser;
let fixtureCreated = false;
try {
  fixture("setup");
  fixtureCreated = true;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const pageErrors = [];
  const httpErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("response", async (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")
      && !isExpectedTelemetryBackpressure(response)) {
      let body = "";
      try { body = await response.text(); } catch {}
      httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()} ${body}`);
    }
  });
  await page.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#login-username").fill(account.username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById("auth-overlay")).display === "none", null, { timeout: 20_000 });

  for (const testCase of cases) {
    await createPackage(page, testCase, httpErrors);
    process.stdout.write(`[PAIRWISE] PKG-${testCase.id}\n`);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  const database = fixture("verify");
  assert(database.count === cases.length, `Expected ${cases.length} packages, got ${database.count}`);
  for (const testCase of cases) {
    const actual = database.packages.find((item) => item.title === `Pairwise ${testCase.id} ${runId}`);
    assert(actual, `PKG-${testCase.id} missing from PostgreSQL: ${JSON.stringify(database.packages)}`);
    assert(actual.code === `${runId}-PKG-${testCase.id}`.toUpperCase(), `PKG-${testCase.id}: code mismatch ${JSON.stringify(actual)}`);
    assert(actual.field === testCase.field, `PKG-${testCase.id}: field mismatch`);
    assert(actual.form === testCase.form, `PKG-${testCase.id}: form mismatch`);
    assert(actual.procedure === testCase.procedure, `PKG-${testCase.id}: procedure mismatch`);
    assert(actual.method === testCase.method, `PKG-${testCase.id}: method mismatch ${JSON.stringify(actual)}`);
    assert(actual.lot === (testCase.lots ? "Có" : "Không"), `PKG-${testCase.id}: lot flag mismatch`);
    assert(actual.lotCount === (testCase.lots ? 2 : 0), `PKG-${testCase.id}: lot count mismatch`);
  }
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(" | ")}`);
  assert(httpErrors.length === 0, `HTTP errors: ${httpErrors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify({ runId, packages: database.count, cases: database.packages }, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
  if (fixtureCreated) process.stdout.write(`[PAIRWISE] fixture-removed ${JSON.stringify(fixture("cleanup"))}\n`);
}
