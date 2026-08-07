import {
  applyHierarchicalDetailedEvaluationResults,
  markHierarchicalDetailedEvaluationCriteria,
} from "./detailedEvaluationHierarchy.js";
import {
  buildReopenedDetailedEvaluationReport,
  normalizeDetailedEvaluationRow,
} from "./DetailedEvaluationState.js";
import {
  aggregateDetailedEvaluationAutomatic,
  aggregateDetailedEvaluationReport,
} from "./detailedEvaluationAggregation.js";
import { beginExcelImportLoading } from "../shared/ExcelImportLoading.js";

export async function confirmDetailedEvaluationDiscard(appController) {
  if (!appController._detailedEvaluationDirty) return true;
  return appController.view.customConfirm(
    "Chưa lưu thay đổi",
    "Các thay đổi trong báo cáo chi tiết chưa được lưu. Bạn có muốn bỏ các thay đổi này?",
    "alert-triangle",
  );
}

export function collectActiveGroupRows(container, report, criteria) {
  const existing = new Map(
    (report?.chiTietList || []).map((row) => [
      String(row.tieuChiDanhGiaId),
      normalizeDetailedEvaluationRow(row),
    ]),
  );
  container.querySelectorAll("[data-detailed-criterion-id]").forEach((element) => {
    const criterionId = element.getAttribute("data-detailed-criterion-id");
    const criterion = criteria.find((item) => String(item.id) === String(criterionId));
    if (!criterion) return;
    const previous = normalizeDetailedEvaluationRow(
      existing.get(String(criterionId)) || {},
    );
    const hasField = (field) => Boolean(element.querySelector(`[data-detailed-field="${field}"]`));
    const value = (field) => element.querySelector(`[data-detailed-field="${field}"]`)?.value ?? "";
    const choiceValue = (field) => {
      const choice = element.querySelector(
        `[data-detailed-field="${field}"][data-detailed-result-value]`,
      );
      if (!choice || typeof choice.getAttribute !== "function") return null;
      const selected = element.querySelector(
        `[data-detailed-field="${field}"][data-detailed-result-value]:checked`,
      );
      return typeof selected?.getAttribute === "function"
        ? selected.getAttribute("data-detailed-result-value") || "pending"
        : "pending";
    };
    const scoreValue = value("diem");
    let result = choiceValue("ketQua") || value("ketQua") || "pending";
    if (criterion.resultType === "text") result = value("nhanXet").trim() ? "pass" : "pending";
    if (criterion.resultType === "number") result = scoreValue !== "" ? "pass" : "pending";
    if (criterion.resultType === "score") {
      const score = scoreValue === "" ? null : Number(scoreValue);
      const minimum = criterion.minScore === null || criterion.minScore === undefined
        ? null
        : Number(criterion.minScore);
      result = score === null || !Number.isFinite(score)
        ? "pending"
        : minimum !== null && Number.isFinite(minimum) && score < minimum ? "fail" : "pass";
    }
    if (criterion.group === "financial") result = value("noiDungHsdt").trim() ? "pass" : "pending";
    const automaticResult = choiceValue("ketQuaTuDong");
    existing.set(String(criterionId), {
      ...previous,
      id: previous.id || `detailed-evaluation-row:${report.id}:${criterionId}`,
      tieuChiDanhGiaId: criterionId,
      ketQua: result,
      diem: scoreValue === "" ? null : Number(scoreValue),
      noiDungHsdt: value("noiDungHsdt"),
      nhanXet: value("nhanXet"),
      yeuCauLamRo: hasField("yeuCauLamRo") ? value("yeuCauLamRo") : previous.yeuCauLamRo || "",
      ketQuaLamRo: hasField("ketQuaLamRo") ? value("ketQuaLamRo") : previous.ketQuaLamRo || "",
      taiLieuThamChieu: hasField("taiLieuThamChieu")
        ? value("taiLieuThamChieu")
        : previous.taiLieuThamChieu || "",
      extension: automaticResult === null
        ? { ...(previous.extension || {}) }
        : { ...(previous.extension || {}), ketQuaTuDong: automaticResult },
    });
  });
  return [...existing.values()];
}

export function collectConfiguredDetailedEvaluationCriteria(container, criteria = []) {
  const updates = new Map();
  const criteriaById = new Map(criteria.map((criterion) => [String(criterion.id), criterion]));
  container.querySelectorAll("[data-detailed-criterion-id]").forEach((element) => {
    const criterionId = String(element.getAttribute("data-detailed-criterion-id") || "");
    const criterion = criteriaById.get(criterionId);
    if (!criterion) return;
    const value = (field) => element.querySelector(
      `[data-detailed-config-field="${field}"]`,
    )?.value;
    const name = criterion.isCustom === true ? value("name") : undefined;
    const stt = criterion.isCustom === true ? value("stt") : undefined;
    const requirement = criterion.isCustom === true ? value("requirement") : undefined;
    const maxScore = value("maxScore");
    const minScore = value("minScore");
    if (name === undefined && stt === undefined && requirement === undefined
      && maxScore === undefined && minScore === undefined) return;
    updates.set(criterionId, {
      ...(name === undefined ? {} : { name: String(name).trim() }),
      ...(stt === undefined ? {} : { stt: String(stt).trim().replace(/\.$/, "") }),
      ...(requirement === undefined ? {} : { requirement: String(requirement).trim() }),
      ...(maxScore === undefined ? {} : { maxScore: maxScore === "" ? null : Number(maxScore) }),
      ...(minScore === undefined ? {} : { minScore: minScore === "" ? null : Number(minScore) }),
    });
  });
  return criteria.map((criterion) => ({
    ...criterion,
    ...(updates.get(String(criterion.id)) || {}),
  }));
}

function updateDerivedResultMarks(container, report, criteria) {
  const rows = new Map(
    (report?.chiTietList || []).map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  criteria.filter((criterion) => criterion.hasChildren === true).forEach((criterion) => {
    const row = rows.get(String(criterion.id)) || {};
    const resultByField = {
      ketQua: row.ketQua || "pending",
      ketQuaTuDong: row.extension?.ketQuaTuDong || row.ketQuaTuDong || "pending",
    };
    const rowElement = container.querySelector(
      `[data-detailed-criterion-id="${criterion.id}"]`,
    );
    rowElement?.querySelectorAll("[data-detailed-derived-field]").forEach((mark) => {
      const field = mark.getAttribute("data-detailed-derived-field");
      const value = mark.getAttribute("data-detailed-derived-value");
      const marked = resultByField[field] === value;
      mark.textContent = marked ? "x" : "-";
      mark.classList.toggle("is-marked", marked);
      mark.setAttribute(
        "aria-label",
        `${mark.getAttribute("data-detailed-derived-label") || "Kết quả tự tính"}: ${marked ? "có" : "không"}`,
      );
    });
  });
}

export function updateDetailedEvaluationConclusion(
  container,
  report,
  criteria,
  activeGroup,
) {
  const conclusionRow = container?.querySelector?.("[data-detailed-conclusion-row]");
  if (!conclusionRow) return false;
  const expertAggregation = aggregateDetailedEvaluationReport({
    report: report || {},
    criteria,
    groups: [activeGroup],
  }).byGroup[activeGroup] || {};
  const expertStatus = expertAggregation.status || "";
  const automaticStatus = aggregateDetailedEvaluationAutomatic({
    report: report || {},
    criteria,
    group: activeGroup,
  });
  const resultByField = {
    ketQua: expertStatus === "Đạt" ? "pass" : expertStatus === "Không đạt" ? "fail" : "pending",
    ketQuaTuDong: automaticStatus === "Đạt" ? "pass" : automaticStatus === "Không đạt" ? "fail" : "pending",
  };
  conclusionRow.querySelectorAll("[data-detailed-derived-field]").forEach((mark) => {
    const field = mark.getAttribute("data-detailed-derived-field");
    const value = mark.getAttribute("data-detailed-derived-value");
    const marked = resultByField[field] === value;
    mark.textContent = marked ? "x" : "-";
    mark.classList.toggle("is-marked", marked);
    mark.setAttribute(
      "aria-label",
      `${mark.getAttribute("data-detailed-derived-label") || "Kết luận"}: ${marked ? "có" : "không"}`,
    );
  });
  const badge = conclusionRow.querySelector("[data-detailed-conclusion-badge]");
  if (badge) {
    const label = expertStatus || "Chưa kết luận";
    const tone = expertStatus === "Đạt"
      ? "badge-success"
      : expertStatus === "Không đạt" ? "badge-danger" : "badge-warning";
    badge.textContent = label;
    badge.classList.remove("badge-success", "badge-danger", "badge-warning");
    badge.classList.add(tone);
  }
  const score = conclusionRow.querySelector(".detailed-evaluation-conclusion-score");
  if (score) score.textContent = expertAggregation.score === null || expertAggregation.score === undefined
    ? ""
    : `Tổng điểm: ${expertAggregation.score}`;
  return true;
}

function assertCommands(commands) {
  const required = ["close", "render", "save", "importExcel", "addCriterion", "removeCriterion", "setTechnicalMethod"];
  if (required.some((name) => typeof commands?.[name] !== "function")) {
    throw new TypeError("Detailed evaluation panel controller requires all command adapters.");
  }
}

export function bindDetailedEvaluationPanelController({
  appController,
  root,
  state,
  commands,
} = {}) {
  if (!appController?.view || !root?.querySelector || !state) {
    throw new TypeError("Detailed evaluation panel controller received an invalid context.");
  }
  assertCommands(commands);
  root.querySelector("#btn-detailed-evaluation-back")?.addEventListener("click", commands.close);
  const select = root.querySelector("#detailed-evaluation-bid-select");
  if (select) select.onchange = async () => {
    if (!await confirmDetailedEvaluationDiscard(appController)) {
      select.value = appController.selectedEvaluationBidId || "";
      return;
    }
    appController.selectedEvaluationBidId = select.value;
    appController._detailedEvaluationDirty = false;
    commands.render();
  };

  const groupButtons = [...root.querySelectorAll("[data-detailed-evaluation-group]")];
  groupButtons.forEach((button, buttonIndex) => {
    button.addEventListener("click", async () => {
      if (!await confirmDetailedEvaluationDiscard(appController)) return;
      appController.selectedDetailedEvaluationTab = button.getAttribute("data-detailed-evaluation-group");
      appController._detailedEvaluationDirty = false;
      commands.render();
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const targetIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? groupButtons.length - 1
          : (buttonIndex + (event.key === "ArrowRight" ? 1 : -1) + groupButtons.length)
            % groupButtons.length;
      groupButtons[targetIndex]?.focus();
      groupButtons[targetIndex]?.click();
    });
  });

  const moveBid = async (offset) => {
    if (!await confirmDetailedEvaluationDiscard(appController)) return;
    const index = state.bids.findIndex(
      (bid) => String(bid.id) === String(appController.selectedEvaluationBidId),
    );
    const target = state.bids[index + offset];
    if (!target) return;
    appController.selectedEvaluationBidId = target.id;
    appController._detailedEvaluationDirty = false;
    commands.render();
  };
  root.querySelector("#btn-detailed-evaluation-previous")?.addEventListener("click", () => moveBid(-1));
  root.querySelector("#btn-detailed-evaluation-next")?.addEventListener("click", () => moveBid(1));
  const markDirty = () => { appController._detailedEvaluationDirty = true; };
  root.querySelectorAll("input:not([data-bidder-goods-filter]), select:not([data-bidder-goods-filter]), textarea:not([data-bidder-goods-filter])").forEach((input) => {
    input._bfDetailedDirtyBound = true;
    input.addEventListener("input", () => {
      appController._detailedEvaluationDirty = true;
      if (input.matches('[data-detailed-field="diem"], [data-detailed-config-field="maxScore"], [data-detailed-config-field="minScore"]')) {
        captureResultChange();
      }
    });
    input.addEventListener("change", () => {
      appController._detailedEvaluationDirty = true;
      if (input.matches('select[data-detailed-field="ketQua"]')) {
        captureResultChange();
      }
    });
  });
  const applyImmediateSequentialGate = (updatedReport, configuredCriteria) => {
    const activeGroup = appController.selectedDetailedEvaluationTab;
    const completed = new Set(updatedReport.extension?.completedGroups || []);
    if (!completed.has(activeGroup)) return false;
    const currentResult = aggregateDetailedEvaluationReport({
      report: updatedReport,
      criteria: configuredCriteria,
      groups: [activeGroup],
    }).byGroup[activeGroup]?.status || "";
    const storedResult = updatedReport.extension?.groupResults?.[activeGroup] || "";
    if (currentResult === storedResult) return false;
    const configuredGroups = state.context.configuredGroups || state.context.editableGroups || [];
    const activeIndex = configuredGroups.indexOf(activeGroup);
    const invalidated = new Set(
      activeIndex >= 0 ? configuredGroups.slice(activeIndex) : [activeGroup],
    );
    updatedReport.extension = {
      ...(updatedReport.extension || {}),
      completedGroups: [...completed].filter((group) => !invalidated.has(group)),
      groupResults: Object.fromEntries(
        Object.entries(updatedReport.extension?.groupResults || {})
          .filter(([group]) => !invalidated.has(group)),
      ),
    };
    appController._detailedEvaluationDrafts.set(state.draftKey, updatedReport);
    commands.render();
    return true;
  };
  const captureResultChange = () => {
    const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
      collectConfiguredDetailedEvaluationCriteria(root, state.criteria),
    );
    const configuredGroupCriteria = configuredCriteria.filter(
      (criterion) => criterion.group === appController.selectedDetailedEvaluationTab,
    );
    const updatedReport = applyHierarchicalDetailedEvaluationResults({
      ...state.report,
      chiTietList: collectActiveGroupRows(root, state.report, configuredGroupCriteria),
    }, configuredCriteria);
    updateDerivedResultMarks(root, updatedReport, configuredGroupCriteria);
    updateDetailedEvaluationConclusion(
      root,
      updatedReport,
      configuredGroupCriteria,
      appController.selectedDetailedEvaluationTab,
    );
    applyImmediateSequentialGate(updatedReport, configuredCriteria);
  };
  const handleResultChange = (input) => {
    const row = input.closest("[data-detailed-criterion-id]");
    const field = input.getAttribute("data-detailed-field");
    if (input.checked) {
      row?.querySelectorAll(
        `[data-detailed-field="${field}"][data-detailed-result-value]`,
      ).forEach((candidate) => {
        if (candidate !== input) candidate.checked = false;
      });
    }
    captureResultChange();
  };
  root.querySelectorAll("[data-detailed-result-value]").forEach((input) => {
    input._bfDetailedResultBound = true;
    input.addEventListener("change", () => handleResultChange(input));
  });
  root.querySelectorAll('input[name="detailed-technical-evaluation-method"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) commands.setTechnicalMethod(input.value);
    });
  });
  root.addEventListener?.("input", (event) => {
    if (
      event.target?.matches?.("input, select, textarea")
      && !event.target._bfDetailedDirtyBound
    ) markDirty();
  });
  root.addEventListener?.("change", (event) => {
    const input = event.target;
    if (input?.matches?.("input, select, textarea") && !input._bfDetailedDirtyBound) {
      markDirty();
    }
    if (
      input?.matches?.("[data-detailed-result-value]")
      && !input._bfDetailedResultBound
    ) handleResultChange(input);
  });

  root.querySelector("#btn-detailed-evaluation-save-draft")?.addEventListener("click", () => commands.save());
  root.querySelector("#btn-detailed-evaluation-complete-group")?.addEventListener(
    "click",
    () => commands.save({ completeGroup: true }),
  );
  root.querySelector("#btn-detailed-evaluation-complete-report")?.addEventListener(
    "click",
    () => commands.save({ completeReport: true }),
  );
  root.querySelector("#btn-detailed-evaluation-reopen")?.addEventListener("click", () => {
    appController._editingDetailedEvaluationKey = state.draftKey;
    appController._detailedEvaluationDrafts.set(
      state.draftKey,
      buildReopenedDetailedEvaluationReport(state.report),
    );
    commands.render();
  });

  const excelInput = root.querySelector("#detailed-evaluation-excel-input");
  const excelButton = root.querySelector("#btn-detailed-evaluation-import-excel");
  root.querySelector("#btn-detailed-evaluation-add-row")?.addEventListener("click", commands.addCriterion);
  root.querySelectorAll("[data-detailed-remove-criterion]").forEach((button) => {
    button._bfDetailedRemoveBound = true;
    button.addEventListener("click", () => commands.removeCriterion(
      button.getAttribute("data-detailed-remove-criterion"),
    ));
  });
  root.addEventListener?.("click", (event) => {
    const button = event.target?.closest?.("[data-detailed-remove-criterion]");
    if (!button || button._bfDetailedRemoveBound) return;
    commands.removeCriterion(button.getAttribute("data-detailed-remove-criterion"));
  });
  excelButton?.addEventListener("click", () => excelInput?.click());
  excelInput?.addEventListener("change", async () => {
    const file = excelInput.files?.[0];
    if (!file) return;
    const loading = await beginExcelImportLoading({ fileName: file.name });
    excelButton.disabled = true;
    excelButton.setAttribute("aria-busy", "true");
    try {
      await commands.importExcel(file);
      await loading.update(
        "preview",
        "Kết quả đánh giá đang được sắp xếp để hiển thị trên biểu mẫu.",
      );
    } finally {
      excelInput.value = "";
      excelButton.disabled = false;
      excelButton.removeAttribute("aria-busy");
      await loading.close();
    }
  });
  appController.view.createIconsScoped?.(root);
}
