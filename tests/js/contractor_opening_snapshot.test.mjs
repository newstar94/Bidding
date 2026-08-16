import test from "node:test";
import assert from "node:assert/strict";

import { collectOpeningBidsFromRows } from "../../frontend/packages/bidProcessOpeningData.js";
import {
  resolveBidContractorName,
  resolveBidJointVentureMembers,
} from "../../frontend/partners/contractorVersionBinding.js";

function openingRow({
  bidId,
  code,
  name,
  type = "Độc lập",
  lookup = {},
  members = [],
}) {
  const fields = new Map([
    [".mt-ma-nha-thau", { value: code }],
    [".mt-ten-nha-thau", { value: name }],
    [".mt-loai-nha-thau", { value: type }],
    [".mt-ma-phan-lo", { value: "" }],
    [".mt-ten-phan-lo", { value: "" }],
    [".mt-ma-dinh-danh", { value: code }],
    [".mt-gia-du-thau", { value: "1000000" }],
    [".mt-gia-sau-giam-gia", { value: "1000000" }],
    [".mt-hieu-luc-hsdt, .mt-hieu-luc-hsdxt", { value: "90" }],
    [".mt-gia-tri-dam-bao, .mt-dam-bao-du-thau", { value: "10000" }],
    [".mt-hieu-luc-bao-dam-ngay, .mt-hieu-luc-dam-bao", { value: "120" }],
    [".mt-thoi-gian-thuc-hien", { value: "30 ngày" }],
    [".mt-thoi-gian-thuc-hien-hop-dong", { value: "30 ngày" }],
  ]);
  return {
    dataset: {},
    _leadMemberLookupData: structuredClone(lookup),
    _leadMemberName: lookup.tenNhaThau || name,
    _thanhVienLienDanh: structuredClone(members),
    getAttribute: (attribute) => attribute === "data-id" ? bidId : null,
    querySelector: (selector) => fields.get(selector) || null,
  };
}

function contractorModel(contractors, openingDate) {
  return {
    state: {
      goithau: [{ id: "package-1", thoiGianMoThau: openingDate }],
      nhathau: contractors,
      thongtinmothau: [],
    },
    getLatestNhaThau: () => contractors.filter((contractor) => contractor.isLatest === 1),
    parseVND: (value) => Number(value || 0),
  };
}

test("independent opening enrichment is frozen on the bid without mutating its business-date contractor version", () => {
  const contractors = [{
    id: "contractor-v1",
    rootId: "contractor-v1",
    phienBan: "01",
    isLatest: 0,
    ngayApDung: "2025-01-01",
    maNhaThau: "NT-01",
    maSoThue: "0100000001",
    tenNhaThau: "",
    diaChi: "",
    loaiNhaThau: "Độc lập",
  }, {
    id: "contractor-v2",
    rootId: "contractor-v1",
    phienBan: "02",
    isLatest: 1,
    ngayApDung: "2026-01-01",
    maNhaThau: "NT-01",
    maSoThue: "0100000001",
    tenNhaThau: "Future contractor name",
    diaChi: "Future address",
    loaiNhaThau: "Độc lập",
  }];
  const before = structuredClone(contractors);
  const model = contractorModel(contractors, "2025-06-15 09:00:00");
  const changedContractors = [];

  const [bid] = collectOpeningBidsFromRows({
    rows: [openingRow({
      bidId: "bid-1",
      code: "NT-01",
      name: "Lookup contractor name",
      lookup: {
        maSoThue: "0100000001",
        tenNhaThau: "Lookup contractor name",
        diaChi: "Lookup address at opening",
      },
    })],
    gtId: "package-1",
    model,
    isDirectOrSpecial: false,
    changedContractors,
  });

  assert.deepEqual(model.state.nhathau, before);
  assert.deepEqual(changedContractors, []);
  assert.equal(bid.nhaThauId, "contractor-v1");
  assert.equal(bid.tenNhaThau, "Lookup contractor name");

  const reloadedBid = structuredClone(bid);
  assert.equal(resolveBidContractorName(model, reloadedBid), "Lookup contractor name");
});

test("joint-venture lookup details survive reload on member snapshots without rewriting contractor history", () => {
  const contractors = [{
    id: "lead-v1",
    rootId: "lead-v1",
    phienBan: "01",
    isLatest: 1,
    ngayApDung: "2025-01-01",
    maNhaThau: "LEAD-01",
    tenNhaThau: "Historical lead",
    diaChi: "Historical lead address",
    loaiNhaThau: "Độc lập",
  }, {
    id: "member-v1",
    rootId: "member-v1",
    phienBan: "01",
    isLatest: 1,
    ngayApDung: "2025-01-01",
    maNhaThau: "MEMBER-01",
    tenNhaThau: "Historical member",
    diaChi: "Historical member address",
    loaiNhaThau: "Độc lập",
  }];
  const before = structuredClone(contractors);
  const model = contractorModel(contractors, "2025-06-15 09:00:00");
  const changedContractors = [];

  const [bid] = collectOpeningBidsFromRows({
    rows: [openingRow({
      bidId: "bid-jv",
      code: "LEAD-01",
      name: "Joint venture Alpha",
      type: "Liên danh",
      lookup: {
        tenNhaThau: "Lead name at opening",
        diaChi: "Lead address at opening",
        email: "lead@opening.example",
      },
      members: [{
        id: "member-row",
        thanhVienNhaThauId: "member-v1",
        maNhaThau: "MEMBER-01",
        tenNhaThau: "Member name at opening",
        diaChi: "Member address at opening",
        email: "member@opening.example",
      }],
    })],
    gtId: "package-1",
    model,
    isDirectOrSpecial: false,
    changedContractors,
  });

  assert.deepEqual(model.state.nhathau, before);
  assert.deepEqual(changedContractors, []);
  assert.deepEqual(bid.thanhVienLienDanh.map((member) => ({
    contractorId: member.thanhVienNhaThauId,
    name: member.tenNhaThau,
    address: member.diaChi,
    email: member.email,
  })), [{
    contractorId: "lead-v1",
    name: "Lead name at opening",
    address: "Lead address at opening",
    email: "lead@opening.example",
  }, {
    contractorId: "member-v1",
    name: "Member name at opening",
    address: "Member address at opening",
    email: "member@opening.example",
  }]);

  const reloadedMembers = resolveBidJointVentureMembers(model, structuredClone(bid));
  assert.deepEqual(reloadedMembers.map((member) => ({
    name: member.tenNhaThau,
    address: member.diaChi,
    email: member.email,
  })), [{
    name: "Lead name at opening",
    address: "Lead address at opening",
    email: "lead@opening.example",
  }, {
    name: "Member name at opening",
    address: "Member address at opening",
    email: "member@opening.example",
  }]);
});

test("opening before the first contractor version keeps the linked contractor available", () => {
  const contractors = [{
    id: "contractor-v1",
    rootId: "contractor-v1",
    phienBan: "01",
    isLatest: 1,
    ngayApDung: "2026-01-01",
    maNhaThau: "NT-FUTURE",
    tenNhaThau: "Future contractor",
  }];
  const before = structuredClone(contractors);
  const model = contractorModel(contractors, "2025-12-31 09:00:00");
  const changedContractors = [];

  const row = openingRow({
    bidId: "bid-future",
    code: "NT-FUTURE",
    name: "Future contractor",
  });
  row.dataset.contractorVersionId = "contractor-v1";
  row.dataset.contractorBindingSource = "lookup";

  const bids = collectOpeningBidsFromRows({
    rows: [row],
    gtId: "package-1",
    model,
    isDirectOrSpecial: false,
    changedContractors,
  });

  assert.equal(bids[0].nhaThauId, "contractor-v1");
  assert.deepEqual(model.state.nhathau, before);
  assert.deepEqual(changedContractors, []);
});
