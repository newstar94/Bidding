import assert from "node:assert/strict";
import test from "node:test";

import {
  bindAwardResultPanel,
  buildAwardedResultPanelMarkup,
} from "../../frontend/packages/detail/AwardResultPanel.js";

function options(overrides = {}) {
  return {
    pkg: {},
    winnerHtml: "Winner",
    bidderRowsHtml: "",
    tableHeaderHtml: "",
    formatCurrency: () => "0 ₫",
    formatDate: () => "",
    ...overrides,
  };
}

test("winning-goods export action is omitted when unavailable and rendered enabled when available", () => {
  assert.doesNotMatch(buildAwardedResultPanelMarkup(options()), /btn-export-winning-goods/);
  const markup = buildAwardedResultPanelMarkup(options({ winningGoodsExportEnabled: true }));
  assert.match(markup, /id="btn-export-winning-goods"/);
  assert.doesNotMatch(markup.match(/<button[^>]+id="btn-export-winning-goods"[^>]*>/)?.[0] || "", /disabled/);
});

test("winning-goods export binding installs its independent Excel action", () => {
  const button = { innerHTML: "Xuất", disabled: false, onclick: null };
  const container = {
    querySelector(selector) {
      if (selector === "#btn-export-winning-goods") return button;
      return null;
    },
  };
  bindAwardResultPanel(container, { onExportWinningGoods: async () => {} });
  assert.equal(typeof button.onclick, "function");
});
