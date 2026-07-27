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
    if (failure === "net::ERR_ABORTED") return;
    failures.push(`requestfailed: ${request.method()} ${request.url()} (${failure})`);
  });
  return failures;
}

function appendUnique(items, record) {
  return [...(Array.isArray(items) ? items.filter((item) => String(item?.id) !== record.id) : []), record];
}

function appendUniqueMany(items, records) {
  const recordIds = new Set(records.map((record) => String(record.id)));
  return [
    ...(Array.isArray(items) ? items.filter((item) => !recordIds.has(String(item?.id))) : []),
    ...records,
  ];
}

async function installDetailedEvaluationFixture(page, {
  bidCount = 1,
  criteriaCount = 0,
  scenarios = [],
} = {}) {
  const fixturePackages = scenarios.length
    ? scenarios.map((scenario) => ({
      ...DETAILED_EVALUATION_FIXTURE.package,
      ...scenario.package,
      rootId: scenario.package.id,
    }))
    : [{ ...DETAILED_EVALUATION_FIXTURE.package }];
  const fixtureBids = scenarios.length
    ? scenarios.map((scenario, index) => ({
      ...DETAILED_EVALUATION_FIXTURE.bid,
      ...scenario.bid,
      id: `e2e-matrix-bid-${index + 1}`,
      goiThauId: scenario.package.id,
      nhaThauId: `e2e-matrix-contractor-${index + 1}`,
      tenNhaThau: `Nhà thầu ma trận ${String(index + 1).padStart(2, "0")}`,
    }))
    : Array.from({ length: bidCount }, (_, index) => ({
      ...DETAILED_EVALUATION_FIXTURE.bid,
      id: `${DETAILED_EVALUATION_FIXTURE.bid.id}-${index + 1}`,
      nhaThauId: `${DETAILED_EVALUATION_FIXTURE.bid.nhaThauId}-${index + 1}`,
      tenNhaThau: `Nhà thầu kiểm thử E2E ${String(index + 1).padStart(3, "0")}`,
    }));
  if (!scenarios.length && criteriaCount > 0) {
    const criteria = Array.from({ length: criteriaCount }, (_, index) => ({
      id: `c${index + 1}`,
      stt: String(index + 1),
      name: `TC ${index + 1}`,
      group: "validity",
      resultType: "pass_fail",
      source: "custom",
    }));
    fixturePackages[0].danhGiaHsdtMetadata = JSON.stringify({ criteria });
    fixtureBids.forEach((bid) => {
      bid.baoCaoDanhGiaChiTietList = [{
        id: `e2e-report-${bid.id}`,
        goiThauId: fixturePackages[0].id,
        thongTinMoThauId: bid.id,
        loaiVong: "single",
        trangThai: "draft",
        chiTietList: criteria.map((criterion) => ({
          id: `e2e-row-${bid.id}-${criterion.id}`,
          tieuChiDanhGiaId: criterion.id,
          ketQua: "pending",
        })),
      }];
    });
  }

  await page.route("**/api/get-all-data?**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.useServerSidePagination = true;
    payload.paginatedKeys = [...new Set([...(payload.paginatedKeys || []), "goithau"])];
    payload.referenceData = payload.referenceData || {};
    payload.referenceData.goithau = appendUniqueMany(payload.referenceData.goithau, fixturePackages);
    payload.thongtinmothau = appendUniqueMany(payload.thongtinmothau, fixtureBids);
    payload.recordManifest = payload.recordManifest || {};
    payload.recordManifest.goithau = [
      ...new Set([...(payload.recordManifest.goithau || []), ...fixturePackages.map((pkg) => pkg.id)]),
    ];
    payload.recordManifest.thongtinmothau = [
      ...new Set([...(payload.recordManifest.thongtinmothau || []), ...fixtureBids.map((bid) => bid.id)]),
    ];
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
        items: fixturePackages,
        totalItems: fixturePackages.length,
        nextCursor: null,
        hasMore: false,
      },
    });
  });
}

async function installContractorScaleFixture(page, contractorCount) {
  const contractors = Array.from({ length: contractorCount }, (_, index) => ({
    id: `e2e-scale-contractor-${index + 1}`,
    rootId: `e2e-scale-contractor-${index + 1}`,
    isLatest: true,
    phienBan: "01",
    ngayApDung: "2026-07-27",
    maNhaThau: `NT-${String(index + 1).padStart(6, "0")}`,
    tenNhaThau: `Nhà thầu quy mô ${String(index + 1).padStart(6, "0")}`,
    tenVietTat: `NT${index + 1}`,
    maSoThue: String(10_000_000_000 + index),
    loaiNhaThau: "Độc lập",
    nguoiDaiDien: `Đại diện ${index + 1}`,
    soDienThoai: "0900000000",
    email: `contractor-${index + 1}@example.test`,
    soTaiKhoan: String(1_000_000_000 + index),
    noiMoTaiKhoan: "Ngân hàng kiểm thử",
  }));

  await page.route("**/api/get-all-data?**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.useServerSidePagination = true;
    payload.paginatedKeys = [...new Set([...(payload.paginatedKeys || []), "nhathau"])];
    payload.nhathau = [];
    payload.referenceData = payload.referenceData || {};
    payload.referenceData.nhathau = contractors.map((contractor) => ({
      id: contractor.id,
      rootId: contractor.rootId,
      isLatest: contractor.isLatest,
      phienBan: contractor.phienBan,
      ngayApDung: contractor.ngayApDung,
      maNhaThau: contractor.maNhaThau,
      tenNhaThau: contractor.tenNhaThau,
      maSoThue: contractor.maSoThue,
      loaiNhaThau: contractor.loaiNhaThau,
      referenceOnly: true,
    }));
    payload.recordManifest = payload.recordManifest || {};
    payload.recordManifest.nhathau = contractors.map((contractor) => contractor.id);
    await route.fulfill({ response, json: payload });
  });

  await page.route("**/api/paginate?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("table") !== "nhathau") {
      await route.continue();
      return;
    }
    const pageNumber = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") || 10));
    const start = (pageNumber - 1) * pageSize;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        items: contractors.slice(start, start + pageSize),
        totalItems: contractors.length,
        nextCursor: null,
        hasMore: start + pageSize < contractors.length,
      },
    });
  });

  return Buffer.byteLength(JSON.stringify(contractors), "utf8");
}

const PACKAGE_WORKFLOW_MATRIX = Object.freeze([
  {
    package: {
      id: "e2e-matrix-consulting-1g1t",
      maGoiThau: "E2E-TV-1G1T",
      tenGoiThau: "Tư vấn một giai đoạn một túi",
      linhVuc: "Tư vấn",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
    },
    expectedGroups: ["Tính hợp lệ", "Kỹ thuật", "Tài chính"],
  },
  {
    package: {
      id: "e2e-matrix-goods-process-1",
      maGoiThau: "E2E-HH-QT1",
      tenGoiThau: "Hàng hóa quy trình một",
      linhVuc: "Hàng hóa",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      quyTrinhDanhGia: "quytrinh1",
      phuongPhapDanhGia: "Giá thấp nhất",
    },
    expectedGroups: ["Tính hợp lệ", "Năng lực và kinh nghiệm", "Kỹ thuật", "Tài chính"],
  },
  {
    package: {
      id: "e2e-matrix-construction-process-2",
      maGoiThau: "E2E-XL-QT2",
      tenGoiThau: "Xây lắp quy trình hai phân lô",
      linhVuc: "Xây lắp",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      quyTrinhDanhGia: "quytrinh2",
      phanLo: "Có",
      phuongPhapDanhGia: "Giá thấp nhất",
    },
    bid: { loaiNhaThau: "Liên danh", maPhanLo: "L01", tenPhanLo: "Lô 01" },
    expectedGroups: ["Tính hợp lệ", "Năng lực và kinh nghiệm", "Kỹ thuật"],
  },
  {
    package: {
      id: "e2e-matrix-mixed-1g2t",
      maGoiThau: "E2E-HH-1G2T",
      tenGoiThau: "Hỗn hợp một giai đoạn hai túi",
      linhVuc: "Hỗn hợp",
      phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
      phanLo: "Có",
      phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
    },
    bid: { maPhanLo: "L02", tenPhanLo: "Lô 02" },
    expectedGroups: ["Tính hợp lệ", "Năng lực và kinh nghiệm", "Kỹ thuật"],
  },
  {
    package: {
      id: "e2e-matrix-non-consulting",
      maGoiThau: "E2E-PTV-1G1T",
      tenGoiThau: "Phi tư vấn một giai đoạn một túi",
      linhVuc: "Phi tư vấn",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      phuongPhapDanhGia: "Kỹ thuật",
    },
    expectedGroups: ["Tính hợp lệ", "Năng lực và kinh nghiệm", "Kỹ thuật", "Tài chính"],
  },
  {
    package: {
      id: "e2e-matrix-goods-1g2t",
      maGoiThau: "E2E-HH-1G2T",
      tenGoiThau: "Hàng hóa một giai đoạn hai túi",
      linhVuc: "Hàng hóa",
      phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
      phuongPhapDanhGia: "Giá thấp nhất",
    },
    expectedGroups: ["Tính hợp lệ", "Năng lực và kinh nghiệm", "Kỹ thuật"],
  },
  {
    package: {
      id: "e2e-matrix-consulting-1g2t",
      maGoiThau: "E2E-TV-1G2T",
      tenGoiThau: "Tư vấn một giai đoạn hai túi",
      linhVuc: "Tư vấn",
      phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
      phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
    },
    expectedGroups: ["Tính hợp lệ", "Kỹ thuật"],
  },
]);

async function installLongTaskObserver(page) {
  await page.addInitScript(() => {
    window.__biddingflowE2ELongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          window.__biddingflowE2ELongTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        });
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Chromium without Long Tasks support still reports navigation and DOM metrics.
    }
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
  await expect(page.locator("#tab-superadmin-dashboard")).toHaveCount(1);
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

test("ma trận loại gói và phương thức mở đúng nhóm báo cáo chi tiết", async ({ page }, testInfo) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await installDetailedEvaluationFixture(page, { scenarios: PACKAGE_WORKFLOW_MATRIX });
  await login(page);
  await switchToManager(page);
  await page.locator("#btn-tab-goithau").click();
  await expect(page.locator("#tab-goithau")).toHaveClass(/active/);

  const observed = [];
  for (const scenario of PACKAGE_WORKFLOW_MATRIX) {
    const packageAction = page.locator(
      `#goithau-table tbody [data-bf-action="show-package"][data-id="${scenario.package.id}"]`,
    ).first();
    await expect(packageAction).toBeVisible();
    await packageAction.click();
    await expect(page.locator("#tab-goithau-detail")).toHaveClass(/active/);

    const evaluationTab = page.locator('[data-workflow-tab="eval_tech"]');
    await expect(evaluationTab).toBeVisible();
    await evaluationTab.click();
    const detailButton = page.locator("#danhgiahsdt-summary-view #btn-danhgiahsdt-detail");
    const detailPanel = page.locator("#danhgiahsdt-detail-view .detailed-evaluation-panel");
    const openedDetailedWithoutRequest = await detailPanel.isVisible();
    expect(openedDetailedWithoutRequest).toBe(false);
    await expect(detailButton).toBeVisible();
    await detailButton.click();
    await expect(detailPanel).toBeVisible();
    const groupLabels = await detailPanel
      .locator("[data-detailed-evaluation-group]")
      .allTextContents();
    expect(groupLabels.map((value) => value.trim())).toEqual(scenario.expectedGroups);
    await expect(detailPanel.locator("#btn-detailed-evaluation-add-row")).toBeVisible();
    await expect(detailPanel.locator("#btn-detailed-evaluation-import-excel")).toBeVisible();
    observed.push({
      packageId: scenario.package.id,
      field: scenario.package.linhVuc,
      method: scenario.package.phuongThucLuaChon,
      process: scenario.package.quyTrinhDanhGia || "quytrinh1",
      lot: scenario.package.phanLo,
      bidderType: scenario.bid?.loaiNhaThau || "Độc lập",
      openedDetailedWithoutRequest,
      groups: groupLabels.map((value) => value.trim()),
    });

    await page.locator("#btn-tab-goithau").click();
    await expect(page.locator("#tab-goithau")).toHaveClass(/active/);
  }

  expect(runtimeFailures).toEqual([]);
  await testInfo.attach("business-workflow-matrix.json", {
    body: Buffer.from(JSON.stringify(observed, null, 2)),
    contentType: "application/json",
  });
});

test("production resource graph tách bidding và partner workflows theo route", async ({ page }, testInfo) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await installDetailedEvaluationFixture(page);
  await login(page);
  await switchToManager(page);

  await page.evaluate(() => performance.clearResourceTimings());
  await page.locator("#btn-tab-goithau").click();
  const packageAction = page.locator(
    `#goithau-table tbody [data-bf-action="show-package"][data-id="${DETAILED_EVALUATION_FIXTURE.package.id}"]`,
  ).first();
  await expect(packageAction).toBeVisible();
  await packageAction.click();
  await expect(page.locator("#tab-goithau-detail")).toHaveClass(/active/);
  const biddingTrace = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => new URL(entry.name).origin === location.origin && /\.js(?:\?|$)/i.test(entry.name))
      .map((entry) => ({
        name: entry.name,
        durationMs: Math.round(entry.duration * 10) / 10,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
      }));
    return {
      resourceCount: resources.length,
      transferSize: resources.reduce((sum, entry) => sum + entry.transferSize, 0),
      encodedBodySize: resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      decodedBodySize: resources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
      maxDurationMs: Math.round(Math.max(0, ...resources.map((entry) => entry.durationMs)) * 10) / 10,
      resources,
    };
  });
  expect(biddingTrace.resources.some((entry) => /BiddingWorkflows/i.test(entry.name))).toBe(true);
  expect(biddingTrace.resources.some((entry) => /PartnerWorkflows/i.test(entry.name))).toBe(false);

  await page.locator("#btn-tab-nhathau").click();
  await expect(page.locator("#tab-nhathau")).toHaveClass(/active/);
  await page.evaluate(() => performance.clearResourceTimings());
  await page.locator("#btn-add-nhathau").click();
  await expect(page.locator("#modal-nhathau")).toHaveClass(/active/);
  const partnerTrace = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => new URL(entry.name).origin === location.origin && /\.js(?:\?|$)/i.test(entry.name))
      .map((entry) => ({
        name: entry.name,
        durationMs: Math.round(entry.duration * 10) / 10,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
      }));
    return {
      resourceCount: resources.length,
      transferSize: resources.reduce((sum, entry) => sum + entry.transferSize, 0),
      encodedBodySize: resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      decodedBodySize: resources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
      maxDurationMs: Math.round(Math.max(0, ...resources.map((entry) => entry.durationMs)) * 10) / 10,
      resources,
    };
  });
  expect(partnerTrace.resources.some((entry) => /PartnerWorkflows/i.test(entry.name))).toBe(true);
  expect(partnerTrace.resources.some((entry) => /BiddingWorkflows/i.test(entry.name))).toBe(false);

  expect(runtimeFailures).toEqual([]);
  await testInfo.attach("route-workflow-resources.json", {
    body: Buffer.from(JSON.stringify({ biddingTrace, partnerTrace }, null, 2)),
    contentType: "application/json",
  });
});

test("đo render báo cáo chi tiết với 500 tiêu chí", async ({ page }, testInfo) => {
  const runtimeFailures = captureRuntimeFailures(page);
  await installLongTaskObserver(page);
  await installDetailedEvaluationFixture(page, { criteriaCount: 500 });
  await login(page);
  await switchToManager(page);
  await page.locator("#btn-tab-goithau").click();
  const packageAction = page.locator(
    `#goithau-table tbody [data-bf-action="show-package"][data-id="${DETAILED_EVALUATION_FIXTURE.package.id}"]`,
  ).first();
  await expect(packageAction).toBeVisible();
  await packageAction.click();
  const evaluationTab = page.locator('[data-workflow-tab="eval_tech"]');
  await expect(evaluationTab).toBeVisible();
  await evaluationTab.click();
  const detailButton = page.locator("#danhgiahsdt-summary-view #btn-danhgiahsdt-detail");
  await expect(detailButton).toBeVisible();
  const detailStartedAt = await page.evaluate(() => performance.now());
  await detailButton.click();
  const rows = page.locator("#detailed-evaluation-criteria-body tr[data-detailed-criterion-id]");
  await expect(rows).toHaveCount(500);
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  const metrics = await page.evaluate((startedAt) => {
    const tasks = (window.__biddingflowE2ELongTasks || []).filter(
      (entry) => entry.startTime >= startedAt,
    );
    return {
      criteriaCount: document.querySelectorAll(
        "#detailed-evaluation-criteria-body tr[data-detailed-criterion-id]",
      ).length,
      detailOpenMs: Math.round(performance.now() - startedAt),
      domNodeCount: document.getElementsByTagName("*").length,
      longTaskCount: tasks.length,
      longTaskTotalMs: Math.round(tasks.reduce((sum, entry) => sum + entry.duration, 0)),
      longestTaskMs: Math.round(Math.max(0, ...tasks.map((entry) => entry.duration))),
      usedJsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  }, detailStartedAt);
  expect(metrics.criteriaCount).toBe(500);
  expect(runtimeFailures).toEqual([]);
  await testInfo.attach("detailed-evaluation-500-criteria-metrics.json", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
  });
});

for (const bidCount of [10, 100, 500]) {
  test(`đo render bảng đánh giá với ${bidCount} nhà thầu`, async ({ page }, testInfo) => {
    const runtimeFailures = captureRuntimeFailures(page);
    await installLongTaskObserver(page);
    await installDetailedEvaluationFixture(page, { bidCount });
    const metrics = await login(page);
    await switchToManager(page);

    const renderStartedAt = Date.now();
    await page.locator("#btn-tab-goithau").click();
    await expect(page.locator("#tab-goithau")).toHaveClass(/active/);
    const packageAction = page.locator('#goithau-table tbody [data-bf-action="show-package"]').first();
    await expect(packageAction).toBeVisible();
    await packageAction.click();
    const evaluationTab = page.locator('[data-workflow-tab="eval_tech"]');
    await expect(evaluationTab).toBeVisible();
    await evaluationTab.click();

    const evaluationRows = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]");
    await expect(evaluationRows).toHaveCount(bidCount);
    await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    metrics.bidCount = bidCount;
    metrics.packageListToEvaluationMs = Date.now() - renderStartedAt;
    Object.assign(metrics, await page.evaluate(() => {
      const longTasks = window.__biddingflowE2ELongTasks || [];
      const memory = performance.memory;
      return {
        domNodeCount: document.getElementsByTagName("*").length,
        longTaskCount: longTasks.length,
        longTaskTotalMs: Math.round(longTasks.reduce((sum, entry) => sum + entry.duration, 0)),
        longestTaskMs: Math.round(Math.max(0, ...longTasks.map((entry) => entry.duration))),
        usedJsHeapBytes: memory?.usedJSHeapSize ?? null,
      };
    }));

    Object.assign(metrics, await page.evaluate(async () => {
      const technicalInput = document.querySelector(
        "#danhgiahsdt-table-tbody tr[data-bid-id] .mt-dg-ky-thuat",
      );
      if (!technicalInput) {
        return {
          inputToRankingMs: null,
          interactionLongTaskCount: null,
          interactionLongTaskTotalMs: null,
          interactionLongestTaskMs: null,
        };
      }
      const observed = window.__biddingflowE2ELongTasks || [];
      const firstNewLongTask = observed.length;
      const startedAt = performance.now();
      technicalInput.value = technicalInput.value === "99" ? "98" : "99";
      technicalInput.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const interactionTasks = observed.slice(firstNewLongTask);
      return {
        inputToRankingMs: Math.round(performance.now() - startedAt),
        interactionLongTaskCount: interactionTasks.length,
        interactionLongTaskTotalMs: Math.round(
          interactionTasks.reduce((sum, entry) => sum + entry.duration, 0),
        ),
        interactionLongestTaskMs: Math.round(
          Math.max(0, ...interactionTasks.map((entry) => entry.duration)),
        ),
      };
    }));

    expect(runtimeFailures).toEqual([]);
    await testInfo.attach("browser-scale-metrics.json", {
      body: Buffer.from(JSON.stringify(metrics, null, 2)),
      contentType: "application/json",
    });
  });
}

for (const contractorCount of [100, 1_000, 5_000]) {
  test(`đo bootstrap và bảng với ${contractorCount} nhà thầu`, async ({ page }, testInfo) => {
    const runtimeFailures = captureRuntimeFailures(page);
    await installLongTaskObserver(page);
    const fixtureBytes = await installContractorScaleFixture(page, contractorCount);
    const metrics = await login(page);
    const switchStartedAt = Date.now();
    await switchToManager(page);
    metrics.switchToManagerMs = Date.now() - switchStartedAt;

    const tableStartedAt = Date.now();
    const paginatedResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/paginate"
        && url.searchParams.get("table") === "nhathau";
    });
    await page.locator("#btn-tab-nhathau").click();
    expect((await paginatedResponse).status()).toBe(200);
    await expect(page.locator("#tab-nhathau")).toHaveClass(/active/);
    const rows = page.locator("#nhathau-table tbody tr");
    await expect(rows).toHaveCount(10);

    metrics.contractorCount = contractorCount;
    metrics.fixtureBytes = fixtureBytes;
    metrics.contractorTabMs = Date.now() - tableStartedAt;
    Object.assign(metrics, await page.evaluate(() => {
      const longTasks = window.__biddingflowE2ELongTasks || [];
      return {
        renderedContractorRows: document.querySelectorAll("#nhathau-table tbody tr").length,
        domNodeCount: document.getElementsByTagName("*").length,
        longTaskCount: longTasks.length,
        longTaskTotalMs: Math.round(longTasks.reduce((sum, entry) => sum + entry.duration, 0)),
        longestTaskMs: Math.round(Math.max(0, ...longTasks.map((entry) => entry.duration))),
        usedJsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      };
    }));

    await page.unrouteAll({ behavior: "wait" });
    expect(metrics.renderedContractorRows).toBe(10);
    expect(runtimeFailures).toEqual([]);
    await testInfo.attach("contractor-scale-metrics.json", {
      body: Buffer.from(JSON.stringify(metrics, null, 2)),
      contentType: "application/json",
    });
  });
}
