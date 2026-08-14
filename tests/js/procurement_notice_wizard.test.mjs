import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  NoticeImportWizard,
  canApplyNoticePreview,
} from "../../frontend/procurement/NoticeImportWizard.js";


test("notice apply gate requires an exact local package target", () => {
  const ready = {
    previewId: "notice-preview",
    blockingIssues: [],
    notice: {
      expectedPackageRowVersion: 3,
      targetPackage: { rootId: "root-b", snapshotId: "package-b" },
    },
  };
  assert.equal(canApplyNoticePreview(ready), true);
  assert.equal(canApplyNoticePreview({
    ...ready,
    blockingIssues: [{ code: "PROCUREMENT_NOTICE_PACKAGE_UNRESOLVED" }],
  }), false);
  assert.equal(canApplyNoticePreview({
    ...ready,
    notice: { ...ready.notice, targetPackage: null },
  }), false);
});


test("notice wizard cleanup revokes preview authority", () => {
  const applyButton = { disabled: false };
  const wizard = Object.create(NoticeImportWizard.prototype);
  wizard.modal = {
    querySelector: (selector) => (
      selector === "[data-procurement-notice-apply]" ? applyButton : null
    ),
  };
  wizard.preview = { previewId: "notice-preview" };
  wizard.requestGeneration = 2;
  wizard.prepareController = { aborted: false, abort() { this.aborted = true; } };
  wizard.applyController = { aborted: false, abort() { this.aborted = true; } };

  wizard.cleanup();

  assert.equal(wizard.preview, null);
  assert.equal(wizard.requestGeneration, 3);
  assert.equal(wizard.prepareController.aborted, true);
  assert.equal(wizard.applyController.aborted, true);
  assert.equal(applyButton.disabled, true);
});


test("package modal keeps IB enrichment inline while legacy wizard remains non-primary", () => {
  const packageModal = fs.readFileSync("views/modals/modal_goithau.html", "utf8");
  const noticeModal = fs.readFileSync(
    "views/modals/modal_procurement_notice_import.html", "utf8",
  );
  const controller = fs.readFileSync("frontend/app/BiddingController.js", "utf8");
  const workflows = fs.readFileSync("frontend/packages/BiddingWorkflows.js", "utf8");

  assert.match(packageModal, /id="procurement-lookup-package-enabled"/);
  assert.doesNotMatch(packageModal, /id="btn-open-procurement-lookup-package"/);
  assert.doesNotMatch(packageModal, /id="btn-open-procurement-notice-import"/);
  assert.match(noticeModal, /id="modal-procurement-notice-import"/);
  assert.match(noticeModal, /aria-live="polite"/);
  assert.match(controller, /"modal-procurement-notice-import"/);
  assert.match(workflows, /NoticeImportWizard\.js/);
});
