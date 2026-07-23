import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { switchTab } from "../../frontend/app/BiddingControllerUI.js";
import { setAppController } from "../../frontend/app/controllerRef.js";
import { resolvePostEvaluationTargetTab } from "../../frontend/packages/bidEvaluationActions.js";
import { saveThongTinMoThau } from "../../frontend/packages/BidProcessWorkflow.js";
import {
  commitPackageAwardDecision,
  commitPackageResultEditState,
} from "../../frontend/packages/packageEvaluationProgress.js";
import { collectOpeningBidsFromRows } from "../../frontend/packages/bidProcessOpeningData.js";
import {
  handlePhatHanhHsmtSubmit,
  moThauGoiThau,
} from "../../frontend/packages/bidProcessTenderLifecycle.js";
import { buildPackageTabs } from "../../frontend/packages/detail/PackageTabs.js";
import {
  resolvePackageDetailState,
  selectPackageDetailTab,
} from "../../frontend/packages/detail/PackageDetailState.js";


test("workflow tab targets survive package-version canonicalization after sync", () => {
  const previousPackageId = "pkg-v1";
  const latestPackageId = "pkg-v2";
  const model = {
    getLatestPackage: () => ({ id: latestPackageId }),
  };
  const scenarios = [
    {
      targetTab: "opening",
      pkg: {
        id: latestPackageId,
        trangThai: "Đã mở thầu",
        phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
        hinhThucLuaChon: "Đấu thầu rộng rãi",
      },
    },
    {
      targetTab: "eval_tech",
      pkg: {
        id: latestPackageId,
        trangThai: "Đang chấm thầu",
        phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
        hinhThucLuaChon: "Đấu thầu rộng rãi",
      },
    },
    {
      targetTab: "result",
      pkg: {
        id: latestPackageId,
        trangThai: "Đang chấm thầu",
        phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
        hinhThucLuaChon: "Đấu thầu rộng rãi",
        danhGiaHsdtMetadata: JSON.stringify({ saved: true }),
      },
    },
  ];

  scenarios.forEach(({ targetTab, pkg }) => {
    const view = {};
    const selectedPackageId = selectPackageDetailTab(
      view,
      targetTab,
      previousPackageId,
      model,
    );
    const { tabs } = buildPackageTabs(pkg, []);
    const detailState = resolvePackageDetailState({
      tabs,
      currentTab: view._currentWorkflowTab,
      currentPackageId: view._currentWorkflowPackageId,
      packageId: latestPackageId,
    });

    assert.equal(selectedPackageId, latestPackageId);
    assert.equal(detailState.activeTab, targetTab);
  });
});


test("a saved selected-lot 1G1T report advances to its scoped result", () => {
  assert.equal(resolvePostEvaluationTargetTab({
    isTwoEnvelope: false,
    currentEvaluationTab: "technical",
    savedPartialScope: true,
    qualifiedBidCount: 1,
  }), "result");
});


test("evaluation save captures detail context before rendering and syncs one atomic batch", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/bidEvaluationActions.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /const isPackageDetailContext = this\.view\.isGoiThauDetailTabActive\(\);/);
  assert.match(source, /persistAndSync\(this, \["goithau", "thongtinmothau"\]\)/);
  assert.match(source, /if \(isPackageDetailContext\) \{/);
  assert.doesNotMatch(source, /await this\.model\.persistData\("goithau"\);/);
});


test("award approval always uses the application controller for server sync", async () => {
  const persisted = [];
  let syncCalls = 0;
  const applicationController = {
    model: {
      state: { goithau: [{}], thongtinmothau: [{}] },
      persistData: async (table) => persisted.push(table),
    },
    autoSync: async () => {
      syncCalls += 1;
      return { ok: true };
    },
  };
  setAppController(applicationController);
  try {
    const result = await commitPackageAwardDecision({
      model: applicationController.model,
    });
    assert.equal(result.ok, true);
  } finally {
    setAppController(null);
  }

  assert.equal(syncCalls, 1);
  assert.deepEqual(persisted, ["goithau", "thongtinmothau"]);
});

test("award approval refreshes the result only after the successful sync", async () => {
  const events = [];
  const applicationController = {
    model: {
      useServerSidePagination: false,
      state: { goithau: [{}], thongtinmothau: [{}] },
      persistData: async (table) => events.push(`persist:${table}`),
    },
    autoSync: async () => {
      events.push("sync");
      return { ok: true };
    },
  };

  await commitPackageAwardDecision(applicationController, {
    afterPersist: async () => events.push("refresh"),
  });

  assert.deepEqual(events, [
    "persist:goithau",
    "persist:thongtinmothau",
    "sync",
    "refresh",
  ]);
});

test("starting or cancelling result editing persists the package status and refreshes dashboard data", async () => {
  const events = [];
  const packageRecord = { id: "pkg-1", trangThai: "Đang chấm thầu" };
  const applicationController = {
    model: {
      state: { goithau: [{}] },
      updateRecord: async (table, record) => events.push(`update:${table}:${record.id}`),
      persistData: async (table) => events.push(`persist:${table}`),
    },
    autoSync: async () => {
      events.push("sync");
      return { ok: true };
    },
  };

  await commitPackageResultEditState(applicationController, {
    packageRecord,
    afterPersist: async () => events.push("refresh"),
  });

  assert.deepEqual(events, [
    "update:goithau:pkg-1",
    "persist:goithau",
    "sync",
    "refresh",
  ]);
});


test("package workflow tabs reuse the dashboard card top accent treatment", async () => {
  const coordinatorSource = await readFile(
    new URL("../../frontend/packages/detail/PackageDetailCoordinator.js", import.meta.url),
    "utf8",
  );
  const cssSource = await readFile(
    new URL("../../views/css/views.css", import.meta.url),
    "utf8",
  );
  const dashboardCssSource = await readFile(
    new URL("../../views/css/ui-redesign.css", import.meta.url),
    "utf8",
  );

  assert.match(coordinatorSource, /class="btn package-workflow-tab \$\{active \? "active" : ""\}"/);
  assert.match(dashboardCssSource, /\.dashboard-work-grid \.dashboard-card\s*\{[\s\S]*?border-top:\s*3px solid transparent;[\s\S]*?border-top-color:\s*var\(--brand\)/);
  assert.match(cssSource, /\.package-workflow-tab\s*\{[\s\S]*?border:\s*1px solid transparent;[\s\S]*?border-radius:\s*11px 11px 0 0/);
  assert.match(cssSource, /\.package-workflow-tab\.active\s*\{[\s\S]*?border-color:\s*transparent;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*inset 0 3px 0 var\(--brand\)/);
  assert.doesNotMatch(cssSource, /\.package-workflow-tab\s*\{[\s\S]*?border-top:\s*3px solid transparent/);
  assert.doesNotMatch(cssSource, /\.package-workflow-tab\.active::after\s*\{/);
  assert.doesNotMatch(cssSource, /border-bottom-right-radius:\s*18px 8px/);
  assert.doesNotMatch(cssSource, /border-bottom-left-radius:\s*18px 8px/);
});


test("award result form initializes Lucide icons immediately after rendering", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/detail/AwardResultDetailsPanel.js", import.meta.url),
    "utf8",
  );
  const renderMarker = "contentWrapper.innerHTML = trustedHTML(approvalPanel.html);";
  const renderIndex = source.indexOf(renderMarker);
  const bindIndex = source.indexOf("bindOfficialResultEditActions();", renderIndex);

  assert.notEqual(renderIndex, -1);
  assert.notEqual(bindIndex, -1);
  assert.match(
    source.slice(renderIndex, bindIndex),
    /window\.lucide\.createIcons\(\{ root: contentWrapper \}\)/,
  );
});


test("controller navigation waits for package-detail rendering", async () => {
  let finishRender;
  const renderTask = new Promise((resolve) => {
    finishRender = resolve;
  });
  const originalDocument = globalThis.document;
  const originalHistory = globalThis.history;
  const originalWindow = globalThis.window;
  const controller = {
    _workflowModulesReady: true,
    lazyTabPartials: {},
    routeMap: {},
    actionMap: {},
    model: {
      state: { activetab: "goithau", activeaction: null },
      hasActiveEffectiveRole: () => true,
    },
    view: {
      areViewModulesReady: () => true,
      elements: { pageTitle: {} },
    },
    renderTabData: () => renderTask,
  };

  globalThis.document = {
    getElementById: () => ({}),
    querySelectorAll: () => [],
  };
  globalThis.history = { pushState: () => {} };
  globalThis.window = { location: { pathname: "/goithau" } };

  try {
    const navigation = switchTab.call(controller, "goithau-detail", "pkg-1", false);
    assert.equal(navigation, renderTask);
    finishRender();
    await navigation;
  } finally {
    globalThis.document = originalDocument;
    globalThis.history = originalHistory;
    globalThis.window = originalWindow;
  }
});


test("issuing HSMT targets the invitation tab with the latest package version", async () => {
  const pkg = {
    id: "pkg-v1",
    rootId: "pkg-root",
    phienBan: "00",
    tenGoiThau: "Gói thử nghiệm",
    linhVuc: "Hàng hóa",
    phanLo: "Không",
    trangThai: "Chuẩn bị",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  };
  let latestPkg = null;
  const model = {
    state: { goithau: [pkg] },
    persistData: async () => {},
    convertDMYToYMD: (value) => value,
    convertDMYHMSToYMDHMS: (value) => value,
    getLatestPackage(packageId) {
      const requested = this.state.goithau.find((item) => item.id === packageId);
      const rootId = requested?.rootId || requested?.id;
      return this.state.goithau
        .filter((item) => (item.rootId || item.id) === rootId)
        .sort((left, right) => Number.parseInt(right.phienBan, 10) - Number.parseInt(left.phienBan, 10))[0];
    },
  };
  const form = {};
  const originalDocument = globalThis.document;
  const renderedStates = [];
  const view = {
    _currentWorkflowTab: "preparation",
    _currentWorkflowPackageId: pkg.id,
    validateForm: () => true,
    getPhathanhHsmtFormData: () => ({
      id: pkg.id,
      maGoiThauVal: "IB-E2E",
      hieuLucHsdtVal: 90,
      giaTriDamBaoVal: 10_000_000,
      soQuyetDinh: "01/QĐ-E2E",
      thoiGianDangTai: "22/07/2026 10:00",
      thoiGianDongThau: "24/07/2026 09:00",
      ngayQuyetDinh: "22/07/2026",
      soToTrinhHsmt: "01/TTr-E2E",
      ngayTrinhHsmt: "22/07/2026",
      yeuCauThamDinhHsmt: "Không",
      soBaoCaoThamDinhHsmt: "",
      ngayBaoCaoThamDinhHsmt: "",
      phanLoRows: [],
    }),
    customConfirm: async () => true,
    customAlert: async () => {},
    closeModal: () => {},
    showPackageDetails: async (renderedPackageId) => renderedStates.push({
      tab: view._currentWorkflowTab,
      packageId: view._currentWorkflowPackageId,
      renderedPackageId,
    }),
  };

  globalThis.document = {
    getElementById: (id) => (id === "form-phathanh-hsmt" ? form : null),
  };

  try {
    await handlePhatHanhHsmtSubmit.call({
      model,
      view,
      autoSync: async () => {
        latestPkg = { ...pkg, id: "pkg-v2", phienBan: "01", isLatest: 1 };
        model.state.goithau.push(latestPkg);
        return { ok: true };
      },
    }, { preventDefault() {} });
  } finally {
    globalThis.document = originalDocument;
  }

  assert.equal(pkg.trangThai, "Đang mời thầu");
  assert.deepEqual(renderedStates, [{
    tab: "opening",
    packageId: latestPkg.id,
    renderedPackageId: latestPkg.id,
  }]);
});


test("opening a package targets the opening-minutes workflow tab immediately", async () => {
  const pkg = {
    id: "pkg-1",
    rootId: "pkg-1",
    phienBan: "00",
    tenGoiThau: "Gói thử nghiệm",
    trangThai: "Đang mời thầu",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  };
  let latestPkg = null;
  let openingController;
  const openingPersistDeferral = [];
  const model = {
    state: { goithau: [pkg] },
    persistData: async () => {
      openingPersistDeferral.push(Boolean(openingController?._deferImmediateSync));
    },
    formatDateWithTime: (value) => value,
    getLatestPackage(packageId) {
      const requested = this.state.goithau.find((item) => item.id === packageId);
      const rootId = requested?.rootId || requested?.id;
      return this.state.goithau
        .filter((item) => (item.rootId || item.id) === rootId)
        .sort((left, right) => Number.parseInt(right.phienBan, 10) - Number.parseInt(left.phienBan, 10))[0];
    },
  };
  let finishSuccessAlert;
  const successAlertTask = new Promise((resolve) => {
    finishSuccessAlert = resolve;
  });
  const view = {
    _currentWorkflowTab: "preparation",
    _currentWorkflowPackageId: "",
    customPrompt: async () => "22/07/2026 12:10",
    customAlert: () => successAlertTask,
    renderGoiThauTable: () => {},
  };
  const switched = [];

  openingController = {
    model,
    view,
    autoSync: async () => {
      latestPkg = { ...pkg, id: "pkg-2", phienBan: "01", isLatest: 1 };
      model.state.goithau.push(latestPkg);
      return { ok: true };
    },
    switchTab: (...args) => switched.push(args),
  };
  const openingTask = moThauGoiThau.call(openingController, pkg.id);

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(pkg.trangThai, "Đã mở thầu");
  assert.equal(latestPkg.trangThai, "Đã mở thầu");
  assert.equal(view._currentWorkflowTab, "opening");
  assert.equal(view._currentWorkflowPackageId, latestPkg.id);
  assert.deepEqual(switched, [["goithau-detail", latestPkg.id]]);
  assert.deepEqual(openingPersistDeferral, [true]);
  finishSuccessAlert();
  await openingTask;
});


test("saving opening minutes targets the evaluation tab with the matching package context", async () => {
  const pkg = {
    id: "pkg-1",
    rootId: "pkg-1",
    phienBan: "00",
    tenGoiThau: "Gói thử nghiệm",
    trangThai: "Đã mở thầu",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  };
  let latestPkg = null;
  let saveOpeningController;
  const saveOpeningPersistDeferral = [];
  const model = {
    state: { goithau: [pkg], thongtinmothau: [], nhathau: [] },
    getCurrentDateTimeString: () => "2026-07-22T12:10:00",
    getLatestNhaThau: () => [],
    parseVND: () => 0,
    persistData: async () => {
      saveOpeningPersistDeferral.push(Boolean(saveOpeningController?._deferImmediateSync));
    },
    formatDateWithTime: (value) => value,
    getLatestPackage(packageId) {
      const requested = this.state.goithau.find((item) => item.id === packageId);
      const rootId = requested?.rootId || requested?.id;
      return this.state.goithau
        .filter((item) => (item.rootId || item.id) === rootId)
        .sort((left, right) => Number.parseInt(right.phienBan, 10) - Number.parseInt(left.phienBan, 10))[0];
    },
  };
  const select = { value: pkg.id };
  const detailPane = { classList: { contains: (name) => name === "active" } };
  const originalDocument = globalThis.document;
  const renderedStates = [];
  let finishSuccessAlert;
  const successAlertTask = new Promise((resolve) => {
    finishSuccessAlert = resolve;
  });
  const view = {
    _currentWorkflowTab: "opening",
    _currentWorkflowPackageId: "stale-package",
    _editingState: {},
    customAlert: () => successAlertTask,
    renderGoiThauTable: () => {},
    showPackageDetails: async (renderedPackageId) => renderedStates.push({
      tab: view._currentWorkflowTab,
      packageId: view._currentWorkflowPackageId,
      renderedPackageId,
    }),
  };

  globalThis.document = {
    getElementById(id) {
      if (id === "mothau-goithau-select") return select;
      if (id === "tab-goithau-detail") return detailPane;
      return null;
    },
    querySelectorAll: () => [],
  };

  try {
    saveOpeningController = {
      model,
      view,
      renderMoThauPanel: () => {},
      autoSync: async () => {
        latestPkg = { ...pkg, id: "pkg-2", phienBan: "01", isLatest: 1 };
        model.state.goithau.push(latestPkg);
          return { ok: true };
        },
    };
    const saveOpeningTask = saveThongTinMoThau.call(saveOpeningController);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(renderedStates, [{
      tab: "eval_tech",
      packageId: latestPkg.id,
      renderedPackageId: latestPkg.id,
    }]);
    assert.deepEqual(saveOpeningPersistDeferral, [true, true]);
    finishSuccessAlert();
    await saveOpeningTask;
  } finally {
    globalThis.document = originalDocument;
  }

  assert.equal(pkg.trangThai, "Đang chấm thầu");
});


test("collecting an existing opening bid preserves its server row version", () => {
  const existingBid = {
    id: "bid-1",
    goiThauId: "pkg-1",
    nhaThauId: "contractor-1",
    rowVersion: 7,
  };
  const contractor = {
    id: "contractor-1",
    maNhaThau: "NT-01",
    tenNhaThau: "Nha thau 01",
    loaiNhaThau: "Độc lập",
  };
  const values = new Map([
    [".mt-ma-nha-thau", "NT-01"],
    [".mt-ten-nha-thau", "Nha thau 01"],
    [".mt-loai-nha-thau", "Độc lập"],
    [".mt-ma-phan-lo", ""],
    [".mt-ten-phan-lo", ""],
    [".mt-ma-dinh-danh", "NT-01"],
    [".mt-gia-du-thau", "900000000"],
    [".mt-ty-le-giam-gia", "0"],
    [".mt-gia-sau-giam-gia", "900000000"],
    [".mt-hieu-luc-hsdt, .mt-hieu-luc-hsdxt", "90"],
    [".mt-gia-tri-dam-bao, .mt-dam-bao-du-thau", "10000000"],
    [".mt-hieu-luc-bao-dam-ngay, .mt-hieu-luc-dam-bao", "120"],
    [".mt-thoi-gian-thuc-hien", "60 ngày"],
    [".mt-thoi-gian-thuc-hien-hop-dong", ""],
  ]);
  const row = {
    dataset: { contractorVersionId: contractor.id },
    getAttribute: (name) => name === "data-id" ? existingBid.id : null,
    querySelector: (selector) => values.has(selector) ? { value: values.get(selector) } : null,
  };
  const model = {
    state: {
      goithau: [{ id: "pkg-1" }],
      thongtinmothau: [existingBid],
      nhathau: [contractor],
    },
    getLatestNhaThau: () => [contractor],
    parseVND: (value) => Number(value || 0),
    persistData: () => {},
  };

  const [collected] = collectOpeningBidsFromRows({
    rows: [row],
    gtId: "pkg-1",
    model,
    isDirectOrSpecial: false,
  });

  assert.equal(collected.rowVersion, 7);
});


test("new opening rows never derive a bid price from the package price", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/BidProcessWorkflow.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /bidData\.giaDuThau\s*\|\|\s*gt\.giaGoiThau/);
  assert.doesNotMatch(
    source,
    /mt-gia-du-thau[^\n]+value="\$\{this\.model\.formatVND\(bidData\.giaDuThau\)\s*\|\|\s*defaultLotPrice\}/,
  );
});


test("choosing a lot never copies the estimated lot value into bid price", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/BidProcessWorkflow.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /giaInput\.value\s*=\s*this\.model\.formatVND\(chosenLot\.giaTriPhanLo\)/,
  );
});


test("award-result import never invents bid prices from the package estimate", async () => {
  const source = await readFile(
    new URL("../../frontend/documents/excelSaveAdapters.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /giaDuThau:\s*goiThau\.giaGoiThau/);
  assert.doesNotMatch(source, /giaSauGiamGia:\s*goiThau\.giaGoiThau/);
});


test("partial-lot evaluation disables generic Excel actions and always creates an official batch", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/BidEvaluationWorkflow.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /isPartialEvaluationLotScope/);
  assert.match(source, /btn-danhgiahsdt-download-excel/);
  assert.match(source, /btn-danhgiahsdt-import-excel/);

  const saveSource = await readFile(
    new URL("../../frontend/packages/bidEvaluationActions.js", import.meta.url),
    "utf8",
  );
  assert.match(saveSource, /evaluationBatch = await ensureEvaluationLotBatch/);
  assert.doesNotMatch(saveSource, /Lưu nháp đợt phần lô/);
});


test("lot packages show an explicit whole-package or selected-lots evaluation choice", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/detail/EvaluationPanel.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /id="danhgiahsdt-scope-container"/);
  assert.match(source, /Đánh giá toàn bộ phần lô/);
  assert.match(source, /Đánh giá một hoặc nhiều phần lô/);
  assert.match(source, /id="danhgiahsdt-lot-options"/);
});
