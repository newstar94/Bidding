import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { executeAppCommand } from "../app/commandBus.js";
import { setJvData } from "./jvDataStore.js";
import { bindCurrencyElement, formatPartnerIdentityCode } from "../app/domUtils.js";
import { setVisible } from "../app/formStateUtils.js";
import { addEvaluationLetterRow, renderEvaluationSummary } from "./bidEvaluationRender.js";
import { getExactContractorVersion, resolveBidContractorName, resolveBidJointVentureMembers, resolveContractorVersion } from "../partners/contractorVersionBinding.js";
import { escapeHtml } from "../shared/view_helpers.js";
import {
  EVALUATION_LOT_SCOPE_MODE,
  filterBidsByEvaluationLotScope,
  findScopedEvaluationMetadata,
  getEvaluationLotScopeDetails,
  getPackageEvaluationLots,
  initializeEvaluationLotScope,
  isPartialEvaluationLotScope,
  updateEvaluationLotScope
} from "./lotEvaluationScope.js";

function evaluationScopeKey(packageId, tab) {
  return `${String(packageId || "")}:${String(tab || "technical")}`;
}

function getEvaluationScopeStore(controller) {
  if (!controller._evaluationLotScopes) controller._evaluationLotScopes = {};
  return controller._evaluationLotScopes;
}

function renderEvaluationLotScopeControls(controller, pkg, scope, {
  isLocked = false,
  onChange = () => {}
} = {}) {
  const container = controller.view.getActiveElement("danhgiahsdt-scope-container");
  const options = controller.view.getActiveElement("danhgiahsdt-lot-options");
  const feedback = controller.view.getActiveElement("danhgiahsdt-scope-feedback");
  const badge = controller.view.getActiveElement("danhgiahsdt-scope-badge");
  const title = controller.view.getActiveElement("danhgiahsdt-table-title");
  const lots = getPackageEvaluationLots(pkg);
  if (!container || lots.length === 0 || !scope) {
    if (container) {
      container.classList.add("is-hidden");
      setRuntimeStyle(container, "display", "none");
    }
    return;
  }

  container.classList.remove("is-hidden");
  setRuntimeStyle(container, "display", "block");
  const allRadio = container.querySelector('input[name="danhgiahsdt-scope-mode"][value="all"]');
  const selectedRadio = container.querySelector('input[name="danhgiahsdt-scope-mode"][value="selected"]');
  if (allRadio) {
    allRadio.checked = scope.mode !== EVALUATION_LOT_SCOPE_MODE.SELECTED;
    allRadio.disabled = isLocked;
  }
  if (selectedRadio) {
    selectedRadio.checked = scope.mode === EVALUATION_LOT_SCOPE_MODE.SELECTED;
    selectedRadio.disabled = isLocked;
  }

  const selectedSet = new Set(scope.selectedLotIds || []);
  if (options) {
    options.innerHTML = trustedHTML(lots.map((lot) => {
      const disabled = scope.mode !== EVALUATION_LOT_SCOPE_MODE.SELECTED || isLocked;
      return `
        <label class="evaluation-lot-option ${disabled ? "is-disabled" : ""}">
          <input type="checkbox" data-evaluation-lot-id="${escapeHtml(lot.id)}"
            ${selectedSet.has(lot.id) ? "checked" : ""} ${disabled ? "disabled" : ""}>
          <span><strong>${escapeHtml(lot.code)}</strong><small title="${escapeHtml(lot.name)}">${escapeHtml(lot.name || "Chưa có tên phần lô")}</small></span>
        </label>`;
    }).join(""));
  }

  const details = getEvaluationLotScopeDetails(pkg, scope);
  const isPartialScope = isPartialEvaluationLotScope(details);
  const selectedLabel = details?.lotCodes?.join(", ") || "chưa chọn phần lô";
  if (badge) badge.textContent = scope.batchId ? `Đợt ${selectedLabel}` : `Phạm vi: ${selectedLabel}`;
  if (feedback) {
    const hasSelection = Boolean(details?.lotIds?.length);
    feedback.textContent = hasSelection
      ? `${details.lotIds.length}/${lots.length} phần lô sẽ được đưa vào báo cáo và bảng đánh giá của đợt này.${isPartialScope ? " Nhập/xuất Excel sẽ được mở sau khi có tệp phạm vi theo đợt." : ""}`
      : "Vui lòng chọn ít nhất một phần lô trước khi lưu đánh giá.";
    feedback.classList.toggle("is-error", !hasSelection);
  }
  if (title) {
    title.textContent = `Đánh giá chi tiết các HSDT nộp — ${selectedLabel}`;
  }
  [
    controller.view.getActiveElement("btn-danhgiahsdt-download-excel"),
    controller.view.getActiveElement("btn-danhgiahsdt-import-excel")
  ].filter(Boolean).forEach((button) => {
    button.disabled = isPartialScope;
    button.setAttribute("aria-disabled", isPartialScope ? "true" : "false");
    button.title = isPartialScope
      ? "Chưa hỗ trợ Excel cho phạm vi một phần lô vì tệp hiện tại không có dấu phạm vi đợt."
      : "";
  });

  const applyMode = (mode) => {
    const next = updateEvaluationLotScope(scope, lots, { mode });
    onChange(next);
  };
  if (allRadio) allRadio.onchange = () => applyMode(EVALUATION_LOT_SCOPE_MODE.ALL);
  if (selectedRadio) selectedRadio.onchange = () => applyMode(EVALUATION_LOT_SCOPE_MODE.SELECTED);
  options?.querySelectorAll("[data-evaluation-lot-id]").forEach((checkbox) => {
    checkbox.onchange = () => {
      const selectedLotIds = Array.from(options.querySelectorAll("[data-evaluation-lot-id]:checked"))
        .map((item) => item.getAttribute("data-evaluation-lot-id"));
      onChange(updateEvaluationLotScope(scope, lots, {
        mode: EVALUATION_LOT_SCOPE_MODE.SELECTED,
        selectedLotIds
      }));
    };
  });
}

export function renderDanhGiaHsdtPanel() {
  const select = this.view.getActiveElement("danhgiahsdt-goithau-select");
  if (!select) return;
  const selectedVal = select.value;
  const targetPackages = this.model.state.goithau.filter((g) => {
    if (g.id === selectedVal) return true;
    return g.trangThai === "Đang chấm thầu" || g.trangThai === "Đã có kết quả";
  });
  select.innerHTML = trustedHTML('<option value="">-- Chọn Gói thầu (Đang chấm thầu / Đã có kết quả) --</option>' + targetPackages.map((g) => `<option value="${escapeHtml(g.id)}" data-search="${escapeHtml(`${g.maGoiThau || ""} ${g.tenGoiThau || ""}`)}">${escapeHtml(g.tenGoiThau)} (${escapeHtml(g.maGoiThau || "Chưa có mã")})</option>`).join(""));
  if (selectedVal && targetPackages.some((g) => g.id === selectedVal)) {
    select.value = selectedVal;
  } else {
    select.value = "";
  }
  this.makeSearchableSelect(select, "Tìm kiếm Gói thầu...");
  const summaryContainer = this.view.getActiveElement("danhgiahsdt-goithau-summary");
  const evaluationContainer = this.view.getActiveElement("danhgiahsdt-container");
  const emptyState = this.view.getActiveElement("danhgiahsdt-empty-state");
  const thead = this.view.getActiveElement("danhgiahsdt-table-thead");
  const tbody = this.view.getActiveElement("danhgiahsdt-table-tbody");
  const addLetterRow = (containerId, letter = { soCv: "", ngayCv: "" }, readOnly = false) => {
    addEvaluationLetterRow({ view: this.view, model: this.model, containerId, letter, readOnly });
  };
  const handlePackageSelection = () => {
    const gtId = select.value;
    if (!gtId) {
      setRuntimeStyle(summaryContainer, "display", "none");
      setRuntimeStyle(evaluationContainer, "display", "none");
      setRuntimeStyle(emptyState, "display", "block");
      return;
    }
    const gt = this.model.state.goithau.find((g) => g.id === gtId);
    if (!gt) return;
    const kh = this.model.getLatestPlan(gt.keHoachId);
    const cdt = kh ? this.model.state.chudautu.find((c) => c.id === kh.chuDauTuId) : null;
    const tenCdt = cdt ? cdt.tenChuDauTu : "Không rõ";
    const tenKhStr = kh ? kh.tenKeHoach : "Không rõ";
    const is1G2T = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
    if (is1G2T) {
      if (this.currentDanhGiaTab !== "technical" && this.currentDanhGiaTab !== "financial") {
        this.currentDanhGiaTab = "technical";
      }
    } else {
      this.currentDanhGiaTab = "unified";
    }
    let metadata = { soBaoCao: "", ngayBaoCao: "", cvLamRo: [], cvTraLoi: [], cvGuiCdt: [] };
    if (gt.danhGiaHsdtMetadata) {
      try {
        metadata = JSON.parse(gt.danhGiaHsdtMetadata);
      } catch (e) {
        console.error("Error parsing evaluation metadata:", e);
      }
    }
    if (is1G2T && !metadata.is1G2T) {
      const oldMeta = { ...metadata };
      metadata = {
        is1G2T: true,
        technical: oldMeta.soBaoCao ? oldMeta : { soBaoCao: "", ngayBaoCao: "", cvLamRo: [], cvTraLoi: [], cvGuiCdt: [], saved: false },
        financial: { soBaoCao: "", ngayBaoCao: "", cvLamRo: [], cvTraLoi: [], cvGuiCdt: [], saved: false }
      };
    }
    const isTechEvalSaved = Boolean(is1G2T && metadata.technical?.saved);
    const isQualifiedSaved = Boolean(is1G2T && metadata.technical?.qualifiedSaved);
    if (is1G2T && this.currentDanhGiaTab === "financial" && !isTechEvalSaved) {
      this.currentDanhGiaTab = "technical";
    }
    const baseEvaluationMeta = is1G2T
      ? (this.currentDanhGiaTab === "financial" ? metadata.financial || {} : metadata.technical || {})
      : metadata;
    const scopeStore = getEvaluationScopeStore(this);
    const scopeKey = evaluationScopeKey(gtId, this.currentDanhGiaTab);
    const lotScope = initializeEvaluationLotScope(gt, baseEvaluationMeta, scopeStore[scopeKey]);
    if (lotScope) scopeStore[scopeKey] = lotScope;
    const matchingScopeMeta = lotScope
      ? findScopedEvaluationMetadata(baseEvaluationMeta, lotScope.selectedLotIds)
      : null;
    const hasScopedHistory = Boolean(baseEvaluationMeta?.lotBatches && Object.keys(baseEvaluationMeta.lotBatches).length);
    const currentEvaluationMeta = matchingScopeMeta || (!hasScopedHistory ? baseEvaluationMeta : {});
    const isCompleted = Boolean(currentEvaluationMeta.saved);
    const stepKey = this.currentDanhGiaTab === "financial" ? "eval_fin" : "eval_tech";
    const isEditingThisStep = this.view._editingState && this.view._editingState[stepKey];
    const isLocked = gt.trangThai === "Đã có kết quả" || gt.trangThai === "Hủy thầu";
    const isTabLocked = isLocked || is1G2T && this.currentDanhGiaTab === "technical" && isQualifiedSaved;
    const isReadOnly = isTabLocked || isCompleted && !isEditingThisStep;
    const isEditable = !isReadOnly;
    renderEvaluationSummary({
      container: summaryContainer,
      gt,
      tenCdt,
      tenKhStr,
      model: this.model,
      is1G2T,
      isReadOnly,
      currentTab: this.currentDanhGiaTab
    });
    setRuntimeStyle(emptyState, "display", "none");
    setRuntimeStyle(evaluationContainer, "display", "block");
    const quyTrinhContainer = this.view.getActiveElement("danhgiahsdt-quytrinh-container");
    const isGoodsOrNonConsulting = gt.linhVuc === "Hàng hóa" || gt.linhVuc === "Phi tư vấn";
    const is1G1T = gt.phuongThucLuaChon === "Một giai đoạn một túi hồ sơ";
    const showQuyTrinh = isGoodsOrNonConsulting && is1G1T;
    if (quyTrinhContainer) {
      if (showQuyTrinh) {
        setRuntimeStyle(quyTrinhContainer, "display", "flex");
        const currentQuyTrinh = gt.quyTrinhDanhGia || "quytrinh1";
        const radio1 = quyTrinhContainer.querySelector('input[value="quytrinh1"]');
        const radio2 = quyTrinhContainer.querySelector('input[value="quytrinh2"]');
        const checkboxUuDai = quyTrinhContainer.querySelector("#eval-co-uu-dai");
        const warningMsg = quyTrinhContainer.querySelector("#quytrinh2-warning-msg");
        let meta = {};
        try {
          meta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
        } catch (e) {
        }
        const updateQuyTrinh2Eligibility = () => {
          if (!radio1 || !radio2) return;
          let currentMeta = {};
          try {
            currentMeta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
          } catch (e) {
          }
          const bids2 = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gt.id));
          let eligible = true;
          let reasons = [];
          if (gt.phuongPhapDanhGia !== "Giá thấp nhất") {
            eligible = false;
            reasons.push('PP đánh giá không phải "Giá thấp nhất"');
          }
          if (currentMeta.coUuDai) {
            eligible = false;
            reasons.push("Có nhà thầu được hưởng ưu đãi");
          }
          const prices = bids2.map((b) => b.giaSauGiamGia || b.giaDuThau || 0).filter((p) => p > 0);
          if (prices.length >= 2) {
            const minPrice = Math.min(...prices);
            const countMin = prices.filter((p) => p === minPrice).length;
            if (countMin >= 2) {
              eligible = false;
              reasons.push("Có từ 02 nhà thầu cùng xếp thứ nhất về giá");
            }
          }
          if (!eligible) {
            radio2.disabled = true;
            if (radio2.checked) {
              radio1.checked = true;
              gt.quyTrinhDanhGia = "quytrinh1";
              currentMeta.quyTrinhDanhGia = "quytrinh1";
              gt.danhGiaHsdtMetadata = JSON.stringify(currentMeta);
              this.model.persistData("goithau");
              setTimeout(() => handlePackageSelection(), 100);
            }
            if (warningMsg) {
              warningMsg.textContent = `(Bắt buộc dùng Quy trình 1 do: ${reasons.join(", ")})`;
              setRuntimeStyle(warningMsg, "display", "inline");
            }
          } else {
            if (!isReadOnly) {
              radio2.removeAttribute("disabled");
            }
            if (warningMsg) {
              setRuntimeStyle(warningMsg, "display", "none");
            }
          }
        };
        if (checkboxUuDai) {
          checkboxUuDai.checked = !!meta.coUuDai;
          if (isReadOnly) {
            checkboxUuDai.disabled = true;
          } else {
            checkboxUuDai.removeAttribute("disabled");
          }
          checkboxUuDai.onchange = () => {
            let currentMeta = {};
            try {
              currentMeta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
            } catch (e) {
            }
            currentMeta.coUuDai = checkboxUuDai.checked;
            gt.danhGiaHsdtMetadata = JSON.stringify(currentMeta);
            this.model.persistData("goithau");
            updateQuyTrinh2Eligibility();
          };
        }
        if (radio1 && radio2) {
          radio1.checked = currentQuyTrinh === "quytrinh1";
          radio2.checked = currentQuyTrinh === "quytrinh2";
          if (isReadOnly) {
            radio1.disabled = true;
            radio2.disabled = true;
          } else {
            radio1.removeAttribute("disabled");
            radio2.removeAttribute("disabled");
          }
          radio1.onchange = () => {
            gt.quyTrinhDanhGia = "quytrinh1";
            let currentMeta = {};
            try {
              currentMeta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
            } catch (e) {
            }
            currentMeta.quyTrinhDanhGia = "quytrinh1";
            gt.danhGiaHsdtMetadata = JSON.stringify(currentMeta);
            this.model.persistData("goithau");
            handlePackageSelection();
          };
          radio2.onchange = () => {
            gt.quyTrinhDanhGia = "quytrinh2";
            let currentMeta = {};
            try {
              currentMeta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
            } catch (e) {
            }
            currentMeta.quyTrinhDanhGia = "quytrinh2";
            gt.danhGiaHsdtMetadata = JSON.stringify(currentMeta);
            this.model.persistData("goithau");
            handlePackageSelection();
          };
          updateQuyTrinh2Eligibility();
        }
      } else {
        setRuntimeStyle(quyTrinhContainer, "display", "none");
      }
    }
    const tabsHeader = this.view.getActiveElement("danhgiahsdt-tabs-header");
    const tabBtnKt = this.view.getActiveElement("tab-btn-hsdxt-kt");
    const tabBtnTc = this.view.getActiveElement("tab-btn-hsdxt-tc");
    if (metadata && metadata.quyTrinhDanhGia) gt.quyTrinhDanhGia = metadata.quyTrinhDanhGia;
    if (is1G2T) {
      const isWorkflowView = this.view.isGoiThauDetailTabActive();
      if (tabsHeader) {
        setRuntimeStyle(tabsHeader, "display", isWorkflowView ? "none" : "flex");
      }
      this._lastSelectedGtId = gtId;
      const isKtSaved = !!(metadata.technical && metadata.technical.saved);
      if (tabBtnKt && tabBtnTc) {
        if (isKtSaved) {
          tabBtnTc.removeAttribute("disabled");
          setRuntimeStyle(tabBtnTc, "opacity", "1");
          setRuntimeStyle(tabBtnTc, "cursor", "pointer");
        } else {
          tabBtnTc.setAttribute("disabled", "true");
          setRuntimeStyle(tabBtnTc, "opacity", "0.6");
          setRuntimeStyle(tabBtnTc, "cursor", "not-allowed");
          this.currentDanhGiaTab = "technical";
        }
        if (this.currentDanhGiaTab === "technical") {
          tabBtnKt.className = "btn active";
          setRuntimeStyle(tabBtnKt, "background", "var(--bg-card)");
          setRuntimeStyle(tabBtnKt, "color", "var(--primary)");
          setRuntimeStyle(tabBtnKt, "border", "1px solid var(--border-color)");
          setRuntimeStyle(tabBtnKt, "borderBottom", "none");
          tabBtnTc.className = "btn";
          setRuntimeStyle(tabBtnTc, "background", "transparent");
          setRuntimeStyle(tabBtnTc, "color", "var(--text-muted)");
          setRuntimeStyle(tabBtnTc, "border", "1px solid transparent");
        } else {
          tabBtnTc.className = "btn active";
          setRuntimeStyle(tabBtnTc, "background", "var(--bg-card)");
          setRuntimeStyle(tabBtnTc, "color", "var(--primary)");
          setRuntimeStyle(tabBtnTc, "border", "1px solid var(--border-color)");
          setRuntimeStyle(tabBtnTc, "borderBottom", "none");
          tabBtnKt.className = "btn";
          setRuntimeStyle(tabBtnKt, "background", "transparent");
          setRuntimeStyle(tabBtnKt, "color", "var(--text-muted)");
          setRuntimeStyle(tabBtnKt, "border", "1px solid transparent");
        }
        tabBtnKt.onclick = () => {
          if (this.currentDanhGiaTab !== "technical") {
            this.currentDanhGiaTab = "technical";
            handlePackageSelection();
          }
        };
        tabBtnTc.onclick = () => {
          if (isKtSaved && this.currentDanhGiaTab !== "financial") {
            this.currentDanhGiaTab = "financial";
            handlePackageSelection();
          }
        };
      }
    } else {
      if (tabsHeader) setRuntimeStyle(tabsHeader, "display", "none");
      this.currentDanhGiaTab = "unified";
    }
    const activeBaseMeta = is1G2T
      ? (this.currentDanhGiaTab === "technical" ? metadata.technical || {} : metadata.financial || {})
      : metadata;
    const activeScopedMeta = lotScope
      ? findScopedEvaluationMetadata(activeBaseMeta, lotScope.selectedLotIds)
      : null;
    const isPartialLotScope = isPartialEvaluationLotScope(getEvaluationLotScopeDetails(gt, lotScope));
    const activeHasScopedHistory = Boolean(activeBaseMeta?.lotBatches && Object.keys(activeBaseMeta.lotBatches).length);
    const activeMeta = activeScopedMeta || (!activeHasScopedHistory ? activeBaseMeta : {});
    renderEvaluationLotScopeControls(this, gt, lotScope, {
      isLocked,
      onChange: (nextScope) => {
        scopeStore[evaluationScopeKey(gtId, this.currentDanhGiaTab)] = nextScope;
        handlePackageSelection();
      }
    });
    const soBaocaoInput = this.view.getActiveElement("danhgiahsdt-so-baocao");
    const ngayBaocaoInput = this.view.getActiveElement("danhgiahsdt-ngay-baocao");
    const ngayMoiDoichieuInput = this.view.getActiveElement("danhgiahsdt-ngay-moi-doichieu");
    const ngayDoichieuInput = this.view.getActiveElement("danhgiahsdt-ngay-doichieu");
    const fieldsRow = this.view.getActiveElement("danhgiahsdt-fields-row");
    const saveBtn = this.view.getActiveElement("btn-danhgiahsdt-save");
    const addCvLamroBtn = this.view.getActiveElement("btn-add-cv-lamro");
    const addCvTraloiBtn = this.view.getActiveElement("btn-add-cv-traloi");
    const addCvGuicdtBtn = this.view.getActiveElement("btn-add-cv-guicdt");
    if (soBaocaoInput) {
      soBaocaoInput.value = activeMeta.soBaoCao || "";
      soBaocaoInput.readOnly = isReadOnly;
    }
    if (ngayBaocaoInput) {
      ngayBaocaoInput.value = activeMeta.ngayBaoCao ? this.model.formatForDateInput(activeMeta.ngayBaoCao) : "";
      ngayBaocaoInput.readOnly = isReadOnly;
    }
    const isDirectOrSpecial = gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
    const showExtraFields = !isDirectOrSpecial && (!is1G2T || this.currentDanhGiaTab === "financial");
    if (fieldsRow) {
      setRuntimeStyle(fieldsRow, "gridTemplateColumns", showExtraFields ? "repeat(4, 1fr)" : "repeat(2, 1fr)");
      fieldsRow.querySelectorAll(".evaluation-extra-field").forEach((el) => {
        setRuntimeStyle(el, "display", showExtraFields ? "block" : "none");
      });
    }
    if (ngayMoiDoichieuInput) {
      ngayMoiDoichieuInput.value = activeMeta.ngayMoiDoiChieu ? this.model.formatForDateInput(activeMeta.ngayMoiDoiChieu) : "";
      ngayMoiDoichieuInput.readOnly = isReadOnly;
      if (isReadOnly) {
        ngayMoiDoichieuInput.setAttribute("disabled", "true");
      } else {
        ngayMoiDoichieuInput.removeAttribute("disabled");
      }
    }
    if (ngayDoichieuInput) {
      ngayDoichieuInput.value = activeMeta.ngayDoiChieu ? this.model.formatForDateInput(activeMeta.ngayDoiChieu) : "";
      ngayDoichieuInput.readOnly = isReadOnly;
      if (isReadOnly) {
        ngayDoichieuInput.setAttribute("disabled", "true");
      } else {
        ngayDoichieuInput.removeAttribute("disabled");
      }
    }
    if (saveBtn) {
      if (isReadOnly) {
        if (isTabLocked) {
          setVisible(saveBtn, false);
        } else {
          setVisible(saveBtn, true, "");
          saveBtn.innerHTML = trustedHTML('<i data-lucide="edit"></i> Chỉnh sửa');
          saveBtn.className = "btn btn-primary";
          saveBtn.onclick = () => {
            this.view._editingState = this.view._editingState || {};
            this.view._editingState[stepKey] = true;
            this.renderDanhGiaHsdtPanel();
          };
        }
      } else {
        setVisible(saveBtn, true, "");
        saveBtn.innerHTML = trustedHTML(isPartialLotScope
          ? '<i data-lucide="save"></i> Lưu nháp đợt phần lô'
          : '<i data-lucide="save"></i> Lưu thông tin đánh giá');
        saveBtn.className = "btn btn-primary";
        saveBtn.onclick = () => this.saveDanhGiaHsdt();
      }
    }
    if (addCvLamroBtn) {
      setVisible(addCvLamroBtn, !isReadOnly, "block");
      addCvLamroBtn.onclick = () => addLetterRow("list-cv-lamro", { soCv: "", ngayCv: "" }, false);
    }
    if (addCvTraloiBtn) {
      setVisible(addCvTraloiBtn, !isReadOnly, "block");
      addCvTraloiBtn.onclick = () => addLetterRow("list-cv-traloi", { soCv: "", ngayCv: "" }, false);
    }
    if (addCvGuicdtBtn) {
      setVisible(addCvGuicdtBtn, !isReadOnly, "block");
      addCvGuicdtBtn.onclick = () => addLetterRow("list-cv-guicdt", { soCv: "", ngayCv: "" }, false);
    }
    const importExcelBtn = this.view.getActiveElement("btn-danhgiahsdt-import-excel");
    setVisible(importExcelBtn, !isReadOnly, "inline-flex");
    const downloadExcelBtn = this.view.getActiveElement("btn-danhgiahsdt-download-excel");
    setVisible(downloadExcelBtn, !isReadOnly, "inline-flex");
    const listCvLamro = this.view.getActiveElement("list-cv-lamro");
    const listCvTraloi = this.view.getActiveElement("list-cv-traloi");
    const listCvGuicdt = this.view.getActiveElement("list-cv-guicdt");
    if (listCvLamro) {
      listCvLamro.innerHTML = trustedHTML("");
      (activeMeta.cvLamRo || []).forEach((item) => addLetterRow("list-cv-lamro", item, isReadOnly));
    }
    if (listCvTraloi) {
      listCvTraloi.innerHTML = trustedHTML("");
      (activeMeta.cvTraLoi || []).forEach((item) => addLetterRow("list-cv-traloi", item, isReadOnly));
    }
    if (listCvGuicdt) {
      listCvGuicdt.innerHTML = trustedHTML("");
      (activeMeta.cvGuiCdt || []).forEach((item) => addLetterRow("list-cv-guicdt", item, isReadOnly));
    }
    const isTuVan = gt.linhVuc === "Tư vấn";
    const hasPhanLo = gt.phanLo === "Có";
    let caseType = "1G1T_NO_LOT";
    if (is1G2T) {
      if (this.currentDanhGiaTab === "technical") {
        caseType = isTuVan ? "TU_VAN" : hasPhanLo ? "1G2T_WITH_LOT" : "1G2T_NO_LOT";
      } else {
        caseType = hasPhanLo ? "1G2T_TC_WITH_LOT" : "1G2T_TC_NO_LOT";
      }
    } else if (isTuVan) {
      caseType = "TU_VAN";
    } else if (is1G1T) {
      caseType = hasPhanLo ? "1G1T_WITH_LOT" : "1G1T_NO_LOT";
    }
    const tableTitle = this.view.getActiveElement("danhgiahsdt-table-title");
    if (tableTitle) {
      const lotLabel = getEvaluationLotScopeDetails(gt, lotScope)?.lotCodes?.join(", ");
      let baseTitle = "Đánh giá chi tiết các HSDT nộp";
      if (is1G2T || isTuVan) {
        if (this.currentDanhGiaTab === "technical") {
          baseTitle = "Đánh giá chi tiết các E-HSĐXKT đã nộp";
        } else {
          baseTitle = "Đánh giá chi tiết các E-HSĐXTC đã nộp";
        }
      }
      tableTitle.textContent = lotLabel ? `${baseTitle} — ${lotLabel}` : baseTitle;
    }
    const isCombinedMethod = gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá";
    const showCombinedScore = isCombinedMethod && !(is1G2T && this.currentDanhGiaTab === "technical");
    let theadHtml = "";
    if (caseType === "TU_VAN") {
      theadHtml = `
                <tr>
                    <th class="bf-s-8523765ec6">Loại nhà thầu</th>
                    <th class="bf-s-ae54075f01">Mã nhà thầu</th>
                    <th class="bf-s-c83ebbe56b">Tên nhà thầu</th>
                    <th class="bf-s-ae54075f01">Hiệu lực E-HSĐXKT</th>
                    <th class="bf-s-ae54075f01">Thời gian thực hiện</th>
                    <th class="bf-s-8523765ec6">Đánh giá hợp lệ</th>
                    <th class="bf-s-8523765ec6">Làm rõ tính hợp lệ</th>
                    <th class="bf-s-8523765ec6">Đánh giá năng lực</th>
                    <th class="bf-s-8523765ec6">Làm rõ năng lực kinh nghiệm</th>
                    <th class="bf-s-8523765ec6">Đánh giá kỹ thuật</th>
                    <th class="bf-s-8523765ec6">Làm rõ kỹ thuật</th>
                    ${showCombinedScore ? '<th class="bf-s-415b5d64b8">Điểm tổng hợp</th>' : ""}
                    <th class="bf-s-8523765ec6">Kết luận</th>
                </tr>
            `;
    } else if (caseType === "1G2T_NO_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-8523765ec6">Loại nhà thầu</th>
                    <th class="bf-s-8523765ec6">Mã nhà thầu</th>
                    <th class="bf-s-2811ee8f01">Tên nhà thầu</th>
                    <th class="bf-s-8523765ec6">Đảm bảo dự thầu</th>
                    <th class="bf-s-8523765ec6">Hiệu lực đảm bảo</th>
                    <th class="bf-s-8523765ec6">Hiệu lực E-HSĐXKT</th>
                    <th class="bf-s-8523765ec6">Đánh giá hợp lệ</th>
                    <th class="bf-s-8523765ec6">Làm rõ tính hợp lệ</th>
                    <th class="bf-s-8523765ec6">Đánh giá năng lực</th>
                    <th class="bf-s-8523765ec6">Làm rõ năng lực kinh nghiệm</th>
                    <th class="bf-s-8523765ec6">Đánh giá kỹ thuật</th>
                    <th class="bf-s-8523765ec6">Làm rõ kỹ thuật</th>
                    <th class="bf-s-8523765ec6">Kết luận</th>
                </tr>
            `;
    } else if (caseType === "1G2T_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-aed34ad439">Mã phần lô</th>
                    <th class="bf-s-aed34ad439">Tên phần lô</th>
                    <th class="bf-s-415b5d64b8">Loại nhà thầu</th>
                    <th class="bf-s-415b5d64b8">Mã nhà thầu</th>
                    <th class="bf-s-ae54075f01">Tên nhà thầu</th>
                    <th class="bf-s-b258c3e162">Đảm bảo dự thầu</th>
                    <th class="bf-s-b258c3e162">Hiệu lực đảm bảo</th>
                    <th class="bf-s-b258c3e162">Hiệu lực E-HSĐXKT</th>
                    <th class="bf-s-b258c3e162">Đánh giá hợp lệ</th>
                    <th class="bf-s-b258c3e162">Làm rõ hợp lệ</th>
                    <th class="bf-s-b258c3e162">Đánh giá năng lực</th>
                    <th class="bf-s-b258c3e162">Làm rõ năng lực</th>
                    <th class="bf-s-b258c3e162">Đánh giá kỹ thuật</th>
                    <th class="bf-s-b258c3e162">Làm rõ kỹ thuật</th>
                    <th class="bf-s-8523765ec6">Kết luận</th>
                </tr>
            `;
    } else if (caseType === "1G2T_TC_NO_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-8523765ec6">Loại nhà thầu</th>
                    <th class="bf-s-8523765ec6">Mã nhà thầu</th>
                    <th class="bf-s-2811ee8f01">Tên nhà thầu</th>
                    <th class="bf-s-ae54075f01">Giá dự thầu</th>
                    <th class="bf-s-415b5d64b8">Tỷ lệ %</th>
                    <th class="bf-s-ae54075f01">Giá sau giảm</th>
                    ${isTuVan ? '<th class="bf-s-ae54075f01">Hiệu lực E-HSĐXTC</th>' : ""}
                    <th class="bf-s-8523765ec6">Làm rõ tài chính</th>
                    ${showCombinedScore ? `
                        <th class="bf-s-415b5d64b8">Đánh giá KT</th>
                        <th class="bf-s-415b5d64b8">Điểm tổng hợp</th>
                    ` : ""}
                    <th class="bf-s-415b5d64b8">Xếp hạng</th>
                </tr>
            `;
    } else if (caseType === "1G2T_TC_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-415b5d64b8">Mã phần lô</th>
                    <th class="bf-s-415b5d64b8">Tên phần lô</th>
                    <th class="bf-s-415b5d64b8">Loại nhà thầu</th>
                    <th class="bf-s-415b5d64b8">Mã nhà thầu</th>
                    <th class="bf-s-ae54075f01">Tên nhà thầu</th>
                    <th class="bf-s-3faf34a5d2">Giá dự thầu</th>
                    <th class="bf-s-aed34ad439">Tỷ lệ %</th>
                    <th class="bf-s-3faf34a5d2">Giá sau giảm</th>
                    ${isTuVan ? '<th class="bf-s-8523765ec6">Hiệu lực E-HSĐXTC</th>' : ""}
                    <th class="bf-s-8523765ec6">Làm rõ tài chính</th>
                    ${showCombinedScore ? `
                        <th class="bf-s-415b5d64b8">Đánh giá KT</th>
                        <th class="bf-s-415b5d64b8">Điểm tổng hợp</th>
                    ` : ""}
                    <th class="bf-s-415b5d64b8">Xếp hạng</th>
                </tr>
            `;
    } else if (caseType === "1G1T_NO_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-aed34ad439">Loại nhà thầu</th>
                    <th class="bf-s-aed34ad439">Mã nhà thầu</th>
                    <th class="bf-s-ae54075f01">Tên nhà thầu</th>
                    <th class="bf-s-8523765ec6">Giá dự thầu</th>
                    <th class="bf-s-6a7768ee0d">Tỷ lệ %</th>
                    <th class="bf-s-8523765ec6">Giá sau giảm</th>
                    <th class="bf-s-415b5d64b8">Hiệu lực E-HSDT</th>
                    <th class="bf-s-415b5d64b8">Giá trị ĐB</th>
                    <th class="bf-s-415b5d64b8">Hiệu lực ĐB</th>
                    <th class="bf-s-415b5d64b8">Thời gian TH</th>
                    <th class="bf-s-415b5d64b8">Đánh giá hợp lệ</th>
                    <th class="bf-s-415b5d64b8">Làm rõ hợp lệ</th>
                    <th class="bf-s-415b5d64b8">Đánh giá năng lực</th>
                    <th class="bf-s-415b5d64b8">Làm rõ năng lực</th>
                    <th class="bf-s-415b5d64b8">Đánh giá kỹ thuật</th>
                    <th class="bf-s-415b5d64b8">Làm rõ kỹ thuật</th>
                    <th class="bf-s-415b5d64b8">Làm rõ tài chính</th>
                    ${isCombinedMethod ? '<th class="bf-s-415b5d64b8">Điểm tổng hợp</th>' : ""}
                    <th class="bf-s-8523765ec6">Kết luận</th>
                    <th class="bf-s-415b5d64b8">Xếp hạng</th>
                </tr>
            `;
    } else if (caseType === "1G1T_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-aed34ad439">Mã phần lô</th>
                    <th class="bf-s-aed34ad439">Tên phần lô</th>
                    <th class="bf-s-6a7768ee0d">Loại nhà thầu</th>
                    <th class="bf-s-415b5d64b8">Mã nhà thầu</th>
                    <th class="bf-s-8523765ec6">Tên nhà thầu</th>
                    <th class="bf-s-b258c3e162">Giá dự thầu</th>
                    <th class="bf-s-6a7768ee0d">Tỷ lệ %</th>
                    <th class="bf-s-b258c3e162">Giá sau giảm</th>
                    <th class="bf-s-aed34ad439">Hiệu lực E-HSDT</th>
                    <th class="bf-s-aed34ad439">Giá trị ĐB</th>
                    <th class="bf-s-aed34ad439">Hiệu lực ĐB</th>
                    <th class="bf-s-aed34ad439">Thời gian TH</th>
                    <th class="bf-s-aed34ad439">Đánh giá hợp lệ</th>
                    <th class="bf-s-aed34ad439">Làm rõ hợp lệ</th>
                    <th class="bf-s-aed34ad439">Đánh giá năng lực</th>
                    <th class="bf-s-aed34ad439">Làm rõ năng lực</th>
                    <th class="bf-s-aed34ad439">Đánh giá kỹ thuật</th>
                    <th class="bf-s-aed34ad439">Làm rõ kỹ thuật</th>
                    <th class="bf-s-aed34ad439">Làm rõ tài chính</th>
                    ${isCombinedMethod ? '<th class="bf-s-415b5d64b8">Điểm tổng hợp</th>' : ""}
                    <th class="bf-s-8523765ec6">Kết luận</th>
                    <th class="bf-s-415b5d64b8">Xếp hạng</th>
                </tr>
            `;
    }
    thead.innerHTML = trustedHTML(theadHtml);
    const updateAllRankings = () => {
      const rows = tbody.querySelectorAll("tr[data-bid-id]");
      const currentBids = [];
      let foundPassedBidder = false;
      let previousAllFailed = true;
      const isNumeric = (val) => {
        if (!val) return false;
        const normalized = val.trim().replace(/,/g, ".");
        return !isNaN(normalized) && isFinite(normalized) && normalized !== "";
      };
      const toggleFailReasons = (tr, conclusionText) => {
        const inpHopLe = tr.querySelector(".mt-dg-hop-le");
        const inpNangLuc = tr.querySelector(".mt-dg-nang-luc");
        const inpKyThuat = tr.querySelector(".mt-dg-ky-thuat");
        const valHopLe = inpHopLe ? (inpHopLe.value || inpHopLe.textContent || "").trim() : "";
        const valNangLuc = inpNangLuc ? (inpNangLuc.value || inpNangLuc.textContent || "").trim() : "";
        const valKyThuat = inpKyThuat ? (inpKyThuat.value || inpKyThuat.textContent || "").trim() : "";
        const reasonHopLe = tr.querySelector(".mt-reason-fail-hople");
        if (reasonHopLe) {
          setRuntimeStyle(reasonHopLe, "display", valHopLe === "Không đạt" ? "block" : "none");
          if (valHopLe !== "Không đạt") reasonHopLe.value = "";
        }
        const reasonNangLuc = tr.querySelector(".mt-reason-fail-nangluc");
        if (reasonNangLuc) {
          setRuntimeStyle(reasonNangLuc, "display", valNangLuc === "Không đạt" ? "block" : "none");
          if (valNangLuc !== "Không đạt") reasonNangLuc.value = "";
        }
        const reasonKyThuat = tr.querySelector(".mt-reason-fail-kythuat");
        if (reasonKyThuat) {
          let shouldShowKyThuatFail = false;
          if (valKyThuat.toLowerCase() === "không đạt") {
            shouldShowKyThuatFail = true;
          } else if (isNumeric(valKyThuat)) {
            shouldShowKyThuatFail = conclusionText.startsWith("Không đạt");
          }
          setRuntimeStyle(reasonKyThuat, "display", shouldShowKyThuatFail ? "block" : "none");
          if (!shouldShowKyThuatFail) reasonKyThuat.value = "";
        }
      };
      rows.forEach((tr) => {
        const bidId = tr.getAttribute("data-bid-id");
        const bid = this.model.state.thongtinmothau.find((b) => b.id === bidId);
        if (bid) {
          const inpHopLe = tr.querySelector(".mt-dg-hop-le");
          const inpNangLuc = tr.querySelector(".mt-dg-nang-luc");
          const inpKyThuat = tr.querySelector(".mt-dg-ky-thuat");
          const selectKetLuan = tr.querySelector(".mt-dg-ketluan");
          let forceRowDisabled = false;
          if (!is1G2T && gt.quyTrinhDanhGia === "quytrinh2") {
            forceRowDisabled = !previousAllFailed || foundPassedBidder;
          }
          if (!isReadOnly && forceRowDisabled) {
            tr.querySelectorAll(".mt-dg-hop-le, .mt-dg-nang-luc, .mt-dg-ky-thuat, .mt-lam-ro-hop-le, .mt-lam-ro-nang-luc, .mt-lam-ro-ky-thuat, .mt-lam-ro-tai-chinh, .mt-reason-fail-hople, .mt-reason-fail-nangluc, .mt-reason-fail-kythuat").forEach((el) => {
              el.setAttribute("disabled", "true");
              setRuntimeStyle(el, "background", "var(--neutral-soft)");
              setRuntimeStyle(el, "cursor", "not-allowed");
            });
          } else if (!isReadOnly) {
            tr.querySelectorAll(".mt-dg-hop-le, .mt-lam-ro-hop-le, .mt-lam-ro-nang-luc, .mt-lam-ro-ky-thuat, .mt-lam-ro-tai-chinh, .mt-reason-fail-hople, .mt-reason-fail-nangluc, .mt-reason-fail-kythuat").forEach((el) => {
              el.removeAttribute("disabled");
              setRuntimeStyle(el, "background", "");
              setRuntimeStyle(el, "cursor", "");
            });
          }
          if (!is1G2T && gt.quyTrinhDanhGia === "quytrinh2" && foundPassedBidder) {
            this.updateRowConclusion(tr, "Không đánh giá", true);
          } else {
            const selectKetLuan2 = tr.querySelector(".mt-dg-ketluan");
            const currentSelectVal = selectKetLuan2 ? selectKetLuan2.value : null;
            const savedConclusion = isReadOnly ? bid.danhGiaKetLuan : !isReadOnly && forceRowDisabled ? "Chờ đánh giá" : currentSelectVal || bid.danhGiaKetLuan || null;
            this.updateRowConclusion(tr, savedConclusion, isReadOnly || forceRowDisabled);
          }
          const valHopLe = (inpHopLe?.value || inpHopLe?.textContent || bid.danhGiaHopLe || "").trim();
          const valNangLuc = (inpNangLuc?.value || inpNangLuc?.textContent || bid.danhGiaNangLuc || "").trim();
          const valKyThuat = (inpKyThuat?.value || inpKyThuat?.textContent || bid.danhGiaKyThuat || "").trim();
          let valKetLuan = "";
          const conclusionCell = tr.querySelector(".mt-ketluan-cell");
          const conclusionText = conclusionCell ? conclusionCell.textContent.trim() : "";
          if (selectKetLuan) {
            valKetLuan = selectKetLuan.value;
          } else {
            valKetLuan = conclusionText;
          }
          toggleFailReasons(tr, valKetLuan);
          if (!is1G2T && gt.quyTrinhDanhGia === "quytrinh2") {
            if (valKetLuan === "Đạt" || valKetLuan.startsWith("Đạt")) {
              foundPassedBidder = true;
            }
            const isThisFailed = valKetLuan.startsWith("Không đạt");
            if (!isThisFailed) {
              previousAllFailed = false;
            }
          }
          const inpGiaDuThau = tr.querySelector(".mt-gia-du-thau");
          const inpTyLeGiam = tr.querySelector(".mt-ty-le-giam-gia");
          const valGiaDuThau = inpGiaDuThau ? this.model.parseVND(inpGiaDuThau.value) : bid.giaDuThau || 0;
          const valTyLeGiam = inpTyLeGiam ? parseFloat(inpTyLeGiam.value.replace(/,/g, ".")) || 0 : bid.tyLeGiamGia || 0;
          const valGiaSauGiam = valGiaDuThau * (1 - valTyLeGiam / 100);
          currentBids.push({
            ...bid,
            danhGiaHopLe: valHopLe,
            danhGiaNangLuc: valNangLuc,
            danhGiaKyThuat: valKyThuat,
            danhGiaKetLuan: valKetLuan,
            giaDuThau: valGiaDuThau,
            tyLeGiamGia: valTyLeGiam,
            giaSauGiamGia: valGiaSauGiam
          });
        }
      });
      const { rankings, scores } = this.calculateRankings(gt, currentBids);
      rows.forEach((tr) => {
        const bidId = tr.getAttribute("data-bid-id");
        const bid = this.model.state.thongtinmothau.find((b) => b.id === bidId);
        const rank = rankings[bidId];
        const score = scores[bidId];
        const rankText = rank ? `Xếp hạng ${rank}` : "";
        const inpDgTaiChinh = tr.querySelector(".mt-dg-tai-chinh");
        if (inpDgTaiChinh) {
          inpDgTaiChinh.value = rankText;
        }
        const elXepHang = tr.querySelector(".mt-dg-xep-hang");
        if (elXepHang) {
          const conclusionCell = tr.querySelector(".mt-ketluan-cell");
          const conclusionText = conclusionCell ? conclusionCell.textContent.trim() : "";
          const isFailed = conclusionText.includes("Không đạt") || bid.danhGiaKetLuan && bid.danhGiaKetLuan.includes("Không đạt");
          elXepHang.textContent = rank ? `Xếp hạng ${rank}` : isFailed ? "Không xếp hạng" : "--";
        }
        const elCombinedScore = tr.querySelector(".mt-combined-score");
        if (elCombinedScore) {
          elCombinedScore.textContent = score !== void 0 && score !== null && !isNaN(score) && score > 0 ? score.toFixed(2) : "--";
        }
        const cellConclusion = tr.querySelector(".mt-ketluan-cell");
        if (cellConclusion) {
          const badge = cellConclusion.querySelector(".badge");
          if (badge) {
            const baseText = badge.textContent.trim();
            if (baseText.startsWith("Đạt")) {
              badge.textContent = "Đạt";
              badge.className = "badge badge-success";
            }
          }
        }
      });
    };
    tbody.innerHTML = trustedHTML("");
    let bids = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId));
    if (lotScope) {
      bids = filterBidsByEvaluationLotScope(bids, gt, lotScope);
    }
    if (is1G2T && this.currentDanhGiaTab === "financial") {
      bids = bids.filter((b) => {
        const kl = String(b.danhGiaKetLuan || "").trim().toLowerCase();
        if (kl) {
          return kl === "đạt" || kl.startsWith("đạt");
        }
        const hl = String(b.danhGiaHopLe || "").trim().toLowerCase();
        const nl = String(b.danhGiaNangLuc || "").trim().toLowerCase();
        const kt = String(b.danhGiaKyThuat || "").trim().toLowerCase();
        return hl === "đạt" && nl === "đạt" && kt !== "không đạt" && kt !== "";
      });
    }
    if (!is1G2T && gt.quyTrinhDanhGia === "quytrinh2") {
      bids.sort((a, b) => {
        const priceA = BigInt(this.model.parseVND(a.giaSauGiamGia || a.giaDuThau) || 0);
        const priceB = BigInt(this.model.parseVND(b.giaSauGiamGia || b.giaDuThau) || 0);
        return priceA < priceB ? -1 : priceA > priceB ? 1 : 0;
      });
    } else {
      bids.sort((a, b) => {
        const codeA = String(a.maPhanLo || "").toLowerCase();
        const codeB = String(b.maPhanLo || "").toLowerCase();
        return codeA.localeCompare(codeB, "vi", { numeric: true });
      });
    }
    if (bids.length === 0) {
      tbody.innerHTML = trustedHTML(`<tr><td colspan="15" class="bf-s-7fa1ce09fc"><small>Không tìm thấy danh sách nhà thầu mở thầu. Vui lòng nhập thông tin mở thầu trước.</small></td></tr>`);
    } else {
      let previousAllFailed = true;
      bids.forEach((bid) => {
        const tr = document.createElement("tr");
        tr.setAttribute("data-bid-id", bid.id);
        const finalGiaTriDamBao = bid.giaTriDamBao || 0;
        let finalHieuLucDamBao = bid.hieuLucBaoDamNgay ? String(bid.hieuLucBaoDamNgay) : "";
        if (finalHieuLucDamBao && !finalHieuLucDamBao.includes("ngày")) {
          finalHieuLucDamBao = finalHieuLucDamBao + " ngày";
        }
        let maNhaThauHienThi = bid.maNhaThau || bid.maDinhDanh || "--";
        let tenNhaThauHienThi = resolveBidContractorName(this.model, bid) || "--";
        const isJVBid = bid.loaiNhaThau === "Liên danh";
        const matchedNt = getExactContractorVersion(this.model, bid.nhaThauId) || resolveContractorVersion(this.model, bid);
        if (matchedNt) {
          maNhaThauHienThi = matchedNt.maNhaThau || maNhaThauHienThi;
        }
        let contractorDisplayHtml = "";
        if (isJVBid) {
          const jvKey = `${gtId}_eval_bidder_${bid.id}`;
          setJvData(jvKey, {
            members: resolveBidJointVentureMembers(this.model, bid),
            leadName: tenNhaThauHienThi,
            leadCode: maNhaThauHienThi,
            leadContractorVersionId: bid.nhaThauId || ""
          });
          contractorDisplayHtml = `<a href="#" class="mt-jv-view-link text-success fw-bold link-hover" data-jv-key="${escapeHtml(jvKey)}" title="Xem thành viên liên danh">👥 ${escapeHtml(tenNhaThauHienThi)}</a>`;
        } else {
          const contractorId = matchedNt?.id || "";
          contractorDisplayHtml = contractorId
            ? `<a href="#" data-bf-action="show-contractor" data-id="${escapeHtml(contractorId)}" class="text-blue fw-bold link-hover">${escapeHtml(tenNhaThauHienThi)}</a>`
            : `<span class="fw-bold">${escapeHtml(tenNhaThauHienThi)}</span>`;
        }
        let cellHtml = "";
        if (gt.phanLo === "Có") {
          cellHtml += `
                        <td>${escapeHtml(bid.maPhanLo || "--")}</td>
                        <td>${escapeHtml(bid.tenPhanLo || "--")}</td>
                    `;
        }
        cellHtml += `
                    <td>${escapeHtml(bid.loaiNhaThau || "Độc lập")}</td>
                    <td>${escapeHtml(formatPartnerIdentityCode(maNhaThauHienThi, "--"))}</td>
                    <td>${contractorDisplayHtml}</td>
                `;
        if (is1G2T && this.currentDanhGiaTab === "financial") {
          const valGiaDuThau = bid.giaDuThau ? this.model.formatVND(bid.giaDuThau) : "";
          const valTyLeGiam = bid.tyLeGiamGia !== void 0 ? this.model.formatVND(bid.tyLeGiamGia) : "0";
          const valGiaSauGiam = bid.giaSauGiamGia ? this.model.formatVND(bid.giaSauGiamGia) : "";
          const valHieuLucHsdt = bid.hieuLucHsdt || "";
          const valLamRoTaiChinh = bid.lamRoTaiChinh || "";
          const valTaiChinh = bid.danhGiaTaiChinh || "";
          if (isReadOnly) {
            cellHtml += `
                            <td><span>${valGiaDuThau || "--"}</span></td>
                            <td class="bf-s-5f326564a5"><span>${valTyLeGiam}</span></td>
                            <td><span>${valGiaSauGiam || "--"}</span></td>
                            ${isTuVan ? `<td><span>${valHieuLucHsdt ? valHieuLucHsdt + " ngày" : "--"}</span></td>` : ""}
                            <td><span>${escapeHtml(valLamRoTaiChinh || "--")}</span></td>
                            ${showCombinedScore ? `
                                <td><span>${escapeHtml(bid.danhGiaKyThuat || "--")}</span></td>
                                <td><span class="mt-combined-score bf-s-c6fa01b3f1">--</span></td>
                            ` : ""}
                            <td><span class="bf-s-6e8bcfac8d">${escapeHtml(valTaiChinh || "--")}</span></td>
                        `;
          } else {
            cellHtml += `
                            <td><input type="text" class="form-control mt-gia-du-thau bf-s-9eae6acf9f" value="${valGiaDuThau}" readonly placeholder="Ví dụ: 1.000.000.000"></td>
                            <td><input type="text" class="form-control mt-ty-le-giam-gia bf-s-b42165990f" value="${valTyLeGiam}" readonly placeholder="0"></td>
                            <td><input type="text" class="form-control mt-gia-sau-giam-gia bf-s-9eae6acf9f" value="${valGiaSauGiam}" readonly placeholder="......"></td>
                            ${isTuVan ? `<td><input type="text" class="form-control mt-hieu-luc-hsdt bf-s-9eae6acf9f" value="${valHieuLucHsdt ? valHieuLucHsdt + " ngày" : ""}" readonly placeholder="Ví dụ: 90 ngày"></td>` : ""}
                            <td><input type="text" class="form-control mt-lam-ro-tai-chinh bf-s-bce22e1c53" value="${escapeHtml(valLamRoTaiChinh)}" placeholder="Nhập làm rõ tài chính..."></td>
                            ${showCombinedScore ? `
                                <td><span>${escapeHtml(bid.danhGiaKyThuat || "--")}</span></td>
                                <td><span class="mt-combined-score bf-s-c6fa01b3f1">--</span></td>
                            ` : ""}
                            <td><input type="text" class="form-control mt-dg-tai-chinh bf-s-bce22e1c53" value="${escapeHtml(valTaiChinh)}" placeholder="Xếp hạng..."></td>
                        `;
          }
        } else {
          const valHopLe = bid.danhGiaHopLe || "";
          const valLamRoHopLe = bid.lamRoHopLe || "";
          const valNangLuc = bid.danhGiaNangLuc || "";
          const valLamRoNangLuc = bid.lamRoNangLuc || "";
          const valKyThuat = bid.danhGiaKyThuat || "";
          const valLamRoKyThuat = bid.lamRoKyThuat || "";
          const valLamRoTaiChinh = bid.lamRoTaiChinh || "";
          const valKetLuan = bid.danhGiaKetLuan || "";
          const isTechnical = caseType === "TU_VAN" || caseType === "1G2T_NO_LOT" || caseType === "1G2T_WITH_LOT";
          const valHieuLucHsdtRaw = bid.hieuLucHsdt || "";
          const valHieuLucHsdtDisplay = valHieuLucHsdtRaw ? String(valHieuLucHsdtRaw).includes("ngày") ? valHieuLucHsdtRaw : valHieuLucHsdtRaw + " ngày" : "--";
          const valHieuLucHsdtInput = valHieuLucHsdtRaw ? String(valHieuLucHsdtRaw).includes("ngày") ? valHieuLucHsdtRaw : valHieuLucHsdtRaw + " ngày" : "";
          if (isReadOnly) {
            if (!isTechnical) {
              cellHtml += `
                                <td><span>${bid.giaDuThau ? this.model.formatVND(bid.giaDuThau) : "--"}</span></td>
                                <td class="bf-s-5f326564a5"><span>${bid.tyLeGiamGia !== void 0 ? this.model.formatVND(bid.tyLeGiamGia) : "0"}</span></td>
                                <td><span>${bid.giaSauGiamGia ? this.model.formatVND(bid.giaSauGiamGia) : "--"}</span></td>
                                <td><span>${valHieuLucHsdtDisplay}</span></td>
                                <td><span>${bid.giaTriDamBao ? this.model.formatVND(bid.giaTriDamBao) : "--"}</span></td>
                                <td><span>${bid.hieuLucBaoDamNgay ? bid.hieuLucBaoDamNgay + " ngày" : "--"}</span></td>
                                <td><span>${escapeHtml(bid.thoiGianThucHien || gt.thoiGianThucHien || "--")}</span></td>
                            `;
            } else {
              if (caseType === "TU_VAN") {
                cellHtml += `
                                    <td><span>${valHieuLucHsdtDisplay}</span></td>
                                    <td><span>${escapeHtml(bid.thoiGianThucHien || gt.thoiGianThucHien || "--")}</span></td>
                                `;
              } else if (caseType === "1G2T_NO_LOT" || caseType === "1G2T_WITH_LOT") {
                cellHtml += `
                                    <td><span>${finalGiaTriDamBao ? this.model.formatVND(finalGiaTriDamBao) : "--"}</span></td>
                                    <td><span>${finalHieuLucDamBao || "--"}</span></td>
                                    <td><span>${valHieuLucHsdtDisplay}</span></td>
                                `;
              }
            }
            cellHtml += `
                            <td>
                                <span class="mt-dg-hop-le bf-s-6e8bcfac8d">${escapeHtml(valHopLe || "--")}</span>
                                ${bid.nguyenNhanKhongDatHopLe ? `<div class="bf-s-1e3e1388dc">Lý do: ${escapeHtml(bid.nguyenNhanKhongDatHopLe)}</div>` : ""}
                            </td>
                            <td><span>${escapeHtml(valLamRoHopLe || "--")}</span></td>
                            <td>
                                <span class="mt-dg-nang-luc bf-s-6e8bcfac8d">${escapeHtml(valNangLuc || "--")}</span>
                                ${bid.nguyenNhanKhongDatNangLuc ? `<div class="bf-s-1e3e1388dc">Lý do: ${escapeHtml(bid.nguyenNhanKhongDatNangLuc)}</div>` : ""}
                            </td>
                            <td><span>${escapeHtml(valLamRoNangLuc || "--")}</span></td>
                            <td>
                                <span class="mt-dg-ky-thuat bf-s-6e8bcfac8d">${escapeHtml(valKyThuat || "--")}</span>
                                ${bid.nguyenNhanKhongDatKyThuat ? `<div class="bf-s-1e3e1388dc">Lý do: ${escapeHtml(bid.nguyenNhanKhongDatKyThuat)}</div>` : ""}
                            </td>
                            <td><span>${escapeHtml(valLamRoKyThuat || "--")}</span></td>
                            ${isTechnical ? "" : `<td><span>${escapeHtml(valLamRoTaiChinh || "--")}</span></td>`}
                            ${showCombinedScore ? `<td><span class="mt-combined-score bf-s-c6fa01b3f1">--</span></td>` : ""}
                            <td class="mt-ketluan-cell bf-s-0c5104285b"></td>
                            ${isTechnical ? "" : `<td><span class="mt-dg-xep-hang bf-s-6e8bcfac8d">${escapeHtml(bid.danhGiaTaiChinh || "--")}</span></td>`}
                        `;
          } else {
            const forceRowDisabled = !is1G2T && gt.quyTrinhDanhGia === "quytrinh2" && !previousAllFailed;
            if (!isTechnical) {
              cellHtml += `
                                <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${bid.giaDuThau ? this.model.formatVND(bid.giaDuThau) : ""}" readonly></td>
                                <td><input type="text" class="form-control bf-s-b42165990f" value="${bid.tyLeGiamGia !== void 0 ? this.model.formatVND(bid.tyLeGiamGia) : "0"}" readonly></td>
                                <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${bid.giaSauGiamGia ? this.model.formatVND(bid.giaSauGiamGia) : ""}" readonly></td>
                                <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${bid.hieuLucHsdt ? bid.hieuLucHsdt + " ngày" : ""}" readonly></td>
                                <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${bid.giaTriDamBao ? this.model.formatVND(bid.giaTriDamBao) : ""}" readonly></td>
                                <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${bid.hieuLucBaoDamNgay ? bid.hieuLucBaoDamNgay + " ngày" : ""}" readonly></td>
                                <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${escapeHtml(bid.thoiGianThucHien || gt.thoiGianThucHien || "")}" readonly></td>
                            `;
            } else {
              if (caseType === "TU_VAN") {
                cellHtml += `
                                    <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${valHieuLucHsdtInput}" readonly></td>
                                    <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${escapeHtml(bid.thoiGianThucHien || gt.thoiGianThucHien || "")}" readonly></td>
                                `;
              } else if (caseType === "1G2T_NO_LOT" || caseType === "1G2T_WITH_LOT") {
                cellHtml += `
                                    <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${finalGiaTriDamBao ? this.model.formatVND(finalGiaTriDamBao) : ""}" readonly></td>
                                    <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${finalHieuLucDamBao}" readonly></td>
                                    <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${valHieuLucHsdtInput}" readonly></td>
                                `;
              }
            }
            cellHtml += `
                            <td>
                                <select class="form-control mt-dg-hop-le" ${forceRowDisabled ? 'disabled' : ""} style="padding: 4px 6px; font-size:0.8rem; font-weight:600; width: 100%;">
                                    <option value="Đạt" ${valHopLe === "Đạt" || valHopLe === "" ? "selected" : ""}>Đạt</option>
                                    <option value="Không đạt" ${valHopLe === "Không đạt" ? "selected" : ""}>Không đạt</option>
                                </select>
                                <input type="text" class="form-control mt-reason-fail-hople" value="${escapeHtml(bid.nguyenNhanKhongDatHopLe || "")}" placeholder="Lý do không đạt hợp lệ..." style="margin-top: 4px; padding: 4px 6px; font-size: 0.75rem; width: 100%; display: ${valHopLe === "Không đạt" ? "block" : "none"};" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""}>
                            </td>
                            <td><input type="text" class="form-control mt-lam-ro-hop-le" ${forceRowDisabled ? 'disabled' : ""} value="${escapeHtml(valLamRoHopLe)}" placeholder="${forceRowDisabled ? "Chờ đánh giá hạng trên..." : "Nhập làm rõ hợp lệ..."}"></td>
                            <td>
                                <select class="form-control mt-dg-nang-luc" ${forceRowDisabled ? 'disabled' : ""} style="padding: 4px 6px; font-size:0.8rem; font-weight:600; width: 100%;">
                                    <option value="Đạt" ${valNangLuc === "Đạt" || valNangLuc === "" ? "selected" : ""}>Đạt</option>
                                    <option value="Không đạt" ${valNangLuc === "Không đạt" ? "selected" : ""}>Không đạt</option>
                                </select>
                                <input type="text" class="form-control mt-reason-fail-nangluc" value="${escapeHtml(bid.nguyenNhanKhongDatNangLuc || "")}" placeholder="Lý do không đạt năng lực..." style="margin-top: 4px; padding: 4px 6px; font-size: 0.75rem; width: 100%; display: ${valNangLuc === "Không đạt" ? "block" : "none"};" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""}>
                            </td>
                            <td><input type="text" class="form-control mt-lam-ro-nang-luc" ${forceRowDisabled ? 'disabled' : ""} value="${escapeHtml(valLamRoNangLuc)}" placeholder="${forceRowDisabled ? "Chờ đánh giá hạng trên..." : "Nhập làm rõ năng lực..."}"></td>
                            <td>
                                <input type="text" class="form-control mt-dg-ky-thuat" ${forceRowDisabled ? 'disabled' : ""} value="${escapeHtml(valKyThuat)}" placeholder="${forceRowDisabled ? "Chờ đánh giá hạng trên..." : gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" ? "Nhập điểm kỹ thuật..." : "Điểm hoặc Đạt..."}">
                                <input type="text" class="form-control mt-reason-fail-kythuat bf-s-32fe8a23fe" value="${escapeHtml(bid.nguyenNhanKhongDatKyThuat || "")}" placeholder="Lý do không đạt kỹ thuật..." ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""}>
                            </td>
                            <td><input type="text" class="form-control mt-lam-ro-ky-thuat" ${forceRowDisabled ? 'disabled' : ""} value="${escapeHtml(valLamRoKyThuat)}" placeholder="${forceRowDisabled ? "Chờ đánh giá hạng trên..." : "Nhập làm rõ kỹ thuật..."}"></td>
                            ${isTechnical ? "" : `<td><input type="text" class="form-control mt-lam-ro-tai-chinh" ${forceRowDisabled ? 'disabled' : ""} value="${escapeHtml(valLamRoTaiChinh)}" placeholder="${forceRowDisabled ? "Chờ đánh giá hạng trên..." : "Nhập làm rõ tài chính..."}"></td>`}
                            ${showCombinedScore ? `<td><span class="mt-combined-score bf-s-c6fa01b3f1">--</span></td>` : ""}
                            <td class="mt-ketluan-cell bf-s-0c5104285b"></td>
                            ${isTechnical ? "" : `<td><span class="mt-dg-xep-hang bf-s-6e8bcfac8d">${escapeHtml(bid.danhGiaTaiChinh || "--")}</span></td>`}
                        `;
          }
        }
        tr.innerHTML = trustedHTML(cellHtml);
        this.updateRowConclusion(tr, bid.danhGiaKetLuan, isReadOnly);
        if (!isReadOnly && !is1G2T && gt.quyTrinhDanhGia === "quytrinh2") {
          const conclusionCell = tr.querySelector(".mt-ketluan-cell");
          const conclusionText = conclusionCell ? conclusionCell.textContent.trim() : "";
          const isThisFailed = conclusionText.startsWith("Không đạt");
          if (!isThisFailed) {
            previousAllFailed = false;
          }
        }
        if (!isReadOnly) {
          const inputs = tr.querySelectorAll(".mt-dg-hop-le, .mt-dg-nang-luc, .mt-dg-ky-thuat");
          inputs.forEach((input) => {
            const triggerUpdate = () => {
              updateAllRankings();
            };
            input.addEventListener("input", triggerUpdate);
            input.addEventListener("change", triggerUpdate);
          });
          tr.addEventListener("change", (e) => {
            if (e.target && e.target.classList.contains("mt-dg-ketluan")) {
              updateAllRankings();
            }
          });
        }
        if (!isReadOnly && (caseType === "1G2T_TC_NO_LOT" || caseType === "1G2T_TC_WITH_LOT")) {
          const inpGiaDuThau = tr.querySelector(".mt-gia-du-thau");
          const inpTyLeGiam = tr.querySelector(".mt-ty-le-giam-gia");
          const inpGiaTriDb = tr.querySelector(".mt-gia-tri-dam-bao");
          const reCalc = () => {
            const baseVal = this.model.parseVND(inpGiaDuThau?.value || "");
            const tyLeValRaw = inpTyLeGiam?.value || "0";
            const tyLeVal = parseFloat(tyLeValRaw.replace(/,/g, ".")) || 0;
            const finalVal = baseVal * (1 - tyLeVal / 100);
            const inpGiaSauGiam = tr.querySelector(".mt-gia-sau-giam-gia");
            if (inpGiaSauGiam) {
              inpGiaSauGiam.value = this.model.formatVND(finalVal) || "";
            }
            updateAllRankings();
          };
          if (inpGiaDuThau) {
            bindCurrencyElement(inpGiaDuThau, (value) => this.model.formatVND(value));
            inpGiaDuThau.addEventListener("input", reCalc);
          }
          if (inpTyLeGiam) {
            inpTyLeGiam.addEventListener("input", reCalc);
          }
          if (inpGiaTriDb) {
            bindCurrencyElement(inpGiaTriDb, (value) => this.model.formatVND(value));
          }
        }
        tr.querySelectorAll(".mt-hieu-luc-hsdt, .mt-hieu-luc-bao-dam-ngay").forEach((input) => {
          input.addEventListener("focus", () => {
            let val = input.value.trim();
            if (val) {
              const num = parseInt(val.replace(/[^0-9]/g, ""), 10);
              if (!isNaN(num)) input.value = num;
            }
          });
          input.addEventListener("blur", () => {
            let val = input.value.trim();
            if (val) {
              const num = parseInt(val.replace(/[^0-9]/g, ""), 10);
              if (!isNaN(num)) {
                input.value = num + " ngày";
              }
            }
          });
        });
        const jvViewLink = tr.querySelector(".mt-jv-view-link");
        if (jvViewLink) {
          jvViewLink.addEventListener("click", (e) => {
            e.preventDefault();
            const resolvedMembers = resolveBidJointVentureMembers(this.model, bid);
            const subMembers = resolvedMembers.filter((m) => m.vaiTro !== "Đứng đầu liên danh" && (m.maNhaThau || m.maSoThue) !== bid.maNhaThau);
            const leadM = resolvedMembers.find((m) => m.vaiTro === "Đứng đầu liên danh") || { tenNhaThau: resolveBidContractorName(this.model, bid), maNhaThau: bid.maNhaThau, maSoThue: "" };
            executeAppCommand("openMoThauJVViewModal", subMembers, leadM.tenNhaThau, leadM.maNhaThau || leadM.maSoThue, leadM.thanhVienNhaThauId || "");
          });
        }
        tbody.appendChild(tr);
      });
      updateAllRankings();
    }
    lucide.createIcons();
    if (typeof this.unifyTableInputsHeight === "function") {
      this.unifyTableInputsHeight(document);
    }
  };
  select.onchange = handlePackageSelection;
  handlePackageSelection();
  this.setupExcelImportEvents();
}
export { saveDanhGiaHsdt, updateRowConclusion } from "./bidEvaluationActions.js";
