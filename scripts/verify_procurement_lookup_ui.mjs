import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";


const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(
  path.join(PROJECT_ROOT, relativePath), "utf8",
);

function elementById(markup, tag, id) {
  const match = markup.match(new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>(?:[\\s\\S]*?<\\/${tag}>)?`));
  if (!match) throw new Error(`Missing #${id} in form markup`);
  return match[0];
}

function inlineLookupFixture(markup, {
  codeId, controlId, statusId, headingId, heading, identityClass,
}) {
  const input = elementById(markup, "input", codeId);
  const control = elementById(markup, "label", controlId);
  const status = elementById(markup, "span", statusId)
    .replace(" hidden", "")
    .replace("></span>", ">Đang lấy dữ liệu từ Mua Sắm Công…</span>");
  return `<section class="procurement-inline-fixture" aria-labelledby="${headingId}">`
    + `<h2 id="${headingId}">${heading}</h2>`
    + `<div class="${identityClass}"><div class="form-group">`
    + `<label for="${codeId}">Mã tra cứu</label>`
    + `<div class="procurement-code-input-row">${input}${control}</div>`
    + `${status}</div></div></section>`;
}

const fixtures = [
  {
    markup: read("views/modals/modal_kehoach.html"),
    codeId: "kh-ma",
    controlId: "procurement-lookup-plan-control",
    checkboxId: "procurement-lookup-plan-enabled",
    statusId: "procurement-lookup-plan-status",
    headingId: "plan-heading",
    heading: "Kế hoạch lựa chọn nhà thầu",
    identityClass: "plan-identity-grid",
    code: "PL2600000001",
    nextCode: "PL2600000002",
  },
  {
    markup: read("views/modals/modal_goithau.html"),
    codeId: "gt-ma",
    controlId: "procurement-lookup-package-control",
    checkboxId: "procurement-lookup-package-enabled",
    statusId: "procurement-lookup-package-status",
    headingId: "package-heading",
    heading: "Gói thầu",
    identityClass: "package-identity-grid",
    code: "IB2600000001",
    nextCode: "IB2600000002",
  },
];
const fixtureMarkup = fixtures.map((fixture) => inlineLookupFixture(
  fixture.markup, fixture,
)).join("");
const autoLookupModuleUrl = "data:text/javascript;base64,"
  + Buffer.from(read("frontend/procurement/ProcurementAutoLookup.js")).toString("base64");

async function checkSourceToggle(page, fixture) {
  const code = page.locator(`#${fixture.codeId}`);
  const checkbox = page.locator(`#${fixture.checkboxId}`);
  const calls = () => page.evaluate(
    (id) => globalThis.procurementLookupSmokeCalls[id], fixture.checkboxId,
  );
  assert.equal(await checkbox.getAttribute("type"), "checkbox");
  assert.equal(await checkbox.isChecked(), false);
  await code.fill(fixture.code);
  await code.blur();
  assert.deepEqual(await calls(), [], "Manual code entry must not enable source lookup");

  await page.locator(`#${fixture.controlId}`).click();
  assert.equal(await checkbox.isChecked(), true, "Clicking the source label must toggle its checkbox");
  await code.dispatchEvent("change");
  await code.dispatchEvent("blur");
  assert.deepEqual(await calls(), [fixture.code], "Change and blur must not duplicate the lookup");

  await checkbox.focus();
  await checkbox.press("Space");
  assert.equal(await checkbox.isChecked(), false, "The source toggle must support the keyboard");
  await code.fill(fixture.nextCode);
  await code.blur();
  assert.deepEqual(await calls(), [fixture.code], "Turning source lookup off must stop automatic requests");
  await checkbox.focus();
  await checkbox.press("Space");
  assert.equal(await checkbox.isChecked(), true);
  assert.deepEqual(await calls(), [fixture.code, fixture.nextCode]);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
try {
  const page = await context.newPage();
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    await page.setContent(
      `<!doctype html><html lang="vi"><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width,initial-scale=1"></head>`
      + `<body><main>${fixtureMarkup}</main></body></html>`,
    );
    for (const stylesheet of [
      "views/css/tokens.css",
      "views/css/variables.css",
      "views/css/base.css",
      "views/css/components.css",
      "views/css/generated-static-styles.css",
    ]) {
      await page.addStyleTag({ path: path.join(PROJECT_ROOT, stylesheet) });
    }
    await page.addStyleTag({ content: `
      main { display: grid; gap: 1rem; padding: 0.75rem; }
      .procurement-inline-fixture { min-width: 0; }
      .procurement-inline-fixture h2 { font-size: 1rem; }
    ` });
    await page.evaluate(async ({ moduleUrl, configs }) => {
      const { bindProcurementCodeAutoLookup } = await import(moduleUrl);
      globalThis.procurementLookupSmokeCalls = {};
      for (const { codeId, checkboxId } of configs) {
        const codeInput = document.getElementById(codeId);
        const checkbox = document.getElementById(checkboxId);
        globalThis.procurementLookupSmokeCalls[checkboxId] = [];
        bindProcurementCodeAutoLookup({
          codeInput,
          checkbox,
          runLookup: async () => {
            globalThis.procurementLookupSmokeCalls[checkboxId].push(codeInput.value);
            return { applied: true };
          },
        });
      }
    }, {
      moduleUrl: autoLookupModuleUrl,
      configs: fixtures.map(({ codeId, checkboxId }) => ({ codeId, checkboxId })),
    });
    for (const fixture of fixtures) await checkSourceToggle(page, fixture);
    const layout = await page.evaluate(() => ({
      viewportWidth: globalThis.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      sectionsInsideViewport: [...document.querySelectorAll(".procurement-inline-fixture")]
        .every((section) => {
          const rect = section.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= globalThis.innerWidth;
        }),
      controls: [...document.querySelectorAll(".procurement-code-input-row")]
        .map((row) => {
          const code = row.querySelector("input[type='text']");
          const toggle = row.querySelector(".procurement-source-toggle");
          const checkbox = toggle.querySelector("input[type='checkbox']");
          const inputRect = code.getBoundingClientRect();
          const toggleRect = toggle.getBoundingClientRect();
          return {
            inputHeight: inputRect.height,
            toggleHeight: toggleRect.height,
            insideViewport: inputRect.left >= 0 && toggleRect.left >= 0
              && inputRect.right <= globalThis.innerWidth && toggleRect.right <= globalThis.innerWidth,
            responsivePlacement: globalThis.innerWidth <= 420
              ? toggleRect.top >= inputRect.bottom
              : toggleRect.left >= inputRect.right,
            labelAssociated: toggle.getAttribute("for") === checkbox.id,
            statusAssociated: code.getAttribute("aria-describedby") === checkbox.getAttribute("aria-describedby")
              && Boolean(document.getElementById(checkbox.getAttribute("aria-describedby"))),
          };
        }),
      statuses: [...document.querySelectorAll(".procurement-inline-status")]
        .map((status) => ({ role: status.getAttribute("role"), live: status.getAttribute("aria-live") })),
    }));
    const axe = await new AxeBuilder({ page }).include("main").analyze();
    const serious = axe.violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    );
    const valid = layout.pageScrollWidth <= layout.viewportWidth
      && layout.sectionsInsideViewport
      && layout.controls.length === 2
      && layout.controls.every((control) => control.toggleHeight >= 44
        && control.inputHeight >= 44
        && Math.abs(control.inputHeight - control.toggleHeight) <= 1
        && control.insideViewport && control.responsivePlacement
        && control.labelAssociated && control.statusAssociated)
      && layout.statuses.length === 2
      && layout.statuses.every((status) => status.role === "status" && status.live === "polite")
      && serious.length === 0;
    if (!valid) {
      throw new Error(JSON.stringify({ layout, serious: serious.map((item) => item.id) }));
    }
    process.stdout.write(`${JSON.stringify({ viewport: `${width}x720`, layout, sourceToggleBehavior: "passed", serious: [] })}\n`);
  }
} finally {
  await context.close();
  await browser.close();
}
