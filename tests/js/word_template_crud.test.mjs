import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWordTemplateActions,
} from "../../frontend/partners/PartnerView.js";
import {
  normalizeWordTemplateName,
  templateResourceUrl,
  validateWordTemplateName,
} from "../../frontend/documents/WordIntegration.js";

test("system template actions never include edit or delete", () => {
  const html = buildWordTemplateActions({
    filename: "mau_bao_cao_dau_thau.docx",
    is_system: true,
    is_available: true,
    is_active: false,
  }, true);

  assert.match(html, /btn-activate-template/);
  assert.doesNotMatch(html, /btn-edit-template/);
  assert.doesNotMatch(html, /btn-delete-template/);
});

test("manager can use, edit, and delete a custom template", () => {
  const html = buildWordTemplateActions({
    filename: "bao cao & quyet dinh.docx",
    is_system: false,
    is_available: true,
    is_active: false,
  }, true);

  assert.match(html, /btn-activate-template/);
  assert.match(html, /btn-edit-template/);
  assert.match(html, /btn-delete-template/);
  assert.doesNotMatch(html, /data-filename="bao cao & quyet dinh.docx"/);
});

test("organization employee cannot mutate a custom template", () => {
  const html = buildWordTemplateActions({
    filename: "bao_cao.docx",
    is_system: false,
    is_available: true,
    is_active: false,
  }, false);

  assert.doesNotMatch(html, /btn-activate-template/);
  assert.doesNotMatch(html, /btn-edit-template/);
  assert.doesNotMatch(html, /btn-delete-template/);
});

test("custom template URL encodes the complete filename", () => {
  assert.equal(
    templateResourceUrl("bao cao #1.docx"),
    "/api/templates/bao%20cao%20%231.docx",
  );
});

test("edited template names retain Unicode and receive the docx extension", () => {
  assert.equal(
    normalizeWordTemplateName(" Báo cáo lựa chọn nhà thầu "),
    "Báo cáo lựa chọn nhà thầu.docx",
  );
  assert.equal(validateWordTemplateName("Báo cáo lựa chọn nhà thầu"), "");
  assert.match(validateWordTemplateName("bad/name"), /không hợp lệ/);
});
