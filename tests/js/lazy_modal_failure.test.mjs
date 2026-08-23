import assert from "node:assert/strict";
import test from "node:test";

import { BiddingView } from "../../frontend/app/BiddingView.js";
import { setAppController } from "../../frontend/app/controllerRef.js";

test("lazy modal failure offers one retry and opens after recovery", async () => {
  const view = new BiddingView({});
  const confirmations = [];
  const opened = [];
  let retries = 0;
  view.customConfirm = async (...args) => {
    confirmations.push(args);
    return true;
  };
  view.openModal = (modalId) => opened.push(modalId);
  setAppController({
    async ensureLazyModal(modalId) {
      retries += 1;
      assert.equal(modalId, "modal-goithau");
    },
  });

  const recovered = await view.handleLazyModalFailure(
    "modal-goithau",
    new Error("network failed"),
  );

  assert.equal(recovered, true);
  assert.equal(retries, 1);
  assert.deepEqual(opened, ["modal-goithau"]);
  assert.equal(confirmations[0][3].confirmLabel, "Thử lại");
  setAppController(null);
});

test("lazy modal retry failure exits loading state and reports an actionable error", async () => {
  const view = new BiddingView({});
  const toasts = [];
  view.customConfirm = async () => true;
  view.showToast = (...args) => toasts.push(args);
  setAppController({
    async ensureLazyModal() {
      throw new Error("still unavailable");
    },
  });

  const recovered = await view.handleLazyModalFailure(
    "modal-goithau",
    new Error("first failure"),
  );

  assert.equal(recovered, false);
  assert.equal(view._lazyModalFailureDialogs.size, 0);
  assert.equal(toasts[0][2], "error");
  setAppController(null);
});
