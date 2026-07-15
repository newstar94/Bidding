import test from "node:test";
import assert from "node:assert/strict";

import {
  renderJointVentureModalBody,
  renderJointVentureModalFooter,
  renderJointVentureModalHeader
} from "../../frontend/packages/detail/JointVentureModal.js";
import { buildAwardJointVentureViewData } from "../../frontend/packages/detail/AwardResultDetailsPanel.js";

test("joint venture modal uses one shared layout for lead and member links", () => {
  assert.match(renderJointVentureModalHeader(), /btn-close-mothau-jv-view/);
  const body = renderJointVentureModalBody({
    leadCodeHtml: '<a data-id="nt-1">VN01</a>',
    leadNameHtml: '<a data-id="nt-1">Nhà thầu A</a>',
    membersHtml: '<div data-id="nt-2">Nhà thầu B</div>'
  });
  assert.match(body, /Thành viên đứng đầu liên danh/);
  assert.match(body, /data-id="nt-1"/);
  assert.match(body, /data-id="nt-2"/);
  assert.match(renderJointVentureModalFooter(), /btn-ok-mothau-jv-view/);
});

test("award result joint venture view resolves lead and members from bound contractor versions", () => {
  const model = { state: { nhathau: [
    { id: "nt-lead-00", maNhaThau: "vn01", maSoThue: "01", tenNhaThau: "Nhà thầu đứng đầu", isLatest: 0, phienBan: "00" },
    { id: "nt-member-00", maNhaThau: "vn02", maSoThue: "02", tenNhaThau: "Nhà thầu thành viên", isLatest: 0, phienBan: "00" }
  ] } };
  const data = buildAwardJointVentureViewData(model, {
    loaiNhaThau: "Liên danh",
    tenNhaThau: "Liên danh A",
    nhaThauId: "nt-lead-00",
    maNhaThau: "vn01",
    thanhVienLienDanh: [
      { thanhVienNhaThauId: "nt-lead-00", vaiTro: "Đứng đầu liên danh" },
      { thanhVienNhaThauId: "nt-member-00", vaiTro: "Thành viên liên danh" }
    ]
  });
  assert.equal(data.leadCode, "vn01");
  assert.equal(data.leadName, "Nhà thầu đứng đầu");
  assert.equal(data.leadContractorVersionId, "nt-lead-00");
  assert.deepEqual(data.members.map(member => member.tenNhaThau), ["Nhà thầu thành viên"]);
});
