import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  buildBidEvaluationTablePresentation,
} from "../../frontend/packages/BidEvaluationTablePresentation.js";

const stylesheetPaths = [
  "../../views/css/tokens.css",
  "../../views/css/variables.css",
  "../../views/css/base.css",
  "../../views/css/components.css",
  "../../views/css/views.css",
  "../../views/css/generated-static-styles.css",
  "../../views/css/ui-redesign.css",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const longLotName = "PHẦN 3: HÓA CHẤT XÉT NGHIỆM SINH HÓA (Sử dụng tương thích cho máy AU480)";
const longContractorName = "Công ty TNHH thương mại dịch vụ thiết bị y tế Medivina";

function editableCells(count) {
  return Array.from({ length: count }, (_, index) => (
    `<td><input class="form-control" value="${index === 0 ? "2.115.000.000" : "Đạt"}"></td>`
  )).join("");
}

test("bid evaluation summary keeps long identity values inside their own cells", async () => {
  const presentation = buildBidEvaluationTablePresentation({
    pkg: {
      linhVuc: "Hàng hóa",
      phanLo: "Có",
      quyTrinhApDung: "1 giai đoạn 1 túi hồ sơ",
    },
  });
  const columnCount = (presentation.headerHtml.match(/<th\b/gu) || []).length;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2048, height: 900 } });
    await page.setContent(`
      <main style="padding: 28px">
        <div class="table-container package-table-frame has-bottom-space">
          <table class="data-table" id="danhgiahsdt-table">
            <thead>${presentation.headerHtml}</thead>
            <tbody>
              <tr>
                <td>PP2600239577</td>
                <td class="package-lot-name-cell">${longLotName}</td>
                <td>Độc lập</td>
                <td>vn0317079471</td>
                <td><a class="fw-bold link-hover text-blue">${longContractorName}</a></td>
                ${editableCells(columnCount - 5)}
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    `);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    for (const width of [2048, 1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.locator("#danhgiahsdt-table tbody tr").evaluate((row) => {
        const cells = Array.from(row.cells).slice(0, 5);
        return cells.map((cell, index) => {
          const content = cell.querySelector("a") || cell;
          const range = document.createRange();
          range.selectNodeContents(content);
          const contentRect = range.getBoundingClientRect();
          const cellRect = cell.getBoundingClientRect();
          const nextRect = cells[index + 1]?.getBoundingClientRect() || null;
          return {
            contentRight: contentRect.right,
            cellRight: cellRect.right,
            nextLeft: nextRect?.left ?? null,
          };
        });
      });

      for (const [index, metric] of metrics.entries()) {
        assert.ok(
          metric.contentRight <= metric.cellRight + 1,
          `identity content ${index + 1} escaped its table cell at ${width}px`,
        );
        if (metric.nextLeft !== null) {
          assert.ok(
            metric.contentRight <= metric.nextLeft + 1,
            `identity content ${index + 1} overlapped the next column at ${width}px`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
});

test("conclusion column has enough width to show pass and fail choices in full", async () => {
  const presentation = buildBidEvaluationTablePresentation({
    pkg: {
      linhVuc: "Tư vấn",
      phanLo: "Không",
      quyTrinhApDung: "1 giai đoạn 2 túi hồ sơ",
    },
    isTwoEnvelope: true,
    currentTab: "technical",
  });
  assert.match(presentation.headerHtml, /<th class="bid-evaluation-conclusion-column">Kết luận<\/th>/u);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 768, height: 500 } });
    await page.setContent(`
      <div class="package-table-frame">
        <table class="data-table" id="danhgiahsdt-table">
          <tbody><tr><td class="mt-ketluan-cell bid-evaluation-conclusion-cell">
            <select class="form-control mt-dg-ketluan bid-evaluation-conclusion-select">
              <option>Đạt</option><option selected>Không đạt</option>
            </select>
          </td></tr></tbody>
        </table>
      </div>
    `);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });
    const metrics = await page.locator(".mt-dg-ketluan").evaluate((select) => ({
      cellWidth: select.closest("td").getBoundingClientRect().width,
      selectWidth: select.getBoundingClientRect().width,
    }));
    assert.ok(metrics.cellWidth >= 160, `conclusion cell was only ${metrics.cellWidth}px wide`);
    assert.ok(metrics.selectWidth >= 128, `conclusion select was only ${metrics.selectWidth}px wide`);
  } finally {
    await browser.close();
  }
});
