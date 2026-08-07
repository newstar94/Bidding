import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const panelSource = fs.readFileSync(
  "frontend/packages/detail/PreparationDetailsPanel.js",
  "utf8",
);
const viewsCss = fs.readFileSync("views/css/views.css", "utf8");
const shell = fs.readFileSync("views/index.html", "utf8");

const APPRAISAL_ROW_IDS = ["wrapper-sobaocaothamdinh", "wrapper-ngaybaocaothamdinh"];

test("appraisal report rows carry no inline display that would defeat hiding", () => {
  // An inline style attribute outranks the class-based runtime styles, so a row
  // rendered with an inline display could never be hidden again when the user
  // picks "Khong".
  for (const rowId of APPRAISAL_ROW_IDS) {
    const start = panelSource.indexOf('id="' + rowId + '"');
    assert.ok(start >= 0, rowId + " must be rendered");
    const openingTag = panelSource.slice(start, panelSource.indexOf(">", start));
    assert.doesNotMatch(openingTag, /style="/u, rowId + " must not set an inline style attribute");
    assert.match(openingTag, /appraisal-report-row/u);
  }
});

test("appraisal report rows are toggled through the hidden attribute", () => {
  for (const rowId of APPRAISAL_ROW_IDS) {
    const pattern = new RegExp('getElementById\\("' + rowId + '"\\)\\?\\.toggleAttribute\\("hidden"', "u");
    assert.match(panelSource, pattern);
  }
});

test("the appraisal row style keeps the hidden attribute effective", () => {
  assert.match(viewsCss, /\.appraisal-report-row\[hidden\]\s*\{[^}]*display:\s*none/su);
  assert.match(
    shell,
    /views\.css[^"\n]*appraisal-report-row-v1-20260807/u,
    "the stylesheet needs a cache-busting revision for the new rule",
  );
});

