import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildLotWinnersModalHtml } from "../../frontend/packages/lotWinnersModal.js";
import { buildContractorInfoModalHtml } from "../../frontend/partners/contractorInfoModal.js";


test("multiple lot winners render every awarded lot in the detail modal", () => {
  const html = buildLotWinnersModalHtml({
    packageName: "Gói thầu nhiều phần lô",
    winners: [
      {
        maPhanLo: "PL1",
        tenPhanLo: "Phần lô 1",
        nhaThauTrungThauId: "nt-1",
        tenNhaThau: "Nhà thầu 1",
        giaTrungThau: 1_000_000,
      },
      {
        maPhanLo: "PL2",
        tenPhanLo: "Phần lô 2",
        nhaThauTrungThauId: "nt-2",
        tenNhaThau: "Nhà thầu 2",
        giaTrungThau: 2_000_000,
      },
    ],
    formatCurrency: (value) => `${Number(value).toLocaleString("vi-VN")} đ`,
  });

  assert.match(html, /Gói thầu nhiều phần lô/);
  assert.match(html, /PL1/);
  assert.match(html, /Nhà thầu 1/);
  assert.match(html, /1\.000\.000 đ/);
  assert.match(html, /PL2/);
  assert.match(html, /Nhà thầu 2/);
  assert.match(html, /2\.000\.000 đ/);
  assert.equal(
    (html.match(/data-bf-action="close-modal"/g) || []).length,
    1,
    "the modal must expose only one close control",
  );
  assert.doesNotMatch(html, /class="modal-footer"/);
  assert.doesNotMatch(html, /class="modal-close"[^>]*>\s*<i/);
  assert.match(html, /class="phanlo-table lot-winners-table"[^>]*data-no-sort="true"/);
  assert.match(html, /data-bf-action="show-contractor-modal"[\s\S]*?data-id="nt-1"/);
  assert.match(html, /data-bf-action="show-contractor-modal"[\s\S]*?data-id="nt-2"/);
  assert.match(
    html,
    /data-close-before="modal-lot-winners"/,
    "opening contractor information must replace the lot-result modal",
  );
});

test("a joint-venture winner opens its member detail", () => {
  const html = buildLotWinnersModalHtml({
    winners: [{
      maPhanLo: "PL1",
      tenPhanLo: "Phần lô 1",
      nhaThauTrungThauId: "nt-lead",
      tenNhaThau: "Liên danh A",
      isJV: true,
      jvKey: "lot-winner:pkg-1:PL1",
      giaTrungThau: 1_000_000,
    }],
  });

  assert.match(html, /data-bf-action="show-jv"[\s\S]*?data-id="lot-winner:pkg-1:PL1"/);
  assert.match(html, /Liên danh/);
});

test("contractor information is rendered as a single-close modal", () => {
  const html = buildContractorInfoModalHtml({
    contractor: {
      maNhaThau: "NT01",
      tenNhaThau: "Nhà thầu 1",
      phienBan: 2,
      maSoThue: "3000123456",
      nguoiDaiDien: "Nguyễn Văn A",
      diaChi: "Hà Nội | Việt Nam",
    },
    formatDate: () => "23/07/2026",
  });

  assert.match(html, /role="dialog"/);
  assert.match(html, /Nhà thầu 1/);
  assert.match(html, /Phiên bản 02/);
  assert.match(html, /3000123456/);
  assert.match(html, /Nguyễn Văn A/);
  assert.match(html, /Hà Nội, Việt Nam/);
  assert.equal((html.match(/data-bf-action="close-modal"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-bf-action="switch-tab"/);
});


test("the delegated winner link has a registered application command", async () => {
  const source = await readFile(
    new URL("../../frontend/app/BiddingController.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /const showLotWinnersModal = \(id\) =>/);
  assert.match(source, /const showNhaThauInfoModal = \(id\) =>/);
  assert.match(source, /commandHandlers = \{[\s\S]*showLotWinnersModal,/);
  assert.match(source, /commandHandlers = \{[\s\S]*showNhaThauInfoModal,/);
  assert.match(source, /case "show-contractor-modal":[\s\S]*call\("showNhaThauInfoModal", id\)/);
  assert.match(source, /case "show-lot-winners":[\s\S]*call\("showLotWinnersModal", id\)/);
});

test("the package table binds its winner link directly", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/GoiThauTable.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /function bindLotWinnerActions\(tableBody, view\)/);
  assert.match(source, /winnerInfoHtml = `<button type="button" data-bf-action="show-lot-winners"/);
  assert.match(source, /ntLink = `<a href="#" data-bf-action="show-contractor-modal"/);
  assert.doesNotMatch(source, /ntLink = `<a href="#" data-bf-action="show-contractor"/);
  assert.match(source, /showLotWinnersModal\(\{ model: view\.model, view \}, action\.dataset\.id\)/);
  assert.match(source, /onRender:[\s\S]*bindLotWinnerActions\(tableBody, this\)/);
});
