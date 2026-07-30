import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  renderDetailedEvaluationConclusionFooter,
} from "../../frontend/packages/detail/DetailedEvaluationPanel.js";

const stylesheetPaths = [
  "../../views/css/tokens.css",
  "../../views/css/variables.css",
  "../../views/css/base.css",
  "../../views/css/components.css",
  "../../views/css/views.css",
  "../../views/css/generated-static-styles.css",
  "../../views/css/ui-redesign.css",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

test("detailed evaluation body content is left aligned while headers and result marks stay centered", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table class="detailed-evaluation-table">
        <thead><tr class="detailed-evaluation-header-group"><th>Tiêu đề</th><th>Kết quả</th></tr></thead>
        <tbody><tr><td class="text-wrap">Nội dung đánh giá</td><td class="detailed-evaluation-mark-cell">x</td></tr></tbody>
      </table>
    `);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    const alignment = await page.evaluate(() => ({
      header: getComputedStyle(document.querySelector("thead th")).textAlign,
      content: getComputedStyle(document.querySelector("tbody .text-wrap")).textAlign,
      mark: getComputedStyle(document.querySelector("tbody .detailed-evaluation-mark-cell")).textAlign,
    }));
    assert.deepEqual(alignment, { header: "center", content: "left", mark: "center" });
  } finally {
    await browser.close();
  }
});

test("detailed evaluation validity table fits without a horizontal scrollbar", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const rows = Array.from({ length: 12 }, (_, index) => `
      <tr>
        <td><strong class="detailed-evaluation-stt">2.1.${index + 1}</strong></td>
        <td class="text-wrap">Nội dung đánh giá dài trong E-HSMT cần tự động xuống dòng trong phạm vi cột.</td>
        <td class="detailed-evaluation-mark-cell">x</td>
        <td class="detailed-evaluation-mark-cell">-</td>
        <td class="detailed-evaluation-mark-cell">x</td>
        <td class="detailed-evaluation-mark-cell">-</td>
        <td><textarea class="form-control" placeholder="Nhận xét đánh giá"></textarea></td>
      </tr>`).join("");
    await page.setContent(`
      <div class="table-container package-table-frame detailed-evaluation-table-frame" style="height:360px">
        <table class="data-table detailed-evaluation-table detailed-evaluation-table-binary detailed-evaluation-table-validity" data-density="comfortable">
          <colgroup>
            <col class="detailed-evaluation-col-stt">
            <col class="detailed-evaluation-col-criterion">
            <col class="detailed-evaluation-col-mark"><col class="detailed-evaluation-col-mark">
            <col class="detailed-evaluation-col-mark"><col class="detailed-evaluation-col-mark">
            <col class="detailed-evaluation-col-comment">
          </colgroup>
          <thead><tr class="detailed-evaluation-header-group"><th>STT</th><th>Nội dung đánh giá trong E-HSMT</th><th>Đạt</th><th>Không đạt</th><th>Đạt</th><th>Không đạt</th><th>Nhận xét</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    for (const width of [1440, 1280, 1024, 900, 768, 600]) {
      await page.setViewportSize({ width, height: 600 });
      const metrics = await page.locator(".detailed-evaluation-table-frame").evaluate((frame) => ({
        clientWidth: frame.clientWidth,
        scrollWidth: frame.scrollWidth,
      }));
      assert.equal(metrics.scrollWidth, metrics.clientWidth, `horizontal overflow at ${width}px`);
    }
  } finally {
    await browser.close();
  }
});

test("detailed evaluation binary table ends with an aggregated conclusion row", () => {
  const criteria = [
    { id: "criterion-1", group: "validity", required: true },
    { id: "criterion-2", group: "validity", required: true },
  ];
  const report = {
    chiTietList: [
      { tieuChiDanhGiaId: "criterion-1", ketQua: "pass", extension: { ketQuaTuDong: "pass" } },
      { tieuChiDanhGiaId: "criterion-2", ketQua: "pass", extension: { ketQuaTuDong: "fail" } },
    ],
  };

  const footer = renderDetailedEvaluationConclusionFooter({ activeGroup: "validity", criteria, report });
  assert.match(footer, /<tfoot>/);
  assert.match(footer, />Kết luận</);
  assert.match(footer, /Kết luận tự động: Không đạt/);
  assert.match(footer, /Kết luận chuyên gia: Đạt/);
  assert.match(footer, /badge-success[^>]*>Đạt</);
});

test("financial detailed evaluation table does not render a conclusion row", () => {
  const footer = renderDetailedEvaluationConclusionFooter({
    activeGroup: "financial",
    criteria: [{ id: "financial-1", group: "financial", required: true }],
    report: { chiTietList: [{ tieuChiDanhGiaId: "financial-1", ketQua: "pass" }] },
  });

  assert.equal(footer, "");
});
