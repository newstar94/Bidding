import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { createBidEvaluationRankingController } from "../../frontend/packages/BidEvaluationRankingController.js";

class FakeElement {
  constructor({ value = "", textContent = "" } = {}) {
    this.value = value;
    this.textContent = textContent;
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  querySelector() {
    return null;
  }
}

class ConclusionCell extends FakeElement {
  constructor() {
    super({ textContent: "Đạt" });
    this.badge = new FakeElement({ textContent: "Đạt" });
    this.badge.className = "badge badge-success";
    this._innerHTML = "";
  }

  querySelector(selector) {
    if (selector === ".badge") return this.badge;
    if (selector === ".badge-success" && this.badge?.className.includes("badge-success")) {
      return this.badge;
    }
    return null;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.textContent = this._innerHTML.replace(/<[^>]+>/g, "").trim();
    const className = /badge-danger/.test(this._innerHTML)
      ? "badge badge-danger"
      : /badge-success/.test(this._innerHTML)
        ? "badge badge-success"
        : "";
    this.badge = className
      ? Object.assign(new FakeElement({ textContent: this.textContent }), { className })
      : null;
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

function evaluationRow(bidId, price, values = {}) {
  const controls = {
    ".mt-dg-hop-le": new FakeElement({ value: values.validity ?? "Đạt" }),
    ".mt-dg-nang-luc": new FakeElement({ value: values.capacity ?? "Đạt" }),
    ".mt-dg-ky-thuat": new FakeElement({ value: values.technical ?? "Đạt" }),
    ".mt-ketluan-cell": new ConclusionCell(),
    ".mt-gia-du-thau": new FakeElement({ value: String(price) }),
    ".mt-ty-le-giam-gia": new FakeElement({ value: "0" }),
    ".mt-dg-tai-chinh": new FakeElement(),
    ".mt-dg-xep-hang": new FakeElement(),
    ".mt-combined-score": new FakeElement(),
    ".mt-reason-fail-hople": new FakeElement(),
    ".mt-reason-fail-nangluc": new FakeElement(),
    ".mt-reason-fail-kythuat": new FakeElement(),
    ".mt-lam-ro-hop-le": new FakeElement(),
    ".mt-lam-ro-nang-luc": new FakeElement(),
    ".mt-lam-ro-ky-thuat": new FakeElement(),
    ".mt-lam-ro-tai-chinh": new FakeElement(),
  };
  return {
    controls,
    getAttribute: (name) => name === "data-bid-id" ? bidId : "",
    querySelector: (selector) => controls[selector] || null,
    querySelectorAll: () => Object.values(controls),
  };
}

test("ranking controller indexes bids once and updates every visible row", () => {
  const originalElement = globalThis.Element;
  const originalDocument = globalThis.document;
  globalThis.Element = FakeElement;
  globalThis.document = {
    querySelector: () => ({ sheet: { insertRule: () => {} } }),
  };
  try {
    const expensive = evaluationRow("bid-expensive", "2000");
    const cheap = evaluationRow("bid-cheap", "1000");
    const rows = [expensive, cheap];
    const bids = [
      { id: "bid-expensive", giaDuThau: 2000 },
      { id: "bid-cheap", giaDuThau: 1000 },
    ];
    bids.find = () => {
      throw new Error("linear bid lookup must not run during ranking updates");
    };
    const controller = createBidEvaluationRankingController({
      root: {
        querySelectorAll: (selector) => selector === "tr[data-bid-id]" ? rows : [],
      },
      pkg: {
        phanLo: "Không",
        linhVuc: "Hàng hóa",
        phuongPhapDanhGia: "Giá thấp nhất",
      },
      bids,
      isTwoEnvelope: true,
      isReadOnly: false,
    });

    const result = controller.update();

    assert.deepEqual(result.rankings, {
      "bid-cheap": 1,
      "bid-expensive": 2,
    });
    assert.equal(expensive.controls[".mt-dg-tai-chinh"].value, "Xếp hạng 2");
    assert.equal(cheap.controls[".mt-dg-tai-chinh"].value, "Xếp hạng 1");
    assert.equal(expensive.controls[".mt-dg-xep-hang"].textContent, "Xếp hạng 2");
    assert.equal(cheap.controls[".mt-dg-xep-hang"].textContent, "Xếp hạng 1");
    assert.deepEqual(result.currentBids.map((bid) => bid.giaSauGiamGia), [2000, 1000]);
  } finally {
    globalThis.Element = originalElement;
    globalThis.document = originalDocument;
  }
});

test("ranking controller ignores stale DOM rows without a matching bid", () => {
  const staleRow = evaluationRow("missing-bid", "1000");
  const controller = createBidEvaluationRankingController({
    root: { querySelectorAll: () => [staleRow] },
    pkg: { phanLo: "Không", linhVuc: "Hàng hóa", phuongPhapDanhGia: "Giá thấp nhất" },
    bids: [],
  });

  assert.deepEqual(controller.update(), {
    currentBids: [],
    rankings: {},
    scores: {},
  });
});

test("ranking schedule renders immediately once and batches later events per frame", () => {
  const originalElement = globalThis.Element;
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = [];
  globalThis.Element = FakeElement;
  globalThis.document = {
    querySelector: () => ({ sheet: { insertRule: () => {} } }),
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const row = evaluationRow("bid-1", "1000");
    let scans = 0;
    const controller = createBidEvaluationRankingController({
      root: {
        querySelectorAll: () => {
          scans += 1;
          return [row];
        },
      },
      pkg: {
        phanLo: "Không",
        linhVuc: "Hàng hóa",
        phuongPhapDanhGia: "Giá thấp nhất",
      },
      bids: [{ id: "bid-1", giaDuThau: 1000 }],
    });

    controller.schedule();
    assert.equal(scans, 1);
    controller.schedule();
    controller.schedule();
    controller.schedule();
    assert.equal(scans, 1);
    assert.equal(frames.length, 1);
    frames[0]();
    assert.equal(scans, 2);
  } finally {
    globalThis.Element = originalElement;
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test("process-two ranking stops evaluation after the first passing bidder", () => {
  const originalElement = globalThis.Element;
  const originalDocument = globalThis.document;
  const originalSupported = DOMPurify.isSupported;
  const originalSanitize = DOMPurify.sanitize;
  globalThis.Element = FakeElement;
  globalThis.document = {
    querySelector: () => ({ sheet: { insertRule: () => {} } }),
  };
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
    const failed = evaluationRow("bid-failed", "900", {
      validity: "Không đạt",
      capacity: "",
      technical: "",
    });
    const passed = evaluationRow("bid-passed", "1000");
    const skipped = evaluationRow("bid-skipped", "1100");
    const clarificationSelectors = [
      ".mt-lam-ro-hop-le",
      ".mt-lam-ro-nang-luc",
      ".mt-lam-ro-ky-thuat",
      ".mt-lam-ro-tai-chinh",
      ".mt-reason-fail-hople",
      ".mt-reason-fail-nangluc",
      ".mt-reason-fail-kythuat",
    ];
    clarificationSelectors.forEach((selector) => {
      passed.controls[selector].setAttribute("disabled", "true");
    });
    const controller = createBidEvaluationRankingController({
      root: { querySelectorAll: () => [failed, passed, skipped] },
      pkg: {
        phanLo: "Không",
        linhVuc: "Hàng hóa",
        phuongPhapDanhGia: "Giá thấp nhất",
        quyTrinhDanhGia: "quytrinh2",
      },
      bids: [
        { id: "bid-failed" },
        { id: "bid-passed" },
        { id: "bid-skipped" },
      ],
      isTwoEnvelope: false,
      isReadOnly: false,
    });

    const result = controller.update();

    assert.equal(result.currentBids[0].danhGiaKetLuan.startsWith("Không đạt"), true);
    assert.equal(result.currentBids[1].danhGiaKetLuan, "Đạt");
    assert.equal(result.currentBids[2].danhGiaKetLuan, "Không đánh giá");
    assert.equal(skipped.controls[".mt-dg-hop-le"].attributes.get("disabled"), "true");
    clarificationSelectors.forEach((selector) => {
      assert.equal(passed.controls[selector].attributes.has("disabled"), false);
    });
    assert.deepEqual(result.rankings, { "bid-passed": 1 });
  } finally {
    globalThis.Element = originalElement;
    globalThis.document = originalDocument;
    DOMPurify.isSupported = originalSupported;
    DOMPurify.sanitize = originalSanitize;
  }
});
