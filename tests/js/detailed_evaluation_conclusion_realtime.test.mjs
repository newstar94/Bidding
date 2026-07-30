import assert from "node:assert/strict";
import test from "node:test";

import {
  updateDetailedEvaluationConclusion,
} from "../../frontend/packages/DetailedEvaluationPanelController.js";

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...tokens) => tokens.forEach((token) => values.add(token)),
    remove: (...tokens) => tokens.forEach((token) => values.delete(token)),
    toggle: (token, force) => force ? values.add(token) : values.delete(token),
    contains: (token) => values.has(token),
  };
}

function conclusionDom({ withScore = false } = {}) {
  const mark = (field, value) => ({
    textContent: "-",
    classList: classList(["detailed-evaluation-derived-mark"]),
    attributes: new Map([
      ["data-detailed-derived-field", field],
      ["data-detailed-derived-value", value],
      ["data-detailed-derived-label", "Kết luận"],
    ]),
    getAttribute(name) { return this.attributes.get(name) || ""; },
    setAttribute(name, valueToSet) { this.attributes.set(name, valueToSet); },
  });
  const marks = [
    mark("ketQuaTuDong", "pass"),
    mark("ketQuaTuDong", "fail"),
    mark("ketQua", "pass"),
    mark("ketQua", "fail"),
  ];
  const badge = { textContent: "Đạt", classList: classList(["badge", "badge-success"]) };
  const score = withScore ? { textContent: "" } : null;
  const row = {
    querySelectorAll: (selector) => selector === "[data-detailed-derived-field]" ? marks : [],
    querySelector: (selector) => {
      if (selector === "[data-detailed-conclusion-badge]") return badge;
      if (selector === ".detailed-evaluation-conclusion-score") return score;
      return null;
    },
  };
  return {
    marks,
    badge,
    score,
    root: {
      querySelector: (selector) => selector === "[data-detailed-conclusion-row]" ? row : null,
    },
  };
}

test("detailed evaluation conclusion updates immediately from unsaved checkbox values", () => {
  const criteria = [
    { id: "criterion-1", group: "validity", required: true },
    { id: "criterion-2", group: "validity", required: true },
  ];
  const report = {
    chiTietList: [
      { tieuChiDanhGiaId: "criterion-1", ketQua: "pass", extension: { ketQuaTuDong: "pass" } },
      { tieuChiDanhGiaId: "criterion-2", ketQua: "fail", extension: { ketQuaTuDong: "pass" } },
    ],
  };
  const dom = conclusionDom();

  updateDetailedEvaluationConclusion(dom.root, report, criteria, "validity");

  const expertPass = dom.marks.find((mark) => mark.getAttribute("data-detailed-derived-field") === "ketQua"
    && mark.getAttribute("data-detailed-derived-value") === "pass");
  const expertFail = dom.marks.find((mark) => mark.getAttribute("data-detailed-derived-field") === "ketQua"
    && mark.getAttribute("data-detailed-derived-value") === "fail");
  const automaticPass = dom.marks.find((mark) => mark.getAttribute("data-detailed-derived-field") === "ketQuaTuDong"
    && mark.getAttribute("data-detailed-derived-value") === "pass");
  assert.equal(expertPass.textContent, "-");
  assert.equal(expertFail.textContent, "x");
  assert.equal(automaticPass.textContent, "x");
  assert.equal(dom.badge.textContent, "Không đạt");
  assert.equal(dom.badge.classList.contains("badge-danger"), true);
  assert.equal(dom.badge.classList.contains("badge-success"), false);
});

test("technical score conclusion updates its total before saving", () => {
  const criteria = [
    { id: "technical-1", group: "technical", resultType: "score", required: true },
    { id: "technical-2", group: "technical", resultType: "score", required: true },
  ];
  const report = {
    chiTietList: [
      { tieuChiDanhGiaId: "technical-1", ketQua: "pass", diem: 36.5 },
      { tieuChiDanhGiaId: "technical-2", ketQua: "pass", diem: 42 },
    ],
  };
  const dom = conclusionDom({ withScore: true });

  updateDetailedEvaluationConclusion(dom.root, report, criteria, "technical");

  assert.equal(dom.badge.textContent, "Đạt");
  assert.equal(dom.score.textContent, "Tổng điểm: 78.5");
});
