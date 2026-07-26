import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { setCommandExecutor } from "../../frontend/app/commandBus.js";
import { createBidEvaluationRankingController } from "../../frontend/packages/BidEvaluationRankingController.js";
import { renderBidEvaluationRows } from "../../frontend/packages/BidEvaluationRowRenderer.js";
import { buildBidEvaluationTablePresentation } from "../../frontend/packages/BidEvaluationTablePresentation.js";
import { getJvData } from "../../frontend/packages/jvDataStore.js";

function stripMarkup(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
    };
    this.listeners = new Map();
    this._children = [];
    this._innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.readOnly = false;
    this.selectionStart = 0;
    this.ownerDocument = null;
  }

  set className(value) {
    this.classes = new Set(String(value || "").split(/\s+/).filter(Boolean));
  }

  get className() {
    return [...this.classes].join(" ");
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.textContent = stripMarkup(this._innerHTML);
    this._children = [];
    const source = this._innerHTML;
    const tagPattern = /<(input|select|span|td|a)\b([^>]*)>/gi;
    let match;
    while ((match = tagPattern.exec(source))) {
      const [, tagName, attributeSource] = match;
      const child = new FakeElement(tagName);
      child.ownerDocument = this.ownerDocument;
      const attributePattern = /([\w:-]+)="([^"]*)"/g;
      let attribute;
      while ((attribute = attributePattern.exec(attributeSource))) {
        child.setAttribute(attribute[1], attribute[2]);
      }
      if (/\bdisabled\b/i.test(attributeSource)) child.setAttribute("disabled", "");
      if (/\breadonly\b/i.test(attributeSource)) child.readOnly = true;
      if (tagName.toLowerCase() === "select") {
        const closeIndex = source.indexOf("</select>", tagPattern.lastIndex);
        const body = closeIndex < 0 ? "" : source.slice(tagPattern.lastIndex, closeIndex);
        const selected = /<option\s+value="([^"]*)"[^>]*\bselected\b/i.exec(body);
        child.value = selected?.[1] || "";
      } else if (tagName.toLowerCase() !== "input") {
        const closingTag = `</${tagName.toLowerCase()}>`;
        const closeIndex = source.toLowerCase().indexOf(closingTag, tagPattern.lastIndex);
        if (closeIndex >= 0) child.textContent = stripMarkup(source.slice(tagPattern.lastIndex, closeIndex));
      }
      this._children.push(child);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  get children() {
    return this._children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = value;
    if (name === "value") this.value = String(value);
    if (name === "disabled") this.disabled = true;
  }

  getAttribute(name) {
    return this.attributes.get(name) || "";
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "disabled") this.disabled = false;
  }

  appendChild(child) {
    child.ownerDocument = this.ownerDocument;
    this._children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    const emitted = {
      preventDefault() {},
      target: this,
      ...event,
    };
    (this.listeners.get(type) || []).forEach((listener) => listener(emitted));
  }

  setSelectionRange() {}

  matches(selector) {
    const className = /^\.([\w-]+)$/.exec(selector)?.[1];
    return className ? this.classes.has(className) : false;
  }

  descendants() {
    return this._children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (selector === "tr[data-bid-id]") {
      return this._children.filter(
        (child) => child.tagName === "TR" && child.attributes.has("data-bid-id"),
      );
    }
    const classNames = [...String(selector).matchAll(/\.([\w-]+)/g)].map((entry) => entry[1]);
    if (!classNames.length) return [];
    return this.descendants().filter(
      (element) => classNames.some((className) => element.classes.has(className)),
    );
  }
}

function createFakeDocument() {
  const document = {
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = document;
      return element;
    },
    querySelector() {
      return { sheet: { insertRule() {} } };
    },
  };
  return document;
}

function withDomSupport(run) {
  const originalElement = globalThis.Element;
  const originalDocument = globalThis.document;
  const originalSupported = DOMPurify.isSupported;
  const originalSanitize = DOMPurify.sanitize;
  const document = createFakeDocument();
  globalThis.Element = FakeElement;
  globalThis.document = document;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
    return run(document);
  } finally {
    setCommandExecutor(null);
    globalThis.Element = originalElement;
    globalThis.document = originalDocument;
    DOMPurify.isSupported = originalSupported;
    DOMPurify.sanitize = originalSanitize;
  }
}

function createRoot(document) {
  const root = new FakeElement("tbody");
  root.ownerDocument = document;
  return root;
}

function createModel(contractors = []) {
  return {
    state: { nhathau: contractors },
    formatVND: (value) => String(value ?? ""),
    parseVND: (value) => Number(String(value || "0").replace(/[^0-9.-]/g, "")) || 0,
  };
}

function basePackage(overrides = {}) {
  return {
    id: "pkg-1",
    linhVuc: "Hàng hóa",
    phanLo: "Không",
    phuongPhapDanhGia: "Giá thấp nhất",
    ...overrides,
  };
}

function baseBid(overrides = {}) {
  return {
    id: "bid-1",
    goiThauId: "pkg-1",
    nhaThauId: "contractor-1",
    loaiNhaThau: "Độc lập",
    maNhaThau: "NT01",
    tenNhaThau: "Nhà thầu A",
    danhGiaHopLe: "Đạt",
    danhGiaNangLuc: "Đạt",
    danhGiaKyThuat: "Đạt",
    ...overrides,
  };
}

test("editable 1G1T rows expose every evaluation and clarification control", () => withDomSupport((document) => {
  const root = createRoot(document);
  let rankingChanges = 0;
  const pkg = basePackage();
  const [row] = renderBidEvaluationRows({
    root,
    pkg,
    bids: [baseBid()],
    model: createModel(),
    presentation: buildBidEvaluationTablePresentation({ pkg }),
    onRankingChange: () => { rankingChanges += 1; },
  });

  [
    ".mt-dg-hop-le",
    ".mt-lam-ro-hop-le",
    ".mt-dg-nang-luc",
    ".mt-lam-ro-nang-luc",
    ".mt-dg-ky-thuat",
    ".mt-lam-ro-ky-thuat",
    ".mt-lam-ro-tai-chinh",
  ].forEach((selector) => assert.ok(row.querySelector(selector), selector));
  assert.doesNotMatch(String(row.innerHTML), /bf-s-7c66cdedec/);
  assert.equal(rankingChanges, 1);
}));

test("financial 1G2T rows render price, clarification, combined score and listeners", () => withDomSupport((document) => {
  const root = createRoot(document);
  let rankingChanges = 0;
  const pkg = basePackage({
    linhVuc: "Tư vấn",
    phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
  });
  const presentation = buildBidEvaluationTablePresentation({
    pkg,
    isTwoEnvelope: true,
    currentTab: "financial",
  });
  const [row] = renderBidEvaluationRows({
    root,
    pkg,
    bids: [baseBid({
      giaDuThau: 1000,
      tyLeGiamGia: 10,
      giaSauGiamGia: 900,
      hieuLucHsdt: 90,
      lamRoTaiChinh: "Đã làm rõ",
    })],
    model: createModel(),
    presentation,
    onRankingChange: () => { rankingChanges += 1; },
  });

  const price = row.querySelector(".mt-gia-du-thau");
  const discount = row.querySelector(".mt-ty-le-giam-gia");
  const discountedPrice = row.querySelector(".mt-gia-sau-giam-gia");
  const duration = row.querySelector(".mt-hieu-luc-hsdt");
  assert.ok(price);
  assert.ok(discount);
  assert.ok(row.querySelector(".mt-lam-ro-tai-chinh"));
  assert.ok(row.querySelector(".mt-combined-score"));
  assert.ok(row.querySelector(".mt-dg-tai-chinh"));
  assert.equal(price.listeners.get("input").length, 2);
  assert.equal(duration.listeners.get("focus").length, 1);
  assert.equal(duration.listeners.get("blur").length, 1);
  discount.emit("input");
  assert.equal(discountedPrice.value, "900");
  assert.equal(rankingChanges, 2);
}));

test("a completed detailed report owns a read-only summary row", () => withDomSupport((document) => {
  const root = createRoot(document);
  const pkg = basePackage();
  const [row] = renderBidEvaluationRows({
    root,
    pkg,
    bids: [baseBid({
      baoCaoDanhGiaChiTietList: [{ loaiVong: "single", trangThai: "completed" }],
    })],
    model: createModel(),
    presentation: buildBidEvaluationTablePresentation({ pkg }),
  });

  assert.match(String(row.innerHTML), /Tổng hợp từ báo cáo chi tiết/);
  assert.equal(row.querySelector(".mt-dg-hop-le").tagName, "SPAN");
  assert.equal(row.querySelector(".mt-lam-ro-hop-le"), null);
}));

test("joint-venture rows register modal data and issue the view command", () => withDomSupport((document) => {
  const contractors = [
    { id: "lead-1", tenNhaThau: "Nhà thầu đứng đầu", maNhaThau: "LEAD" },
    { id: "member-1", tenNhaThau: "Nhà thầu thành viên", maNhaThau: "MEMBER" },
  ];
  const bid = baseBid({
    nhaThauId: "lead-1",
    loaiNhaThau: "Liên danh",
    tenNhaThau: "Liên danh A-B",
    maNhaThau: "JV01",
    thanhVienLienDanh: [
      { thanhVienNhaThauId: "lead-1", vaiTro: "Đứng đầu liên danh" },
      { thanhVienNhaThauId: "member-1", vaiTro: "Thành viên liên danh" },
    ],
  });
  const root = createRoot(document);
  const pkg = basePackage();
  const commands = [];
  setCommandExecutor((...args) => commands.push(args));
  const [row] = renderBidEvaluationRows({
    root,
    pkg,
    bids: [bid],
    model: createModel(contractors),
    presentation: buildBidEvaluationTablePresentation({ pkg }),
  });

  const stored = getJvData("pkg-1_eval_bidder_bid-1");
  assert.equal(stored.leadName, "Liên danh A-B");
  assert.equal(stored.members.length, 2);
  row.querySelector(".mt-jv-view-link").emit("click");
  assert.equal(commands[0][0], "openMoThauJVViewModal");
  assert.equal(commands[0][1][0].tenNhaThau, "Nhà thầu thành viên");
  assert.equal(commands[0][2], "Nhà thầu đứng đầu");
}));

test("process two locks rows after the first passing bidder", () => withDomSupport((document) => {
  const pkg = basePackage({ quyTrinhDanhGia: "quytrinh2" });
  const bids = [baseBid(), baseBid({ id: "bid-2", tenNhaThau: "Nhà thầu B" })];
  const root = createRoot(document);
  const ranking = createBidEvaluationRankingController({ root, pkg, bids });
  const rows = renderBidEvaluationRows({
    root,
    pkg,
    bids,
    model: createModel(),
    presentation: buildBidEvaluationTablePresentation({ pkg }),
    onRankingChange: () => ranking.update(),
  });

  assert.equal(rows[0].querySelector(".mt-dg-hop-le").disabled, false);
  assert.equal(rows[1].querySelector(".mt-dg-hop-le").disabled, true);
  assert.equal(rows[1].querySelector(".mt-dg-nang-luc").disabled, true);
  assert.equal(rows[1].querySelector(".mt-dg-ky-thuat").disabled, true);
  assert.match(rows[1].querySelector(".mt-ketluan-cell").textContent, /Không đánh giá/);
}));

test("empty bidder lists render the existing guidance row", () => withDomSupport((document) => {
  const root = createRoot(document);
  const pkg = basePackage();
  const rows = renderBidEvaluationRows({
    root,
    pkg,
    bids: [],
    model: createModel(),
    presentation: buildBidEvaluationTablePresentation({ pkg }),
  });

  assert.deepEqual(rows, []);
  assert.match(String(root.innerHTML), /Không tìm thấy danh sách nhà thầu mở thầu/);
}));
