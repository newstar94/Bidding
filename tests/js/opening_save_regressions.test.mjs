import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { formatPartnerIdentityCode } from "../../frontend/app/domUtils.js";
import { saveThongTinMoThau } from "../../frontend/packages/BidProcessWorkflow.js";
import {
  createPartnerLookupHandlers,
  PARTNER_FORM_CONFIGS,
} from "../../frontend/partners/PartnerFormController.js";

test("contractor codes keep their original letter casing", () => {
  assert.equal(formatPartnerIdentityCode("  VnAb-01  "), "VnAb-01");
  const workflowSource = fs.readFileSync("frontend/packages/BidProcessWorkflow.js", "utf8");
  assert.match(workflowSource, /bidData\.maDinhDanh \|\| bidData\.maNhaThau/);
  assert.doesNotMatch(workflowSource, /inputMa\.value = data\.org_code/);
});

test("contractor lookup does not replace the exact code entered by the user", async () => {
  const controls = new Map([
    ["nt-ma", { value: "VnAb-01" }],
  ]);
  const root = {
    getElementById(id) {
      return controls.get(id) || null;
    },
  };
  const form = { dataset: {} };
  const { applyLookupData } = createPartnerLookupHandlers({
    form,
    config: PARTNER_FORM_CONFIGS.nhathau.lookup,
    root,
    applyAddress: async () => {},
  });

  await applyLookupData({ org_code: "VNAB-01", name: "Nhà thầu thử nghiệm" });

  assert.equal(controls.get("nt-ma").value, "VnAb-01");
});

test("opening save always reports unexpected failures and restores the button", async () => {
  const originalDocument = globalThis.document;
  const originalLucide = globalThis.lucide;
  const originalConsoleError = console.error;
  const button = {
    dataset: {},
    disabled: false,
    innerHTML: "Lưu thông tin mở thầu",
    textContent: "Lưu thông tin mở thầu",
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
  };
  const alerts = [];
  globalThis.document = {
    getElementById(id) {
      if (id === "btn-mothau-save") return button;
      throw new Error("simulated opening-save failure");
    },
  };
  globalThis.lucide = { createIcons() {} };
  console.error = () => {};
  try {
    await saveThongTinMoThau.call({
      view: {
        async customAlert(...args) { alerts.push(args); },
      },
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.lucide = originalLucide;
    console.error = originalConsoleError;
  }
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][0], "Không thể lưu thông tin mở thầu");
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Lưu thông tin mở thầu");
  assert.equal(button.dataset.openingSaveBusy, undefined);
});

test("opening save partner lookup has a bounded timeout", () => {
  const source = fs.readFileSync("frontend/packages/openingContractorLookup.js", "utf8");
  assert.match(source, /OPENING_SAVE_LOOKUP_TIMEOUT_MS = 3000/);
  assert.match(source, /controller\.abort\(\)/);
});

test("joint-venture member controls use one replaceable runtime display rule", () => {
  const source = fs.readFileSync("frontend/packages/BidProcessWorkflow.js", "utf8");
  assert.doesNotMatch(
    source,
    /mt-jv-members-container" style="[^"]*display:/,
    "an extracted css-text display rule can override the later runtime display toggle",
  );
  assert.match(source, /setRuntimeStyle\(jvContainer, "marginTop", "4px"\)/);
  assert.match(
    source,
    /setRuntimeStyle\(jvContainer, "display", ntType === "Liên danh" \? "block" : "none"\)/,
  );
});
