import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const modalsSource = fs.readFileSync("frontend/packages/GoiThauModals.js", "utf8");
const formsSource = fs.readFileSync("frontend/app/BiddingControllerForms.js", "utf8");
const componentsCss = fs.readFileSync("views/css/components.css", "utf8");

test("form groups lay their label and control out as a flex column with a gap", () => {
  // This is why revealing a group as a block misaligns it: the row gap between
  // label and control disappears, lifting the control above its grid neighbour.
  assert.match(
    componentsCss,
    /\.form-group \{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*6px/su,
  );
});

test("conditionally revealed HSMT form groups keep the flex column layout", () => {
  const revealed = [
    "phathanh-sobaocao-container",
    "phathanh-ngaybaocao-container",
    "phathanh-baodam-container",
  ];
  for (const containerId of revealed) {
    const variable = containerId
      .replace("phathanh-", "")
      .replace(/-container$/, "")
      .replace(/-(\w)/g, (_m, c) => c.toUpperCase());
    assert.ok(variable.length > 0);
  }
  // No conditional reveal of these groups may use "block".
  const blockReveals = modalsSource.match(/setRuntimeStyle\(\s*(?:soBaoCaoContainer|ngayBaoCaoContainer|baodamContainer)[^;]*"block"/gsu);
  assert.equal(
    blockReveals,
    null,
    "revealing a form group as a block removes the label/control gap",
  );
  assert.match(modalsSource, /soBaoCaoContainer, "display", hasAudit \? "flex" : "none"/u);
  assert.match(modalsSource, /ngayBaoCaoContainer, "display", hasAudit \? "flex" : "none"/u);
  assert.match(modalsSource, /setRuntimeStyle\(baodamContainer, "display", "flex"\)/u);
});

test("the appraisal radio handler reveals its form groups with the default flex display", () => {
  assert.match(formsSource, /setVisible\(soBaoCaoContainer, show\);/u);
  assert.match(formsSource, /setVisible\(ngayBaoCaoContainer, show\);/u);
  assert.doesNotMatch(formsSource, /setVisible\(soBaoCaoContainer, show, "block"\)/u);
  assert.doesNotMatch(formsSource, /setVisible\(ngayBaoCaoContainer, show, "block"\)/u);
});

