import { setJvData } from "./jvDataStore.js";
import { bindCurrencyElement } from "../app/domUtils.js";
import { setVisible } from "../app/formStateUtils.js";
import { validateRequiredEvaluationReportFields } from "./bidEvaluationValidation.js";
import { addEvaluationLetterRow, renderEvaluationSummary } from "./bidEvaluationRender.js";
import { getExactContractorVersion, resolveBidContractorName, resolveBidJointVentureMembers, resolveContractorVersion } from "../partners/contractorVersionBinding.js";
import { escapeHtml } from "../shared/view_helpers.js";
export function renderDanhGiaHsdtPanel() {
  const select = this.view.getActiveElement("danhgiahsdt-goithau-select");
  if (!select) return;
  const selectedVal = select.value;
  const targetPackages = this.model.state.goithau.filter((g) => {
    if (g.id === selectedVal) return true;
    return g.trangThai === "Đang chấm thầu" || g.trangThai === "Đã có kết quả";
  });
  select.innerHTML = '<option value="">-- Chọn Gói thầu (Đang chấm thầu / Đã có kết quả) --</option>' + targetPackages.map((g) => `<option value="${escapeHtml(g.id)}" data-search="${escapeHtml(`${g.maGoiThau || ""} ${g.tenGoiThau || ""}`)}">${escapeHtml(g.tenGoiThau)} (${escapeHtml(g.maGoiThau || "Chưa có mã")})</option>`).join("");
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
      summaryContainer.style.display = "none";
      evaluationContainer.style.display = "none";
      emptyState.style.display = "block";
      return;
    }
    const gt = this.model.state.goithau.find((g) => g.id === gtId);
    if (!gt) return;
    const kh = this.model.getLatestPlan(gt.keHoachId);
    const cdt = kh ? this.model.state.chudautu.find((c) => c.id === kh.chuDauTuId) : null;
    const tenCdt = cdt ? cdt.tenChuDauTu : "Không rõ";
    const tenKhStr = kh ? kh.tenKeHoach : "Không rõ";
    const is1G2T = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
    let isTechEvalSaved = false;
    let isFinEvalSaved = false;
    let isEvalSaved1G1T = false;
    let isQualifiedSaved = false;
    if (gt.danhGiaHsdtMetadata) {
      try {
        const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
        if (is1G2T) {
          if (parsed.is1G2T) {
            isTechEvalSaved = !!(parsed.technical && parsed.technical.saved);
            isFinEvalSaved = !!(parsed.financial && parsed.financial.saved);
            isQualifiedSaved = !!(parsed.technical && parsed.technical.qualifiedSaved);
          }
        } else {
          isEvalSaved1G1T = !!parsed.saved;
        }
      } catch (e) {
        console.error("Error parsing evaluation metadata:", e);
      }
    }
    const isCompleted = this.currentDanhGiaTab === "technical" ? is1G2T ? isTechEvalSaved : isEvalSaved1G1T : isFinEvalSaved;
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
    emptyState.style.display = "none";
    evaluationContainer.style.display = "block";
    const quyTrinhContainer = this.view.getActiveElement("danhgiahsdt-quytrinh-container");
    const isGoodsOrNonConsulting = gt.linhVuc === "Hàng hóa" || gt.linhVuc === "Phi tư vấn";
    const is1G1T = gt.phuongThucLuaChon === "Một giai đoạn một túi hồ sơ";
    const showQuyTrinh = isGoodsOrNonConsulting && is1G1T;
    if (quyTrinhContainer) {
      if (showQuyTrinh) {
        quyTrinhContainer.style.display = "flex";
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
              warningMsg.style.display = "inline";
            }
          } else {
            if (!isReadOnly) {
              radio2.removeAttribute("disabled");
            }
            if (warningMsg) {
              warningMsg.style.display = "none";
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
        quyTrinhContainer.style.display = "none";
      }
    }
    const tabsHeader = this.view.getActiveElement("danhgiahsdt-tabs-header");
    const tabBtnKt = this.view.getActiveElement("tab-btn-hsdxt-kt");
    const tabBtnTc = this.view.getActiveElement("tab-btn-hsdxt-tc");
    let metadata = { soBaoCao: "", ngayBaoCao: "", cvLamRo: [], cvTraLoi: [], cvGuiCdt: [] };
    if (gt.danhGiaHsdtMetadata) {
      try {
        metadata = JSON.parse(gt.danhGiaHsdtMetadata);
        if (metadata && metadata.quyTrinhDanhGia) {
          gt.quyTrinhDanhGia = metadata.quyTrinhDanhGia;
        }
      } catch (e) {
        console.error("Failed to parse evaluation metadata:", e);
      }
    }
    if (is1G2T) {
      const isWorkflowView = this.view.isGoiThauDetailTabActive();
      if (tabsHeader) {
        tabsHeader.style.display = isWorkflowView ? "none" : "flex";
      }
      if (!this.currentDanhGiaTab || this.currentDanhGiaTab !== "technical" && this.currentDanhGiaTab !== "financial") {
        this.currentDanhGiaTab = "technical";
      }
      this._lastSelectedGtId = gtId;
      if (!metadata.is1G2T) {
        const oldMeta = { ...metadata };
        metadata = {
          is1G2T: true,
          technical: oldMeta.soBaoCao ? oldMeta : { soBaoCao: "", ngayBaoCao: "", cvLamRo: [], cvTraLoi: [], cvGuiCdt: [], saved: false },
          financial: { soBaoCao: "", ngayBaoCao: "", cvLamRo: [], cvTraLoi: [], cvGuiCdt: [], saved: false }
        };
      }
      const isKtSaved = !!(metadata.technical && metadata.technical.saved);
      if (tabBtnKt && tabBtnTc) {
        if (isKtSaved) {
          tabBtnTc.removeAttribute("disabled");
          tabBtnTc.style.opacity = "1";
          tabBtnTc.style.cursor = "pointer";
        } else {
          tabBtnTc.setAttribute("disabled", "true");
          tabBtnTc.style.opacity = "0.6";
          tabBtnTc.style.cursor = "not-allowed";
          this.currentDanhGiaTab = "technical";
        }
        if (this.currentDanhGiaTab === "technical") {
          tabBtnKt.className = "btn active";
          tabBtnKt.style.background = "var(--bg-card)";
          tabBtnKt.style.color = "var(--primary)";
          tabBtnKt.style.border = "1px solid var(--border-color)";
          tabBtnKt.style.borderBottom = "none";
          tabBtnTc.className = "btn";
          tabBtnTc.style.background = "transparent";
          tabBtnTc.style.color = "var(--text-muted)";
          tabBtnTc.style.border = "1px solid transparent";
        } else {
          tabBtnTc.className = "btn active";
          tabBtnTc.style.background = "var(--bg-card)";
          tabBtnTc.style.color = "var(--primary)";
          tabBtnTc.style.border = "1px solid var(--border-color)";
          tabBtnTc.style.borderBottom = "none";
          tabBtnKt.className = "btn";
          tabBtnKt.style.background = "transparent";
          tabBtnKt.style.color = "var(--text-muted)";
          tabBtnKt.style.border = "1px solid transparent";
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
      if (tabsHeader) tabsHeader.style.display = "none";
      this.currentDanhGiaTab = "unified";
    }
    let activeMeta = metadata;
    if (is1G2T) {
      activeMeta = this.currentDanhGiaTab === "technical" ? metadata.technical : metadata.financial;
    }
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
      fieldsRow.style.gridTemplateColumns = showExtraFields ? "repeat(4, 1fr)" : "repeat(2, 1fr)";
      fieldsRow.querySelectorAll(".evaluation-extra-field").forEach((el) => {
        el.style.display = showExtraFields ? "block" : "none";
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
          saveBtn.innerHTML = '<i data-lucide="edit"></i> Chỉnh sửa';
          saveBtn.className = "btn btn-primary";
          saveBtn.onclick = () => {
            this.view._editingState = this.view._editingState || {};
            this.view._editingState[stepKey] = true;
            this.renderDanhGiaHsdtPanel();
          };
        }
      } else {
        setVisible(saveBtn, true, "");
        saveBtn.innerHTML = '<i data-lucide="save"></i> Lưu thông tin đánh giá';
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
      listCvLamro.innerHTML = "";
      (activeMeta.cvLamRo || []).forEach((item) => addLetterRow("list-cv-lamro", item, isReadOnly));
    }
    if (listCvTraloi) {
      listCvTraloi.innerHTML = "";
      (activeMeta.cvTraLoi || []).forEach((item) => addLetterRow("list-cv-traloi", item, isReadOnly));
    }
    if (listCvGuicdt) {
      listCvGuicdt.innerHTML = "";
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
      if (is1G2T || isTuVan) {
        if (this.currentDanhGiaTab === "technical") {
          tableTitle.textContent = "Đánh giá chi tiết các E-HSĐXKT đã nộp";
        } else {
          tableTitle.textContent = "Đánh giá chi tiết các E-HSĐXTC đã nộp";
        }
      } else {
        tableTitle.textContent = "Đánh giá chi tiết các HSDT nộp";
      }
    }
    const isCombinedMethod = gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá";
    const showCombinedScore = isCombinedMethod && !(is1G2T && this.currentDanhGiaTab === "technical");
    let theadHtml = "";
    if (caseType === "TU_VAN") {
      theadHtml = `
                <tr>
                    <th style="width: 8%;">Loại nhà thầu</th>
                    <th style="width: 10%;">Mã nhà thầu</th>
                    <th style="width: 14%;">Tên nhà thầu</th>
                    <th style="width: 10%;">Hiệu lực E-HSĐXKT</th>
                    <th style="width: 10%;">Thời gian thực hiện</th>
                    <th style="width: 8%;">Đánh giá hợp lệ</th>
                    <th style="width: 8%;">Làm rõ tính hợp lệ</th>
                    <th style="width: 8%;">Đánh giá năng lực</th>
                    <th style="width: 8%;">Làm rõ năng lực kinh nghiệm</th>
                    <th style="width: 8%;">Đánh giá kỹ thuật</th>
                    <th style="width: 8%;">Làm rõ kỹ thuật</th>
                    ${showCombinedScore ? '<th style="width: 6%;">Điểm tổng hợp</th>' : ""}
                    <th style="width: 8%;">Kết luận</th>
                </tr>
            `;
    } else if (caseType === "1G2T_NO_LOT") {
      theadHtml = `
                <tr>
                    <th style="width: 8%;">Loại nhà thầu</th>
                    <th style="width: 8%;">Mã nhà thầu</th>
                    <th style="width: 12%;">Tên nhà thầu</th>
                    <th style="width: 8%;">Đảm bảo dự thầu</th>
                    <th style="width: 8%;">Hiệu lực đảm bảo</th>
                    <th style="width: 8%;">Hiệu lực E-HSĐXKT</th>
                    <th style="width: 8%;">Đánh giá hợp lệ</th>
                    <th style="width: 8%;">Làm rõ tính hợp lệ</th>
                    <th style="width: 8%;">Đánh giá năng lực</th>
                    <th style="width: 8%;">Làm rõ năng lực kinh nghiệm</th>
                    <th style="width: 8%;">Đánh giá kỹ thuật</th>
                    <th style="width: 8%;">Làm rõ kỹ thuật</th>
                    <th style="width: 8%;">Kết luận</th>
                </tr>
            `;
    } else if (caseType === "1G2T_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th style="width: 5%;">Mã phần lô</th>
                    <th style="width: 5%;">Tên phần lô</th>
                    <th style="width: 6%;">Loại nhà thầu</th>
                    <th style="width: 6%;">Mã nhà thầu</th>
                    <th style="width: 10%;">Tên nhà thầu</th>
                    <th style="width: 7%;">Đảm bảo dự thầu</th>
                    <th style="width: 7%;">Hiệu lực đảm bảo</th>
                    <th style="width: 7%;">Hiệu lực E-HSĐXKT</th>
                    <th style="width: 7%;">Đánh giá hợp lệ</th>
                    <th style="width: 7%;">Làm rõ hợp lệ</th>
                    <th style="width: 7%;">Đánh giá năng lực</th>
                    <th style="width: 7%;">Làm rõ năng lực</th>
                    <th style="width: 7%;">Đánh giá kỹ thuật</th>
                    <th style="width: 7%;">Làm rõ kỹ thuật</th>
                    <th style="width: 8%;">Kết luận</th>
                </tr>
            `;
    } else if (caseType === "1G2T_TC_NO_LOT") {
      theadHtml = `
                <tr>
                    <th style="width: 8%;">Loại nhà thầu</th>
                    <th style="width: 8%;">Mã nhà thầu</th>
                    <th style="width: 12%;">Tên nhà thầu</th>
                    <th style="width: 10%;">Giá dự thầu</th>
                    <th style="width: 6%;">Tỷ lệ %</th>
                    <th style="width: 10%;">Giá sau giảm</th>
                    ${isTuVan ? '<th style="width: 10%;">Hiệu lực E-HSĐXTC</th>' : ""}
                    <th style="width: 8%;">Làm rõ tài chính</th>
                    ${showCombinedScore ? `
                        <th style="width: 6%;">Đánh giá KT</th>
                        <th style="width: 6%;">Điểm tổng hợp</th>
                    ` : ""}
                    <th style="width: 6%;">Xếp hạng</th>
                </tr>
            `;
    } else if (caseType === "1G2T_TC_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th style="width: 6%;">Mã phần lô</th>
                    <th style="width: 6%;">Tên phần lô</th>
                    <th style="width: 6%;">Loại nhà thầu</th>
                    <th style="width: 6%;">Mã nhà thầu</th>
                    <th style="width: 10%;">Tên nhà thầu</th>
                    <th style="width: 9%;">Giá dự thầu</th>
                    <th style="width: 5%;">Tỷ lệ %</th>
                    <th style="width: 9%;">Giá sau giảm</th>
                    ${isTuVan ? '<th style="width: 8%;">Hiệu lực E-HSĐXTC</th>' : ""}
                    <th style="width: 8%;">Làm rõ tài chính</th>
                    ${showCombinedScore ? `
                        <th style="width: 6%;">Đánh giá KT</th>
                        <th style="width: 6%;">Điểm tổng hợp</th>
                    ` : ""}
                    <th style="width: 6%;">Xếp hạng</th>
                </tr>
            `;
    } else if (caseType === "1G1T_NO_LOT") {
      theadHtml = `
                <tr>
                    <th style="width: 5%;">Loại nhà thầu</th>
                    <th style="width: 5%;">Mã nhà thầu</th>
                    <th style="width: 10%;">Tên nhà thầu</th>
                    <th style="width: 8%;">Giá dự thầu</th>
                    <th style="width: 4%;">Tỷ lệ %</th>
                    <th style="width: 8%;">Giá sau giảm</th>
                    <th style="width: 6%;">Hiệu lực E-HSDT</th>
                    <th style="width: 6%;">Giá trị ĐB</th>
                    <th style="width: 6%;">Hiệu lực ĐB</th>
                    <th style="width: 6%;">Thời gian TH</th>
                    <th style="width: 6%;">Đánh giá hợp lệ</th>
                    <th style="width: 6%;">Làm rõ hợp lệ</th>
                    <th style="width: 6%;">Đánh giá năng lực</th>
                    <th style="width: 6%;">Làm rõ năng lực</th>
                    <th style="width: 6%;">Đánh giá kỹ thuật</th>
                    <th style="width: 6%;">Làm rõ kỹ thuật</th>
                    <th style="width: 6%;">Làm rõ tài chính</th>
                    ${isCombinedMethod ? '<th style="width: 6%;">Điểm tổng hợp</th>' : ""}
                    <th style="width: 8%;">Kết luận</th>
                    <th style="width: 6%;">Xếp hạng</th>
                </tr>
            `;
    } else if (caseType === "1G1T_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th style="width: 5%;">Mã phần lô</th>
                    <th style="width: 5%;">Tên phần lô</th>
                    <th style="width: 4%;">Loại nhà thầu</th>
                    <th style="width: 6%;">Mã nhà thầu</th>
                    <th style="width: 8%;">Tên nhà thầu</th>
                    <th style="width: 7%;">Giá dự thầu</th>
                    <th style="width: 4%;">Tỷ lệ %</th>
                    <th style="width: 7%;">Giá sau giảm</th>
                    <th style="width: 5%;">Hiệu lực E-HSDT</th>
                    <th style="width: 5%;">Giá trị ĐB</th>
                    <th style="width: 5%;">Hiệu lực ĐB</th>
                    <th style="width: 5%;">Thời gian TH</th>
                    <th style="width: 5%;">Đánh giá hợp lệ</th>
                    <th style="width: 5%;">Làm rõ hợp lệ</th>
                    <th style="width: 5%;">Đánh giá năng lực</th>
                    <th style="width: 5%;">Làm rõ năng lực</th>
                    <th style="width: 5%;">Đánh giá kỹ thuật</th>
                    <th style="width: 5%;">Làm rõ kỹ thuật</th>
                    <th style="width: 5%;">Làm rõ tài chính</th>
                    ${isCombinedMethod ? '<th style="width: 6%;">Điểm tổng hợp</th>' : ""}
                    <th style="width: 8%;">Kết luận</th>
                    <th style="width: 6%;">Xếp hạng</th>
                </tr>
            `;
    }
    thead.innerHTML = theadHtml;
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
          reasonHopLe.style.display = valHopLe === "Không đạt" ? "block" : "none";
          if (valHopLe !== "Không đạt") reasonHopLe.value = "";
        }
        const reasonNangLuc = tr.querySelector(".mt-reason-fail-nangluc");
        if (reasonNangLuc) {
          reasonNangLuc.style.display = valNangLuc === "Không đạt" ? "block" : "none";
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
          reasonKyThuat.style.display = shouldShowKyThuatFail ? "block" : "none";
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
              el.style.background = "var(--neutral-soft)";
              el.style.cursor = "not-allowed";
            });
          } else if (!isReadOnly) {
            const inpHopLe2 = tr.querySelector(".mt-dg-hop-le");
            const inpLamRoHopLe = tr.querySelector(".mt-lam-ro-hop-le");
            if (inpHopLe2) {
              inpHopLe2.removeAttribute("disabled");
              inpHopLe2.style.background = "";
              inpHopLe2.style.cursor = "";
            }
            if (inpLamRoHopLe) {
              inpLamRoHopLe.removeAttribute("disabled");
              inpLamRoHopLe.style.background = "";
              inpLamRoHopLe.style.cursor = "";
            }
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
    tbody.innerHTML = "";
    let bids = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId));
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
      tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; padding: 24px; color: var(--text-muted);"><small>Không tìm thấy danh sách nhà thầu mở thầu. Vui lòng nhập thông tin mở thầu trước.</small></td></tr>`;
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
                    <td>${escapeHtml(maNhaThauHienThi)}</td>
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
                            <td style="text-align:right;"><span>${valTyLeGiam}</span></td>
                            <td><span>${valGiaSauGiam || "--"}</span></td>
                            ${isTuVan ? `<td><span>${valHieuLucHsdt ? valHieuLucHsdt + " ngày" : "--"}</span></td>` : ""}
                            <td><span>${escapeHtml(valLamRoTaiChinh || "--")}</span></td>
                            ${showCombinedScore ? `
                                <td><span>${escapeHtml(bid.danhGiaKyThuat || "--")}</span></td>
                                <td><span class="mt-combined-score" style="font-weight:700;">--</span></td>
                            ` : ""}
                            <td><span style="font-weight:600;">${escapeHtml(valTaiChinh || "--")}</span></td>
                        `;
          } else {
            cellHtml += `
                            <td><input type="text" class="form-control mt-gia-du-thau" value="${valGiaDuThau}" readonly placeholder="Ví dụ: 1.000.000.000" style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-ty-le-giam-gia" value="${valTyLeGiam}" readonly placeholder="0" style="background:#f1f5f9; text-align:right; padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-gia-sau-giam-gia" value="${valGiaSauGiam}" readonly placeholder="......" style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                            ${isTuVan ? `<td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${valHieuLucHsdt ? valHieuLucHsdt + " ngày" : ""}" readonly placeholder="Ví dụ: 90 ngày" style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>` : ""}
                            <td><input type="text" class="form-control mt-lam-ro-tai-chinh" value="${escapeHtml(valLamRoTaiChinh)}" placeholder="Nhập làm rõ tài chính..." style="padding: 4px 6px; font-size:0.8rem;"></td>
                            ${showCombinedScore ? `
                                <td><span>${escapeHtml(bid.danhGiaKyThuat || "--")}</span></td>
                                <td><span class="mt-combined-score" style="font-weight:700;">--</span></td>
                            ` : ""}
                            <td><input type="text" class="form-control mt-dg-tai-chinh" value="${escapeHtml(valTaiChinh)}" placeholder="Xếp hạng..." style="padding: 4px 6px; font-size:0.8rem;"></td>
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
                                <td style="text-align:right;"><span>${bid.tyLeGiamGia !== void 0 ? this.model.formatVND(bid.tyLeGiamGia) : "0"}</span></td>
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
                                <span class="mt-dg-hop-le" style="font-weight:600;">${escapeHtml(valHopLe || "--")}</span>
                                ${bid.nguyenNhanKhongDatHopLe ? `<div style="color: #dc2626; font-size: 0.72rem; margin-top: 2px;">Lý do: ${escapeHtml(bid.nguyenNhanKhongDatHopLe)}</div>` : ""}
                            </td>
                            <td><span>${escapeHtml(valLamRoHopLe || "--")}</span></td>
                            <td>
                                <span class="mt-dg-nang-luc" style="font-weight:600;">${escapeHtml(valNangLuc || "--")}</span>
                                ${bid.nguyenNhanKhongDatNangLuc ? `<div style="color: #dc2626; font-size: 0.72rem; margin-top: 2px;">Lý do: ${escapeHtml(bid.nguyenNhanKhongDatNangLuc)}</div>` : ""}
                            </td>
                            <td><span>${escapeHtml(valLamRoNangLuc || "--")}</span></td>
                            <td>
                                <span class="mt-dg-ky-thuat" style="font-weight:600;">${escapeHtml(valKyThuat || "--")}</span>
                                ${bid.nguyenNhanKhongDatKyThuat ? `<div style="color: #dc2626; font-size: 0.72rem; margin-top: 2px;">Lý do: ${escapeHtml(bid.nguyenNhanKhongDatKyThuat)}</div>` : ""}
                            </td>
                            <td><span>${escapeHtml(valLamRoKyThuat || "--")}</span></td>
                            ${isTechnical ? "" : `<td><span>${escapeHtml(valLamRoTaiChinh || "--")}</span></td>`}
                            ${showCombinedScore ? `<td><span class="mt-combined-score" style="font-weight:700;">--</span></td>` : ""}
                            <td class="mt-ketluan-cell" style="text-align: center; vertical-align: middle;"></td>
                            ${isTechnical ? "" : `<td><span class="mt-dg-xep-hang" style="font-weight:600;">${escapeHtml(bid.danhGiaTaiChinh || "--")}</span></td>`}
                        `;
          } else {
            const forceRowDisabled = !is1G2T && gt.quyTrinhDanhGia === "quytrinh2" && !previousAllFailed;
            if (!isTechnical) {
              cellHtml += `
                                <td><input type="text" class="form-control" value="${bid.giaDuThau ? this.model.formatVND(bid.giaDuThau) : ""}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.tyLeGiamGia !== void 0 ? this.model.formatVND(bid.tyLeGiamGia) : "0"}" readonly style="background:#f1f5f9; text-align:right; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.giaSauGiamGia ? this.model.formatVND(bid.giaSauGiamGia) : ""}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.hieuLucHsdt ? bid.hieuLucHsdt + " ngày" : ""}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.giaTriDamBao ? this.model.formatVND(bid.giaTriDamBao) : ""}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.hieuLucBaoDamNgay ? bid.hieuLucBaoDamNgay + " ngày" : ""}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${escapeHtml(bid.thoiGianThucHien || gt.thoiGianThucHien || "")}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                            `;
            } else {
              if (caseType === "TU_VAN") {
                cellHtml += `
                                    <td><input type="text" class="form-control" value="${valHieuLucHsdtInput}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                    <td><input type="text" class="form-control" value="${escapeHtml(bid.thoiGianThucHien || gt.thoiGianThucHien || "")}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                `;
              } else if (caseType === "1G2T_NO_LOT" || caseType === "1G2T_WITH_LOT") {
                cellHtml += `
                                    <td><input type="text" class="form-control" value="${finalGiaTriDamBao ? this.model.formatVND(finalGiaTriDamBao) : ""}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                    <td><input type="text" class="form-control" value="${finalHieuLucDamBao}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                    <td><input type="text" class="form-control" value="${valHieuLucHsdtInput}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                `;
              }
            }
            cellHtml += `
                            <td>
                                <select class="form-control mt-dg-hop-le" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""} style="padding: 4px 6px; font-size:0.8rem; font-weight:600; width: 100%;">
                                    <option value="Đạt" ${valHopLe === "Đạt" || valHopLe === "" ? "selected" : ""}>Đạt</option>
                                    <option value="Không đạt" ${valHopLe === "Không đạt" ? "selected" : ""}>Không đạt</option>
                                </select>
                                <input type="text" class="form-control mt-reason-fail-hople" value="${escapeHtml(bid.nguyenNhanKhongDatHopLe || "")}" placeholder="Lý do không đạt hợp lệ..." style="margin-top: 4px; padding: 4px 6px; font-size: 0.75rem; width: 100%; display: ${valHopLe === "Không đạt" ? "block" : "none"};" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""}>
                            </td>
                            <td><input type="text" class="form-control mt-lam-ro-hop-le" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""} value="${escapeHtml(valLamRoHopLe)}" placeholder="${forceRowDisabled ? "Chờ đánh giá hạng trên..." : "Nhập làm rõ hợp lệ..."}"></td>
                            <td>
                                <select class="form-control mt-dg-nang-luc" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""} style="padding: 4px 6px; font-size:0.8rem; font-weight:600; width: 100%;">
                                    <option value="Đạt" ${valNangLuc === "Đạt" || valNangLuc === "" ? "selected" : ""}>Đạt</option>
                                    <option value="Không đạt" ${valNangLuc === "Không đạt" ? "selected" : ""}>Không đạt</option>
                                </select>
                                <input type="text" class="form-control mt-reason-fail-nangluc" value="${escapeHtml(bid.nguyenNhanKhongDatNangLuc || "")}" placeholder="Lý do không đạt năng lực..." style="margin-top: 4px; padding: 4px 6px; font-size: 0.75rem; width: 100%; display: ${valNangLuc === "Không đạt" ? "block" : "none"};" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""}>
                            </td>
                            <td><input type="text" class="form-control mt-lam-ro-nang-luc" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""} value="${escapeHtml(valLamRoNangLuc)}" placeholder="${forceRowDisabled ? "Chờ đánh giá hạng trên..." : "Nhập làm rõ năng lực..."}"></td>
                            <td>
                                <input type="text" class="form-control mt-dg-ky-thuat" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""} value="${escapeHtml(valKyThuat)}" placeholder="${forceRowDisabled ? "Chờ đánh giá hạng trên..." : gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" ? "Nhập điểm kỹ thuật..." : "Điểm hoặc Đạt..."}">
                                <input type="text" class="form-control mt-reason-fail-kythuat" value="${escapeHtml(bid.nguyenNhanKhongDatKyThuat || "")}" placeholder="Lý do không đạt kỹ thuật..." style="margin-top: 4px; padding: 4px 6px; font-size: 0.75rem; width: 100%; display: none;" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""}>
                            </td>
                            <td><input type="text" class="form-control mt-lam-ro-ky-thuat" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""} value="${escapeHtml(valLamRoKyThuat)}" placeholder="${forceRowDisabled ? "Chờ đánh giá hạng trên..." : "Nhập làm rõ kỹ thuật..."}"></td>
                            ${isTechnical ? "" : `<td><input type="text" class="form-control mt-lam-ro-tai-chinh" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ""} value="${escapeHtml(valLamRoTaiChinh)}" placeholder="${forceRowDisabled ? "Chờ đánh giá hạng trên..." : "Nhập làm rõ tài chính..."}"></td>`}
                            ${showCombinedScore ? `<td><span class="mt-combined-score" style="font-weight:700;">--</span></td>` : ""}
                            <td class="mt-ketluan-cell" style="text-align: center; vertical-align: middle;"></td>
                            ${isTechnical ? "" : `<td><span class="mt-dg-xep-hang" style="font-weight:600;">${escapeHtml(bid.danhGiaTaiChinh || "--")}</span></td>`}
                        `;
          }
        }
        tr.innerHTML = cellHtml;
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
export function updateRowConclusion(tr, savedKetLuan = null, isReadOnly = false) {
  const cell = tr.querySelector(".mt-ketluan-cell");
  if (!cell) return;
  const inpHopLe = tr.querySelector(".mt-dg-hop-le");
  const inpNangLuc = tr.querySelector(".mt-dg-nang-luc");
  const inpKyThuat = tr.querySelector(".mt-dg-ky-thuat");
  const valHopLe = (inpHopLe?.value || inpHopLe?.textContent || "").trim();
  const valNangLuc = (inpNangLuc?.value || inpNangLuc?.textContent || "").trim();
  const valKyThuat = (inpKyThuat?.value || inpKyThuat?.textContent || "").trim();
  if (!isReadOnly) {
    if (inpNangLuc) {
      if (valHopLe.toLowerCase() === "đạt") {
        inpNangLuc.removeAttribute("disabled");
        inpNangLuc.style.background = "";
        inpNangLuc.style.cursor = "auto";
      } else {
        inpNangLuc.setAttribute("disabled", "true");
        inpNangLuc.style.background = "var(--neutral-soft)";
        inpNangLuc.style.cursor = "not-allowed";
        inpNangLuc.value = "";
      }
    }
    if (inpKyThuat) {
      if (valHopLe.toLowerCase() === "đạt" && valNangLuc.toLowerCase() === "đạt") {
        inpKyThuat.removeAttribute("disabled");
        inpKyThuat.style.background = "";
        inpKyThuat.style.cursor = "auto";
      } else {
        inpKyThuat.setAttribute("disabled", "true");
        inpKyThuat.style.background = "var(--neutral-soft)";
        inpKyThuat.style.cursor = "not-allowed";
        inpKyThuat.value = "";
      }
    }
  }
  const valHopLeFinal = (inpHopLe?.value || inpHopLe?.textContent || "").trim();
  const valNangLucFinal = (inpNangLuc?.value || inpNangLuc?.textContent || "").trim();
  const valKyThuatFinal = (inpKyThuat?.value || inpKyThuat?.textContent || "").trim();
  const isNumeric = (val) => {
    if (!val) return false;
    const normalized = val.trim().replace(/,/g, ".");
    return !isNaN(normalized) && isFinite(normalized) && normalized !== "";
  };
  let conclusion = "";
  let status = "pending";
  if (!valHopLeFinal) {
    conclusion = "";
    status = "pending";
  } else if (valHopLeFinal.toLowerCase() !== "đạt") {
    conclusion = "Không đạt yêu cầu về tính hợp lệ";
    status = "fixed_fail";
  } else if (!valNangLucFinal) {
    conclusion = "";
    status = "pending";
  } else if (valNangLucFinal.toLowerCase() !== "đạt") {
    conclusion = "Không đạt yêu cầu về năng lực, kinh nghiệm";
    status = "fixed_fail";
  } else {
    if (!valKyThuatFinal) {
      conclusion = "";
      status = "pending";
    } else if (valKyThuatFinal.toLowerCase() === "không đạt") {
      conclusion = "Không đạt yêu cầu kỹ thuật";
      status = "fixed_fail";
    } else if (valKyThuatFinal.toLowerCase() === "đạt") {
      conclusion = "Đạt";
      status = "fixed_pass";
    } else if (isNumeric(valKyThuatFinal)) {
      status = "user_select";
      conclusion = savedKetLuan || "";
    } else {
      status = "user_select";
      conclusion = savedKetLuan || "";
    }
  }
  if (isReadOnly) {
    const finalConclusion = savedKetLuan || conclusion;
    if (finalConclusion === "Đạt" || finalConclusion === "Đạt (Xếp hạng 1)" || finalConclusion.startsWith("Đạt")) {
      cell.innerHTML = `<span class="badge badge-success" style="font-weight:700;">Đạt</span>`;
    } else if (finalConclusion && finalConclusion.startsWith("Không đạt")) {
      cell.innerHTML = `<span class="badge badge-danger" style="font-weight:700; background-color:rgba(239,68,68,0.08); color:#dc2626; border:1px solid rgba(239,68,68,0.25);">${escapeHtml(finalConclusion)}</span>`;
    } else {
      cell.innerHTML = `<span>${escapeHtml(finalConclusion || "--")}</span>`;
    }
  } else {
    if (status === "fixed_pass") {
      if (cell.textContent.trim() !== "Đạt" || !cell.querySelector(".badge-success")) {
        cell.innerHTML = `<span class="badge badge-success" style="font-weight:700; padding:6px 12px; border-radius:4px; display:inline-block;">Đạt</span>`;
      }
    } else if (status === "fixed_fail") {
      if (cell.textContent.trim() !== conclusion || !cell.querySelector(".badge-danger")) {
        cell.innerHTML = `<span class="badge badge-danger" style="font-weight:700; padding:6px 12px; border-radius:4px; display:inline-block; background-color:rgba(239,68,68,0.08); color:#dc2626; border:1px solid rgba(239,68,68,0.25);">${escapeHtml(conclusion)}</span>`;
      }
    } else if (status === "user_select") {
      const existingSelect = cell.querySelector(".mt-dg-ketluan");
      if (existingSelect) {
        if (existingSelect.value !== conclusion) {
          existingSelect.value = conclusion;
        }
      } else {
        cell.innerHTML = `
                    <select class="form-control mt-dg-ketluan" style="padding: 4px 6px; font-size:0.8rem; font-weight:600; border-color:var(--primary); width: 100%;">
                        <option value="">-- Chọn --</option>
                        <option value="Đạt" ${conclusion === "Đạt" ? "selected" : ""}>Đạt</option>
                        <option value="Không đạt" ${conclusion === "Không đạt" ? "selected" : ""}>Không đạt</option>
                    </select>
                `;
      }
    } else {
      if (cell.textContent.trim() !== "Chờ đánh giá") {
        cell.innerHTML = `<span style="color:var(--text-muted); font-style:italic;">Chờ đánh giá</span>`;
      }
    }
  }
}
export async function saveDanhGiaHsdt() {
  const select = this.view.getActiveElement("danhgiahsdt-goithau-select");
  if (!select) return;
  const gtId = select.value;
  if (!gtId) {
    this.view.focusInvalidControl(select);
    return;
  }
  const gt = this.model.state.goithau.find((g) => g.id === gtId);
  if (!gt) return;
  const inpSo = this.view.getActiveElement("danhgiahsdt-so-baocao");
  const inpNgay = this.view.getActiveElement("danhgiahsdt-ngay-baocao");
  const inpNgayMoiDoiChieu = this.view.getActiveElement("danhgiahsdt-ngay-moi-doichieu");
  const inpNgayDoiChieu = this.view.getActiveElement("danhgiahsdt-ngay-doichieu");
  const soBaoCao = inpSo?.value.trim() || "";
  const ngayBaoCaoRaw = inpNgay?.value.trim() || "";
  const ngayBaoCao = this.model.convertDMYToYMD(ngayBaoCaoRaw);
  const ngayMoiDoiChieuRaw = inpNgayMoiDoiChieu?.value.trim() || "";
  const ngayDoiChieuRaw = inpNgayDoiChieu?.value.trim() || "";
  const ngayMoiDoiChieu = ngayMoiDoiChieuRaw ? this.model.convertDMYToYMD(ngayMoiDoiChieuRaw) : "";
  const ngayDoiChieu = ngayDoiChieuRaw ? this.model.convertDMYToYMD(ngayDoiChieuRaw) : "";
  const reportValidation = validateRequiredEvaluationReportFields({
    reportNumberInput: inpSo,
    reportDateInput: inpNgay
  });
  if (!reportValidation.valid) {
    const first = reportValidation.errorInputs[0];
    this.view.focusInvalidControl(first);
    return;
  }
  const collectLetters = (containerId) => {
    const list = [];
    const container = this.view.getActiveElement(containerId);
    if (!container) return list;
    container.querySelectorAll(".letter-row").forEach((row) => {
      const soCv = row.querySelector(".letter-so-cv")?.value.trim() || "";
      const ngayCvRaw = row.querySelector(".letter-ngay-cv")?.value.trim() || "";
      const ngayCv = this.model.convertDMYToYMD(ngayCvRaw);
      if (soCv && ngayCv) {
        list.push({ soCv, ngayCv });
      }
    });
    return list;
  };
  const cvLamRo = collectLetters("list-cv-lamro");
  const cvTraLoi = collectLetters("list-cv-traloi");
  const cvGuiCdt = collectLetters("list-cv-guicdt");
  const quyTrinhContainer = this.view.getActiveElement("danhgiahsdt-quytrinh-container");
  if (quyTrinhContainer && quyTrinhContainer.style.display !== "none") {
    const radio2 = quyTrinhContainer.querySelector('input[value="quytrinh2"]');
    if (radio2) {
      gt.quyTrinhDanhGia = radio2.checked ? "quytrinh2" : "quytrinh1";
    }
  }
  const isDirectOrSpecial = gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
  const is1G2T = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  const hasExtraFields = !isDirectOrSpecial && (!is1G2T || this.currentDanhGiaTab === "financial");
  const activeBlock = {
    soBaoCao,
    ngayBaoCao,
    cvLamRo,
    cvTraLoi,
    cvGuiCdt,
    quyTrinhDanhGia: gt.quyTrinhDanhGia || "quytrinh1",
    saved: true
  };
  if (hasExtraFields) {
    activeBlock.ngayMoiDoiChieu = ngayMoiDoiChieu;
    activeBlock.ngayDoiChieu = ngayDoiChieu;
  }
  if (is1G2T) {
    let currentMetadata = { is1G2T: true, technical: { saved: false }, financial: { saved: false } };
    if (gt.danhGiaHsdtMetadata) {
      try {
        const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
        if (parsed.is1G2T) {
          currentMetadata = parsed;
        }
      } catch (e) {
        console.error("Error parsing existing metadata:", e);
      }
    }
    if (this.currentDanhGiaTab === "technical") {
      currentMetadata.technical = {
        ...currentMetadata.technical,
        ...activeBlock
      };
    } else {
      currentMetadata.financial = {
        ...currentMetadata.financial,
        ...activeBlock
      };
    }
    gt.danhGiaHsdtMetadata = JSON.stringify(currentMetadata);
  } else {
    gt.danhGiaHsdtMetadata = JSON.stringify(activeBlock);
  }
  await this.model.persistData("goithau");
  const rows = this.view.getActiveElement("danhgiahsdt-table-tbody").querySelectorAll("tr");
  const updatedBidsList = [];
  rows.forEach((tr) => {
    const bidId = tr.getAttribute("data-bid-id");
    const bid = this.model.state.thongtinmothau.find((b) => b.id === bidId);
    if (bid) {
      let giaDuThau = bid.giaDuThau;
      let tyLeGiamGia = bid.tyLeGiamGia;
      let giaSauGiamGia = bid.giaSauGiamGia;
      let danhGiaHopLe = bid.danhGiaHopLe;
      let danhGiaNangLuc = bid.danhGiaNangLuc;
      let danhGiaKyThuat = bid.danhGiaKyThuat;
      let danhGiaKetLuan = bid.danhGiaKetLuan;
      if (is1G2T && this.currentDanhGiaTab === "financial") {
        giaDuThau = this.model.parseVND(tr.querySelector(".mt-gia-du-thau")?.value || "");
        const tyLeRaw = tr.querySelector(".mt-ty-le-giam-gia")?.value || "0";
        tyLeGiamGia = parseFloat(tyLeRaw.replace(/,/g, ".")) || 0;
        giaSauGiamGia = this.model.parseVND(tr.querySelector(".mt-gia-sau-giam-gia")?.value || "");
      } else {
        danhGiaHopLe = tr.querySelector(".mt-dg-hop-le")?.value.trim() || "";
        danhGiaNangLuc = tr.querySelector(".mt-dg-nang-luc")?.value.trim() || "";
        danhGiaKyThuat = tr.querySelector(".mt-dg-ky-thuat")?.value.trim() || "";
        const selectKetLuan = tr.querySelector(".mt-dg-ketluan");
        if (selectKetLuan) {
          danhGiaKetLuan = selectKetLuan.value;
        } else {
          const cell = tr.querySelector(".mt-ketluan-cell");
          danhGiaKetLuan = cell ? cell.textContent.trim() : "";
        }
      }
      const nguyenNhanKhongDatHopLe = tr.querySelector(".mt-reason-fail-hople")?.value.trim() || "";
      const nguyenNhanKhongDatNangLuc = tr.querySelector(".mt-reason-fail-nangluc")?.value.trim() || "";
      const nguyenNhanKhongDatKyThuat = tr.querySelector(".mt-reason-fail-kythuat")?.value.trim() || "";
      updatedBidsList.push({
        ...bid,
        giaDuThau,
        tyLeGiamGia,
        giaSauGiamGia,
        danhGiaHopLe,
        danhGiaNangLuc,
        danhGiaKyThuat,
        danhGiaKetLuan,
        nguyenNhanKhongDatHopLe,
        nguyenNhanKhongDatNangLuc,
        nguyenNhanKhongDatKyThuat
      });
    }
  });
  const { rankings } = this.calculateRankings(gt, updatedBidsList);
  rows.forEach((tr) => {
    const bidId = tr.getAttribute("data-bid-id");
    if (!bidId) return;
    const bid = this.model.state.thongtinmothau.find((b) => b.id === bidId);
    if (bid) {
      const finalRank = rankings[bid.id];
      if (is1G2T && this.currentDanhGiaTab === "financial") {
        bid.giaDuThau = this.model.parseVND(tr.querySelector(".mt-gia-du-thau")?.value || "");
        const tyLeRaw = tr.querySelector(".mt-ty-le-giam-gia")?.value || "0";
        bid.tyLeGiamGia = parseFloat(tyLeRaw.replace(/,/g, ".")) || 0;
        bid.giaSauGiamGia = this.model.parseVND(tr.querySelector(".mt-gia-sau-giam-gia")?.value || "");
        bid.hieuLucHsdt = parseInt(tr.querySelector(".mt-hieu-luc-hsdt")?.value || "0", 10);
        const giaTriDamBaoEl = tr.querySelector(".mt-gia-tri-dam-bao");
        if (giaTriDamBaoEl) {
          bid.giaTriDamBao = this.model.parseVND(giaTriDamBaoEl.value || "");
        }
        const hieuLucBaoDamNgayEl = tr.querySelector(".mt-hieu-luc-bao-dam-ngay");
        if (hieuLucBaoDamNgayEl) {
          bid.hieuLucBaoDamNgay = parseInt(hieuLucBaoDamNgayEl.value || "0", 10);
        }
        const thoiGianThucHienEl = tr.querySelector(".mt-thoi-gian-thuc-hien");
        if (thoiGianThucHienEl) {
          bid.thoiGianThucHien = thoiGianThucHienEl.value.trim();
        }
        const isFailedFinancial = bid.danhGiaKetLuan && bid.danhGiaKetLuan.startsWith("Không đạt");
        bid.danhGiaTaiChinh = finalRank ? `Xếp hạng ${finalRank}` : isFailedFinancial ? "Không xếp hạng" : "--";
        bid.lamRoTaiChinh = tr.querySelector(".mt-lam-ro-tai-chinh")?.value.trim() || "";
      } else {
        bid.danhGiaHopLe = tr.querySelector(".mt-dg-hop-le")?.value.trim() || "";
        bid.danhGiaNangLuc = tr.querySelector(".mt-dg-nang-luc")?.value.trim() || "";
        bid.danhGiaKyThuat = tr.querySelector(".mt-dg-ky-thuat")?.value.trim() || "";
        const selectKetLuan = tr.querySelector(".mt-dg-ketluan");
        if (selectKetLuan) {
          bid.danhGiaKetLuan = selectKetLuan.value;
        } else {
          const cell = tr.querySelector(".mt-ketluan-cell");
          bid.danhGiaKetLuan = cell ? cell.textContent.trim() : "";
        }
        const isFailedTechnical = bid.danhGiaKetLuan && bid.danhGiaKetLuan.startsWith("Không đạt");
        bid.danhGiaTaiChinh = finalRank ? `Xếp hạng ${finalRank}` : isFailedTechnical ? "Không xếp hạng" : "--";
        const inpLamRoHopLe = tr.querySelector(".mt-lam-ro-hop-le");
        if (inpLamRoHopLe) bid.lamRoHopLe = inpLamRoHopLe.value.trim();
        const inpLamRoNangLuc = tr.querySelector(".mt-lam-ro-nang-luc");
        if (inpLamRoNangLuc) bid.lamRoNangLuc = inpLamRoNangLuc.value.trim();
        const inpLamRoKyThuat = tr.querySelector(".mt-lam-ro-ky-thuat");
        if (inpLamRoKyThuat) bid.lamRoKyThuat = inpLamRoKyThuat.value.trim();
        const inpLamRoTaiChinh = tr.querySelector(".mt-lam-ro-tai-chinh");
        if (inpLamRoTaiChinh) bid.lamRoTaiChinh = inpLamRoTaiChinh.value.trim();
        bid.nguyenNhanKhongDatHopLe = tr.querySelector(".mt-reason-fail-hople")?.value.trim() || "";
        bid.nguyenNhanKhongDatNangLuc = tr.querySelector(".mt-reason-fail-nangluc")?.value.trim() || "";
        bid.nguyenNhanKhongDatKyThuat = tr.querySelector(".mt-reason-fail-kythuat")?.value.trim() || "";
      }
    }
  });
  await this.model.persistData("thongtinmothau");
  this.view.renderGoiThauTable();
  const syncResult = await this.autoSync();
  if (!syncResult?.ok) return;
  const stepKey = this.currentDanhGiaTab === "financial" ? "eval_fin" : "eval_tech";
  if (this.view._editingState) {
    this.view._editingState[stepKey] = false;
  }
  if (this.view.isGoiThauDetailTabActive()) {
    if (!is1G2T) {
      this.view._currentWorkflowTab = "result";
    } else {
      if (this.currentDanhGiaTab === "technical") {
        const allBids = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId));
        const qualifiedBids = allBids.filter((b) => {
          const kl = String(b.danhGiaKetLuan || "").trim().toLowerCase();
          return kl === "đạt" || kl.startsWith("đạt") || kl.includes("trúng thầu");
        });
        this.view._currentWorkflowTab = qualifiedBids.length > 0 ? "qualified" : "result";
      } else {
        this.view._currentWorkflowTab = "result";
      }
    }
    this.view.showPackageDetails(gtId);
  }
  await this.view.customAlert("Lưu thành công", `Đã lưu toàn bộ thông tin báo cáo đánh giá của gói thầu "${gt.tenGoiThau}" thành công!`, "check-circle");
}
import { executeAppCommand } from "../app/commandBus.js";
