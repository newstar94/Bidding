import assert from "node:assert/strict";
import test from "node:test";

import {
  getAvailableWordPublicationTypes,
  WORD_PUBLICATION_DOCUMENTS,
  WORD_PUBLICATION_PROCUREMENT_FORM,
  WORD_PUBLICATION_SELECTION_METHOD,
} from "../../frontend/documents/WordPublicationPolicy.js";
import {
  buildWordPublicationExportRequest,
  createWordPublicationState,
  getWordPublicationPackages,
  getWordPublicationPlans,
  selectWordPublicationPackage,
  selectWordPublicationPlan,
} from "../../frontend/documents/WordPublicationState.js";

const idsFor = (packageRecord) => (
  getAvailableWordPublicationTypes({ packageRecord }).map((item) => item.id)
);

const packageFixture = ({
  method = WORD_PUBLICATION_SELECTION_METHOD.ONE_STAGE_ONE_ENVELOPE,
  procurementForm = "Đấu thầu rộng rãi",
} = {}) => ({
  id: "package-a",
  keHoachId: "plan-a",
  maGoiThau: "Gói 01",
  phuongThucLuaChon: method,
  hinhThucLuaChon: procurementForm,
});

test("Word publication definitions have stable unique identities", () => {
  assert.equal(WORD_PUBLICATION_DOCUMENTS.length, 11);
  assert.equal(
    new Set(WORD_PUBLICATION_DOCUMENTS.map((item) => item.id)).size,
    WORD_PUBLICATION_DOCUMENTS.length,
  );
  const technical = WORD_PUBLICATION_DOCUMENTS.filter((item) => (
    item.id.startsWith("technical_bid_evaluation_report_")
  ));
  assert.deepEqual(
    technical.map((item) => item.id),
    [
      "technical_bid_evaluation_report_01",
      "technical_bid_evaluation_report_02",
      "technical_bid_evaluation_report_03",
    ],
  );
  assert.equal(
    WORD_PUBLICATION_DOCUMENTS.every((item) => item.exportTarget),
    true,
  );
  assert.equal(
    WORD_PUBLICATION_DOCUMENTS.some((item) => item.legacyActiveFallback === true),
    false,
  );
});

test("1G1T exposes the one-envelope report and excludes all E-HSĐXKT identities", () => {
  const ids = idsFor(packageFixture());
  assert.equal(ids.includes("package_full_profile"), false);
  assert.equal(ids.includes("bid_evaluation_report"), true);
  assert.equal(ids.some((id) => id.startsWith("technical_bid_evaluation_report_")), false);
  assert.equal(ids.includes("award_result_appraisal_report"), true);
  assert.equal(ids.includes("contractor_selection_result"), false);
});

test("1G2T exposes technical report, technical decision and financial report", () => {
  const documents = getAvailableWordPublicationTypes({ packageRecord: packageFixture({
    method: WORD_PUBLICATION_SELECTION_METHOD.ONE_STAGE_TWO_ENVELOPE,
  }) });
  const ids = documents.map((item) => item.id);
  const technicalIds = ids.filter((id) => id.startsWith("technical_bid_evaluation_report_"));
  assert.equal(technicalIds.length, 3);
  assert.equal(new Set(technicalIds).size, 3);
  assert.deepEqual(
    documents.filter((item) => technicalIds.includes(item.id)).map((item) => item.label),
    [
      "Báo cáo đánh giá E-HSĐXKT",
      "Quyết định phê duyệt nhà thầu đạt kỹ thuật",
      "Báo cáo đánh giá E-HSĐXTC",
    ],
  );
  assert.equal(ids.includes("bid_evaluation_report"), false);
});

for (const procurementForm of [
  WORD_PUBLICATION_PROCUREMENT_FORM.DIRECT_APPOINTMENT_SHORTENED,
  WORD_PUBLICATION_PROCUREMENT_FORM.SPECIAL_SELECTION,
]) {
  test(`${procurementForm} exposes plan and selection result`, () => {
    const ids = idsFor(packageFixture({ procurementForm }));
    assert.deepEqual(ids, [
      "procurement_plan",
      "contractor_selection_result",
    ]);
  });
}

test("missing package has no documents and unknown method does not infer by display fragments", () => {
  assert.deepEqual(getAvailableWordPublicationTypes(), []);
  const ids = idsFor(packageFixture({ method: "Tên có chữ 1G2T nhưng không phải canonical value" }));
  assert.equal(ids.includes("bid_evaluation_report"), false);
  assert.equal(ids.some((id) => id.startsWith("technical_bid_evaluation_report_")), false);
  assert.equal(ids.includes("award_result_appraisal_report"), true);
});

test("dependent state resets package and document whenever plan or package changes", () => {
  const state = createWordPublicationState();
  assert.deepEqual(state, {
    planId: "",
    packageId: "",
    selectedDocumentId: "",
    pendingDocumentId: "",
  });
  selectWordPublicationPlan(state, "plan-a");
  selectWordPublicationPackage(state, "package-a");
  state.selectedDocumentId = "bid_evaluation_report";

  selectWordPublicationPlan(state, "plan-b");
  assert.deepEqual(state, {
    planId: "plan-b",
    packageId: "",
    selectedDocumentId: "",
    pendingDocumentId: "",
  });

  state.selectedDocumentId = "technical_bid_evaluation_report_01";
  selectWordPublicationPackage(state, "package-b");
  assert.equal(state.packageId, "package-b");
  assert.equal(state.selectedDocumentId, "");
});

test("plan and package selectors use filtered latest records and enforce parent relationship", () => {
  const plans = [
    { id: "plan-b", maKeHoach: "KH-02", tenKeHoach: "Kế hoạch B" },
    { id: "plan-a", maKeHoach: "KH-01", tenKeHoach: "Kế hoạch A" },
  ];
  const packages = [
    { id: "package-b", keHoachId: "plan-b", maGoiThau: "Gói 02", tenGoiThau: "Gói B" },
    { id: "package-a2", keHoachId: "plan-a", maGoiThau: "Gói 02", tenGoiThau: "Gói A2" },
    { id: "package-a1", keHoachId: "plan-a", maGoiThau: "Gói 01", tenGoiThau: "Gói A1" },
  ];
  const model = {
    getFilteredKeHoach: () => plans,
    getFilteredGoiThau: () => packages,
  };

  assert.deepEqual(getWordPublicationPlans(model).map((item) => item.id), ["plan-a", "plan-b"]);
  assert.deepEqual(
    getWordPublicationPackages(model, "plan-a").map((item) => item.id),
    ["package-a1", "package-a2"],
  );
  assert.deepEqual(getWordPublicationPackages(model, ""), []);
});

test("export requests use the background plan and package Word job endpoints", () => {
  const planDocument = WORD_PUBLICATION_DOCUMENTS.find((item) => item.id === "procurement_plan");
  const evaluationDocument = WORD_PUBLICATION_DOCUMENTS.find((item) => item.id === "bid_evaluation_report");
  const consultantDocument = WORD_PUBLICATION_DOCUMENTS.find((item) => item.id === "consultant_evaluation_step_1");
  const plan = { id: "plan/a", maKeHoach: "KH/2026" };
  const packageRecord = { id: "package/a", maGoiThau: "Gói 01" };

  assert.deepEqual(
    buildWordPublicationExportRequest({ documentType: planDocument, plan, packageRecord }),
    {
      createJobUrl: "/api/document-jobs/plan/plan%2Fa?publicationType=procurement_plan",
      filename: "procurement_plan_KH_2026.docx",
    },
  );
  assert.deepEqual(
    buildWordPublicationExportRequest({ documentType: evaluationDocument, plan, packageRecord }),
    {
      createJobUrl: "/api/document-jobs/package-report/package%2Fa?type=evaluation&publicationType=bid_evaluation_report",
      filename: "bid_evaluation_report_Goi_01.docx",
    },
  );
  assert.deepEqual(
    buildWordPublicationExportRequest({
      documentType: consultantDocument,
      plan,
      packageRecord,
    }),
    {
      createJobUrl: "/api/document-jobs/package-report/package%2Fa?type=evaluation&publicationType=consultant_evaluation_step_1",
      filename: "consultant_evaluation_step_1_Goi_01.docx",
    },
  );
  assert.throws(
    () => buildWordPublicationExportRequest({ documentType: planDocument, plan: null }),
    /Không xác định được Kế hoạch/u,
  );
  assert.throws(
    () => buildWordPublicationExportRequest({ documentType: evaluationDocument, packageRecord: null }),
    /Không xác định được Gói thầu/u,
  );
});
