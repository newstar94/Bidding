import test from "node:test";
import assert from "node:assert/strict";

import { bindBidEvaluationPanelController } from "../../frontend/packages/BidEvaluationPanelController.js";
import {
  parseEvaluationMetadataStrict,
  serializeEvaluationMetadata,
} from "../../frontend/packages/evaluationMetadata.js";

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.checked = false;
    this.classList = {
      add() {},
      remove() {},
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

function deferred() {
  let reject;
  const promise = new Promise((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
}

test("evaluation preference persistence keeps the live package unchanged and reports a durable failure", async () => {
  const previousDocument = globalThis.document;
  const previousElement = globalThis.Element;
  const previousConsoleError = console.error;
  const sheet = {
    cssRules: [],
    insertRule(rule, index) {
      this.cssRules.splice(index, 0, rule);
    },
  };
  globalThis.Element = FakeElement;
  globalThis.document = {
    querySelector: () => ({ sheet }),
  };
  console.error = () => {};

  const processOne = new FakeElement();
  const processTwo = new FakeElement();
  const preference = new FakeElement();
  const warning = new FakeElement();
  const controls = new Map([
    ['input[value="quytrinh1"]', processOne],
    ['input[value="quytrinh2"]', processTwo],
    ["#eval-co-uu-dai", preference],
    ["#quytrinh2-warning-msg", warning],
  ]);
  const container = new FakeElement();
  container.querySelector = (selector) => controls.get(selector) || null;
  const failure = deferred();
  const staged = [];
  const feedback = [];
  let rerenders = 0;
  const pkg = {
    id: "package-1",
    linhVuc: "Hàng hóa",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    phuongPhapDanhGia: "Giá thấp nhất",
    danhGiaHsdtMetadata: serializeEvaluationMetadata({ coUuDai: false }),
  };
  const originalMetadata = pkg.danhGiaHsdtMetadata;
  const appController = {
    model: {
      state: { thongtinmothau: [] },
      updateRecord(_table, record) {
        staged.push(structuredClone(record));
        return failure.promise;
      },
    },
    view: {
      getActiveElement(id) {
        return id === "danhgiahsdt-quytrinh-container" ? container : null;
      },
      showToast(...args) {
        feedback.push(args);
      },
    },
    renderDanhGiaHsdtPanel() {
      rerenders += 1;
    },
  };

  try {
    bindBidEvaluationPanelController({
      appController,
      pkg,
      panelState: {
        activeMeta: {},
        isReadOnly: false,
        isTwoEnvelope: false,
      },
      onRerender() {},
    });
    preference.checked = true;
    preference.onchange();

    assert.equal(pkg.danhGiaHsdtMetadata, originalMetadata);
    assert.equal(parseEvaluationMetadataStrict(staged[0].danhGiaHsdtMetadata).coUuDai, true);

    failure.reject(new Error("IndexedDB quota"));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(pkg.danhGiaHsdtMetadata, originalMetadata);
    assert.equal(feedback.length, 1);
    assert.equal(feedback[0][0], "Không thể lưu");
    assert.equal(rerenders, 1);
  } finally {
    console.error = previousConsoleError;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }
});
