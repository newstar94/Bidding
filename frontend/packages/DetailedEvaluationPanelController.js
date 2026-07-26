import {
  applyHierarchicalDetailedEvaluationResults,
  markHierarchicalDetailedEvaluationCriteria,
} from "./detailedEvaluationHierarchy.js";
import { buildReopenedDetailedEvaluationReport } from "./DetailedEvaluationState.js";

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
    (report?.chiTietList || []).map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  container.querySelectorAll("[data-detailed-criterion-id]").forEach((element) => {
    const criterionId = element.getAttribute("data-detailed-criterion-id");
    const criterion = criteria.find((item) => String(item.id) === String(criterionId));
    if (!criterion) return;
    const previous = existing.get(String(criterionId)) || {};
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
      lyDoKhongDat: hasField("lyDoKhongDat")
        ? value("lyDoKhongDat")
        : previous.lyDoKhongDat || "",
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
    if (criteriaById.get(criterionId)?.isCustom !== true) return;
    const value = (field) => element.querySelector(
      `[data-detailed-config-field="${field}"]`,
    )?.value;
    const name = value("name");
    const stt = value("stt");
    const requirement = value("requirement");
    if (name === undefined && stt === undefined && requirement === undefined) return;
    updates.set(criterionId, {
      ...(name === undefined ? {} : { name: String(name).trim() }),
      ...(stt === undefined ? {} : { stt: String(stt).trim().replace(/\.$/, "") }),
      ...(requirement === undefined ? {} : { requirement: String(requirement).trim() }),
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

function assertCommands(commands) {
  const required = ["close", "render", "save", "importExcel", "addCriterion", "removeCriterion"];
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
  root.querySelectorAll("input, select, textarea").forEach((input) => {
    input.addEventListener("input", () => { appController._detailedEvaluationDirty = true; });
    input.addEventListener("change", () => { appController._detailedEvaluationDirty = true; });
  });
  root.querySelectorAll("[data-detailed-result-value]").forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      const row = input.closest("[data-detailed-criterion-id]");
      const field = input.getAttribute("data-detailed-field");
      row?.querySelectorAll(
        `[data-detailed-field="${field}"][data-detailed-result-value]`,
      ).forEach((candidate) => {
        if (candidate !== input) candidate.checked = false;
      });
      const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
        collectConfiguredDetailedEvaluationCriteria(root, state.criteria),
      );
      const configuredGroupCriteria = configuredCriteria.filter(
        (criterion) => criterion.group === appController.selectedDetailedEvaluationTab,
      );
      const currentRows = collectActiveGroupRows(root, state.report, configuredGroupCriteria);
      const updatedReport = applyHierarchicalDetailedEvaluationResults({
        ...state.report,
        chiTietList: currentRows,
      }, configuredCriteria);
      updateDerivedResultMarks(root, updatedReport, configuredGroupCriteria);
    });
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
    button.addEventListener("click", () => commands.removeCriterion(
      button.getAttribute("data-detailed-remove-criterion"),
    ));
  });
  excelButton?.addEventListener("click", () => excelInput?.click());
  excelInput?.addEventListener("change", async () => {
    const file = excelInput.files?.[0];
    if (!file) return;
    excelButton.disabled = true;
    try {
      await commands.importExcel(file);
    } finally {
      excelInput.value = "";
      excelButton.disabled = false;
    }
  });
  appController.view.createIconsScoped?.(root);
}
