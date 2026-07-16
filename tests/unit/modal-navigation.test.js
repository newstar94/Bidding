import assert from "node:assert/strict";
import test from "node:test";

import { closeModal } from "../../frontend/app/BiddingControllerUI.js";

test("closing a plan breakdown for navigation does not restore the previous route", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === "modal-plan-breakdown") return { classList: { contains: () => true } };
      return null;
    }
  };
  let closedModal = "";
  let switchCount = 0;
  try {
    const context = {
      backupKeHoachState: null,
      backupGoiThauState: null,
      tempPlanData: null,
      tempPlanAction: null,
      model: {
        state: {},
        persistData() {}
      },
      view: {
        closeModal(id) { closedModal = id; },
        renderKeHoachTable() {},
        renderGoiThauTable() {}
      },
      autoSync() {},
      switchTab() { switchCount += 1; }
    };
    await closeModal.call(context, "modal-plan-breakdown", { restoreRoute: false });
    assert.equal(closedModal, "modal-plan-breakdown");
    assert.equal(switchCount, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("closing the investor create modal restores the investor list route", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById() { return null; }
  };
  let closedModal = "";
  let switchedTo = null;
  try {
    const context = {
      view: { closeModal(id) { closedModal = id; } },
      switchTab(tab, action, updateState) { switchedTo = { tab, action, updateState }; }
    };
    await closeModal.call(context, "modal-chudautu");
    assert.equal(closedModal, "modal-chudautu");
    assert.deepEqual(switchedTo, { tab: "chudautu", action: null, updateState: true });
  } finally {
    globalThis.document = previousDocument;
  }
});

test("closing the expert create modal restores the expert list route", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById() { return null; } };
  let destination = null;
  try {
    const context = {
      view: { closeModal() {} },
      switchTab(tab, action, updateState) { destination = { tab, action, updateState }; }
    };
    await closeModal.call(context, "modal-chuyengia");
    assert.deepEqual(destination, { tab: "chuyengia", action: null, updateState: true });
  } finally {
    globalThis.document = previousDocument;
  }
});
