import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { serializeOutboundRecord } from "../../frontend/app/outboundSerializer.js";
import {
  isPackageDraftSaveActive,
  packageSyncRequiresReload,
  persistPackageFormChanges,
  shouldShowPackageSyncFailureDialog,
} from "../../frontend/packages/GoiThauWorkflow.js";
import { deleteGoiThau } from "../../frontend/packages/packageLifecycleWorkflow.js";
import {
  backToPlanDraft,
  handleKeHoachSubmit,
  openPlanBreakdownModal,
  renderBreakdownPackagesList,
  saveIntermediatePlanVersion,
  savePlanBreakdown,
} from "../../frontend/plans/KeHoachWorkflow.js";
import {
  applyDraftAssignmentSelection,
  capturePlanBreakdownDraft,
  boundProcurementRevisionChanges,
  collectPlanBreakdownDraftChanges,
  isPlanBreakdownDraftActive,
  rebasePlanBreakdownDraftAfterServerMerge,
  restorePlanBreakdownDraft,
} from "../../frontend/plans/planBreakdownDraft.js";
import {
  fillPackageFormFromProcurementDraft,
  materializeProcurementRevisionDraft,
  materializeProcurementRevisionIntoExisting,
  materializeProcurementRevisionFromPrevious,
  resolveProcurementImportedPackageStatus,
} from "../../frontend/procurement/ProcurementDraftWorkflow.js";
import { closeModal } from "../../frontend/app/BiddingControllerUI.js";
import {
  createPlanVersionDraftSession,
  hydratePlanVersionDraftSessions,
  savePlanVersionDraftSession,
} from "../../frontend/plans/PlanVersionDraftSession.js";
import { persistExpertFormChanges } from "../../frontend/experts/ChuyenGiaWorkflow.js";
import {
  completeProcurementPlanImportRevision,
  originatePlanImportFlow,
  startProcurementPlanImport,
} from "../../frontend/procurement/PlanImportWizard.js";
import { SequentialRevisionController } from "../../frontend/procurement/SequentialRevisionController.js";

test("procurement package status projection caps source lifecycle and preserves local progress", () => {
  assert.equal(resolveProcurementImportedPackageStatus({
    sourceStatus: "Đang chấm thầu",
    isNew: true,
    hasPublishedNotice: true,
  }), "Đang mời thầu");
  assert.equal(resolveProcurementImportedPackageStatus({
    sourceStatus: "Đã có kết quả",
    existingStatus: "Đang mời thầu",
    hasPublishedNotice: true,
  }), "Đang mời thầu");
  assert.equal(resolveProcurementImportedPackageStatus({
    sourceStatus: "Đã có kết quả",
    existingStatus: "Đang chấm thầu",
    hasPublishedNotice: true,
  }), "Đang chấm thầu");
});

test("procurement resync preserves existing appraisal and workflow state", () => {
  const state = {
    kehoach: [{ id: "plan-00", rootId: "plan-00", phienBan: "00", rowVersion: 1 }],
    goithau: [{
      id: "package-1",
      rootId: "package-1",
      keHoachId: "plan-00",
      phienBan: "00",
      rowVersion: 3,
      trangThai: "Đang chấm thầu",
      hieuLucHsdt: 60,
      hieuLucDamBaoDuThau: 99,
      yeuCauThamDinhHsmt: "Có",
      yeuCauThamDinhHsmtCode: "REQUIRED",
      sourceRevision: { stablePackageId: "stable-1" },
    }],
  };

  const result = materializeProcurementRevisionIntoExisting(
    state,
    "plan-00",
    {
      revisionNumber: "00",
      packageDrafts: [{
        tenGoiThau: "Gói đã có kết quả ở nguồn",
        trangThai: "Đã có kết quả",
        hieuLucHsdt: 90,
        yeuCauThamDinhHsmt: "Không",
        yeuCauThamDinhHsmtCode: "NOT_REQUIRED",
        sourceRevision: { stablePackageId: "stable-1" },
        noticeLink: {
          state: "LINKED", kind: "TBMT", noticeNo: "IB2600000001",
          noticeRevisionId: "notice-00", noticeVersion: "00",
        },
      }],
    },
  );

  assert.equal(result.packages[0].trangThai, "Đang chấm thầu");
  assert.equal(result.packages[0].hieuLucDamBaoDuThau, 99);
  assert.equal(result.packages[0].yeuCauThamDinhHsmt, "Có");
  assert.equal(result.packages[0].yeuCauThamDinhHsmtCode, "REQUIRED");
});

test("procurement resync preserves existing goods and stable lot ids", () => {
  let sequence = 0;
  const state = {
    kehoach: [{ id: "plan-00", rootId: "plan-00", phienBan: "00", rowVersion: 1 }],
    goithau: [{
      id: "package-1",
      rootId: "package-1",
      keHoachId: "plan-00",
      phienBan: "00",
      rowVersion: 3,
      trangThai: "Đang mời thầu",
      phanLo: "Có",
      phanLoList: [{ id: "lot-local-1", maPhanLo: "PP01", tenPhanLo: "Phần 1" }],
      sourceRevision: { stablePackageId: "stable-1" },
    }],
    goithauhanghoa: [{
      id: "goods-local-1",
      goiThauId: "package-1",
      phanLoId: "lot-local-1",
      maHangHoa: "1.1",
      tenHangHoa: "Tên người dùng đã chỉnh",
      donViTinh: "Hộp",
      soLuong: 9,
    }],
  };

  materializeProcurementRevisionIntoExisting(state, "plan-00", {
    revisionNumber: "00",
    packageDrafts: [{
      tenGoiThau: "Gói nguồn",
      phanLo: true,
      danhSachPhanLo: [{ lotNo: "pp01", lotName: "Phần 1" }],
      danhSachHangHoa: [{
        maPhanLo: "PP01", maHangHoa: "1.1", tenHangHoa: "Tên từ MSC",
        donViTinh: "Hộp", soLuong: 12,
      }],
      sourceRevision: { stablePackageId: "stable-1" },
    }],
  }, { createId: (kind) => `${kind}-${++sequence}` });

  assert.equal(state.goithau[0].phanLoList[0].id, "lot-local-1");
  assert.equal(state.goithauhanghoa.length, 1);
  assert.equal(state.goithauhanghoa[0].id, "goods-local-1");
  assert.equal(state.goithauhanghoa[0].tenHangHoa, "Tên người dùng đã chỉnh");
  assert.equal(state.goithauhanghoa[0].soLuong, 9);
});

test("procurement resync backfills goods when the existing package has none", () => {
  let sequence = 0;
  const state = {
    kehoach: [{ id: "plan-00", rootId: "plan-00", phienBan: "00", rowVersion: 1 }],
    goithau: [{
      id: "package-1",
      rootId: "package-1",
      keHoachId: "plan-00",
      phienBan: "00",
      rowVersion: 3,
      trangThai: "Đang mời thầu",
      phanLo: "Có",
      phanLoList: [{ id: "lot-local-1", maPhanLo: "PP01", tenPhanLo: "Phần 1" }],
      sourceRevision: { stablePackageId: "stable-1" },
    }],
    goithauhanghoa: [],
  };

  materializeProcurementRevisionIntoExisting(state, "plan-00", {
    revisionNumber: "00",
    packageDrafts: [{
      tenGoiThau: "Gói nguồn",
      phanLo: true,
      danhSachPhanLo: [{ lotNo: "PP01", lotName: "Phần 1" }],
      danhSachHangHoa: [{
        maPhanLo: "PP01", maHangHoa: "1.1", tenHangHoa: "Tên từ MSC",
        donViTinh: "Hộp", soLuong: 12,
      }],
      sourceRevision: { stablePackageId: "stable-1" },
    }],
  }, { createId: (kind) => `${kind}-${++sequence}` });

  assert.equal(state.goithauhanghoa.length, 1);
  assert.equal(state.goithauhanghoa[0].goiThauId, "package-1");
  assert.equal(state.goithauhanghoa[0].phanLoId, "lot-local-1");
  assert.equal(state.goithauhanghoa[0].maHangHoa, "1.1");
});

test("package procurement draft fills lifecycle and tender milestone controls", () => {
  const controls = new Map([
    "gt-ma", "gt-ten", "gt-gia", "gt-thoigian", "gt-linhvuc",
    "gt-hinhthuc", "gt-phuongthuc", "gt-phuongphapdanhgia", "gt-nguonvon",
    "gt-loaihopdong", "gt-thoigiantochuc", "gt-thoigianbatdautochuc",
    "gt-quatmang", "gt-trongnuocquocte", "gt-tuychonmuathem", "gt-phanlo",
    "gt-giatribaomothau", "gt-soquyetdinh", "gt-ngayquyetdinh",
    "gt-thoigiandangtai", "gt-thoigiandongthau", "gt-thoigianmothau",
    "gt-thoigianmoehsdxtc", "gt-hieuluchsdt", "gt-hieuluchbaomothau", "gt-trangthai",
  ].map((id) => [id, { id, value: "", disabled: false, dispatchEvent() {} }]));
  const medicineRadios = new Map([
    ["0", { value: "0", checked: true, disabled: false, dispatchEvent() {} }],
    ["1", { value: "1", checked: false, disabled: false, dispatchEvent() {} }],
  ]);
  const document = {
    getElementById: (id) => controls.get(id) || null,
    querySelector: (selector) => {
      const match = /input\[name="gt-goithauthuoc"\]\[value="([01])"\]/.exec(selector);
      return match ? medicineRadios.get(match[1]) : null;
    },
    querySelectorAll: (selector) => (
      selector === 'input[name="gt-goithauthuoc"]'
        ? [...medicineRadios.values()]
        : []
    ),
  };
  const additionalPurchaseRows = [];
  fillPackageFormFromProcurementDraft(document, {
    maGoiThau: "IB2600374868",
    trangThai: "Đang chấm thầu",
    hieuLucHsdt: 90,
    goiThauThuoc: true,
    phanLo: true,
    danhSachPhanLo: [{
      lotNo: "PP2600000001",
      lotName: "Phần 1",
      lotPrice: 7_783_488_780,
      bidGuarantee: null,
      executionPeriod: "24 tháng",
    }],
    tuyChonMuaThem: true,
    tuyChonMuaThemList: [{
      sourceItemId: "option-1",
      hangMuc: "Phim X-Quang kỹ thuật số",
      donVi: "tấm",
      soLuong: 6000,
      tyLe: 0.3,
      giaTriUocTinh: 123_360_000,
    }],
    giaTriBaoDamDuThau: 52_183_040,
    soQuyetDinh: "123/QĐ-E-HSMT",
    ngayQuyetDinh: "2026-07-15T00:00:00",
    thoiGianDangTai: "2026-07-16T09:00:00",
    thoiGianDongThau: "2026-08-03T13:00:00",
    thoiGianMoThau: "2026-08-03T13:08:42",
    thoiGianMoEhsdxtc: "2026-08-03T16:20:00",
  }, {
    model: {
      formatVND: (value) => String(value),
      formatForDateInput: (value) => `DATE:${value}`,
      formatForDatetimeLocal: (value) => `DATETIME:${value}`,
    },
    _loadPhanLoRows: () => {
      // The real lot loader recalculates the package-level guarantee from
      // lot guarantees. MSC sometimes supplies only the package-level value.
      controls.get("gt-giatribaomothau").value = "0";
    },
    _loadTuyChonMuaThemRows: (rows) => additionalPurchaseRows.push(...rows),
  });

  assert.equal(controls.get("gt-trangthai").value, "Đang chấm thầu");
  assert.equal(controls.get("gt-giatribaomothau").value, "52183040");
  assert.equal(controls.get("gt-hieuluchsdt").value, "90");
  assert.equal(controls.get("gt-hieuluchbaomothau").value, "120");
  assert.equal(medicineRadios.get("1").checked, true);
  assert.equal(medicineRadios.get("0").checked, false);
  assert.equal(controls.get("gt-tuychonmuathem").value, "Có");
  assert.deepEqual(additionalPurchaseRows, [{
    sourceItemId: "option-1",
    hangMuc: "Phim X-Quang kỹ thuật số",
    donVi: "tấm",
    soLuong: 6000,
    tyLe: 0.3,
    giaTriUocTinh: 123_360_000,
  }]);
  assert.equal(controls.get("gt-soquyetdinh").value, "123/QĐ-E-HSMT");
  assert.equal(controls.get("gt-ngayquyetdinh").value, "DATE:2026-07-15T00:00:00");
  assert.equal(controls.get("gt-thoigiandangtai").value, "DATETIME:2026-07-16T09:00:00");
  assert.equal(controls.get("gt-thoigianmothau").value, "DATETIME:2026-08-03T13:08:42");
  assert.equal(controls.get("gt-thoigianmoehsdxtc").value, "DATETIME:2026-08-03T16:20:00");
});

test("prepared plan revision materializes source packages into one memory-only breakdown draft", () => {
  const state = {
    kehoach: [], goithau: [], goithauhanghoa: [], thongtinmothau: [],
    hanghoaduthaunhathau: [], assignments: [],
  };
  const result = materializeProcurementRevisionDraft(state, {
    revisionNumber: "00",
    planDraft: {
      maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 00",
      loaiHinhMuaSam: "Dự án", phienBan: "00",
      sourceRevision: { revisionId: "rev-00", revisionNumber: "00" },
    },
    packageDrafts: [{
      maGoiThau: "IB2600000001", tenGoiThau: "Gói A", giaGoiThau: 100,
      trangThai: "PREPARING",
      phanLo: true, danhSachPhanLo: [{ lotNo: "01", lotName: "Lô 1", lotPrice: 100 }],
      sourceRevision: { revisionId: "rev-00", revisionNumber: "00", packageObservationId: "detail-a" },
      danhSachHangHoa: [{
        sourceItemId: "1.1", sourceIndex: "1.1",
        maPhanLo: "01", tenPhanLo: "Lô 1", maHangHoa: "1.1",
        tenHangHoa: "Hóa chất A", donViTinh: "Hộp", soLuong: 12,
        yeuCauKyThuat: "Yêu cầu kỹ thuật A",
      }],
    }],
  }, {
    createId: (() => {
      const ids = {};
      return (kind) => `${kind}-draft-${ids[kind] = (ids[kind] || 0) + 1}`;
    })(),
    timestamp: "2026-08-13 10:00:00",
  });

  assert.equal(state.kehoach.length, 1);
  assert.equal(state.goithau.length, 1);
  assert.equal(state.goithau[0].keHoachId, state.kehoach[0].id);
  assert.equal(state.goithau[0].phanLo, "Có");
  assert.equal(state.goithau[0].trangThai, "Chuẩn bị");
  assert.equal(state.goithau[0].phanLoList[0].maPhanLo, "01");
  assert.ok(state.goithau[0].phanLoList[0].id);
  assert.equal(state.goithauhanghoa.length, 1);
  assert.equal(state.goithauhanghoa[0].goiThauId, state.goithau[0].id);
  assert.equal(state.goithauhanghoa[0].phanLoId, state.goithau[0].phanLoList[0].id);
  assert.equal(state.goithauhanghoa[0].maHangHoa, "1.1");
  assert.equal(state.goithauhanghoa[0].tenHangHoa, "Hóa chất A");
  assert.equal(state.goithauhanghoa[0].donViTinh, "Hộp");
  assert.equal(state.goithauhanghoa[0].soLuong, 12);
  assert.equal(state.goithauhanghoa[0].yeuCauKyThuat, "Yêu cầu kỹ thuật A");
  assert.equal(state.goithau[0].phienBan, "00");
  assert.equal(state.goithau[0].sourceRevision.packageObservationId, "detail-a");
  assert.equal(state.kehoach[0]._procurementImportCurrent, true);
  assert.equal(state.goithau[0]._procurementImportCurrent, true);
  assert.equal(result.draft.active, true);
  assert.deepEqual(result.draft.snapshot.goithau, []);
});

test("non-lot procurement package drops a synthetic source lot before sync", () => {
  const state = {
    kehoach: [], goithau: [], goithauhanghoa: [], thongtinmothau: [],
    hanghoaduthaunhathau: [], assignments: [],
  };
  materializeProcurementRevisionDraft(state, {
    revisionNumber: "00",
    planDraft: {
      maKeHoach: "PL2600048068",
      tenKeHoach: "Mua may giat cong nghiep va may phan tich huyet hoc",
    },
    packageDrafts: [{
      tenGoiThau: "Mua may giat cong nghiep va may phan tich huyet hoc",
      phanLo: false,
      danhSachPhanLo: [{
        lotNo: "BP2600113130",
        lotName: "Mua may giat cong nghiep va may phan tich huyet hoc",
        lotPrice: 898_000_000,
      }],
      danhSachHangHoa: [{
        sourceItemId: "source-goods-1",
        maPhanLo: "BP2600113130",
        maHangHoa: "1",
        tenHangHoa: "May giat cong nghiep",
        donViTinh: "Cai",
        soLuong: 1,
      }],
    }],
  }, {
    createId: (() => {
      let sequence = 0;
      return (kind) => `${kind}-non-lot-${++sequence}`;
    })(),
    timestamp: "2026-08-15T00:00:00Z",
  });

  assert.equal(state.goithau[0].phanLo, "Không");
  assert.deepEqual(state.goithau[0].phanLoList, []);
  assert.equal(state.goithauhanghoa.length, 1);
  assert.equal(state.goithauhanghoa[0].phanLoId, null);
});

test("revision 01 keeps procurement purchase-option flags sync-safe for inherited and new packages", () => {
  let sequence = 0;
  const state = {
    chudautu: [], kehoach: [], goithau: [], goithauhanghoa: [],
    thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  const revision00 = materializeProcurementRevisionDraft(state, {
    revisionNumber: "00",
    planDraft: { maKeHoach: "PL2600225773", phienBan: "00" },
    packageDrafts: [{
      tenGoiThau: "Goi ke thua",
      tuyChonMuaThem: false,
      sourceRevision: { stablePackageId: "stable-inherited", revisionNumber: "00" },
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-13 10:00:00",
  });

  assert.equal(revision00.packages[0].tuyChonMuaThem, "Không");

  const revision01 = materializeProcurementRevisionFromPrevious(
    state,
    revision00.plan.id,
    {
      revisionNumber: "01",
      planDraft: { maKeHoach: "PL2600225773", phienBan: "01" },
      packageDrafts: [
        {
          tenGoiThau: "Goi ke thua 01",
          tuyChonMuaThem: true,
          sourceRevision: { stablePackageId: "stable-inherited", revisionNumber: "01" },
        },
        {
          tenGoiThau: "Goi moi 01",
          tuyChonMuaThem: false,
          sourceRevision: { stablePackageId: "stable-new", revisionNumber: "01" },
        },
      ],
    },
    {
      createId: (kind) => `${kind}-${++sequence}`,
      timestamp: "2026-08-13 11:00:00",
    },
  );

  assert.deepEqual(
    revision01.packages.map((row) => row.tuyChonMuaThem),
    ["Có", "Không"],
  );
  assert.ok(revision01.packages.every((row) => typeof row.tuyChonMuaThem === "string"));
  assert.deepEqual(
    revision01.packages.map(
      (row) => serializeOutboundRecord(row, "goithau").tuyChonMuaThem,
    ),
    ["Có", "Không"],
  );
});

test("revision 01 inherits local-only aggregate state and applies source-owned package fields", () => {
  let sequence = 0;
  const state = {
    chudautu: [],
    kehoach: [{
      id: "plan-00", rootId: "plan-00", phienBan: "00", isLatest: 1,
      maKeHoach: "PL2600000001", ghiChuNoiBo: "Giữ local",
    }],
    goithau: [{
      id: "pkg-00", rootId: "pkg-00", phienBan: "01", isLatest: 1,
      keHoachId: "plan-00", tenGoiThau: "Tên 00", giaGoiThau: 100,
      ghiChuNoiBo: "Ghi chú local",
      sourceRevision: { stablePackageId: "stable-a" },
    }],
    goithauhanghoa: [{ id: "goods-00", goiThauId: "pkg-00" }],
    thongtinmothau: [], hanghoaduthaunhathau: [],
    assignments: [{ id: "assign-00", targetId: "pkg-00", type: "goithau", empId: "user-1" }],
  };
  const result = materializeProcurementRevisionFromPrevious(state, "plan-00", {
    revisionNumber: "01",
    planDraft: { maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 01", phienBan: "01" },
    packageDrafts: [{
      tenGoiThau: "Tên 01", giaGoiThau: 200,
      sourceRevision: { stablePackageId: "stable-a", revisionNumber: "01" },
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-13 11:00:00",
  });

  assert.equal(result.plan.phienBan, "01");
  assert.equal(state.kehoach.find((row) => row.id === "plan-00")._procurementImportCurrent, false);
  assert.equal(result.plan._procurementImportCurrent, true);
  assert.equal(state.goithau.find((row) => row.id === "pkg-00")._procurementImportCurrent, false);
  assert.equal(result.packages[0]._procurementImportCurrent, true);
  assert.equal(result.plan.rootId, "plan-00");
  assert.equal(result.plan.ghiChuNoiBo, "Giữ local");
  assert.equal(result.packages[0].tenGoiThau, "Tên 01");
  assert.equal(result.packages[0].giaGoiThau, 200);
  assert.equal(
    result.packages[0].phienBan,
    "00",
    "a plan revision must not become a package revision",
  );
  assert.equal(result.packages[0].ghiChuNoiBo, "Ghi chú local");
  assert.equal(result.packages[0].keHoachId, result.plan.id);
  assert.equal(state.assignments.at(-1).targetId, result.packages[0].id);
  assert.equal(result.draft.active, true);
});

test("linked notice version independently advances the package version", () => {
  let sequence = 0;
  const state = {
    chudautu: [],
    kehoach: [{
      id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 1,
      maKeHoach: "PL2600225773",
    }],
    goithau: [{
      id: "pkg-00", rootId: "pkg-root", phienBan: "00", isLatest: 1,
      keHoachId: "plan-00", tenGoiThau: "Gói A 00",
      noticeLink: { state: "LINKED", noticeNo: "IB2600000001", noticeVersion: "00" },
      sourceRevision: { stablePackageId: "stable-a" },
    }],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };

  const result = materializeProcurementRevisionFromPrevious(state, "plan-00", {
    revisionNumber: "01",
    planDraft: { maKeHoach: "PL2600225773", phienBan: "01" },
    packageDrafts: [{
      tenGoiThau: "Gói A thông báo 01",
      noticeLink: { state: "LINKED", noticeNo: "IB2600000001", noticeVersion: "01" },
      sourceRevision: { stablePackageId: "stable-a", revisionNumber: "01" },
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-13 12:00:00",
  });

  assert.equal(result.plan.phienBan, "01");
  assert.equal(result.packages[0].phienBan, "01");
});

test("a linked notice first seen in the next plan revision keeps every notice version", () => {
  let sequence = 0;
  const state = {
    chudautu: [],
    kehoach: [{
      id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 1,
      maKeHoach: "PL2600219933",
    }],
    goithau: [{
      id: "pkg-plan-00", rootId: "pkg-root", phienBan: "00", isLatest: 1,
      keHoachId: "plan-00", tenGoiThau: "Gói thầu số 01",
      noticeLink: { state: "UNLINKED" },
      sourceRevision: { stablePackageId: "BP2600546627" },
      phanLo: "Có", phanLoList: [],
    }],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  const notice00 = {
    maGoiThau: "IB2600399197",
    tenGoiThau: "Gói thầu số 01",
    noticeLink: {
      state: "LINKED", kind: "TBMT", noticeNo: "IB2600399197",
      noticeRevisionId: "notice-00", noticeVersion: "00",
    },
    sourceRevision: {
      stablePackageId: "BP2600546627", packageObservationId: "detail-01",
      packageRevisionNumber: "00",
    },
    phanLo: true,
    danhSachPhanLo: [{ maPhanLo: "PP01", tenPhanLo: "Phần 1" }],
    danhSachHangHoa: [{
      sourceItemId: "goods-00", maPhanLo: "PP01", maHangHoa: "1.1",
      tenHangHoa: "Hóa chất 00", donViTinh: "ml", soLuong: 10,
    }],
  };
  const notice01 = {
    ...notice00,
    noticeLink: {
      ...notice00.noticeLink,
      noticeRevisionId: "notice-01", noticeVersion: "01",
    },
    sourceRevision: {
      ...notice00.sourceRevision,
      packageRevisionNumber: "01",
    },
    danhSachHangHoa: [{
      sourceItemId: "goods-01", maPhanLo: "PP01", maHangHoa: "1.1",
      tenHangHoa: "Hóa chất 01", donViTinh: "ml", soLuong: 20,
    }],
  };

  const result = materializeProcurementRevisionFromPrevious(state, "plan-00", {
    revisionNumber: "01",
    planDraft: { maKeHoach: "PL2600219933", phienBan: "01" },
    packageDrafts: [notice01],
    packageRevisionHistories: [{
      packageObservationId: "detail-01",
      stablePackageId: "BP2600546627",
      noticeNo: "IB2600399197",
      revisions: [notice00, notice01],
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-17 04:00:00",
  });

  const lineage = state.goithau.filter(
    (row) => row.keHoachId === result.plan.id && row.rootId === "pkg-root",
  ).sort((left, right) => Number(left.phienBan) - Number(right.phienBan));
  assert.deepEqual(lineage.map((row) => row.phienBan), ["00", "01"]);
  assert.deepEqual(lineage.map((row) => row.isLatest), [0, 1]);
  assert.equal(result.packages.length, 1, "only the latest notice version is editable");
  assert.deepEqual(
    lineage.map((pkg) => state.goithauhanghoa
      .filter((item) => item.goiThauId === pkg.id)
      .map((item) => item.tenHangHoa)),
    [["Hóa chất 00"], ["Hóa chất 01"]],
  );
});

test("resync backfills a missing linked-notice predecessor and its goods", () => {
  let sequence = 0;
  const state = {
    chudautu: [],
    kehoach: [{
      id: "plan-01", rootId: "plan-root", phienBan: "01", isLatest: 1,
      maKeHoach: "PL2600219933", rowVersion: 1,
    }],
    goithau: [{
      id: "pkg-01", rootId: "pkg-root", phienBan: "01", isLatest: 1,
      keHoachId: "plan-01", tenGoiThau: "Gói thầu số 01",
      maGoiThau: "IB2600399197", phanLo: "Có", phanLoList: [],
      noticeLink: {
        state: "LINKED", kind: "TBMT", noticeNo: "IB2600399197",
        noticeRevisionId: "notice-01", noticeVersion: "01",
      },
      sourceRevision: {
        stablePackageId: "BP2600546627", packageObservationId: "detail-01",
        packageRevisionNumber: "01",
      },
    }],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  const notice00 = {
    maGoiThau: "IB2600399197", tenGoiThau: "Gói thầu số 01",
    noticeLink: {
      state: "LINKED", kind: "TBMT", noticeNo: "IB2600399197",
      noticeRevisionId: "notice-00", noticeVersion: "00",
    },
    sourceRevision: {
      stablePackageId: "BP2600546627", packageObservationId: "detail-01",
      packageRevisionNumber: "00",
    },
    phanLo: true,
    danhSachPhanLo: [{ maPhanLo: "PP01", tenPhanLo: "Phần 1" }],
    danhSachHangHoa: [{
      sourceItemId: "goods-00", maPhanLo: "PP01", maHangHoa: "1.1",
      tenHangHoa: "Hóa chất 00", donViTinh: "ml", soLuong: 10,
    }],
  };
  const notice01 = {
    ...notice00,
    noticeLink: {
      ...notice00.noticeLink,
      noticeRevisionId: "notice-01", noticeVersion: "01",
    },
    sourceRevision: {
      ...notice00.sourceRevision,
      packageRevisionNumber: "01",
    },
    danhSachHangHoa: [{
      sourceItemId: "goods-01", maPhanLo: "PP01", maHangHoa: "1.1",
      tenHangHoa: "Hóa chất 01", donViTinh: "ml", soLuong: 20,
    }],
  };

  const result = materializeProcurementRevisionIntoExisting(state, "plan-01", {
    revisionNumber: "01",
    planDraft: { maKeHoach: "PL2600219933", phienBan: "01" },
    packageDrafts: [notice01],
    packageRevisionHistories: [{
      packageObservationId: "detail-01",
      stablePackageId: "BP2600546627",
      noticeNo: "IB2600399197",
      revisions: [notice00, notice01],
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-17 04:10:00",
  });

  const lineage = state.goithau.filter(
    (row) => row.keHoachId === "plan-01" && row.rootId === "pkg-root",
  ).sort((left, right) => Number(left.phienBan) - Number(right.phienBan));
  assert.deepEqual(lineage.map((row) => row.phienBan), ["00", "01"]);
  assert.deepEqual(lineage.map((row) => row.isLatest), [0, 1]);
  assert.equal(result.packages.length, 1);
  assert.deepEqual(
    lineage.map((pkg) => state.goithauhanghoa
      .filter((item) => item.goiThauId === pkg.id)
      .map((item) => item.tenHangHoa)),
    [["Hóa chất 00"], ["Hóa chất 01"]],
  );
});

test("next plan revision backfills notice history when the plan package identity changes", () => {
  let sequence = 0;
  const state = {
    chudautu: [],
    kehoach: [{
      id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 1,
      maKeHoach: "PL2600219933",
    }],
    goithau: [{
      id: "pkg-plan-00", rootId: "pkg-plan-root", phienBan: "00", isLatest: 1,
      keHoachId: "plan-00", tenGoiThau: "Gói thầu số 01",
      sourceRevision: { stablePackageId: "plan-detail-01" },
      noticeLink: { state: "UNLINKED" },
    }],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  const notice00 = {
    maGoiThau: "IB2600399197", tenGoiThau: "Gói thầu số 01",
    noticeLink: {
      state: "LINKED", kind: "TBMT", noticeNo: "IB2600399197",
      noticeRevisionId: "notice-00", noticeVersion: "00",
    },
    sourceRevision: {
      stablePackageId: "BP2600546627", packageObservationId: "notice-detail-01",
      packageRevisionNumber: "00",
    },
    danhSachHangHoa: [{
      sourceItemId: "goods-00", maHangHoa: "1", tenHangHoa: "Hóa chất 00",
      donViTinh: "ml", soLuong: 10,
    }],
  };
  const notice01 = {
    ...notice00,
    noticeLink: {
      ...notice00.noticeLink,
      noticeRevisionId: "notice-01", noticeVersion: "01",
    },
    sourceRevision: {
      ...notice00.sourceRevision,
      packageRevisionNumber: "01",
    },
    danhSachHangHoa: [{
      sourceItemId: "goods-01", maHangHoa: "1", tenHangHoa: "Hóa chất 01",
      donViTinh: "ml", soLuong: 20,
    }],
  };

  const result = materializeProcurementRevisionFromPrevious(state, "plan-00", {
    revisionNumber: "01",
    planDraft: { maKeHoach: "PL2600219933", phienBan: "01" },
    packageDrafts: [notice01],
    packageRevisionHistories: [{
      packageObservationId: "notice-detail-01",
      stablePackageId: "BP2600546627",
      noticeNo: "IB2600399197",
      revisions: [notice00, notice01],
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-17 04:20:00",
  });

  const current = result.packages[0];
  const lineage = state.goithau.filter(
    (row) => row.keHoachId === result.plan.id && row.rootId === current.rootId,
  ).sort((left, right) => Number(left.phienBan) - Number(right.phienBan));
  assert.deepEqual(lineage.map((row) => row.phienBan), ["00", "01"]);
  assert.deepEqual(lineage.map((row) => row.isLatest), [0, 1]);
  assert.deepEqual(
    lineage.map((pkg) => state.goithauhanghoa
      .filter((item) => item.goiThauId === pkg.id)
      .map((item) => item.tenHangHoa)),
    [["Hóa chất 00"], ["Hóa chất 01"]],
  );
});

test("new plan import materializes every prior linked notice revision on one package root", () => {
  let sequence = 0;
  const state = {
    chudautu: [], kehoach: [], goithau: [], goithauhanghoa: [],
    thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  const current = {
    maGoiThau: "IB2600212155",
    tenGoiThau: "Gói người dùng có thể chỉnh trước khi lưu",
    phanLo: false,
    noticeLink: {
      state: "LINKED", kind: "TBMT", noticeNo: "IB2600212155",
      noticeRevisionId: "notice-01", noticeVersion: "01",
    },
    sourceRevision: {
      stablePackageId: "BP2600291019", packageObservationId: "detail-00",
      packageRevisionNumber: "01",
    },
  };
  const result = materializeProcurementRevisionDraft(state, {
    revisionNumber: "00",
    planDraft: { maKeHoach: "PL2600122143", tenKeHoach: "Kế hoạch 00" },
    packageDrafts: [current],
    packageRevisionHistories: [{
      packageObservationId: "detail-00",
      stablePackageId: "BP2600291019",
      noticeNo: "IB2600212155",
      revisions: [{
        ...current,
        tenGoiThau: "Gói tại TBMT 00",
        noticeLink: { ...current.noticeLink, noticeRevisionId: "notice-00", noticeVersion: "00" },
        sourceRevision: { ...current.sourceRevision, packageRevisionNumber: "00" },
      }, current],
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-16 09:00:00",
  });

  const lineage = state.goithau.filter(
    (row) => row.rootId === result.packages[0].rootId,
  ).sort((left, right) => Number(left.phienBan) - Number(right.phienBan));
  assert.deepEqual(lineage.map((row) => row.phienBan), ["00", "01"]);
  assert.deepEqual(lineage.map((row) => row.isLatest), [0, 1]);
  assert.equal(lineage[0].tenGoiThau, "Gói tại TBMT 00");
  assert.equal(lineage[1].tenGoiThau, current.tenGoiThau);
  assert.equal(result.packages.length, 1, "only the latest revision is editable");

  const bounded = boundProcurementRevisionChanges(
    collectPlanBreakdownDraftChanges(state, {
      planId: result.plan.id,
      snapshot: result.draft.snapshot,
    }),
    result.plan.id,
  );
  assert.deepEqual(
    bounded.upserts.goithau.map((row) => row.phienBan).sort(),
    ["00", "01"],
  );
});

test("next plan revision keeps three package lineages when MSC detail ids change", () => {
  let sequence = 0;
  const previousPackages = ["01", "02", "03"].map((symbol) => ({
    id: `pkg-${symbol}-00`,
    rootId: `pkg-${symbol}-root`,
    phienBan: "00",
    isLatest: 1,
    keHoachId: "plan-00",
    tenGoiThau: `Gói thầu số ${symbol}`,
  }));
  const expectedRoots = previousPackages.map((row) => row.rootId).sort();
  const state = {
    chudautu: [],
    kehoach: [{
      id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 1,
      maKeHoach: "PL2600219933",
    }],
    goithau: structuredClone(previousPackages),
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  const packageDrafts = ["01", "02", "03"].map((symbol) => ({
    tenGoiThau: `Gói thầu số ${symbol}`,
    sourceRevision: {
      stablePackageId: `BP26000000${symbol}`,
      packageObservationId: `observation-${symbol}-01`,
      revisionNumber: "01",
      localRootId: `pkg-${symbol}-root`,
    },
  }));

  const result = materializeProcurementRevisionFromPrevious(state, "plan-00", {
    revisionNumber: "01",
    planDraft: { maKeHoach: "PL2600219933", phienBan: "01" },
    packageDrafts,
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-17 05:00:00",
  });

  assert.equal(result.packages.length, 3);
  assert.deepEqual(
    result.packages.map((row) => row.rootId).sort(),
    expectedRoots,
  );
  assert.equal(new Set(state.goithau.map((row) => row.rootId)).size, 3);
});

test("next plan revision matches changed detail ids by package symbol and drops removed packages", () => {
  let sequence = 0;
  const state = {
    chudautu: [],
    kehoach: [{
      id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 1,
      maKeHoach: "PL2600000001",
    }],
    goithau: [
      {
        id: "pkg-a-00", rootId: "pkg-a-root", phienBan: "00", isLatest: 1,
        keHoachId: "plan-00", soHieuGoiThau: "A", tenGoiThau: "A 00",
        sourceRevision: { packageObservationId: "detail-a-00" },
      },
      {
        id: "pkg-b-00", rootId: "pkg-b-root", phienBan: "00", isLatest: 1,
        keHoachId: "plan-00", soHieuGoiThau: "B", tenGoiThau: "B 00",
        sourceRevision: { packageObservationId: "detail-b-00" },
      },
    ],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };

  const result = materializeProcurementRevisionFromPrevious(state, "plan-00", {
    revisionNumber: "01",
    planDraft: { maKeHoach: "PL2600000001", phienBan: "01" },
    packageDrafts: [{
      soHieuGoiThau: "A", tenGoiThau: "A 01",
      sourceRevision: { packageObservationId: "detail-a-01", revisionNumber: "01" },
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-13 12:00:00",
  });

  assert.deepEqual(result.packages.map((row) => row.tenGoiThau), ["A 01"]);
  assert.equal(result.packages[0].rootId, "pkg-a-root");
  assert.equal(
    state.goithau.filter((row) => row.keHoachId === result.plan.id).length,
    1,
  );
  assert.equal(state.goithau.find((row) => row.id === "pkg-b-00").isLatest, 1);
});

test("saving a package inside plan breakdown remains a memory-only draft", async () => {
  const calls = [];
  const controller = {
    model: {
      commitLocalMutation: () => calls.push("commitLocalMutation"),
      persistChanges: async () => calls.push("persistChanges"),
      flushMutationOutbox: async () => calls.push("flushMutationOutbox"),
    },
    autoSync: async () => {
      calls.push("autoSync");
      return { ok: true };
    },
  };

  const result = await persistPackageFormChanges(controller, {
    goithau: [{ id: "pkg-draft", keHoachId: "plan-draft" }],
    kehoach: [{ id: "plan-draft" }],
  }, { draft: true });

  assert.deepEqual(result, { ok: true, draft: true });
  assert.deepEqual(calls, [], "a child modal must not make the draft durable or sync it");
});

test("a durable plan-version draft keeps package modal saves out of /api/sync", async () => {
  const calls = [];
  const plan = {
    id: "plan-01", rootId: "plan-root", phienBan: "01", isLatest: 1,
  };
  const pkg = {
    id: "package-01", rootId: "package-root", phienBan: "00",
    keHoachId: plan.id, isLatest: 1,
  };
  const aggregate = {
    chudautu: [], chuyengia: [], nhathau: [], kehoach: [plan], goithau: [pkg],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  const session = {
    draftId: "draft-1", finalizeMutationId: "finalize-1", rootId: "plan-root",
    revision: 0, currentVersionId: plan.id, aggregate,
  };
  let envelope = { version: 2, sessions: [session], tombstones: {} };
  const controller = {
    model: {
      state: structuredClone(aggregate),
      planVersionDraftSessions: [session],
      db: {
        async update(_key, updater) {
          envelope = updater(envelope);
          return envelope;
        },
      },
      commitLocalMutation: () => calls.push("commitLocalMutation"),
      persistChanges: async () => calls.push("persistChanges"),
      flushMutationOutbox: async () => calls.push("flushMutationOutbox"),
    },
    planBreakdownDraft: null,
    autoSync: async () => { calls.push("autoSync"); return { ok: true }; },
  };

  assert.equal(isPackageDraftSaveActive(controller, "plan-01"), true);
  assert.equal(isPackageDraftSaveActive(controller, "plan-02"), false);
  const result = await persistPackageFormChanges(controller, {
    goithau: [{ ...pkg, tenGoiThau: "Gói đã chỉnh tổ chuyên gia" }],
  });
  assert.deepEqual(result, { ok: true, draft: true });
  assert.deepEqual(calls, []);
});

test("confirmed package row conflict uses the F5 toast without a second failure dialog", () => {
  assert.equal(shouldShowPackageSyncFailureDialog({
    ok: false,
    conflictQuarantined: true,
  }), false);
  assert.equal(shouldShowPackageSyncFailureDialog({
    ok: false,
    reloadRequired: true,
  }), false);
  assert.equal(shouldShowPackageSyncFailureDialog({
    ok: false,
    status: 500,
  }), true);
  assert.equal(shouldShowPackageSyncFailureDialog({
    ok: false,
    status: 400,
  }), true);
  assert.equal(packageSyncRequiresReload({
    ok: false,
    conflictQuarantined: true,
  }), true);
  assert.equal(packageSyncRequiresReload({
    ok: false,
    status: 500,
  }), false);
});

test("editing an existing plan activates the same memory-only breakdown boundary", async () => {
  const calls = [];
  const state = {
    kehoach: [{ id: "plan-01", rootId: "plan-root", phienBan: "01", rowVersion: 7 }],
    goithau: [{ id: "pkg-01", rootId: "pkg-root", keHoachId: "plan-01", rowVersion: 4 }],
    assignments: [],
  };
  const controller = {
    planBreakdownDraft: capturePlanBreakdownDraft(state, {
      planId: "plan-01",
      action: "edit",
    }),
    model: {
      commitLocalMutation: () => calls.push("commitLocalMutation"),
      persistChanges: async () => calls.push("persistChanges"),
      flushMutationOutbox: async () => calls.push("flushMutationOutbox"),
    },
    autoSync: async () => {
      calls.push("autoSync");
      return { ok: true };
    },
  };

  const draftActive = isPlanBreakdownDraftActive(controller, "plan-01");
  const result = await persistPackageFormChanges(controller, {
    goithau: [{ ...state.goithau[0], tenGoiThau: "Gói đã sửa" }],
    assignments: [{
      id: "assignment-01",
      targetId: "pkg-01",
      type: "goithau",
      empId: "expert-01",
    }],
  }, { draft: draftActive });

  assert.equal(draftActive, true);
  assert.deepEqual(result, { ok: true, draft: true });
  assert.deepEqual(calls, [], "editing an existing plan must not push a child save");
});

test("saving an expert inside an edit breakdown session remains memory-only", async () => {
  const calls = [];
  const controller = {
    planBreakdownDraft: { active: true, action: "edit", planId: "plan-01" },
    model: {
      commitLocalMutation: () => calls.push("commitLocalMutation"),
      persistChanges: async () => calls.push("persistChanges"),
      flushMutationOutbox: async () => calls.push("flushMutationOutbox"),
    },
    autoSync: async () => { calls.push("autoSync"); return { ok: true }; },
    async closeModal() { calls.push("closeModal"); },
    view: { renderChuyenGiaTable() { calls.push("render"); } },
  };

  const result = await persistExpertFormChanges(controller, [{
    id: "expert-01", rootId: "expert-01", isLatest: 1, hoTen: "Chuyên gia mới",
  }]);

  assert.deepEqual(result, { ok: true, draft: true });
  assert.deepEqual(calls, ["closeModal", "render"]);
});

test("draft assignments are changed in memory without calling model persistence methods", () => {
  const state = {
    assignments: [
      { id: "a-old", targetId: "pkg-1", type: "goithau", empId: "employee-old" },
    ],
  };
  const model = {
    state,
    addRecord: () => assert.fail("draft assignment must not call addRecord"),
    deleteRecord: () => assert.fail("draft assignment must not call deleteRecord"),
  };

  applyDraftAssignmentSelection(model, {
    targetId: "pkg-1",
    type: "goithau",
    selectedIds: ["employee-new"],
    createId: () => "a-new",
  });

  assert.deepEqual(state.assignments, [
    { id: "a-new", targetId: "pkg-1", type: "goithau", empId: "employee-new" },
  ]);
});

test("draft assignment selection preserves the cloned assignment identity for plan 01", () => {
  const cloned = {
    id: "assignment-plan-01",
    targetId: "pkg-plan-01",
    type: "goithau",
    empId: "employee-1",
    rowVersion: 1,
  };
  const state = { assignments: [cloned] };
  const model = { state, entityIndexes: { invalidate() {} } };

  const selected = applyDraftAssignmentSelection(model, {
    targetId: "pkg-plan-01",
    type: "goithau",
    selectedIds: ["employee-1"],
    createId: () => assert.fail("unchanged assignment must not receive a new id"),
  });

  assert.equal(selected[0], cloned);
  assert.deepEqual(state.assignments, [cloned]);
});

test("committing plan breakdown includes its draft packages, children, assignments and removals", () => {
  const snapshot = {
    chuyengia: [{ id: "expert-1", rootId: "expert-1", isLatest: 1, hoTen: "Before" }],
    assignments: [
      { id: "a-removed", targetId: "pkg-1", type: "goithau", empId: "employee-old" },
    ],
  };
  const state = {
    chuyengia: [{ id: "expert-1", rootId: "expert-1", isLatest: 1, hoTen: "After" }],
    kehoach: [{ id: "plan-1", rootId: "plan-1" }],
    goithau: [{ id: "pkg-1", keHoachId: "plan-1" }],
    goithauhanghoa: [{ id: "goods-1", goiThauId: "pkg-1" }],
    thongtinmothau: [{ id: "opening-1", goiThauId: "pkg-1" }],
    hanghoaduthaunhathau: [{ id: "bid-goods-1", goiThauId: "pkg-1" }],
    assignments: [
      { id: "a-new", targetId: "pkg-1", type: "goithau", empId: "employee-new" },
    ],
  };

  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-1",
    snapshot,
  });

  assert.deepEqual(changes.upserts.goithau.map((row) => row.id), ["pkg-1"]);
  assert.deepEqual(changes.upserts.goithauhanghoa.map((row) => row.id), ["goods-1"]);
  assert.deepEqual(changes.upserts.thongtinmothau.map((row) => row.id), ["opening-1"]);
  assert.deepEqual(changes.upserts.hanghoaduthaunhathau.map((row) => row.id), ["bid-goods-1"]);
  assert.deepEqual(changes.upserts.assignments.map((row) => row.id), ["a-new"]);
  assert.deepEqual(changes.upserts.chuyengia.map((row) => row.id), ["expert-1"]);
  assert.deepEqual(changes.deletions.assignments, ["a-removed"]);
});

test("editing plan 01 commits only changed rows from its mutable snapshot", () => {
  const snapshot = {
    kehoach: [
      { id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 0, rowVersion: 9 },
      { id: "plan-01", rootId: "plan-root", phienBan: "01", isLatest: 1, rowVersion: 3, tenKeHoach: "Before" },
    ],
    goithau: [
      { id: "pkg-00", rootId: "pkg-root-1", keHoachId: "plan-00", rowVersion: 8 },
      { id: "pkg-01", rootId: "pkg-root-1", keHoachId: "plan-01", rowVersion: 2, tenGoiThau: "Before" },
      { id: "pkg-02", rootId: "pkg-root-2", keHoachId: "plan-01", rowVersion: 2, tenGoiThau: "Untouched" },
    ],
    goithauhanghoa: [
      { id: "goods-01", goiThauId: "pkg-01", tenHangHoa: "Before" },
      { id: "goods-02", goiThauId: "pkg-02", tenHangHoa: "Untouched" },
    ],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [
      { id: "assignment-old", targetId: "pkg-01", type: "goithau", empId: "expert-old" },
    ],
    chudautu: [],
  };
  const state = structuredClone(snapshot);
  state.kehoach.find((row) => row.id === "plan-01").tenKeHoach = "After";
  state.goithau.find((row) => row.id === "pkg-01").tenGoiThau = "After";
  state.goithauhanghoa.find((row) => row.id === "goods-01").tenHangHoa = "After";
  state.assignments = [{
    id: "assignment-new",
    targetId: "pkg-01",
    type: "goithau",
    empId: "expert-new",
  }];

  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-01",
    snapshot,
  });

  assert.deepEqual(changes.upserts.kehoach.map((row) => row.id), ["plan-01"]);
  assert.deepEqual(changes.upserts.goithau.map((row) => row.id), ["pkg-01"]);
  assert.deepEqual(changes.upserts.goithauhanghoa.map((row) => row.id), ["goods-01"]);
  assert.deepEqual(changes.upserts.assignments.map((row) => row.id), ["assignment-new"]);
  assert.deepEqual(changes.deletions.assignments, ["assignment-old"]);
  assert.equal(JSON.stringify(changes).includes("plan-00"), false);
  assert.equal(JSON.stringify(changes).includes("pkg-00"), false);
  assert.equal(JSON.stringify(changes).includes("pkg-02"), false);
  assert.equal(JSON.stringify(changes).includes("goods-02"), false);
});

test("row-version-only delta rebases an active edit draft without losing local fields", () => {
  const baselinePackage = {
    id: "pkg-01", rootId: "pkg-root", keHoachId: "plan-01",
    rowVersion: 2, tenGoiThau: "Before",
  };
  const draft = {
    active: true,
    action: "edit",
    planId: "plan-01",
    snapshot: { goithau: [structuredClone(baselinePackage)] },
  };
  const localBefore = {
    goithau: [{ ...baselinePackage, tenGoiThau: "Local edit" }],
  };
  const model = {
    state: {
      goithau: [{ ...baselinePackage, rowVersion: 3 }],
    },
    entityIndexes: { invalidate() {} },
  };

  rebasePlanBreakdownDraftAfterServerMerge(model, draft, localBefore, new Set(["goithau"]));

  assert.deepEqual(model.state.goithau[0], {
    ...baselinePackage,
    rowVersion: 3,
    tenGoiThau: "Local edit",
  });
  assert.equal(draft.snapshot.goithau[0].rowVersion, 3);
});

test("hydration metadata rebases without turning a local package edit into a false conflict", () => {
  const baselinePackage = {
    id: "pkg-01", keHoachId: "plan-01", rowVersion: 2,
    referenceOnly: true, tenGoiThau: "Before",
  };
  const draft = {
    active: true,
    action: "edit",
    planId: "plan-01",
    snapshot: { goithau: [structuredClone(baselinePackage)] },
  };
  const localBefore = {
    goithau: [{ ...baselinePackage, tenGoiThau: "Local edit" }],
  };
  const model = {
    state: {
      goithau: [{ ...baselinePackage, rowVersion: 3, referenceOnly: false }],
    },
    entityIndexes: { invalidate() {} },
  };

  rebasePlanBreakdownDraftAfterServerMerge(model, draft, localBefore, new Set(["goithau"]));

  assert.equal(model.state.goithau[0].tenGoiThau, "Local edit");
  assert.equal(model.state.goithau[0].rowVersion, 3);
  assert.equal(model.state.goithau[0].referenceOnly, false);
  assert.equal(draft.snapshot.goithau[0].referenceOnly, false);
});

test("delta for an unrelated record leaves the active package draft intact", () => {
  const localBase = { id: "pkg-01", keHoachId: "plan-01", rowVersion: 2, tenGoiThau: "Before" };
  const otherBase = { id: "pkg-other", keHoachId: "plan-other", rowVersion: 4, tenGoiThau: "Other" };
  const localEdit = { ...localBase, tenGoiThau: "Local edit" };
  const draft = {
    active: true, action: "edit", planId: "plan-01",
    snapshot: { goithau: [structuredClone(localBase), structuredClone(otherBase)] },
  };
  const model = {
    state: { goithau: [localEdit, { ...otherBase, rowVersion: 5, tenGoiThau: "Server edit" }] },
    entityIndexes: { invalidate() {} },
  };

  rebasePlanBreakdownDraftAfterServerMerge(
    model,
    draft,
    { goithau: [localEdit, otherBase] },
    new Set(["goithau"]),
  );

  assert.deepEqual(model.state.goithau.find((row) => row.id === "pkg-01"), localEdit);
  assert.equal(model.state.goithau.find((row) => row.id === "pkg-other").rowVersion, 5);
});

test("same-record business delta preserves stale rowVersion so a real concurrent edit conflicts", () => {
  const baselinePackage = {
    id: "pkg-01", rootId: "pkg-root", keHoachId: "plan-01",
    rowVersion: 2, tenGoiThau: "Before",
  };
  const draft = {
    active: true,
    action: "edit",
    planId: "plan-01",
    snapshot: { goithau: [structuredClone(baselinePackage)] },
  };
  const localBefore = { goithau: [{ ...baselinePackage, tenGoiThau: "Local edit" }] };
  const model = {
    state: { goithau: [{ ...baselinePackage, rowVersion: 3, tenGoiThau: "Server edit" }] },
    entityIndexes: { invalidate() {} },
  };

  rebasePlanBreakdownDraftAfterServerMerge(model, draft, localBefore, new Set(["goithau"]));

  assert.equal(model.state.goithau[0].tenGoiThau, "Local edit");
  assert.equal(model.state.goithau[0].rowVersion, 2);
  assert.equal(draft.snapshot.goithau[0].rowVersion, 2);
});

test("server-added package becomes the draft baseline instead of an outgoing local change", () => {
  const baselinePackage = {
    id: "pkg-01", rootId: "pkg-root", keHoachId: "plan-01",
    rowVersion: 2, tenGoiThau: "Existing",
  };
  const serverPackage = {
    id: "pkg-server", rootId: "pkg-server-root", keHoachId: "plan-01",
    rowVersion: 1, tenGoiThau: "Server added",
  };
  const draft = {
    active: true,
    action: "edit",
    planId: "plan-01",
    snapshot: { goithau: [structuredClone(baselinePackage)] },
  };
  const localBefore = { goithau: [structuredClone(baselinePackage)] };
  const model = {
    state: { goithau: [structuredClone(baselinePackage), structuredClone(serverPackage)] },
    entityIndexes: { invalidate() {} },
  };

  rebasePlanBreakdownDraftAfterServerMerge(model, draft, localBefore, new Set(["goithau"]));

  assert.deepEqual(model.state.goithau, [baselinePackage, serverPackage]);
  assert.deepEqual(draft.snapshot.goithau, [baselinePackage, serverPackage]);
});

test("server deletion cannot erase a concurrent local edit from the active draft", () => {
  const baselinePackage = {
    id: "pkg-01", rootId: "pkg-root", keHoachId: "plan-01",
    rowVersion: 2, tenGoiThau: "Before",
  };
  const localPackage = { ...baselinePackage, tenGoiThau: "Local edit" };
  const draft = {
    active: true,
    action: "edit",
    planId: "plan-01",
    snapshot: { goithau: [structuredClone(baselinePackage)] },
  };
  const model = {
    state: { goithau: [] },
    entityIndexes: { invalidate() {} },
  };

  rebasePlanBreakdownDraftAfterServerMerge(
    model,
    draft,
    { goithau: [structuredClone(localPackage)] },
    new Set(["goithau"]),
  );

  assert.deepEqual(model.state.goithau, [localPackage]);
  assert.deepEqual(draft.snapshot.goithau, [baselinePackage]);
});

test("concurrent server business edit keeps a local deletion on its stale baseline", () => {
  const baselinePackage = {
    id: "pkg-01", rootId: "pkg-root", keHoachId: "plan-01",
    rowVersion: 2, tenGoiThau: "Before",
  };
  const serverPackage = { ...baselinePackage, rowVersion: 3, tenGoiThau: "Server edit" };
  const draft = {
    active: true,
    action: "edit",
    planId: "plan-01",
    snapshot: { goithau: [structuredClone(baselinePackage)] },
  };
  const model = {
    state: { goithau: [structuredClone(serverPackage)] },
    entityIndexes: { invalidate() {} },
  };

  rebasePlanBreakdownDraftAfterServerMerge(
    model,
    draft,
    { goithau: [] },
    new Set(["goithau"]),
  );

  assert.deepEqual(model.state.goithau, []);
  assert.deepEqual(draft.snapshot.goithau, [baselinePackage]);
});

test("imported revision commit excludes immutable predecessor plan and package rows", () => {
  const state = {
    kehoach: [
      { id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 0 },
      { id: "plan-01", rootId: "plan-root", phienBan: "01", isLatest: 1 },
    ],
    goithau: [
      { id: "pkg-00", rootId: "pkg-root", keHoachId: "plan-00", isLatest: 0 },
      { id: "pkg-01", rootId: "pkg-root", keHoachId: "plan-01", isLatest: 1 },
    ],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [],
    assignments: [], chudautu: [],
  };
  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-01",
    snapshot: {
      kehoach: [{ id: "plan-00", rootId: "plan-root" }],
      goithau: [{ id: "pkg-00", rootId: "pkg-root", keHoachId: "plan-00" }],
      assignments: [], chudautu: [], goithauhanghoa: [], thongtinmothau: [],
      hanghoaduthaunhathau: [],
    },
  });

  assert.deepEqual(changes.upserts.kehoach.map((row) => row.id), ["plan-01"]);
  assert.deepEqual(changes.upserts.goithau.map((row) => row.id), ["pkg-01"]);
  const bounded = boundProcurementRevisionChanges(changes, "plan-01");
  assert.deepEqual(bounded.upserts.kehoach.map((row) => row.id), ["plan-01"]);
  assert.deepEqual(bounded.upserts.goithau.map((row) => row.id), ["pkg-01"]);
});

test("cancelling plan breakdown restores the complete aggregate and drops memory-only rows", () => {
  const state = {
    chudautu: [],
    kehoach: [],
    goithau: [],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  };
  const draft = capturePlanBreakdownDraft(state, { action: "create" });
  state.kehoach.push({ id: "plan-draft" });
  state.chudautu.push({ id: "investor-draft", maChuDauTu: "INV-1" });
  state.goithau.push({ id: "pkg-draft", keHoachId: "plan-draft" });
  state.goithauhanghoa.push({ id: "goods-draft", goiThauId: "pkg-draft" });
  state.assignments.push({
    id: "assignment-draft",
    targetId: "pkg-draft",
    type: "goithau",
    empId: "employee-1",
  });

  restorePlanBreakdownDraft({ state }, draft);

  assert.deepEqual(state, {
    chudautu: [],
    kehoach: [],
    goithau: [],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  });
});

test("cancelling plan revision 01 keeps committed 00 and removes only draft 01", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  const committedPlan = {
    id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 1,
    maKeHoach: "PL2600000001",
  };
  const committedPackage = {
    id: "package-00", rootId: "package-root", phienBan: "00", isLatest: 1,
    keHoachId: "plan-00", tenGoiThau: "Gói A 00",
    sourceRevision: { stablePackageId: "stable-a" },
  };
  const state = {
    chudautu: [], kehoach: [committedPlan], goithau: [committedPackage],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [],
    assignments: [],
  };
  const revision01 = materializeProcurementRevisionFromPrevious(
    state,
    "plan-00",
    {
      revisionNumber: "01",
      planDraft: { maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 01" },
      packageDrafts: [{
        tenGoiThau: "Gói A 01", giaGoiThau: 200,
        sourceRevision: { stablePackageId: "stable-a", revisionNumber: "01" },
      }],
    },
    { createId: (kind) => `${kind}-01`, timestamp: "2026-08-13 12:00:00" },
  );
  revision01.packages[0].giaGoiThau = 250;
  const cancellations = [];
  const controller = {
    model: {
      state,
      replaceTableState(table, rows) { this.state[table] = rows; },
    },
    planBreakdownDraft: revision01.draft,
    backupKeHoachState: null,
    backupGoiThauState: null,
    tempPlanData: { id: revision01.plan.id },
    tempPlanAction: "create",
    procurementPlanImport: { controller: { cancel() {} } },
    cancelActiveProcurementImportSession: async () => cancellations.push("cancel"),
    view: {
      closeModal: () => undefined,
      renderKeHoachTable: () => undefined,
      renderGoiThauTable: () => undefined,
    },
    switchTab: () => undefined,
  };

  try {
    await closeModal.call(controller, "modal-plan-breakdown");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.deepEqual(state.kehoach.map((row) => row.id), ["plan-00"]);
  assert.deepEqual(state.goithau.map((row) => row.id), ["package-00"]);
  assert.equal(state.kehoach[0].isLatest, 1);
  assert.equal(state.goithau[0].isLatest, 1);
  assert.equal(state.goithau[0].tenGoiThau, "Gói A 00");
  assert.deepEqual(cancellations, ["cancel"]);
});

test("explicitly cancelling a new MSC plan removes its durable draft aggregate", async () => {
  const previousDocument = globalThis.document;
  const controls = new Map([
    ["breakdown-plan-id", { value: "plan-draft-00" }],
  ]);
  globalThis.document = { getElementById: (id) => controls.get(id) || null };
  const state = {
    chudautu: [], chuyengia: [], nhathau: [],
    kehoach: [{
      id: "plan-unrelated", rootId: "plan-unrelated", phienBan: "00", isLatest: 1,
    }],
    goithau: [], goithauhanghoa: [], thongtinmothau: [],
    hanghoaduthaunhathau: [], assignments: [],
  };
  const breakdownDraft = capturePlanBreakdownDraft(state, { action: "create" });
  state.kehoach.push({
    id: "plan-draft-00", rootId: "plan-draft-00", phienBan: "00", isLatest: 1,
  });
  state.goithau.push({
    id: "package-draft-00", rootId: "package-draft-00", phienBan: "00",
    keHoachId: "plan-draft-00", isLatest: 1,
  });
  breakdownDraft.planId = "plan-draft-00";
  let envelope = null;
  const db = {
    async get() { return structuredClone(envelope); },
    async update(_key, updater) {
      envelope = updater(structuredClone(envelope));
      return structuredClone(envelope);
    },
  };
  const model = {
    state, db, planVersionDraftSessions: [],
    replaceTableState(table, rows) { this.state[table] = rows; },
  };
  const activeDraft = createPlanVersionDraftSession(state, "plan-draft-00");
  await savePlanVersionDraftSession(model, activeDraft);
  const unrelatedDraft = createPlanVersionDraftSession(state, "plan-unrelated");
  await savePlanVersionDraftSession(model, unrelatedDraft);
  const cancellations = [];
  const controller = {
    model,
    planBreakdownDraft: breakdownDraft,
    backupKeHoachState: null,
    backupGoiThauState: null,
    tempPlanData: { id: "plan-draft-00" },
    tempPlanAction: "create",
    procurementPlanImport: { controller: { cancel() {} } },
    cancelActiveProcurementImportSession: async () => cancellations.push("cancel"),
    view: {
      closeModal() {}, renderKeHoachTable() {}, renderGoiThauTable() {},
    },
    switchTab() {},
  };

  try {
    await closeModal.call(controller, "modal-plan-breakdown");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.deepEqual(state.kehoach.map((row) => row.id), ["plan-unrelated"]);
  assert.deepEqual(state.goithau, []);
  assert.deepEqual(cancellations, ["cancel"]);
  assert.deepEqual(
    model.planVersionDraftSessions.map((session) => session.rootId),
    ["plan-unrelated"],
  );
  const reloaded = {
    state: structuredClone(state), db, planVersionDraftSessions: [],
    replaceTableState(table, rows) { this.state[table] = rows; },
  };
  await hydratePlanVersionDraftSessions(reloaded);
  assert.deepEqual(reloaded.state.kehoach.map((row) => row.id), ["plan-unrelated"]);
  assert.deepEqual(reloaded.state.goithau, []);
});

test("saving plan breakdown commits the new plan and package aggregate in one sync", async () => {
  const previousDocument = globalThis.document;
  const emptyBody = { querySelectorAll: () => [] };
  globalThis.document = {
    getElementById(id) {
      if (id === "breakdown-plan-id") return { value: "plan-draft" };
      if (id.startsWith("tbody-breakdown-")) return emptyBody;
      return null;
    },
  };
  const persisted = [];
  let syncCount = 0;
  const state = {
    chudautu: [{ id: "investor-draft", rootId: "investor-draft", phienBan: "00", isLatest: 1 }],
    kehoach: [{
      id: "plan-draft",
      rootId: "plan-draft",
      phienBan: "00",
      isLatest: 1,
      isTongMucTuDong: false,
    }],
    goithau: [{ id: "pkg-draft", rootId: "pkg-draft", keHoachId: "plan-draft" }],
    goithauhanghoa: [{ id: "goods-draft", goiThauId: "pkg-draft" }],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [{
      id: "assignment-draft",
      targetId: "pkg-draft",
      type: "goithau",
      empId: "employee-1",
    }],
  };
  const controller = {
    tempPlanAction: "create",
    tempPlanData: { id: "plan-draft" },
    backupKeHoachState: [],
    backupGoiThauState: [],
    planBreakdownDraft: {
      active: true,
      action: "create",
      planId: "plan-draft",
      snapshot: {
        chudautu: [],
        kehoach: [],
        goithau: [],
        goithauhanghoa: [],
        thongtinmothau: [],
        hanghoaduthaunhathau: [],
        assignments: [],
      },
    },
    model: {
      state,
      parseVND: Number,
      commitLocalMutation() {},
      async persistChanges(table, changes) {
        persisted.push({ table, changes });
      },
      async flushMutationOutbox() {},
    },
    autoSync: async () => {
      syncCount += 1;
      return { ok: true };
    },
    updateBreakdownTotal() {},
    closeModal() {},
    view: {
      renderKeHoachTable: async () => {},
      renderGoiThauTable: async () => {},
      customAlert: async () => {},
    },
  };

  try {
    await savePlanBreakdown.call(controller);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.equal(syncCount, 1);
  assert.deepEqual(
    persisted.map(({ table }) => table).sort(),
    [
      "assignments",
      "chudautu",
      "goithau",
      "goithauhanghoa",
      "hanghoaduthaunhathau",
      "kehoach",
      "thongtinmothau",
    ],
  );
  const packageWrite = persisted.find(({ table }) => table === "goithau");
  assert.deepEqual(packageWrite.changes.upserts.map((row) => row.id), ["pkg-draft"]);
  assert.equal(controller.planBreakdownDraft, null);
});

test("saving an edited plan 01 commits its changed aggregate exactly once", async () => {
  const previousDocument = globalThis.document;
  const emptyBody = { querySelectorAll: () => [] };
  globalThis.document = {
    getElementById(id) {
      if (id === "breakdown-plan-id") return { value: "plan-01" };
      if (id.startsWith("tbody-breakdown-")) return emptyBody;
      return null;
    },
  };
  const baseline = {
    chudautu: [],
    kehoach: [{
      id: "plan-01", rootId: "plan-root", phienBan: "01", isLatest: 1,
      rowVersion: 3, tenKeHoach: "Before", isTongMucTuDong: false,
    }],
    goithau: [{
      id: "pkg-01", rootId: "pkg-root", keHoachId: "plan-01",
      rowVersion: 2, tenGoiThau: "Before",
    }],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [],
    assignments: [],
  };
  const state = structuredClone(baseline);
  state.kehoach[0].tenKeHoach = "After";
  state.goithau[0].tenGoiThau = "After";
  state.assignments.push({
    id: "assignment-01", targetId: "pkg-01", type: "goithau", empId: "expert-01",
  });
  const persisted = [];
  let syncCount = 0;
  const controller = {
    tempPlanAction: "edit",
    tempPlanData: { id: "plan-01", thoiGianDangMa: "" },
    backupKeHoachState: structuredClone(baseline.kehoach),
    backupGoiThauState: structuredClone(baseline.goithau),
    planBreakdownDraft: {
      active: true, action: "edit", planId: "plan-01", snapshot: structuredClone(baseline),
    },
    model: {
      state,
      parseVND: Number,
      commitLocalMutation() {},
      async persistChanges(table, changes) { persisted.push({ table, changes }); },
      async flushMutationOutbox() {},
    },
    autoSync: async () => { syncCount += 1; return { ok: true }; },
    updateBreakdownTotal() {},
    closeModal() {},
    view: {
      renderKeHoachTable: async () => {},
      renderGoiThauTable: async () => {},
      customAlert: async () => {},
    },
  };

  try {
    await savePlanBreakdown.call(controller);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.equal(syncCount, 1);
  assert.deepEqual(
    persisted.find(({ table }) => table === "kehoach").changes.upserts.map((row) => row.id),
    ["plan-01"],
  );
  assert.deepEqual(
    persisted.find(({ table }) => table === "goithau").changes.upserts.map((row) => row.id),
    ["pkg-01"],
  );
  assert.deepEqual(
    persisted.find(({ table }) => table === "assignments").changes.upserts.map((row) => row.id),
    ["assignment-01"],
  );
  assert.equal(controller.planBreakdownDraft, null);
});

test("inline Plan import runs 00 then 01 through the existing forms and breakdown draft", async () => {
  const previousDocument = globalThis.document;
  const previousEvent = globalThis.Event;
  const previousElement = globalThis.Element;
  const previousLucide = globalThis.lucide;
  const previousSanitize = DOMPurify.sanitize;
  const previousIsSupported = DOMPurify.isSupported;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => String(value);
  class FakeEvent {
    constructor(type) { this.type = type; }
  }
  const control = (value = "") => ({
    value, dataset: {}, innerHTML: "", hidden: false, disabled: false,
    classList: { add() {}, remove() {}, contains: () => true },
    setAttribute(name, next) { this[name] = String(next); },
    getAttribute(name) { return this[name] ?? null; },
    removeAttribute(name) { delete this[name]; },
    dispatchEvent() {}, focus() {}, click() { this.onclick?.(); },
    querySelectorAll: () => [],
  });
  const controls = new Map();
  [
    "form-kehoach", "form-kehoach-id", "kh-ma", "kh-ten", "kh-loaihinh",
    "kh-duan", "kh-chudautuid", "kh-donvitrinhcdt",
    "kh-tenviettatdonvitrinh", "kh-tongmuc", "kh-ngaypheduyet",
    "kh-quyetdinh", "kh-thoigiandang", "kh-nguonvon", "kh-thoigian-duan",
    "kh-maduan", "kh-soqdpheduyetduan", "kh-ngayqdpheduyetduan",
    "kh-coquanpheduyetduan", "kh-diadiem-quymo", "kh-thongtinkhac",
    "kh-pheduyet", "kh-ngaytrinhkehoach", "kh-sototrinhkehoach",
    "kh-sototrinhdutoankehoach", "kh-ngaytrinhdutoan",
    "kh-sototrinhdutoan", "kh-ngaypheduyetdutoan",
    "kh-quyetdinhpheduyetdutoan", "modal-plan-breakdown",
    "breakdown-plan-id", "breakdown-modal-subtitle", "btn-breakdown-add-package",
    "btn-save-plan-breakdown", "btn-save-plan-version-draft",
    "btn-back-plan-breakdown", "gt-kehoachid",
    "tbody-breakdown-dathuchien", "tbody-breakdown-khongapdung",
    "tbody-breakdown-chuadudieuKien", "tbody-breakdown-goithau",
    "pane-dathuchien",
  ].forEach((id) => controls.set(id, control()));
  controls.get("kh-tongmuc").getAttribute = (name) => (
    name === "data-initial-val" ? "" : name === "data-was-auto" ? "false" : null
  );
  for (const id of [
    "tbody-breakdown-dathuchien", "tbody-breakdown-khongapdung",
    "tbody-breakdown-chuadudieuKien",
  ]) controls.get(id).querySelectorAll = () => [];
  const tab = control();
  tab.getAttribute = () => "dathuchien";
  const pane = controls.get("pane-dathuchien");
  globalThis.document = {
    getElementById: (id) => controls.get(id) || null,
    querySelectorAll(selector) {
      if (selector === ".breakdown-tab-btn") return [tab];
      if (selector === ".breakdown-pane") return [pane];
      return [];
    },
  };
  globalThis.Event = FakeEvent;
  globalThis.Element = class FakeElement {};
  globalThis.lucide = { createIcons() {} };

  const revisionDrafts = {
    "00": {
      familyNo: "PL2600000001", revisionNumber: "00",
      planAuthority: {
        familyNo: "PL2600000001", expectedPredecessor: null,
      },
      packageAuthorities: [],
      planDraft: {
        maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 00",
        loaiHinhMuaSam: "Dự toán mua sắm", tenDuAnDuToan: "Dự toán A",
        tongMucDauTu: 300, ngayPheDuyet: "2026-01-01",
        quyetDinhPheDuyet: "01/QĐ", pheDuyet: "Dự toán và kế hoạch",
        investorSource: { code: "vn123456789" },
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-00",
          revisionNumber: "00", revisionDigest: "sha256:00",
        },
      },
      packageDrafts: [{
        soHieuGoiThau: "A", tenGoiThau: "Gói A 00", giaGoiThau: 100,
        thoiGianThucHien: "30 ngày", nguonVon: "Ngân sách",
        thoiGianToChuc: "30 ngày", thoiGianBatDauToChuc: "Quý I/2026",
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-00",
          revisionNumber: "00", revisionDigest: "sha256:00",
          stablePackageId: "stable-a", packageObservationId: "detail-a-00",
        },
      }, {
        soHieuGoiThau: "B", tenGoiThau: "Gói B 00", giaGoiThau: 200,
        thoiGianThucHien: "60 ngày", nguonVon: "Ngân sách",
        thoiGianToChuc: "30 ngày", thoiGianBatDauToChuc: "Quý II/2026",
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-00",
          revisionNumber: "00", revisionDigest: "sha256:00",
          stablePackageId: "stable-b", packageObservationId: "detail-b-00",
        },
      }],
    },
    "01": {
      familyNo: "PL2600000001", revisionNumber: "01",
      planAuthority: {
        familyNo: "PL2600000001", expectedPredecessor: null,
      },
      packageAuthorities: [],
      planDraft: {
        maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 01",
        loaiHinhMuaSam: "Dự toán mua sắm", tenDuAnDuToan: "Dự toán A",
        tongMucDauTu: 350, ngayPheDuyet: "2026-02-01",
        quyetDinhPheDuyet: "02/QĐ", pheDuyet: "Dự toán và kế hoạch",
        investorSource: { code: "vn123456789" },
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-01",
          revisionNumber: "01", revisionDigest: "sha256:01",
        },
      },
      packageDrafts: [{
        soHieuGoiThau: "A", tenGoiThau: "Gói A 01", giaGoiThau: 150,
        thoiGianThucHien: "45 ngày", nguonVon: "Nguồn điều chỉnh",
        thoiGianToChuc: "45 ngày", thoiGianBatDauToChuc: "Quý III/2026",
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-01",
          revisionNumber: "01", revisionDigest: "sha256:01",
          stablePackageId: "stable-a", packageObservationId: "detail-a-01",
        },
      }, {
        soHieuGoiThau: "B", tenGoiThau: "Gói B 01", giaGoiThau: 200,
        thoiGianThucHien: "60 ngày", nguonVon: "Ngân sách",
        thoiGianToChuc: "30 ngày", thoiGianBatDauToChuc: "Quý II/2026",
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-01",
          revisionNumber: "01", revisionDigest: "sha256:01",
          stablePackageId: "stable-b", packageObservationId: "detail-b-01",
        },
      }],
    },
  };
  const loaded = [];
  const sequential = new SequentialRevisionController({
    revisions: [{ revisionNumber: "01" }, { revisionNumber: "00" }],
    loadRevision: async (revision) => {
      loaded.push(revision.revisionNumber);
      return structuredClone(revisionDrafts[revision.revisionNumber]);
    },
    saveRevision: async () => ({ ok: true }),
  });
  const firstDraft = await sequential.loadCurrent();
  const persistedRevisions = [];
  const workspaceMutations = [];
  const finalizeCalls = [];
  const packageModalEdits = [];
  const planModalEditOptions = [];
  const state = {
    chudautu: [{
      id: "investor-1", rootId: "investor-1", maChuDauTu: "vn123456789",
      phienBan: "00", isLatest: 1,
    }],
    kehoach: [], goithau: [], goithauhanghoa: [], thongtinmothau: [],
    hanghoaduthaunhathau: [], assignments: [],
  };
  const model = {
    state, workspaceStorage: null, getWorkspaceToken: () => "org-1",
    db: {
      values: new Map(),
      async get(key) { return structuredClone(this.values.get(key)); },
      async update(key, updater) {
        const next = updater(structuredClone(this.values.get(key) ?? null));
        this.values.set(key, structuredClone(next));
        return structuredClone(next);
      },
    },
    getLatestChuDauTu: () => state.chudautu.filter((row) => row.isLatest == 1),
    getCurrentDateTimeString: () => "2026-08-13 10:00:00",
    getLatestPackagesForPlan: (planId) => state.goithau.filter(
      (row) => String(row.keHoachId) === String(planId) && row.isLatest == 1,
    ),
    getPlanBaseCode: (value) => value,
    getPackageBaseCode: (value) => value,
    getVersionLabel: (value) => `Phiên bản ${value}`,
    formatCurrency: (value) => String(value), formatVND: (value) => String(value),
    formatForDateInput: (value) => value,
    formatForDatetimeLocal: (value) => value,
    convertDMYToYMD: (value) => value,
    convertDMYHMSToYMDHMS: (value) => value,
    parseVND: Number,
    beginWorkspaceMutation() {
      const mutation = {
        state,
        stagedTables: new Set(),
        outbox: { flush: async () => {} },
      };
      workspaceMutations.push(mutation);
      return mutation;
    },
    commitWorkspaceMutation(mutation, table) {
      mutation.stagedTables.add(table);
    },
    finishWorkspaceMutation() {},
    workspaceMutationUsesCurrentResources: () => true,
    commitLocalMutation() {}, markDeleted() {},
    async persistChanges() {}, async flushMutationOutbox() {},
  };
  const controller = {
    model,
    view: {
      validateForm: () => true, focusInvalidControl() {},
      closeModal() {}, openModal() {}, getStatusBadge: (value) => value,
      renderKeHoachTable: async () => {}, renderGoiThauTable: async () => {},
      customConfirm: async () => true, customAlert: async () => {},
    },
    plans: {
      edit: async (id, options) => {
        planModalEditOptions.push(options);
        controller.planBreakdownDraft.planId = id;
        const plan = state.kehoach.find((row) => row.id === id);
        controls.get("form-kehoach-id").value = id;
        const importedPlanValues = {
          "kh-ma": plan.maKeHoach,
          "kh-ten": plan.tenKeHoach,
          "kh-loaihinh": plan.loaiHinhMuaSam,
          "kh-duan": plan.tenDuAnDuToan,
          "kh-tongmuc": plan.tongMucDauTu == null
            ? ""
            : model.formatVND(plan.tongMucDauTu),
          "kh-nguonvon": plan.nguonVon,
          "kh-quyetdinh": plan.quyetDinhPheDuyet,
          "kh-ngaypheduyet": model.formatForDateInput(plan.ngayPheDuyet),
          "kh-thoigiandang": model.formatForDatetimeLocal(plan.thoiGianDangMa),
          "kh-pheduyet": plan.pheDuyet || "Dự toán và kế hoạch",
        };
        Object.entries(importedPlanValues).forEach(([controlId, value]) => {
          controls.get(controlId).value = value == null ? "" : String(value);
        });
        controls.get("kh-chudautuid").value = plan.chuDauTuId || "investor-1";
      },
    },
    packages: { edit: async (id) => packageModalEdits.push(id) },
    addBreakdownRow() {}, updateBreakdownTotal() {}, recalculatePlanTotal() {},
    loadBreakdownPackageDetails: async () => {},
    renderBreakdownPackagesList,
    openPlanBreakdownModal,
    closeModal: async () => {},
    finalizePlanDraft: async (payload) => {
      finalizeCalls.push(payload);
      return { status: "success", rowVersions: [] };
    },
    autoSync: async () => {
      const current = state.kehoach.find((row) => row._procurementImportCurrent);
      persistedRevisions.push({
        revision: current.phienBan,
        packages: state.goithau.filter((row) => row.keHoachId === current.id)
          .map((row) => ({
            name: row.tenGoiThau,
            price: row.giaGoiThau,
            version: row.phienBan,
          })),
      });
      return { ok: true };
    },
  };
  controller.startProcurementPlanImport = startProcurementPlanImport.bind(controller);
  controller.completeProcurementPlanImportRevision = (
    completeProcurementPlanImportRevision.bind(controller)
  );
  controller.handleKeHoachSubmit = handleKeHoachSubmit.bind(controller);
  controller.saveIntermediatePlanVersion = saveIntermediatePlanVersion.bind(controller);
  controller.savePlanBreakdown = savePlanBreakdown.bind(controller);

  try {
    await controller.startProcurementPlanImport(originatePlanImportFlow(controller, {
      session: {
        sessionId: "session-plan", kind: "PLAN", familyNo: "PL2600000001",
        revisions: [{ revisionNumber: "00" }, { revisionNumber: "01" }],
      },
      controller: sequential, currentDraft: firstDraft,
      client: { cancelImportSession: async () => {} },
    }));
    assert.equal(
      controller.model.planVersionDraftSessions?.length,
      1,
      "a new MSC plan must create one durable plan-version draft session",
    );
    assert.deepEqual(planModalEditOptions[0], {
      keepProcurementCodeEditable: true,
      preserveProcurementLookupSelection: true,
    });
    await controller.handleKeHoachSubmit({ preventDefault() {} });
    const plan00 = state.kehoach.find((row) => row.phienBan === "00");
    assert.equal(
      controls.get("btn-save-plan-version-draft").hidden,
      false,
      "revision 00 must expose the intermediate save action",
    );
    assert.equal(
      controls.get("btn-save-plan-breakdown").hidden,
      true,
      "revision 00 must not expose finalization while revision 01 remains",
    );
    assert.match(controls.get("tbody-breakdown-goithau").innerHTML, /Gói A 00/);
    assert.match(controls.get("tbody-breakdown-goithau").innerHTML, /Gói B 00/);

    const packageA00 = state.goithau.find(
      (row) => row.keHoachId === plan00.id && row.tenGoiThau === "Gói A 00",
    );
    await controller.packages.edit(packageA00.id);
    packageA00.giaGoiThau = 125;
    await persistPackageFormChanges(controller, { goithau: [packageA00] }, { draft: true });
    applyDraftAssignmentSelection(model, {
      targetId: packageA00.id,
      type: "goithau",
      selectedIds: ["expert-00"],
      createId: () => "assignment-expert-00",
    });
    controller.renderBreakdownPackagesList(plan00.id);
    assert.match(controls.get("tbody-breakdown-goithau").innerHTML, />125</);
    assert.deepEqual(persistedRevisions, [], "package modal save remains memory-only");

    const prematureFinalize = await controller.savePlanBreakdown();
    assert.deepEqual(
      prematureFinalize,
      { ok: false, code: "PROCUREMENT_REVISIONS_REMAINING" },
      "a stale or programmatic final-save call must be rejected before reaching the API",
    );
    assert.deepEqual(finalizeCalls, [], "revision 00 must never call finalize-draft");

    await controller.saveIntermediatePlanVersion();
    assert.deepEqual(workspaceMutations, [], "finalize-draft must bypass the regular sync mutation lane");
    assert.deepEqual(persistedRevisions, [], "intermediate/import save must not write the server before finalization");
    assert.deepEqual(finalizeCalls, [], "revision 00 must stay local until the last source revision");
    assert.deepEqual(loaded, ["00", "01"]);
    assert.equal(controls.get("form-kehoach-id").value, controller.procurementPlanImport.currentPlanId);
    const plan01 = state.kehoach.find((row) => row.phienBan === "01");
    const packageA01 = state.goithau.find(
      (row) => row.keHoachId === plan01.id
        && row.sourceRevision?.stablePackageId === "stable-a",
    );
    assert.deepEqual(
      state.assignments
        .filter((row) => row.targetId === packageA01.id)
        .map((row) => row.empId),
      ["expert-00"],
      "revision 01 must inherit the expert selected in revision 00",
    );

    await controller.handleKeHoachSubmit({ preventDefault() {} });
    assert.equal(
      controls.get("btn-save-plan-version-draft").hidden,
      true,
      "the final source revision must hide the intermediate action",
    );
    assert.equal(
      controls.get("btn-save-plan-breakdown").hidden,
      false,
      "the final source revision must expose finalization",
    );
    assert.match(controls.get("tbody-breakdown-goithau").innerHTML, /Gói A 01/);
    assert.match(controls.get("tbody-breakdown-goithau").innerHTML, /Gói B 01/);
    await controller.savePlanBreakdown();

    assert.deepEqual(workspaceMutations, [], "the complete import chain must remain outside /api/sync");
    assert.deepEqual(persistedRevisions, []);
    assert.equal(finalizeCalls.length, 1, "only the last source revision may finalize the draft chain");
    assert.deepEqual(
      finalizeCalls[0].kehoach.map((plan) => plan.sourceRevision?.revisionNumber),
      ["00", "01"],
      "atomic finalization must retain MSC provenance for every plan revision",
    );
    assert.deepEqual(
      finalizeCalls[0].goithau
        .map((pkg) => pkg.sourceRevision?.revisionNumber)
        .sort(),
      ["00", "00", "01", "01"],
      "atomic finalization must retain MSC provenance for historical package snapshots",
    );
    assert.deepEqual(packageModalEdits, [packageA00.id]);
    assert.equal(controller.procurementPlanImport, null);
  } finally {
    DOMPurify.sanitize = previousSanitize;
    DOMPurify.isSupported = previousIsSupported;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousEvent === undefined) delete globalThis.Event;
    else globalThis.Event = previousEvent;
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
    if (previousLucide === undefined) delete globalThis.lucide;
    else globalThis.lucide = previousLucide;
  }
});

test("retrying the same procurement revision reuses the saved plan version", async () => {
  const existingPlan = {
    id: "plan-00",
    rootId: "plan-00",
    maKeHoach: "PL2600164871",
    phienBan: 0,
    isLatest: 1,
    rowVersion: 2,
  };
  const state = {
    chudautu: [{
      id: "investor-1", rootId: "investor-1", maChuDauTu: "vn3900786617",
      phienBan: "00", isLatest: 1,
    }],
    kehoach: [existingPlan],
    goithau: [],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  };
  const controller = {
    model: {
      state,
      workspaceStorage: null,
      getLatestChuDauTu: () => state.chudautu,
      getCurrentDateTimeString: () => "2026-08-15 12:00:00",
      getPlanBaseCode: (value) => value,
      getWorkspaceToken: () => "org-1",
    },
    plans: { edit: async () => {} },
  };
  const revisionDraft = {
    familyNo: "PL2600164871",
    revisionNumber: "00",
    planDraft: {
      maKeHoach: "PL2600164871",
      investorSource: { code: "vn3900786617" },
      sourceRevision: {
        provider: "MUASAMCONG",
        familyNo: "PL2600164871",
        revisionId: "revision-00",
        revisionNumber: "00",
      },
    },
    packageDrafts: [{
      tenGoiThau: "Package 01",
      sourceRevision: {
        stablePackageId: "package-01",
        packageObservationId: "detail-01",
      },
    }],
  };

  const result = await startProcurementPlanImport.call(controller, originatePlanImportFlow(controller, {
    session: { sessionId: "session-1", familyNo: "PL2600164871" },
    controller: {},
    currentDraft: revisionDraft,
  }));

  assert.equal(result.plan.id, "plan-00");
  assert.equal(state.kehoach.length, 1);
  assert.equal(state.kehoach[0].phienBan, "00");
  assert.equal(state.kehoach[0].isLatest, 1);
  assert.equal(state.goithau.length, 1);
  assert.equal(state.goithau[0].keHoachId, "plan-00");
});

test("a newly published revision extends persisted 00 without opening a new-plan draft", async () => {
  const existingPlan = {
    id: "plan-00", rootId: "plan-00", maKeHoach: "PL2600225773",
    phienBan: "00", isLatest: 1, rowVersion: 4,
  };
  const state = {
    chudautu: [{
      id: "investor-1", rootId: "investor-1", maChuDauTu: "vn3900786617",
      phienBan: "00", isLatest: 1, rowVersion: 2,
    }],
    kehoach: [existingPlan], goithau: [], goithauhanghoa: [],
    thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  let draftEnvelope = null;
  const controller = {
    model: {
      state, workspaceStorage: null, planVersionDraftSessions: [],
      getLatestChuDauTu: () => state.chudautu,
      getCurrentDateTimeString: () => "2026-08-20 12:00:00",
      getPlanBaseCode: (value) => value,
      getWorkspaceToken: () => "org-1",
      db: {
        async update(_key, updater) {
          draftEnvelope = updater(structuredClone(draftEnvelope));
          return structuredClone(draftEnvelope);
        },
      },
    },
    plans: { edit: async () => {} },
  };
  const revisionDraft = {
    familyNo: "PL2600225773", revisionNumber: "01",
    planDraft: {
      maKeHoach: "PL2600225773", tenKeHoach: "Kế hoạch cập nhật 01",
      investorSource: { code: "vn3900786617" },
      sourceRevision: {
        sessionId: "session-later-01", workspaceLease: "org-1",
        provider: "MUASAMCONG", familyNo: "PL2600225773",
        revisionId: "revision-01", revisionNumber: "01",
        revisionDigest: "sha256:01",
      },
    },
    packageDrafts: [],
  };

  const result = await startProcurementPlanImport.call(controller, originatePlanImportFlow(controller, {
    session: {
      sessionId: "session-later-01", familyNo: "PL2600225773",
      revisions: [{ revisionNumber: "01" }],
    },
    controller: { hasNext: () => false },
    currentDraft: revisionDraft,
  }));

  assert.equal(result.plan.phienBan, "01");
  assert.equal(result.plan.rootId, "plan-00");
  assert.equal(existingPlan.isLatest, 0);
  assert.equal(result.plan.isLatest, 1);
  assert.equal(result.plan.rowVersion, undefined);
  assert.deepEqual(
    controller.model.planVersionDraftSessions,
    [],
    "persisted 00 + new 01 must use the normal optimistic aggregate-version save",
  );
  assert.equal(draftEnvelope, null);
});

test("procurement materialization replaces MSC option ids with internal child ids", () => {
  const state = {
    kehoach: [{ id: "plan-00", rootId: "plan-00", phienBan: "00", rowVersion: 2 }],
    goithau: [],
  };
  const ids = { goithau: 0, tuychonmuathem: 0 };
  const result = materializeProcurementRevisionIntoExisting(
    state,
    "plan-00",
    {
      revisionNumber: "00",
      packageDrafts: [{
        tenGoiThau: "Gói mua sắm",
        sourceRevision: { stablePackageId: "source-package-1" },
        tuyChonMuaThem: true,
        tuyChonMuaThemList: [{
          sourceItemId: "msc-option-1",
          id: "msc-option-1",
          hangMuc: "Phim X-Quang",
        }],
      }],
    },
    { createId: (type) => `${type}-${++ids[type]}` },
  );

  assert.equal(result.packages[0].tuyChonMuaThemList[0].id, "tuychonmuathem-1");
  assert.equal(result.packages[0].tuyChonMuaThemList[0].sourceItemId, "msc-option-1");
  assert.notEqual(result.packages[0].tuyChonMuaThemList[0].id, "msc-option-1");
});

test("pending imported investor is part of plan breakdown commit and rollback boundary", () => {
  const snapshot = {
    chudautu: [], kehoach: [], goithau: [], goithauhanghoa: [],
    thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  const state = structuredClone(snapshot);
  state.chudautu.push({
    id: "investor-draft", rootId: "investor-draft", phienBan: "00",
    isLatest: 1, maChuDauTu: "INV-1", tenChuDauTu: "Chủ đầu tư A",
  });
  state.kehoach.push({ id: "plan-draft", chuDauTuId: "investor-draft" });

  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-draft", snapshot,
  });
  assert.deepEqual(changes.upserts.chudautu.map((row) => row.id), ["investor-draft"]);
  restorePlanBreakdownDraft({ state }, { snapshot });
  assert.deepEqual(state.chudautu, []);
});

test("next plan revision reuses its investor without deleting the master record", () => {
  const investor = {
    id: "investor-existing", rootId: "investor-existing", phienBan: "00",
    isLatest: 1, rowVersion: 1, maChuDauTu: "INV-1",
  };
  const snapshot = {
    chudautu: [structuredClone(investor)],
    kehoach: [{ id: "plan-00", rootId: "plan-root", chuDauTuId: investor.id }],
    goithau: [], goithauhanghoa: [], thongtinmothau: [],
    hanghoaduthaunhathau: [], assignments: [],
  };
  const state = structuredClone(snapshot);
  state.kehoach.push({
    id: "plan-01", rootId: "plan-root", phienBan: "01",
    chuDauTuId: investor.id,
  });

  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-01", snapshot,
  });

  assert.deepEqual(changes.upserts.chudautu, []);
  assert.equal(changes.deletions.chudautu, undefined);
});

test("an unsynced investor already present in the draft snapshot remains an upsert", () => {
  const investor = {
    id: "investor-pending", rootId: "investor-pending", phienBan: "00",
    isLatest: 1, maChuDauTu: "INV-PENDING",
  };
  const snapshot = {
    chudautu: [structuredClone(investor)],
    kehoach: [], goithau: [], goithauhanghoa: [], thongtinmothau: [],
    hanghoaduthaunhathau: [], assignments: [],
  };
  const state = structuredClone(snapshot);
  state.kehoach.push({ id: "plan-01", rootId: "plan-root", chuDauTuId: investor.id });

  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-01", snapshot,
  });

  assert.deepEqual(changes.upserts.chudautu.map((row) => row.id), [investor.id]);
  assert.equal(changes.deletions.chudautu, undefined);
});

test("plan breakdown package row exposes accessible icon-only actions", () => {
  const previousDocument = globalThis.document;
  const previousLucide = globalThis.lucide;
  const previousSanitize = DOMPurify.sanitize;
  const previousIsSupported = DOMPurify.isSupported;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => String(value);
  const tbody = { innerHTML: "" };
  const iconRoots = [];
  globalThis.lucide = {
    createIcons(options) {
      iconRoots.push(options?.root);
    },
  };
  globalThis.document = {
    getElementById: (id) => id === "tbody-breakdown-goithau" ? tbody : null,
  };
  const pkg = {
    id: "pkg-draft",
    maGoiThau: "IB-DRAFT",
    tenGoiThau: "Gói thầu bản nháp",
    giaGoiThau: 100,
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    trangThai: "Chuẩn bị",
  };
  const controller = {
    model: {
      getLatestPackagesForPlan: () => [pkg],
      getPackageBaseCode: (value) => value,
      formatCurrency: (value) => String(value),
    },
    view: { getStatusBadge: (value) => value },
  };

  try {
    renderBreakdownPackagesList.call(controller, "plan-draft");
  } finally {
    DOMPurify.sanitize = previousSanitize;
    DOMPurify.isSupported = previousIsSupported;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLucide === undefined) delete globalThis.lucide;
    else globalThis.lucide = previousLucide;
  }

  assert.match(String(tbody.innerHTML), /data-bf-action="edit-package"/);
  assert.match(String(tbody.innerHTML), /data-bf-action="delete-package"/);
  assert.match(String(tbody.innerHTML), /aria-label="Sửa gói thầu"/);
  assert.match(String(tbody.innerHTML), /title="Xóa gói thầu"/);
  assert.doesNotMatch(String(tbody.innerHTML), />\s*Sửa\s*</);
  assert.doesNotMatch(String(tbody.innerHTML), />\s*Xóa\s*</);
  assert.deepEqual(iconRoots, [tbody]);
});

test("plan breakdown tabs use one active-state color contract", () => {
  const modal = fs.readFileSync("views/modals/modal_plan_breakdown.html", "utf8");
  const css = fs.readFileSync("views/css/components.css", "utf8");
  const tabClasses = [...modal.matchAll(/class="([^"]*breakdown-tab-btn[^"]*)"/g)]
    .map((match) => match[1].replace(/\s+active\b/g, "").trim());

  assert.equal(tabClasses.length, 4);
  assert.equal(new Set(tabClasses).size, 1);
  assert.match(css, /#modal-plan-breakdown \.breakdown-tab-btn\.active\s*\{[^}]*color:\s*var\(--primary\)/s);
  assert.doesNotMatch(modal, /breakdown-tab-btn[^\n]*!important/);
});

test("deleting a draft package from breakdown removes its aggregate without persistence", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === "breakdown-plan-id") return { value: "plan-draft" };
      if (id === "modal-plan-breakdown") return { classList: { contains: () => true } };
      return null;
    },
  };
  const calls = [];
  const controller = {
    planBreakdownDraft: {
      active: true,
      action: "create",
      planId: "plan-draft",
    },
    model: {
      state: {
        goithau: [{
          id: "pkg-draft",
          rootId: "pkg-draft",
          keHoachId: "plan-draft",
          tenGoiThau: "Gói thầu bản nháp",
        }],
        goithauhanghoa: [{ id: "goods-1", goiThauId: "pkg-draft" }],
        thongtinmothau: [{ id: "opening-1", goiThauId: "pkg-draft" }],
        hanghoaduthaunhathau: [{ id: "bid-goods-1", goiThauId: "pkg-draft" }],
        assignments: [{ id: "assignment-1", targetId: "pkg-draft", type: "goithau" }],
        selectedPackageVersion: { "pkg-draft": "pkg-draft" },
      },
      persistChanges: async () => calls.push("persistChanges"),
      flushMutationOutbox: async () => calls.push("flushMutationOutbox"),
      markDeleted: () => calls.push("markDeleted"),
    },
    autoSync: async () => calls.push("autoSync"),
    view: { customConfirm: async () => true },
    recalculatePlanTotal() {},
    renderBreakdownPackagesList() {},
    updateBreakdownTotal() {},
  };

  try {
    await deleteGoiThau.call(controller, "pkg-draft");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.deepEqual(controller.model.state.goithau, []);
  assert.deepEqual(controller.model.state.goithauhanghoa, []);
  assert.deepEqual(controller.model.state.thongtinmothau, []);
  assert.deepEqual(controller.model.state.hanghoaduthaunhathau, []);
  assert.deepEqual(controller.model.state.assignments, []);
  assert.deepEqual(controller.model.state.selectedPackageVersion, {});
  assert.deepEqual(calls, []);
});

test("back from breakdown reopens the same plan draft and keeps breakdown rows in memory", async () => {
  const previousDocument = globalThis.document;
  const row = {
    querySelector(selector) {
      return {
        ".breakdown-name": { value: "Công việc nháp" },
        ".breakdown-value": { value: "250" },
        ".breakdown-unit": { value: "Đơn vị A" },
        ".breakdown-doc": { value: "QĐ 01" },
      }[selector] || null;
    },
  };
  const bodies = {
    "tbody-breakdown-dathuchien": { querySelectorAll: () => [row] },
    "tbody-breakdown-khongapdung": { querySelectorAll: () => [] },
    "tbody-breakdown-chuadudieuKien": { querySelectorAll: () => [] },
  };
  globalThis.document = {
    getElementById(id) {
      if (id === "breakdown-plan-id") return { value: "plan-draft" };
      return bodies[id] || null;
    },
  };
  const events = [];
  let editOptions;
  const plan = { id: "plan-draft" };
  const controller = {
    planBreakdownDraft: { active: true, action: "create", planId: "plan-draft" },
    tempPlanAction: "create",
    tempPlanData: { id: "plan-draft" },
    model: {
      state: { kehoach: [plan] },
      parseVND: Number,
    },
    view: {
      closeModal: (id) => events.push(["close", id]),
      openModal: (id) => events.push(["open", id]),
    },
    plans: {
      edit: async (id, options) => {
        editOptions = options;
        events.push(["edit", id]);
      },
    },
  };

  try {
    await backToPlanDraft.call(controller);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.deepEqual(plan.cvDaThucHienList, [{
    tenCongViec: "Công việc nháp",
    giaTri: 250,
    donViThucHien: "Đơn vị A",
    vanBanPheDuyet: "QĐ 01",
  }]);
  assert.deepEqual(events, [
    ["close", "modal-plan-breakdown"],
    ["edit", "plan-draft"],
  ]);
  assert.deepEqual(editOptions, {
    keepProcurementCodeEditable: true,
    preserveProcurementLookupSelection: true,
  });
  assert.equal(controller.planBreakdownDraft.active, true);
});

test("new plan breakdown exposes distinct intermediate and final save actions", async () => {
  const markup = await import("node:fs/promises").then(({ readFile }) => (
    readFile(new URL("../../views/modals/modal_plan_breakdown.html", import.meta.url), "utf8")
  ));
  assert.match(markup, /id="btn-back-plan-breakdown"[^>]*>Quay lại</);
  assert.match(markup, /id="btn-save-plan-version-draft"[^>]*>Lưu phiên bản nháp</);
  assert.match(markup, /id="btn-save-plan-breakdown"[\s\S]*?Lưu kế hoạch/);
  assert.doesNotMatch(markup, />Bỏ qua</);
  assert.doesNotMatch(markup, /Lưu phân chia công việc/);
});
