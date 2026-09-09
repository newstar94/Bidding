import assert from "node:assert/strict";
import test from "node:test";

import {
  selectCanonicalContractorForOpenContract,
} from "../../frontend/partners/NhaThauWorkflow.js";

test("contract modal never selects a contractor before canonical acceptance", () => {
  const previousDocument = globalThis.document;
  let selected = "";
  globalThis.document = {
    getElementById() {
      selected = "looked-up";
      return null;
    },
  };
  try {
    const result = selectCanonicalContractorForOpenContract(
      { model: { getLatestNhaThau: () => [] } },
      { id: "contractor-pending" },
      { canonicalStatus: "CANONICAL_REJECTED" },
    );
    assert.equal(result, false);
    assert.equal(selected, "", "dependent contract UI must not inspect or select a rejected contractor");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("canonical contractor acceptance permits the dependent workflow", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === "modal-hopdong") return { classList: { contains: () => false } };
      return null;
    },
  };
  try {
    const result = selectCanonicalContractorForOpenContract(
      {
        model: {
          getLatestNhaThau: () => [{ id: "contractor-accepted", tenNhaThau: "Nhà thầu A" }],
        },
      },
      { id: "contractor-accepted" },
      { canonicalStatus: "CANONICAL_COMMITTED" },
    );
    assert.equal(result, true);
  } finally {
    globalThis.document = previousDocument;
  }
});
