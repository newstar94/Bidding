import { resolveDetailedEvaluationTemplate } from "./detailedEvaluationTemplates.js";
import { supportsGoodsWorkflow } from "./goodsWorkflowSupport.js";

const ALL_GROUPS = Object.freeze([
  "validity",
  "capacity",
  "technical",
  "financial",
]);

export const DETAILED_EVALUATION_RULES = Object.freeze({
  default: Object.freeze({
    visibleGroups: ALL_GROUPS,
    editableGroups: ALL_GROUPS,
    contractorFilter: "package-bids",
    allowComplete: true,
  }),
  oneStageOneEnvelope: Object.freeze({
    visibleGroups: ALL_GROUPS,
    editableGroups: ALL_GROUPS,
    contractorFilter: "package-bids",
    allowComplete: true,
  }),
  oneStageTwoEnvelopeTechnical: Object.freeze({
    visibleGroups: Object.freeze(["validity", "capacity", "technical"]),
    editableGroups: Object.freeze(["validity", "capacity", "technical"]),
    contractorFilter: "package-bids",
    allowComplete: true,
  }),
  oneStageTwoEnvelopeFinancial: Object.freeze({
    visibleGroups: Object.freeze(["financial"]),
    editableGroups: Object.freeze(["financial"]),
    contractorFilter: "technical-qualified",
    allowComplete: true,
  }),
  directAppointmentSimplified: Object.freeze({}),
  specialSelection: Object.freeze({}),
  consulting: Object.freeze({}),
  nonConsultingProcess2: Object.freeze({
    visibleGroups: Object.freeze(["validity", "capacity", "technical"]),
    editableGroups: Object.freeze(["validity", "capacity", "technical"]),
    contractorFilter: "package-bids",
    allowComplete: true,
  }),
});

function methodKeyFor(pkg, roundType) {
  if (roundType === "technical") return "oneStageTwoEnvelopeTechnical";
  if (roundType === "financial") return "oneStageTwoEnvelopeFinancial";
  const template = resolveDetailedEvaluationTemplate(pkg);
  if (template.id === "bc-dgct-14d") return "consulting";
  if (template.id === "bc-dgct-14b") return "nonConsultingProcess2";
  if (roundType === "single") return "oneStageOneEnvelope";
  const method = String(pkg?.phuongThucLuaChon || "").toLocaleLowerCase("vi");
  return method.includes("hai túi")
    ? "oneStageTwoEnvelopeTechnical"
    : "oneStageOneEnvelope";
}

export function resolveDetailedEvaluationContext(pkg, roundType = "single") {
  const methodKey = methodKeyFor(pkg, roundType);
  const template = resolveDetailedEvaluationTemplate(pkg);
  const rule = {
    ...DETAILED_EVALUATION_RULES.default,
    ...DETAILED_EVALUATION_RULES[methodKey],
  };
  const templateGroups = new Set(template.groups);
  let roundGroups = roundType === "technical"
    ? ["validity", "capacity", "technical"]
    : roundType === "financial"
      ? ["financial"]
      : template.groups;
  const showBidderGoods = supportsGoodsWorkflow(pkg)
    && ["single", "financial"].includes(roundType);
  if (showBidderGoods) {
    roundGroups = roundType === "financial"
      ? ["bidder_goods", "financial"]
      : roundGroups.flatMap((group) => group === "financial" ? ["bidder_goods", group] : [group]);
  }
  const configuredGroups = roundGroups.filter((group) => group === "bidder_goods" || templateGroups.has(group));
  const editableGroups = configuredGroups.filter((group) => group === "bidder_goods" || rule.editableGroups.includes(group));
  return {
    methodKey,
    roundType,
    configuredGroups,
    visibleGroups: configuredGroups,
    editableGroups,
    templateId: template.id,
    templateVersion: template.version,
    templateSource: template.source,
    contractorFilter: rule.contractorFilter,
    scoringModeByGroup: Object.fromEntries(configuredGroups.map((group) => [
      group,
      template.scoreGroups?.includes(group) ? "score" : "criteria",
    ])),
    allowComplete: rule.allowComplete !== false,
  };
}

export function resolveAccessibleDetailedEvaluationGroups({
  configuredGroups = [], report = {}, aggregationByGroup = {}, bidderGoodsReady = false,
} = {}) {
  const completed = new Set(report?.extension?.completedGroups || []);
  const storedResults = report?.extension?.groupResults || {};
  const accessible = [];
  for (const group of configuredGroups) {
    if (accessible.length === 0) {
      accessible.push(group);
      continue;
    }
    const predecessor = configuredGroups[configuredGroups.indexOf(group) - 1];
    const predecessorPassed = predecessor === "bidder_goods"
      ? bidderGoodsReady
      : completed.has(predecessor)
        && (storedResults[predecessor] || aggregationByGroup[predecessor]?.status) === "Đạt";
    if (!predecessorPassed) break;
    accessible.push(group);
  }
  return accessible;
}
