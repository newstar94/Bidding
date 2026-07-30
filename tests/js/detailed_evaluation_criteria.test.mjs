import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptDetailedEvaluationCriteriaForBid,
} from "../../frontend/packages/detailedEvaluationCriteria.js";
import {
  DETAILED_EVALUATION_TEMPLATES,
} from "../../frontend/packages/detailedEvaluationTemplates.js";


test("1G2T omits the joint-venture agreement for an independent bidder", () => {
  const criteria = DETAILED_EVALUATION_TEMPLATES.oneStageTwoEnvelope.criteria.validity;
  const adapted = adaptDetailedEvaluationCriteriaForBid(criteria, {
    loaiNhaThau: "Độc lập",
  });

  assert.equal(adapted.some((criterion) => criterion.code === "JV_AGREEMENT"), false);
});


test("1G2T keeps the joint-venture agreement for a joint-venture bidder", () => {
  const criteria = DETAILED_EVALUATION_TEMPLATES.oneStageTwoEnvelope.criteria.validity;
  const adapted = adaptDetailedEvaluationCriteriaForBid(criteria, {
    loaiNhaThau: "Liên danh",
  });

  assert.equal(adapted.some((criterion) => criterion.code === "JV_AGREEMENT"), true);
});


test("imported public-procurement criterion code is recognized without relying on its label", () => {
  const adapted = adaptDetailedEvaluationCriteriaForBid([
    { code: "MSC_VALIDITY_1", name: "Tư cách hợp lệ", group: "validity", stt: "1" },
    { code: "MSC_VALIDITY_2", name: "Imported label", group: "validity", stt: "2" },
  ], { loaiNhaThau: "Độc lập" });

  assert.deepEqual(adapted.map((criterion) => criterion.code), ["MSC_VALIDITY_1"]);
});


test("Mua sắm công only removes MSC_VALIDITY_2 when its content is a joint-venture agreement", () => {
  const ordinary = adaptDetailedEvaluationCriteriaForBid([
    { code: "MSC_VALIDITY_2", name: "Tư cách hợp lệ theo quy định", group: "validity", stt: "2", source: "muasamcong" },
  ], { loaiNhaThau: "Độc lập" });
  const jointVentureAgreement = adaptDetailedEvaluationCriteriaForBid([
    { code: "MSC_VALIDITY_2", name: "Thỏa thuận liên danh (đối với nhà thầu liên danh)", group: "validity", stt: "2", source: "muasamcong" },
  ], { loaiNhaThau: "Độc lập" });

  assert.equal(ordinary.length, 1);
  assert.equal(jointVentureAgreement.length, 0);
});
