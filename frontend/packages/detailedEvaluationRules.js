import { resolveDetailedEvaluationTemplate } from "./detailedEvaluationTemplates.js";

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
  const roundGroups = roundType === "technical"
    ? ["validity", "capacity", "technical"]
    : roundType === "financial"
      ? ["financial"]
      : template.groups;
  const visibleGroups = roundGroups.filter((group) => templateGroups.has(group));
  const editableGroups = visibleGroups.filter((group) => rule.editableGroups.includes(group));
  return {
    methodKey,
    roundType,
    visibleGroups,
    editableGroups,
    templateId: template.id,
    templateVersion: template.version,
    templateSource: template.source,
    contractorFilter: rule.contractorFilter,
    scoringModeByGroup: Object.fromEntries(visibleGroups.map((group) => [
      group,
      template.scoreGroups?.includes(group) ? "score" : "criteria",
    ])),
    allowComplete: rule.allowComplete !== false,
  };
}
