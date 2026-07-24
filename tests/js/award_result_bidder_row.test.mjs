import assert from "node:assert/strict";
import test from "node:test";

import { initializeAwardResultBidderRow } from "../../frontend/packages/detail/AwardResultDetailsPanel.js";

test("dynamic award bidder rows receive the same duration listener as initial rows", () => {
  let inputListener;
  const contractDuration = { value: "" };
  const packageDuration = {
    addEventListener(type, listener) {
      if (type === "input") inputListener = listener;
    },
  };
  const row = {
    querySelectorAll(selector) {
      if (selector === ".row-tg-goithau") return [packageDuration];
      return [];
    },
    querySelector(selector) {
      if (selector === ".row-tg-hopdong") return contractDuration;
      return null;
    },
  };

  initializeAwardResultBidderRow({ model: {} }, row);
  inputListener({ target: { value: "120 ngày" } });

  assert.equal(
    contractDuration.value,
    "120 ngày + Thời gian thực hiện các nghĩa vụ theo hợp đồng",
  );
});
