import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const viewSource = fs.readFileSync("frontend/app/BiddingView.js", "utf8");
const cssSource = fs.readFileSync("views/css/components.css", "utf8");
const indexSource = fs.readFileSync("views/index.html", "utf8");
const methodStart = viewSource.indexOf("customVersionDeleteChoice(");
const methodEnd = viewSource.indexOf("customSelectConfirm(", methodStart);
const methodSource = viewSource.slice(methodStart, methodEnd);

test("version delete dialog keeps correct Vietnamese and responsive action layout", () => {
  assert.ok(methodStart >= 0 && methodEnd > methodStart);
  assert.match(methodSource, /cancelChoiceBtn\.textContent = "Hủy"/u);
  assert.match(methodSource, /cardEl\.classList\.add\("version-delete-dialog"\)/u);
  assert.match(methodSource, /buttonContainer\.classList\.add\("dialog-buttons-version-delete"\)/u);
  assert.doesNotMatch(methodSource, /white-space:\s*nowrap/u);
  assert.match(
    cssSource,
    /#modal-custom-dialog \.modal-card\.version-delete-dialog\s*\{[^}]*width:\s*min\(680px, calc\(100vw - 32px\)\)/su,
  );
  assert.match(
    cssSource,
    /#dialog-buttons\.dialog-buttons-version-delete\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/su,
  );
  assert.match(
    cssSource,
    /@media \(max-width:\s*680px\)\s*\{[\s\S]*?#dialog-buttons\.dialog-buttons-version-delete\s*\{[^}]*grid-template-columns:\s*1fr/su,
  );
  assert.match(
    indexSource,
    /components\.css\?v=2\.0&amp;rev=[^"\n]*version-delete-dialog-v1-20260804/u,
  );
});
