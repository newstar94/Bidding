import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const formSource = fs.readFileSync("frontend/app/BiddingControllerForms.js", "utf8");
const modalSource = fs.readFileSync("views/modals/modal_goithau.html", "utf8");

test("shows the medicine selector when the package field is goods", () => {
  assert.match(
    formSource,
    /if \(val === "Hàng hóa"\) \{\s*setVisible\(gtGoiThauThuocContainer, true\);/,
  );
  assert.match(
    formSource,
    /setVisible\(gtGoiThauThuocContainer, linhVuc === "Hàng hóa"\);/,
  );
  assert.doesNotMatch(
    formSource,
    /setVisible\(gtGoiThauThuocContainer, (?:true|linhVuc === "Hàng hóa"), ""\)/,
  );
});

test("keeps each medicine radio aligned with its label", () => {
  assert.match(modalSource, /<div class="radio-options">/);
  assert.equal((modalSource.match(/<label class="radio-option">/g) || []).length, 2);
  assert.equal((modalSource.match(/class="radio-option-input"/g) || []).length, 2);
});
