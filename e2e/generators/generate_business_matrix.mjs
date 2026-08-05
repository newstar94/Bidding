import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEvaluationMethods } from "../../frontend/packages/evaluationMethodRules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const enumSource = fs.readFileSync(path.join(root, "backend/documents/excel_handler.py"), "utf8");

function optionsFor(field) {
  const match = enumSource.match(new RegExp(`\\{'field': '${field}'[\\s\\S]*?'options': \\[([^\\]]+)\\]`));
  if (!match) throw new Error(`Could not derive options for ${field} from backend/documents/excel_handler.py`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

const planTypes = optionsFor("loaiHinhMuaSam");
const approvalTypes = optionsFor("pheDuyet");
const fields = optionsFor("linhVuc");
const forms = optionsFor("hinhThucLuaChon");
const procedures = optionsFor("phuongThucLuaChon");
const contractTypes = optionsFor("loaiHopDong");
const bidderTypes = optionsFor("loaiNhaThau");
const selectedProcedures = new Set(procedures);
const specialForms = new Set(["Chỉ định thầu rút gọn", "Lựa chọn nhà thầu trong trường hợp đặc biệt"]);
const standardForms = new Set(["Đấu thầu rộng rãi", "Đấu thầu hạn chế", "Chỉ định thầu"]);

const core = [];
for (const planType of planTypes) {
  for (const approvalType of approvalTypes) {
    for (const field of fields) {
      for (const form of forms) {
        if (specialForms.has(form)) {
          core.push({ planType, approvalType, field, form, procedure: "Không có", method: "" });
          continue;
        }
        for (const procedure of selectedProcedures) {
          const methods = getEvaluationMethods({
            linhVuc: field,
            hinhThucLuaChon: form,
            phuongThucLuaChon: procedure,
          });
          for (const method of methods) core.push({ planType, approvalType, field, form, procedure, method });
        }
      }
    }
  }
}

const deduped = [...new Map(core.map((tuple) => [JSON.stringify(tuple), tuple])).values()];
const validTuples = deduped.map((tuple, index) => {
  const lotted = tuple.field !== "Tư vấn" && !specialForms.has(tuple.form);
  return {
    id: `BC-${String(index + 1).padStart(4, "0")}`,
    valid: true,
    rule: "Derived by getEvaluationMethods plus package-form special-case rules",
    fixture: "generated-package-combination",
    testSpec: "e2e/specs/auth/auth.smoke.spec.mjs (schema smoke); package pairwise/lifecycle suites for representatives",
    result: "NOT_RUN_AS_EXACT_TUPLE",
    evidence: "",
    ...tuple,
    isMedicine: tuple.field === "Hàng hóa" ? "false (true boundary generated below)" : "false",
    isLotted: lotted ? "Có" : "Không",
    networkMode: "Qua mạng",
    domesticOrInternational: "Trong nước",
    optionalPurchase: "Không",
    contractType: contractTypes[0],
    bidderType: bidderTypes[0],
    bidderCount: 1,
    lotCount: lotted ? 2 : 0,
    resultOutcome: "AWARDED",
    userRole: "manager",
    workspaceRole: "organization_manager",
  };
});

const negativeTuples = [
  {
    id: "BC-N-001", valid: false, field: "Tư vấn", form: "Chào hàng cạnh tranh", procedure: "Một giai đoạn một túi hồ sơ", method: "Giá thấp nhất",
    rule: "Chào hàng cạnh tranh chỉ hợp lệ cho lĩnh vực chuẩn và 1G1T", violation: "field/form constraint",
  },
  {
    id: "BC-N-002", valid: false, field: "Tư vấn", form: "Đấu thầu rộng rãi", procedure: "Hai giai đoạn một túi hồ sơ", method: "Giá thấp nhất",
    rule: "Tư vấn chỉ dùng 1G2T trong evaluationMethodRules", violation: "procedure constraint",
  },
  {
    id: "BC-N-003", valid: false, field: "Hàng hóa", form: "Đấu thầu rộng rãi", procedure: "Một giai đoạn một túi hồ sơ", method: "Kết hợp giữa kỹ thuật và giá",
    rule: "1G1T chỉ cho STANDARD_METHODS", violation: "evaluation method constraint",
  },
  {
    id: "BC-N-004", valid: false, field: "Tư vấn", form: "Đấu thầu rộng rãi", procedure: "Một giai đoạn hai túi hồ sơ", method: "", isLotted: "Có",
    rule: "Lĩnh vực Tư vấn không phân lô theo form rule hiện tại", violation: "lot boundary",
  },
  {
    id: "BC-N-005", valid: false, field: "Hàng hóa", form: "Đấu thầu rộng rãi", procedure: "Một giai đoạn một túi hồ sơ", method: "Giá thấp nhất", isMedicine: "true",
    rule: "Thuốc + combined method requires technical weight 30%-40%", violation: "medicine weighting boundary",
  },
  {
    id: "BC-N-006", valid: false, bidderType: "Liên danh", bidderCount: 1,
    rule: "Liên danh phải có ít nhất hai thành viên", violation: "bidder membership constraint",
  },
  {
    id: "BC-N-007", valid: false, isLotted: "Có", lotCount: 0,
    rule: "Phân lô phải có phần/lô tương ứng", violation: "lot-count constraint",
  },
];

const rows = [...validTuples, ...negativeTuples];
const fieldsTable = rows.map((row) => [
  row.id, row.valid ? "HỢP LỆ" : "KHÔNG HỢP LỆ", row.planType || "—", row.approvalType || "—", row.field || "—",
  row.form || "—", row.procedure || "—", row.method || "—", row.isMedicine || "—", row.isLotted || "—",
  row.networkMode || "—", row.domesticOrInternational || "—", row.optionalPurchase || "—", row.contractType || "—",
  row.bidderType || "—", row.bidderCount ?? "—", row.lotCount ?? "—", row.resultOutcome || "—", row.userRole || "—",
  row.workspaceRole || "—", row.rule || row.violation, row.fixture || "generated-negative", row.testSpec || "boundary test",
  row.result || "NOT_RUN", row.evidence || "",
]);

const header = ["ID", "Validity", "plan_type", "approval_type", "package_field", "selection_form", "procedure", "evaluation_method", "is_medicine", "is_lotted", "network_mode", "domestic_or_international", "optional_purchase", "contract_type", "bidder_type", "bidder_count", "lot_count", "result_outcome", "user_role", "workspace_role", "Rule/violation", "Fixture", "Test spec", "Result", "Evidence"];
const md = [
  "# Business combination matrix",
  "",
  `Generated from \`backend/documents/excel_handler.py\` and \`frontend/packages/evaluationMethodRules.js\`. Valid package-form/evaluation tuples: **${validTuples.length}**. Negative boundary tuples: **${negativeTuples.length}**.`,
  "",
  "> This matrix is generated and intentionally reports exact-tuple execution separately from representative pairwise/lifecycle evidence. It does not claim full execution when a tuple was not run.",
  "",
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...fieldsTable.map((row) => `| ${row.map((value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |`),
  "",
  "## Generation contract",
  "",
  "- The generator reads the finite domain options from the source manifest and delegates evaluation-method validity to the production rule module.",
  "- Special procurement forms are represented with `procedure=Không có` and an empty evaluation method, matching the current UI rule.",
  "- Negative tuples violate one boundary at a time and are kept separate from valid tuples.",
  "- Run `npm run test:e2e:business-matrix`; CI should fail if the generator cannot derive a domain or if a generated valid tuple lacks an execution mapping in a future full-matrix runner.",
].join("\n");

const outputDir = path.join(root, "docs/e2e");
const resultDir = path.join(root, "test-results");
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(resultDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "BUSINESS_COMBINATION_MATRIX.md"), md + "\n", "utf8");
fs.writeFileSync(path.join(resultDir, "business-matrix.json"), JSON.stringify({ generatedFrom: ["backend/documents/excel_handler.py", "frontend/packages/evaluationMethodRules.js"], valid: validTuples, negative: negativeTuples }, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify({ validTuples: validTuples.length, negativeTuples: negativeTuples.length, output: "docs/e2e/BUSINESS_COMBINATION_MATRIX.md" }) + "\n");
