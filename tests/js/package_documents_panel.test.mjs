import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildPackageTabs } from "../../frontend/packages/detail/PackageTabs.js";
import {
  buildPackageDocumentsMarkup,
  formatPackageDocumentBytes,
} from "../../frontend/packages/detail/PackageDocumentsPanel.js";

const packageDocumentsCss = readFileSync(
  new URL("../../views/css/views.css", import.meta.url),
  "utf8",
);

function desktopRule(selector, occurrence = 0) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...packageDocumentsCss.matchAll(
    new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "g"),
  )];
  assert.ok(matches[occurrence], `Missing desktop CSS rule for ${selector}`);
  return matches[occurrence][1];
}


test("package detail always exposes the documents tab", () => {
  for (const trangThai of ["Chuẩn bị", "Đang mời thầu", "Đang chấm thầu", "Đã có kết quả", "Hủy thầu"]) {
    const { tabs } = buildPackageTabs({
      id: "gt-1",
      trangThai,
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      hinhThucLuaChon: "Đấu thầu rộng rãi",
    }, []);
    assert.equal(tabs.some((tab) => tab.id === "documents"), true);
  }
});


test("document panel renders server slots and current file actions", () => {
  const markup = buildPackageDocumentsMarkup({
    packageStatus: "Đang chấm thầu",
    slots: [{
      type: "BID_EVALUATION_REPORT",
      label: "Báo cáo đánh giá E-HSDT",
      icon: "file-check-2",
      canUpload: true,
      canDelete: true,
      document: {
        originalFilename: "bao-cao.pdf",
        sizeBytes: 2 * 1024 * 1024,
        uploadedByName: "Nguyễn Văn A",
        uploadedAt: "2026-07-24T08:00:00Z",
      },
    }],
  });

  assert.match(markup, /Báo cáo đánh giá E-HSDT/);
  assert.match(markup, /bao-cao\.pdf/);
  assert.match(markup, /data-document-download="BID_EVALUATION_REPORT"/);
  assert.match(markup, /data-document-upload="BID_EVALUATION_REPORT"/);
  assert.match(markup, /data-document-delete="BID_EVALUATION_REPORT"/);
  assert.match(markup, /class="package-documents-table"/);
  assert.doesNotMatch(markup, /package-documents-hero/);
  assert.doesNotMatch(markup, /Tài liệu theo bước thực hiện/);
  const typeHeading = markup.indexOf('role="columnheader">Loại tài liệu');
  const documentHeading = markup.indexOf('role="columnheader">Tài liệu');
  const actionHeading = markup.indexOf('role="columnheader">Thao tác');
  assert.ok(typeHeading < documentHeading);
  assert.ok(documentHeading < actionHeading);
  assert.equal(formatPackageDocumentBytes(2 * 1024 * 1024), "2.0 MB");
});


test("read-only document slot omits mutation controls", () => {
  const markup = buildPackageDocumentsMarkup({
    packageStatus: "Đã có kết quả",
    slots: [{
      type: "HSMT",
      label: "Hồ sơ mời thầu",
      document: {
        originalFilename: "hsmt.docx",
        sizeBytes: 1024,
      },
      canUpload: false,
      canDelete: false,
    }],
  });

  assert.match(markup, /data-document-download="HSMT"/);
  assert.doesNotMatch(markup, /data-document-upload="HSMT"/);
  assert.doesNotMatch(markup, /data-document-delete="HSMT"/);
});


test("document action heading and controls share the centered desktop axis", () => {
  const markup = buildPackageDocumentsMarkup({
    slots: [{
      type: "HSMT",
      label: "Hồ sơ mời thầu/E-Hồ sơ mời thầu",
      canUpload: true,
      canDelete: false,
      document: null,
    }],
  });

  assert.match(
    markup,
    /class="package-document-action-heading" role="columnheader">Thao tác/,
  );
  assert.match(
    desktopRule(".package-document-action-heading"),
    /text-align:\s*center\s*;/,
  );
  assert.match(
    desktopRule(".package-document-actions"),
    /justify-content:\s*center\s*;/,
  );
  assert.match(
    desktopRule(".package-document-action-cell", 1),
    /display:\s*flex\s*;[\s\S]*align-items:\s*center\s*;/,
  );
  assert.match(
    desktopRule(".package-document-live-status"),
    /position:\s*absolute\s*;/,
  );
});
