import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  renderDetailedEvaluationConclusionFooter,
  renderTechnicalEvaluationHeader,
  renderTechnicalPassFailRow,
} from "../../frontend/packages/detail/DetailedEvaluationPanel.js";

const stylesheetPaths = [
  "../../views/css/tokens.css",
  "../../views/css/variables.css",
  "../../views/css/base.css",
  "../../views/css/components.css",
  "../../views/css/generated-static-styles.css",
  "../../views/css/ui-redesign.css",
  "../../views/css/views.css",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const criterion = {
  id: "criterion-1",
  code: "TECH-1",
  name: "Giải pháp kỹ thuật",
  group: "technical",
  required: true,
  maxScore: 100,
  minScore: 70,
  stt: "1",
  isCustom: true,
  requirement: "Yêu cầu kỹ thuật",
};

test("technical evaluation table keeps seven columns and icon-only actions at common widths", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const header = renderTechnicalEvaluationHeader("pass_fail");
    const row = renderTechnicalPassFailRow({
      criterion,
      row: { ketQua: "acceptable", nhanXet: "" },
      index: 0,
      disabled: false,
      editing: false,
    });
    const footer = renderDetailedEvaluationConclusionFooter({
      activeGroup: "technical",
      criteria: [criterion],
      report: { chiTietList: [{ tieuChiDanhGiaId: criterion.id, ketQua: "pass" }] },
    });
    await page.setContent(`
      <div class="table-container package-table-frame detailed-evaluation-table-frame" style="height:500px">
        <table class="data-table detailed-evaluation-table detailed-evaluation-table-technical-pass-fail" data-density="comfortable">
          <colgroup>
            <col class="detailed-evaluation-col-stt">
            <col class="detailed-evaluation-col-criterion">
            <col class="detailed-evaluation-col-mark"><col class="detailed-evaluation-col-mark"><col class="detailed-evaluation-col-mark">
            <col class="detailed-evaluation-col-comment"><col class="detailed-evaluation-col-actions">
          </colgroup>
          ${header}
          <tbody>${row}</tbody>
          ${footer}
        </table>
      </div>
    `);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    const tableInfo = await page.evaluate(() => {
      const table = document.querySelector("table");
      const bodyRow = table.querySelector("tbody tr");
      const footerRow = table.querySelector("tfoot tr");
      const actionButtons = [...bodyRow.querySelectorAll("button")];
      return {
        headerActionCount: [...table.querySelectorAll("thead th")]
          .filter((cell) => cell.textContent.trim() === "Thao tác").length,
        bodyCells: bodyRow.children.length,
        footerSpans: [...footerRow.children].map((cell) => cell.colSpan || 1),
        sttTag: bodyRow.querySelector(".detailed-evaluation-stt")?.tagName || "",
        sttInputCount: bodyRow.querySelectorAll('[data-detailed-config-field="stt"]').length,
        actionButtonCount: actionButtons.length,
        actionButtonText: actionButtons.map((button) => button.textContent.trim()),
      };
    });

    assert.equal(tableInfo.headerActionCount, 1);
    assert.equal(tableInfo.bodyCells, 7);
    assert.deepEqual(tableInfo.footerSpans, [2, 5]);
    assert.equal(tableInfo.sttTag, "STRONG");
    assert.equal(tableInfo.sttInputCount, 0);
    assert.equal(tableInfo.actionButtonCount, 3);
    assert.deepEqual(tableInfo.actionButtonText, ["", "", ""]);

    for (const width of [1280, 900, 600]) {
      await page.setViewportSize({ width, height: 720 });
      const metrics = await page.locator(".detailed-evaluation-table-frame").evaluate((frame) => ({
        clientWidth: frame.clientWidth,
        scrollWidth: frame.scrollWidth,
      }));
      assert.ok(
        metrics.scrollWidth <= metrics.clientWidth + 1,
        `horizontal overflow at ${width}px: ${metrics.scrollWidth} > ${metrics.clientWidth}`,
      );
    }
  } finally {
    await browser.close();
  }
});

test("technical read-only table keeps an empty actions cell", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const row = renderTechnicalPassFailRow({
      criterion,
      row: { ketQua: "pass" },
      index: 0,
      disabled: true,
      editing: false,
    });
    await page.setContent(`<table><tbody>${row}</tbody></table>`);
    const result = await page.evaluate(() => {
      const bodyRow = document.querySelector("tbody tr");
      return {
        buttonCount: bodyRow.querySelectorAll("button").length,
        actionAttrs: bodyRow.querySelectorAll("[data-detailed-add-child-criterion], [data-detailed-edit-criterion], [data-detailed-remove-criterion]").length,
      };
    });
    assert.deepEqual(result, { buttonCount: 0, actionAttrs: 0 });
  } finally {
    await browser.close();
  }
});
