import { expect, test } from "@playwright/test";

const DETAILED_EVALUATION_FIXTURE = Object.freeze({
  package: {
    id: "e2e-package-detailed-evaluation",
    rootId: "e2e-package-detailed-evaluation",
    isLatest: true,
    phienBan: "01",
    maGoiThau: "E2E-BCDG-1G1T",
    tenGoiThau: "Gói kiểm thử báo cáo đánh giá chi tiết",
    linhVuc: "Hàng hóa",
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    phanLo: "Không",
    danhGiaHsdtMetadata: null,
  },
  bid: {
    id: "e2e-opening-detailed-evaluation",
    goiThauId: "e2e-package-detailed-evaluation",
    nhaThauId: "e2e-contractor-detailed-evaluation",
    tenNhaThau: "Nhà thầu kiểm thử E2E",
    loaiNhaThau: "Độc lập",
    baoCaoDanhGiaChiTietList: [],
  },
});

function requiredCredentials() {
  const username = process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin";
  const password = process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("E2E_PASSWORD or ADMIN_PASSWORD must be configured.");
  }
  return { username, password };
}

function captureRuntimeFailures(page) {
  const appOrigin = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").origin;
  const isApplicationUrl = (url) => {
    try {
      return new URL(url).origin === appOrigin;
    } catch {
      return true;
    }
  };
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      if (location.url && !isApplicationUrl(location.url)) return;
      failures.push(`console: ${message.text()} @ ${location.url || "unknown"}:${location.lineNumber || 0}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && isApplicationUrl(response.url())) {
      failures.push(`http: ${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (!isApplicationUrl(request.url())) return;
    const failure = request.failure()?.errorText || "unknown";
    failures.push(`requestfailed: ${request.method()} ${request.url()} (${failure})`);
  });
  return failures;
}

function appendUnique(items, record) {
  return [...(Array.isArray(items) ? items.filter((item) => String(item?.id) !== record.id) : []), record];
}

async function installDetailedEvaluationFixture(page) {
  const fixturePackage = { ...DETAILED_EVALUATION_FIXTURE.package };
  const fixtureBid = { ...DETAILED_EVALUATION_FIXTURE.bid };

  await page.route("**/api/get-all-data?**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.useServerSidePagination = true;
    payload.paginatedKeys = [...new Set([...(payload.paginatedKeys || []), "goithau"])];
    payload.referenceData = payload.referenceData || {};
    payload.referenceData.goithau = appendUnique(payload.referenceData.goithau, fixturePackage);
    payload.thongtinmothau = appendUnique(payload.thongtinmothau, fixtureBid);
    payload.recordManifest = payload.recordManifest || {};
    payload.recordManifest.goithau = [...new Set([...(payload.recordManifest.goithau || []), fixturePackage.id])];
    payload.recordManifest.thongtinmothau = [...new Set([...(payload.recordManifest.thongtinmothau || []), fixtureBid.id])];
    await route.fulfill({ response, json: payload });
  });

  await page.route("**/api/paginate?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("table") !== "goithau") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        items: [fixturePackage],
        totalItems: 1,
        nextCursor: null,
        hasMore: false,
      },
    });
  });
}

async function login(page) {
  const { username, password } = requiredCredentials();
  const loginResponse = await page.request.post("/api/auth/login", {
    data: { username, password, remember: false },
  });
  expect(loginResponse.status()).toBe(200);
  const loginPayload = await loginResponse.json();
  const initialSyncResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/get-all-data"
      && url.searchParams.get("include_summary") === "1";
  });
  const startedAt = Date.now();
  await page.goto("/tong-quan-admin", { waitUntil: "domcontentloaded" });
  expect((await initialSyncResponse).status()).toBe(200);
  expect(loginPayload.effective_roles).toContain("super_admin");
  await expect(page.locator("body")).toHaveAttribute("data-active-role", "super_admin");
  await expect(page.locator("#tab-superadmin-dashboard")).toHaveClass(/active/);
  await expect(page.locator("#initial-route-loading-state")).toBeHidden();
  return { loginToDashboardMs: Date.now() - startedAt };
}

async function switchToManager(page) {
  await page.locator("#header-profile-trigger").click();
  const roleButton = page.locator('.dropdown-role-btn[data-switch-role="manager"]');
  await expect(roleButton).toBeVisible();
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/tong-quan"),
    roleButton.click(),
  ]);
  await expect(page.locator("body")).toHaveAttribute("data-active-role", "manager");
  await expect(page.locator("#tab-dashboard")).toHaveClass(/active/);
  await expect(page.locator("#system-init-loader")).toBeHidden();
  await expect(page.locator("#initial-route-loading-state")).toBeHidden();
}

test("doanh thu lần đầu khớp sau khi chuyển tab", async ({ page }, testInfo) => {
  const runtimeFailures = captureRuntimeFailures(page);
  const metrics = await login(page);
  const revenue = page.locator("#sad-stat-revenue");
  await expect(revenue).toBeVisible();
  await expect(revenue).not.toHaveText("");
  const initialRevenue = (await revenue.textContent()).trim();

  const switchStartedAt = Date.now();
  await page.locator("#btn-tab-superadmin").click();
  await expect(page.locator("#tab-superadmin")).toHaveClass(/active/);
  await page.locator("#btn-tab-superadmin-dashboard").click();
  await expect(page.locator("#tab-superadmin-dashboard")).toHaveClass(/active/);
  const revenueAfterTabSwitch = (await revenue.textContent()).trim();
  metrics.superAdminTabRoundTripMs = Date.now() - switchStartedAt;
  metrics.initialRevenue = initialRevenue;
  metrics.revenueAfterTabSwitch = revenueAfterTabSwitch;

  expect(revenueAfterTabSwitch).toBe(initialRevenue);
  expect(runtimeFailures).toEqual([]);
  await testInfo.attach("browser-metrics.json", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
  });
});

test("mở báo cáo chi tiết hiển thị bảng và hai cách cấu hình", async ({ page }, testInfo) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await installDetailedEvaluationFixture(page);
  const metrics = await login(page);
  await switchToManager(page);

  const [packagesResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/paginate" && url.searchParams.get("table") === "goithau";
    }),
    page.locator("#btn-tab-goithau").click(),
  ]);
  expect(packagesResponse.status()).toBe(200);
  await expect(page.locator("#page-title")).toHaveText("Danh sách Gói thầu");
  await expect(page.locator("#tab-goithau")).toHaveClass(/active/);
  const firstPackageAction = page.locator('#goithau-table tbody [data-bf-action="show-package"]').first();
  await expect(firstPackageAction).toBeVisible();

  const packageStartedAt = Date.now();
  await firstPackageAction.click();
  await expect(page.locator("#tab-goithau-detail")).toHaveClass(/active/);
  const evaluationTab = page.locator('[data-workflow-tab="eval_tech"]');
  await expect(evaluationTab).toBeVisible();
  await evaluationTab.click();
  const evaluationPanel = page.locator("#detail-workflow-content-wrapper #danhgiahsdt-summary-view");
  await expect(evaluationPanel).toBeVisible();
  const detailButton = evaluationPanel.locator("#btn-danhgiahsdt-detail");
  await expect(detailButton).toBeVisible();
  metrics.packageToEvaluationMs = Date.now() - packageStartedAt;

  const detailStartedAt = Date.now();
  await detailButton.click();
  const detailPanel = page.locator("#detail-workflow-content-wrapper #danhgiahsdt-detail-view .detailed-evaluation-panel");
  await expect(detailPanel).toBeVisible();
  metrics.openDetailedEvaluationMs = Date.now() - detailStartedAt;

  await expect(page.locator("#btn-detailed-evaluation-add-row")).toBeVisible();
  await expect(page.locator("#btn-detailed-evaluation-import-excel")).toBeVisible();
  await expect(page.locator(".detailed-evaluation-table thead")).toBeVisible();
  const criterionRows = page.locator("#detailed-evaluation-criteria-body tr");
  metrics.criteriaRows = await criterionRows.count();
  expect(metrics.criteriaRows).toBe(0);
  await expect(page.locator("#btn-detailed-evaluation-back")).toBeVisible();
  expect(runtimeFailures).toEqual([]);

  await testInfo.attach("browser-metrics.json", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
  });
});
