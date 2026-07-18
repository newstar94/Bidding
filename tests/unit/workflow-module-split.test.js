import test from "node:test";
import assert from "node:assert/strict";

import {
  saveDanhGiaHsdt as saveEvaluationAction,
  updateRowConclusion as updateConclusionAction
} from "../../frontend/packages/bidEvaluationActions.js";
import {
  saveDanhGiaHsdt,
  updateRowConclusion
} from "../../frontend/packages/BidEvaluationWorkflow.js";
import {
  openMoThauJVManager as openJointVentureManager,
  openMoThauJVViewModal as openJointVentureView
} from "../../frontend/packages/bidProcessJointVenture.js";
import {
  handlePhatHanhHsmtSubmit as submitTenderIssuance,
  moThauGoiThau as openTender
} from "../../frontend/packages/bidProcessTenderLifecycle.js";
import {
  handlePhatHanhHsmtSubmit,
  moThauGoiThau,
  openMoThauJVManager,
  openMoThauJVViewModal
} from "../../frontend/packages/BidProcessWorkflow.js";

test("evaluation workflow keeps its public action exports after the module split", () => {
  assert.equal(saveDanhGiaHsdt, saveEvaluationAction);
  assert.equal(updateRowConclusion, updateConclusionAction);
});

test("bid process workflow keeps its joint-venture exports after the module split", () => {
  assert.equal(openMoThauJVManager, openJointVentureManager);
  assert.equal(openMoThauJVViewModal, openJointVentureView);
});

test("bid process workflow keeps its tender lifecycle exports after the module split", () => {
  assert.equal(moThauGoiThau, openTender);
  assert.equal(handlePhatHanhHsmtSubmit, submitTenderIssuance);
});

test("extracted evaluation conclusion action preserves read-only rendering", () => {
  const fields = new Map([
    [".mt-dg-hop-le", { value: "\u0110\u1ea1t" }],
    [".mt-dg-nang-luc", { value: "\u0110\u1ea1t" }],
    [".mt-dg-ky-thuat", { value: "\u0110\u1ea1t" }]
  ]);
  const cell = { innerHTML: "", textContent: "" };
  const row = {
    querySelector(selector) {
      return selector === ".mt-ketluan-cell" ? cell : fields.get(selector) || null;
    }
  };

  updateConclusionAction(row, "\u0110\u1ea1t", true);

  assert.match(cell.innerHTML, /badge-success/);
  assert.match(cell.innerHTML, /\u0110\u1ea1t/);
});
