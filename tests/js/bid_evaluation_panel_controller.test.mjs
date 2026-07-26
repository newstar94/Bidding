import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { bindBidEvaluationPanelController } from "../../frontend/packages/BidEvaluationPanelController.js";
import { buildBidEvaluationPanelState } from "../../frontend/packages/BidEvaluationPanelState.js";

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
    };
    this._innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.readOnly = false;
    this.children = [];
    this.selectors = new Map();
    this.selectorLists = new Map();
  }

  set className(value) {
    this.classes = new Set(String(value || "").split(/\s+/).filter(Boolean));
  }

  get className() {
    return [...this.classes].join(" ");
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "disabled") this.disabled = true;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "disabled") this.disabled = false;
  }

  querySelector(selector) {
    return this.selectors.get(selector) || null;
  }

  querySelectorAll(selector) {
    return this.selectorLists.get(selector) || [];
  }

  appendChild(child) {
    this.children.push(child);
  }
}

function withDomSupport(run) {
  const originalElement = globalThis.Element;
  const originalDocument = globalThis.document;
  const originalSupported = DOMPurify.isSupported;
  const originalSanitize = DOMPurify.sanitize;
  globalThis.Element = FakeElement;
  globalThis.document = {
    querySelector: () => ({ sheet: { insertRule() {} } }),
    createElement: () => new FakeElement(),
  };
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
    return run();
  } finally {
    globalThis.Element = originalElement;
    globalThis.document = originalDocument;
    DOMPurify.isSupported = originalSupported;
    DOMPurify.sanitize = originalSanitize;
  }
}

function createElements() {
  const elements = Object.fromEntries([
    "danhgiahsdt-quytrinh-container",
    "danhgiahsdt-tabs-header",
    "tab-btn-hsdxt-kt",
    "tab-btn-hsdxt-tc",
    "danhgiahsdt-so-baocao",
    "danhgiahsdt-ngay-baocao",
    "danhgiahsdt-ngay-moi-doichieu",
    "danhgiahsdt-ngay-doichieu",
    "danhgiahsdt-fields-row",
    "btn-danhgiahsdt-save",
    "btn-add-cv-lamro",
    "btn-add-cv-traloi",
    "btn-add-cv-guicdt",
    "btn-danhgiahsdt-import-excel",
    "btn-danhgiahsdt-download-excel",
    "list-cv-lamro",
    "list-cv-traloi",
    "list-cv-guicdt",
  ].map((id) => [id, new FakeElement()]));
  const processOne = new FakeElement();
  const processTwo = new FakeElement();
  const preference = new FakeElement();
  const warning = new FakeElement();
  const processContainer = elements["danhgiahsdt-quytrinh-container"];
  processContainer.selectors.set('input[value="quytrinh1"]', processOne);
  processContainer.selectors.set('input[value="quytrinh2"]', processTwo);
  processContainer.selectors.set("#eval-co-uu-dai", preference);
  processContainer.selectors.set("#quytrinh2-warning-msg", warning);
  const extraFields = [new FakeElement(), new FakeElement()];
  elements["danhgiahsdt-fields-row"].selectorLists.set(".evaluation-extra-field", extraFields);
  return { elements, extraFields, preference, processOne, processTwo, warning };
}

function createApp(elements, bids = []) {
  const persisted = [];
  let renders = 0;
  let saves = 0;
  return {
    app: {
      currentDanhGiaTab: "technical",
      model: {
        state: { thongtinmothau: bids },
        formatForDateInput: (value) => `date:${value}`,
        persistData: (table) => persisted.push(table),
      },
      view: {
        _editingState: {},
        getActiveElement: (id) => elements[id] || null,
        isGoiThauDetailTabActive: () => false,
      },
      renderDanhGiaHsdtPanel: () => { renders += 1; },
      saveDanhGiaHsdt: () => { saves += 1; },
    },
    persisted,
    renderCount: () => renders,
    saveCount: () => saves,
  };
}

function packageRecord(overrides = {}) {
  return {
    id: "pkg-1",
    linhVuc: "Hàng hóa",
    phanLo: "Không",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    phuongPhapDanhGia: "Giá thấp nhất",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: "{}",
    ...overrides,
  };
}

test("process controls apply to construction and mixed packages too", () => withDomSupport(() => {
  ["Xây lắp", "Hỗn hợp"].forEach((linhVuc) => {
    const controls = createElements();
    const appContext = createApp(controls.elements);
    const pkg = packageRecord({ linhVuc });
    const panelState = buildBidEvaluationPanelState({ pkg });
    let rerenders = 0;
    bindBidEvaluationPanelController({
      appController: appContext.app,
      pkg,
      panelState,
      onRerender: () => { rerenders += 1; },
    });

    assert.equal(controls.processTwo.disabled, false, linhVuc);
    controls.processTwo.onchange();
    assert.equal(pkg.quyTrinhDanhGia, "quytrinh2", linhVuc);
    assert.equal(JSON.parse(pkg.danhGiaHsdtMetadata).quyTrinhDanhGia, "quytrinh2", linhVuc);
    assert.equal(rerenders, 1, linhVuc);
  });
}));

test("an ineligible process-two selection falls back once and explains why", async () => withDomSupport(async () => {
  const controls = createElements();
  const appContext = createApp(controls.elements, [
    { goiThauId: "pkg-1", giaDuThau: 100 },
    { goiThauId: "pkg-1", giaDuThau: 100 },
  ]);
  const pkg = packageRecord({ quyTrinhDanhGia: "quytrinh2" });
  const panelState = buildBidEvaluationPanelState({ pkg });
  let rerenders = 0;
  bindBidEvaluationPanelController({
    appController: appContext.app,
    pkg,
    panelState,
    onRerender: () => { rerenders += 1; },
  });
  await Promise.resolve();

  assert.equal(controls.processTwo.disabled, true);
  assert.equal(controls.processOne.checked, true);
  assert.equal(pkg.quyTrinhDanhGia, "quytrinh1");
  assert.match(controls.warning.textContent, /cùng xếp thứ nhất về giá/);
  assert.deepEqual(appContext.persisted, ["goithau"]);
  assert.equal(rerenders, 1);
}));

test("financial tab is enabled only after technical evaluation and emits one rerender", () => withDomSupport(() => {
  const controls = createElements();
  const appContext = createApp(controls.elements);
  const pkg = packageRecord({
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true },
      financial: { saved: false },
    }),
  });
  const panelState = buildBidEvaluationPanelState({ pkg });
  let rerenders = 0;
  bindBidEvaluationPanelController({
    appController: appContext.app,
    pkg,
    panelState,
    onRerender: () => { rerenders += 1; },
  });

  const financial = controls.elements["tab-btn-hsdxt-tc"];
  assert.equal(financial.disabled, false);
  financial.onclick();
  assert.equal(appContext.app.currentDanhGiaTab, "financial");
  assert.equal(rerenders, 1);
}));

test("completed report exposes edit while an editable report invokes save", () => withDomSupport(() => {
  const completedControls = createElements();
  const completedApp = createApp(completedControls.elements);
  const completedPackage = packageRecord({
    danhGiaHsdtMetadata: JSON.stringify({ saved: true, soBaoCao: "01/BC" }),
  });
  bindBidEvaluationPanelController({
    appController: completedApp.app,
    pkg: completedPackage,
    panelState: buildBidEvaluationPanelState({ pkg: completedPackage }),
    onRerender() {},
  });
  const editButton = completedControls.elements["btn-danhgiahsdt-save"];
  assert.match(String(editButton.innerHTML), /Chỉnh sửa/);
  editButton.onclick();
  assert.equal(completedApp.app.view._editingState.eval_tech, true);
  assert.equal(completedApp.renderCount(), 1);

  const editableControls = createElements();
  const editableApp = createApp(editableControls.elements);
  const editablePackage = packageRecord();
  bindBidEvaluationPanelController({
    appController: editableApp.app,
    pkg: editablePackage,
    panelState: buildBidEvaluationPanelState({ pkg: editablePackage }),
    onRerender() {},
  });
  const saveButton = editableControls.elements["btn-danhgiahsdt-save"];
  assert.match(String(saveButton.innerHTML), /Lưu thông tin đánh giá/);
  saveButton.onclick();
  assert.equal(editableApp.saveCount(), 1);
}));

test("report fields and Excel actions follow read-only state", () => withDomSupport(() => {
  const controls = createElements();
  const appContext = createApp(controls.elements);
  const pkg = packageRecord({
    danhGiaHsdtMetadata: JSON.stringify({
      saved: true,
      soBaoCao: "03/BC",
      ngayBaoCao: "2026-07-26",
      ngayMoiDoiChieu: "2026-07-27",
      ngayDoiChieu: "2026-07-28",
    }),
  });
  bindBidEvaluationPanelController({
    appController: appContext.app,
    pkg,
    panelState: buildBidEvaluationPanelState({ pkg }),
    onRerender() {},
  });

  assert.equal(controls.elements["danhgiahsdt-so-baocao"].value, "03/BC");
  assert.equal(controls.elements["danhgiahsdt-ngay-baocao"].value, "date:2026-07-26");
  assert.equal(controls.elements["danhgiahsdt-ngay-moi-doichieu"].disabled, true);
  assert.equal(controls.elements["danhgiahsdt-ngay-doichieu"].disabled, true);
  assert.equal(controls.elements["btn-add-cv-lamro"].onclick instanceof Function, true);
  assert.equal(controls.elements["btn-danhgiahsdt-import-excel"].classes.size > 0, true);
}));
