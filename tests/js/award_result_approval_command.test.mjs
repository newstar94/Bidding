import assert from "node:assert/strict";
import test from "node:test";

import { prepareAwardApprovalCommand } from "../../frontend/packages/detail/AwardResultApprovalCommand.js";

function control(value = "") {
  return { value, closest: () => null };
}

function row({ attrs = {}, controls = {}, cells = [] } = {}) {
  return {
    _thanhVienLienDanh: controls.jointVentureMembers || [],
    cells,
    getAttribute: (name) => attrs[name] ?? null,
    querySelector: (selector) => controls[selector] || null,
  };
}

function root(fields, rows) {
  const tbody = { querySelectorAll: (selector) => selector === "tr" ? rows : [] };
  return {
    querySelector: (selector) => (
      selector === "#approve-bidders-tbody" ? tbody : fields[selector] || null
    ),
  };
}

const model = {
  convertDMYToYMD: (value) => value ? value.split("/").reverse().join("-") : "",
  parseVND: (value) => Number(String(value || "").replace(/\./g, "")) || 0,
};

test("approval command reports every required decision and winner field", () => {
  const winner = row({
    attrs: { "data-approve-bid-id": "bid-1", "data-nt-id": "contractor-1" },
    controls: {
      ".row-status-select": control("trung"),
      ".row-gia-trung": control(""),
      ".row-tg-goithau": control(""),
      ".row-tg-hopdong": control(""),
    },
  });
  const command = prepareAwardApprovalCommand({
    root: root({
      "#award-so-bctd": control(""),
      "#award-ngay-bctd": control(""),
      "#award-decision-no": control(""),
      "#award-decision-date": control(""),
    }, [winner]),
    pkg: { phanLo: "Không" },
    model,
    isDirectOrSpecial: false,
  });

  assert.equal(command.ok, false);
  assert.deepEqual(command.errors.map((error) => error.code), [
    "appraisal_number_required",
    "appraisal_date_required",
    "decision_number_required",
    "decision_date_required",
    "award_price_required",
    "package_duration_required",
    "contract_duration_required",
  ]);
  assert.equal(command.winnerRows.length, 1);
  assert.equal(command.winnerRows[0].bidId, "bid-1");
});

test("approval command normalizes a direct-award joint-venture lot row", () => {
  const members = [{ thanhVienNhaThauId: "member-2", tenNhaThau: "Thành viên B" }];
  const winner = row({
    attrs: { "data-approve-bid-id": "bid-new", "data-nt-id": "contractor-lead" },
    controls: {
      ".row-ma-nha-thau": control(" JV-01 "),
      ".row-ten-nha-thau": control(" Liên danh A-B "),
      ".row-loai-nha-thau": control("Liên danh"),
      ".row-gia-trung": control("1.200.000"),
      ".row-tg-goithau": control("60 ngày"),
      ".row-tg-hopdong": control("90 ngày"),
      ".row-ma-phan-lo": control("PL-01"),
      ".row-ten-phan-lo": control("Lô 01"),
      jointVentureMembers: members,
    },
  });
  const command = prepareAwardApprovalCommand({
    root: root({
      "#award-so-bctd": control("12/BCTĐ"),
      "#award-ngay-bctd": control("25/07/2026"),
      "#award-decision-no": control("34/QĐ"),
      "#award-decision-date": control("26/07/2026"),
    }, [winner]),
    pkg: { phanLo: "Có" },
    model,
    isDirectOrSpecial: true,
  });

  assert.equal(command.ok, true);
  assert.deepEqual(command.decision, {
    number: "34/QĐ",
    date: "2026-07-26",
    rawDate: "26/07/2026",
    appraisalNumber: "12/BCTĐ",
    appraisalDate: "2026-07-25",
    appraisalRawDate: "25/07/2026",
  });
  assert.equal(command.winnerRows.length, 1);
  assert.deepEqual(command.winnerRows[0], {
    element: winner,
    bidId: "bid-new",
    contractorId: "contractor-lead",
    status: "trung",
    isWinner: true,
    contractorCode: "JV-01",
    contractorName: "Liên danh A-B",
    contractorType: "Liên danh",
    jointVentureMembers: members,
    leadMemberContractorId: "",
    leadMemberName: "",
    lotCode: "PL-01",
    lotName: "Lô 01",
    awardPriceRaw: "1.200.000",
    awardPrice: 1_200_000,
    packageDuration: "60 ngày",
    contractDuration: "90 ngày",
    rejectionReason: "",
  });
});

test("approval command keeps losing rows without applying winner-only validation", () => {
  const loser = row({
    attrs: { "data-approve-bid-id": "bid-2", "data-nt-id": "contractor-2" },
    controls: {
      ".row-status-select": control("truot"),
      ".row-gia-trung": control(""),
      ".row-tg-goithau": control(""),
      ".row-tg-hopdong": control(""),
      ".row-ly-do-truot": control("Không đạt kỹ thuật"),
    },
  });
  const command = prepareAwardApprovalCommand({
    root: root({
      "#award-decision-no": control("34/QĐ"),
      "#award-decision-date": control("26/07/2026"),
    }, [loser]),
    pkg: { phanLo: "Không" },
    model,
    isDirectOrSpecial: false,
  });

  assert.equal(command.ok, true);
  assert.equal(command.winnerRows.length, 0);
  assert.equal(command.rows[0].rejectionReason, "Không đạt kỹ thuật");
});

test("approval command reads lot identity from static cells for evaluated bids", () => {
  const evaluatedRow = row({
    attrs: { "data-approve-bid-id": "bid-3", "data-nt-id": "contractor-3" },
    cells: [{ textContent: " PL-03 " }, { textContent: " Lô 03 " }],
    controls: {
      ".row-status-select": control("truot"),
      ".row-ly-do-truot": control("Xếp hạng sau"),
    },
  });
  const command = prepareAwardApprovalCommand({
    root: root({
      "#award-decision-no": control("34/QĐ"),
      "#award-decision-date": control("26/07/2026"),
    }, [evaluatedRow]),
    pkg: { phanLo: "Có" },
    model,
    isDirectOrSpecial: false,
  });

  assert.equal(command.rows[0].lotCode, "PL-03");
  assert.equal(command.rows[0].lotName, "Lô 03");
});
