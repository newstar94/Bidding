import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  renderBidderGoodsPanelMarkup,
} from "../../frontend/packages/BidderGoodsWorkflow.js";

const stylesheetPaths = [
  "../../views/css/tokens.css",
  "../../views/css/variables.css",
  "../../views/css/base.css",
  "../../views/css/components.css",
  "../../views/css/views.css",
  "../../views/css/generated-static-styles.css",
  "../../views/css/ui-redesign.css",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

function panelState() {
  const row = {
    id: "offered-1",
    sttNguon: "1",
    danhMucHangHoa: "Hóa chất xét nghiệm định lượng C-reactive protein dùng cho máy xét nghiệm sinh hóa",
    kyMaHieu: "CRP-01",
    nhanHieu: "Nhãn A",
    namSanXuat: "2026",
    xuatXu: "Việt Nam",
    hangSanXuat: "Nhà sản xuất A",
    cauHinhTinhNangKyThuat: "Đáp ứng cấu hình kỹ thuật theo E-HSMT",
    donViTinh: "Hộp",
    khoiLuong: 18,
    maHs: "3002",
    donGiaDuThau: 10_000_000,
    thanhTienDuThau: 180_000_000,
    goiThauHangHoaId: "required-1",
    mappingStatus: "matched",
    maUuDai: 0,
  };
  return {
    pkg: {
      tenGoiThau: "Gói thầu cung cấp thiết bị tường lửa và hệ thống phát hiện xâm nhập IDS/IPS",
      phanLo: "Có",
      phanLoList: [{ id: "lot-2", maPhanLo: "PL2", tenPhanLo: "Lô 2" }],
    },
    bid: { id: "opening-1", giaDuThau: 180_000_000, trangThaiTinhUuDai: "draft" },
    roundType: "single",
    lot: { id: "lot-2", maPhanLo: "PL2", tenPhanLo: "Lô 2" },
    requirements: [{ id: "required-1", maHangHoa: "HH-01", tenHangHoa: row.danhMucHangHoa, phanLoId: null }],
    rows: [row],
    pageRows: [row],
    summary: { total: 180_000_000, difference: 0, matchesBidPrice: true, missing: [], unmatched: 0, duplicate: 0, invalidRows: 0 },
    preferenceCalculation: {
      heSoUuDaiCaoNhatBp: 0,
      tongGiaTriCongUuDai: 0,
      giaSoSanhSauUuDai: 180_000_000,
    },
    page: 1,
    pageCount: 1,
    filter: "",
    importPreview: null,
    readOnly: false,
    busy: "",
    error: "",
  };
}

test("full bidder-goods table stays inside its scroll frame and keeps toolbar aligned", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<meta charset="utf-8"><main>${renderBidderGoodsPanelMarkup(panelState())}</main>`);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    assert.equal(await page.locator(".bidder-goods-table thead th").count(), 19);
    assert.equal(await page.locator(".bidder-goods-item-row > td").count(), 19);
    assert.deepEqual(
      await page.locator(".bidder-goods-lot-row > td").evaluateAll((cells) => cells.slice(0, 3).map((cell) => cell.textContent.trim())),
      ["1", "PL2", "Lô 2"],
    );
    assert.equal(await page.locator(".bidder-goods-detail-row").count(), 0);
    assert.equal(await page.locator(".bidder-goods-summary-primary > div").count(), 4);
    const summaryTypography = await page.evaluate(() => {
      const style = (selector) => {
        const computed = getComputedStyle(document.querySelector(selector));
        return { family: computed.fontFamily, size: computed.fontSize, weight: computed.fontWeight };
      };
      return {
        primaryLabel: style(".bidder-goods-summary-label"),
        primaryValue: style(".bidder-goods-summary-value"),
        preferenceLabel: style(".bidder-goods-summary-preference dt"),
        preferenceValue: style(".bidder-goods-summary-preference dd"),
      };
    });
    assert.equal(summaryTypography.primaryLabel.weight, "700");
    assert.equal(summaryTypography.preferenceLabel.weight, "700");
    assert.equal(summaryTypography.primaryValue.weight, "400");
    assert.equal(summaryTypography.preferenceValue.weight, "400");
    assert.equal(summaryTypography.primaryLabel.family, summaryTypography.primaryValue.family);
    assert.equal(summaryTypography.primaryLabel.size, summaryTypography.primaryValue.size);
    assert.equal(await page.locator(".bidder-goods-command-main").count(), 1);
    assert.equal(await page.locator(".bidder-goods-file-actions").count(), 1);
    assert.equal(await page.locator("#btn-bidder-goods-export-menu").count(), 1);
    assert.equal(await page.locator(".bidder-goods-export-popover #btn-bidder-goods-template").count(), 1);
    assert.equal(await page.locator(".bidder-goods-export-popover #btn-bidder-goods-export").count(), 1);

    await page.setViewportSize({ width: 1440, height: 900 });
    const actionTops = await page.locator("#btn-bidder-goods-import, #btn-bidder-goods-export-menu, #btn-bidder-goods-add")
      .evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    assert.equal(actionTops.length, 3);
    assert.equal(new Set(actionTops).size, 1, "import, export and add actions must share one row");
    const actionPositions = await page.locator("#btn-bidder-goods-add, #btn-bidder-goods-import, #btn-bidder-goods-export-menu")
      .evaluateAll((buttons) => Object.fromEntries(buttons.map((button) => [button.id, button.getBoundingClientRect().left])));
    assert.ok(actionPositions["btn-bidder-goods-import"] < actionPositions["btn-bidder-goods-add"], "add action must follow the Excel actions");
    assert.ok(actionPositions["btn-bidder-goods-export-menu"] > actionPositions["btn-bidder-goods-import"], "export must follow import on the right");
    assert.ok(actionPositions["btn-bidder-goods-add"] > actionPositions["btn-bidder-goods-export-menu"], "add action must be the rightmost toolbar button");
    const paginationCenters = await page.evaluate(() => {
      const footer = document.querySelector(".bidder-goods-footer").getBoundingClientRect();
      const buttons = document.querySelector(".bidder-goods-pagination .pagination-buttons").getBoundingClientRect();
      return {
        footer: footer.left + footer.width / 2,
        buttons: buttons.left + buttons.width / 2,
      };
    });
    assert.ok(
      Math.abs(paginationCenters.footer - paginationCenters.buttons) <= 1,
      `pagination must be centered in the footer: ${JSON.stringify(paginationCenters)}`,
    );
    const desktopFrame = await page.locator(".bidder-goods-table-frame").evaluate((frame) => ({
      clientWidth: frame.clientWidth,
      scrollWidth: frame.scrollWidth,
    }));
    assert.ok(desktopFrame.scrollWidth > desktopFrame.clientWidth, "all columns must remain reachable in the table scroll frame");

    await page.locator("#btn-bidder-goods-export-menu").click();
    assert.equal(await page.locator("#btn-bidder-goods-template").isVisible(), true);
    assert.equal(await page.locator("#btn-bidder-goods-export").isVisible(), true);
    await page.locator("#btn-bidder-goods-export-menu").click();

    for (const width of [1920, 1440, 1280, 1024, 900, 800, 768, 414, 375, 320]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
      const metrics = await page.evaluate(() => ({
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        frameClientWidth: document.querySelector(".bidder-goods-table-frame").clientWidth,
        frameScrollWidth: document.querySelector(".bidder-goods-table-frame").scrollWidth,
        wrappedButtons: [...document.querySelectorAll(".bidder-goods-panel button")]
          .filter((button) => button.scrollWidth > button.clientWidth + 1)
          .map((button) => button.textContent.trim()),
      }));
      assert.equal(metrics.documentScrollWidth, metrics.documentClientWidth, `document overflow at ${width}px`);
      assert.ok(metrics.frameScrollWidth >= metrics.frameClientWidth, `invalid table width at ${width}px`);
      assert.deepEqual(metrics.wrappedButtons, [], `wrapped button label at ${width}px`);
    }
  } finally {
    await browser.close();
  }
});

test("bidder-goods validation stays hidden until save and then marks the exact field", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const initialState = panelState();
    initialState.rows[0].donGiaDuThau = null;
    initialState.rows[0].thanhTienDuThau = null;
    initialState.pageRows = initialState.rows;
    await page.setContent(`<meta charset="utf-8"><main>${renderBidderGoodsPanelMarkup(initialState)}</main>`);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    assert.equal(await page.locator(".bidder-goods-field-error").count(), 0);
    assert.equal(await page.locator('[data-bidder-goods-field="donGiaDuThau"][aria-invalid="true"]').count(), 0);

    const editingState = { ...initialState, editingId: initialState.rows[0].id };
    await page.setContent(`<meta charset="utf-8"><main>${renderBidderGoodsPanelMarkup(editingState)}</main>`);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });
    const normalShadow = await page.locator('[data-bidder-goods-field="donGiaDuThau"]')
      .evaluate((control) => getComputedStyle(control).boxShadow);
    const attemptedState = {
      ...initialState,
      validationAttempted: true,
      editingId: initialState.rows[0].id,
    };
    await page.setContent(`<meta charset="utf-8"><main>${renderBidderGoodsPanelMarkup(attemptedState)}</main>`);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    const invalidControl = page.locator('[data-bidder-goods-field="donGiaDuThau"]');
    assert.equal(await invalidControl.getAttribute("aria-invalid"), "true");
    assert.match(await page.locator(".bidder-goods-field-error").first().textContent(), /Vui lòng nhập đơn giá dự thầu hợp lệ/);
    assert.equal(await invalidControl.evaluate((control) => control.nextElementSibling?.classList.contains("bidder-goods-field-error")), true);
    assert.notEqual(await invalidControl.evaluate((control) => getComputedStyle(control).boxShadow), normalShadow);
  } finally {
    await browser.close();
  }
});
