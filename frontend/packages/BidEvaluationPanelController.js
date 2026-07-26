import { setVisible } from "../app/formStateUtils.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { addEvaluationLetterRow } from "./bidEvaluationRender.js";

const ONE_ENVELOPE = "Một giai đoạn một túi hồ sơ";
const PROCESS_FIELDS = new Set(["Hàng hóa", "Xây lắp", "Hỗn hợp", "Phi tư vấn"]);

function readMetadata(pkg) {
  if (!pkg?.danhGiaHsdtMetadata) return {};
  if (typeof pkg.danhGiaHsdtMetadata === "object") return { ...pkg.danhGiaHsdtMetadata };
  try {
    const parsed = JSON.parse(pkg.danhGiaHsdtMetadata);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMetadata(appController, pkg, metadata) {
  pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
  appController.model.persistData("goithau");
}

function setDisabled(control, disabled) {
  if (!control) return;
  if (disabled) control.setAttribute("disabled", "true");
  else control.removeAttribute("disabled");
}

function processTwoEligibility(appController, pkg) {
  const metadata = readMetadata(pkg);
  const bids = appController.model.state.thongtinmothau.filter(
    (bid) => String(bid.goiThauId) === String(pkg.id),
  );
  const reasons = [];
  if (pkg.phuongPhapDanhGia !== "Giá thấp nhất") {
    reasons.push('PP đánh giá không phải "Giá thấp nhất"');
  }
  if (metadata.coUuDai) reasons.push("Có nhà thầu được hưởng ưu đãi");
  const prices = bids
    .map((bid) => Number(bid.giaSauGiamGia || bid.giaDuThau || 0))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length >= 2) {
    const minimum = Math.min(...prices);
    if (prices.filter((price) => price === minimum).length >= 2) {
      reasons.push("Có từ 02 nhà thầu cùng xếp thứ nhất về giá");
    }
  }
  return { eligible: reasons.length === 0, metadata, reasons };
}

function bindProcessControls({ appController, pkg, panelState, onRerender }) {
  const container = appController.view.getActiveElement("danhgiahsdt-quytrinh-container");
  if (!container) return;
  const show = PROCESS_FIELDS.has(pkg.linhVuc) && pkg.phuongThucLuaChon === ONE_ENVELOPE;
  setRuntimeStyle(container, "display", show ? "flex" : "none");
  if (!show) return;

  const processOne = container.querySelector('input[value="quytrinh1"]');
  const processTwo = container.querySelector('input[value="quytrinh2"]');
  const preference = container.querySelector("#eval-co-uu-dai");
  const warning = container.querySelector("#quytrinh2-warning-msg");
  const updateEligibility = () => {
    if (!processOne || !processTwo) return;
    const result = processTwoEligibility(appController, pkg);
    if (!result.eligible) {
      setDisabled(processTwo, true);
      if (processTwo.checked) {
        processOne.checked = true;
        processTwo.checked = false;
        pkg.quyTrinhDanhGia = "quytrinh1";
        result.metadata.quyTrinhDanhGia = "quytrinh1";
        writeMetadata(appController, pkg, result.metadata);
        queueMicrotask(onRerender);
      }
      if (warning) {
        warning.textContent = `(Bắt buộc dùng Quy trình 1 do: ${result.reasons.join(", ")})`;
        setRuntimeStyle(warning, "display", "inline");
      }
      return;
    }
    if (!panelState.isReadOnly) setDisabled(processTwo, false);
    if (warning) setRuntimeStyle(warning, "display", "none");
  };

  const metadata = readMetadata(pkg);
  if (preference) {
    preference.checked = Boolean(metadata.coUuDai);
    setDisabled(preference, panelState.isReadOnly);
    preference.onchange = () => {
      const current = readMetadata(pkg);
      current.coUuDai = preference.checked;
      writeMetadata(appController, pkg, current);
      updateEligibility();
    };
  }
  if (!processOne || !processTwo) return;
  const currentProcess = pkg.quyTrinhDanhGia || "quytrinh1";
  processOne.checked = currentProcess === "quytrinh1";
  processTwo.checked = currentProcess === "quytrinh2";
  setDisabled(processOne, panelState.isReadOnly);
  setDisabled(processTwo, panelState.isReadOnly);
  const selectProcess = (value) => {
    pkg.quyTrinhDanhGia = value;
    const current = readMetadata(pkg);
    current.quyTrinhDanhGia = value;
    writeMetadata(appController, pkg, current);
    onRerender();
  };
  processOne.onchange = () => selectProcess("quytrinh1");
  processTwo.onchange = () => selectProcess("quytrinh2");
  updateEligibility();
}

function setTabAppearance(active, inactive) {
  active.className = "btn active";
  setRuntimeStyle(active, "background", "var(--bg-card)");
  setRuntimeStyle(active, "color", "var(--primary)");
  setRuntimeStyle(active, "border", "1px solid var(--border-color)");
  setRuntimeStyle(active, "borderBottom", "none");
  inactive.className = "btn";
  setRuntimeStyle(inactive, "background", "transparent");
  setRuntimeStyle(inactive, "color", "var(--text-muted)");
  setRuntimeStyle(inactive, "border", "1px solid transparent");
}

function bindEnvelopeTabs({ appController, pkg, panelState, onRerender }) {
  const header = appController.view.getActiveElement("danhgiahsdt-tabs-header");
  const technical = appController.view.getActiveElement("tab-btn-hsdxt-kt");
  const financial = appController.view.getActiveElement("tab-btn-hsdxt-tc");
  if (!panelState.isTwoEnvelope) {
    if (header) setRuntimeStyle(header, "display", "none");
    appController.currentDanhGiaTab = "unified";
    return;
  }
  if (header) {
    setRuntimeStyle(
      header,
      "display",
      appController.view.isGoiThauDetailTabActive() ? "none" : "flex",
    );
  }
  appController._lastSelectedGtId = pkg.id;
  if (!technical || !financial) return;
  setDisabled(financial, !panelState.isTechnicalSaved);
  setRuntimeStyle(financial, "opacity", panelState.isTechnicalSaved ? "1" : "0.6");
  setRuntimeStyle(financial, "cursor", panelState.isTechnicalSaved ? "pointer" : "not-allowed");
  if (panelState.currentTab === "technical") setTabAppearance(technical, financial);
  else setTabAppearance(financial, technical);
  technical.onclick = () => {
    if (appController.currentDanhGiaTab === "technical") return;
    appController.currentDanhGiaTab = "technical";
    onRerender();
  };
  financial.onclick = () => {
    if (!panelState.isTechnicalSaved || appController.currentDanhGiaTab === "financial") return;
    appController.currentDanhGiaTab = "financial";
    onRerender();
  };
}

function setDateField(model, input, value, readOnly) {
  if (!input) return;
  input.value = value ? model.formatForDateInput(value) : "";
  input.readOnly = readOnly;
}

function renderLetterRows({ appController, activeMeta, isReadOnly }) {
  const definitions = [
    ["list-cv-lamro", activeMeta.cvLamRo || []],
    ["list-cv-traloi", activeMeta.cvTraLoi || []],
    ["list-cv-guicdt", activeMeta.cvGuiCdt || []],
  ];
  definitions.forEach(([containerId, letters]) => {
    const container = appController.view.getActiveElement(containerId);
    if (!container) return;
    container.innerHTML = trustedHTML("");
    letters.forEach((letter) => addEvaluationLetterRow({
      view: appController.view,
      model: appController.model,
      containerId,
      letter,
      readOnly: isReadOnly,
    }));
  });
}

function bindReportForm({ appController, pkg, panelState }) {
  const { activeMeta, isReadOnly, isTabLocked, lotScope, stepKey } = panelState;
  const get = (id) => appController.view.getActiveElement(id);
  const reportNumber = get("danhgiahsdt-so-baocao");
  const reportDate = get("danhgiahsdt-ngay-baocao");
  const invitationDate = get("danhgiahsdt-ngay-moi-doichieu");
  const comparisonDate = get("danhgiahsdt-ngay-doichieu");
  if (reportNumber) {
    reportNumber.value = activeMeta.soBaoCao || "";
    reportNumber.readOnly = isReadOnly;
  }
  setDateField(appController.model, reportDate, activeMeta.ngayBaoCao, isReadOnly);
  setDateField(appController.model, invitationDate, activeMeta.ngayMoiDoiChieu, isReadOnly);
  setDateField(appController.model, comparisonDate, activeMeta.ngayDoiChieu, isReadOnly);
  setDisabled(invitationDate, isReadOnly);
  setDisabled(comparisonDate, isReadOnly);

  const directOrSpecial = pkg.hinhThucLuaChon === "Chỉ định thầu rút gọn"
    || pkg.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
  const showExtraFields = !directOrSpecial
    && (!panelState.isTwoEnvelope || panelState.currentTab === "financial");
  const fieldsRow = get("danhgiahsdt-fields-row");
  if (fieldsRow) {
    setRuntimeStyle(fieldsRow, "gridTemplateColumns", showExtraFields ? "repeat(4, 1fr)" : "repeat(2, 1fr)");
    fieldsRow.querySelectorAll(".evaluation-extra-field").forEach((field) => {
      setRuntimeStyle(field, "display", showExtraFields ? "block" : "none");
    });
  }

  const saveButton = get("btn-danhgiahsdt-save");
  if (saveButton) {
    if (isReadOnly && isTabLocked) {
      setVisible(saveButton, false);
    } else {
      setVisible(saveButton, true, "");
      saveButton.className = "btn btn-primary";
      if (isReadOnly) {
        saveButton.innerHTML = trustedHTML('<i data-lucide="edit"></i> Chỉnh sửa');
        saveButton.onclick = () => {
          appController.view._editingState = appController.view._editingState || {};
          appController.view._editingState[stepKey] = true;
          appController.renderDanhGiaHsdtPanel();
        };
      } else {
        saveButton.innerHTML = trustedHTML(lotScope
          ? '<i data-lucide="save"></i> Lưu báo cáo đánh giá đợt'
          : '<i data-lucide="save"></i> Lưu thông tin đánh giá');
        saveButton.onclick = () => appController.saveDanhGiaHsdt();
      }
    }
  }

  const addButtons = [
    ["btn-add-cv-lamro", "list-cv-lamro"],
    ["btn-add-cv-traloi", "list-cv-traloi"],
    ["btn-add-cv-guicdt", "list-cv-guicdt"],
  ];
  addButtons.forEach(([buttonId, containerId]) => {
    const button = get(buttonId);
    if (!button) return;
    setVisible(button, !isReadOnly, "block");
    button.onclick = () => addEvaluationLetterRow({
      view: appController.view,
      model: appController.model,
      containerId,
      letter: { soCv: "", ngayCv: "" },
      readOnly: false,
    });
  });
  setVisible(get("btn-danhgiahsdt-import-excel"), !isReadOnly, "inline-flex");
  setVisible(get("btn-danhgiahsdt-download-excel"), !isReadOnly, "inline-flex");
  renderLetterRows({ appController, activeMeta, isReadOnly });
}

export function bindBidEvaluationPanelController({
  appController,
  pkg,
  panelState,
  onRerender,
} = {}) {
  if (!appController?.view || !appController?.model || !pkg || !panelState) {
    throw new TypeError("Bid evaluation panel controller received an invalid context.");
  }
  if (typeof onRerender !== "function") {
    throw new TypeError("Bid evaluation panel controller requires a rerender callback.");
  }
  bindProcessControls({ appController, pkg, panelState, onRerender });
  bindEnvelopeTabs({ appController, pkg, panelState, onRerender });
  bindReportForm({ appController, pkg, panelState });
}
