import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { formatPartnerIdentityCode } from "../../frontend/app/domUtils.js";
import {
  calculateOpeningDiscountedPrice,
  saveThongTinMoThau,
} from "../../frontend/packages/BidProcessWorkflow.js";
import { validateOpeningRows } from "../../frontend/packages/bidProcessOpeningData.js";
import {
  createPartnerLookupHandlers,
  PARTNER_FORM_CONFIGS,
} from "../../frontend/partners/PartnerFormController.js";

function openingRow({ price, includePrice = true } = {}) {
  const classes = new Set();
  const fields = {
    ".mt-ma-nha-thau": { value: "vn000000001" },
    ".mt-ten-nha-thau": { value: "Nhà thầu thử nghiệm" },
  };
  if (includePrice) fields[".mt-gia-du-thau"] = { value: price ?? "" };
  return {
    querySelector(selector) { return fields[selector] || null; },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
  };
}

test("opening bids require a positive bid price when the price field exists", () => {
  assert.equal(validateOpeningRows([openingRow({ price: "" })]).valid, false);
  assert.equal(validateOpeningRows([openingRow({ price: "0" })]).valid, false);
  assert.equal(validateOpeningRows([openingRow({ price: "-1.000" })]).valid, false);
  assert.equal(validateOpeningRows([openingRow({ price: "1.250.000" })]).valid, true);
});

test("opening rows without a bid-price field remain valid", () => {
  assert.equal(validateOpeningRows([openingRow({ includePrice: false })]).valid, true);
});

test("discounted bid price stays blank until a positive bid price exists", () => {
  const model = {
    parseVND(value) { return Number(String(value).replace(/\D/g, "")) || 0; },
    formatVND(value) { return String(Math.round(value)); },
  };

  assert.equal(calculateOpeningDiscountedPrice(model, "", "0"), "");
  assert.equal(calculateOpeningDiscountedPrice(model, "0", "10"), "");
  assert.equal(calculateOpeningDiscountedPrice(model, "1.000.000", "10"), "900000");
});

test("discounted price inputs do not expose a placeholder", () => {
  const source = fs.readFileSync("frontend/packages/BidProcessWorkflow.js", "utf8");
  assert.doesNotMatch(
    source,
    /class="[^"]*mt-gia-sau-giam-gia[^"]*"[^>]*placeholder=/,
  );
});

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

test("investor lookup does not replace the exact code entered by the user", async () => {
  const controls = new Map([
    ["cdt-ma", { value: "vn123456789" }],
  ]);
  const root = {
    getElementById(id) {
      return controls.get(id) || null;
    },
  };
  const { applyLookupData } = createPartnerLookupHandlers({
    form: { dataset: {} },
    config: PARTNER_FORM_CONFIGS.chudautu.lookup,
    root,
    applyAddress: async () => {},
  });

  await applyLookupData({ org_code: "VN123456789", name: "Chủ đầu tư thử nghiệm" });

  assert.equal(controls.get("cdt-ma").value, "vn123456789");
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

test("runtime visibility rules load after the static redesign stylesheet", () => {
  const shell = fs.readFileSync("views/index.html", "utf8");
  const redesignIndex = shell.indexOf("/css/ui-redesign.css");
  const runtimeIndex = shell.indexOf("/css/runtime-styles.css");

  assert.ok(redesignIndex >= 0, "ui-redesign stylesheet is missing");
  assert.ok(runtimeIndex >= 0, "runtime stylesheet is missing");
  assert.ok(
    redesignIndex < runtimeIndex,
    "static button display rules currently override runtime locked-state visibility",
  );
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
