import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { bindCurrencyElement, bindCurrencyInput, debounce, onAll, onById } from "./domUtils.js";
import { bindImageUploadPreview } from "./fileUploadUtils.js";
import { setDisabled, setFieldFeedback, setReadonlyVisual, setRequired, setVisible } from "./formStateUtils.js";
import { setupInlineExcelControls } from "./inlineExcelControls.js";
import { escapeHtml, initCustomSelect } from "../shared/view_helpers.js";
import { derivePackagePrice } from "../packages/packagePricing.js";
import {
  EVALUATION_METHODS,
  evaluationMethodLabel,
  getEvaluationMethods,
  isCombinedEvaluationMethod,
} from "../packages/evaluationMethodRules.js";
import { paginatedSearchHasChanged } from "../shared/tableDataUtils.js";
import { trackPackageInheritance } from "../packages/packageRebidWorkflow.js";

function setDynamicFieldLabel(label, text, required = false) {
  if (!label) return;
  label.textContent = String(text || "");
  if (!required) return;
  label.append(" ");
  const marker = document.createElement("span");
  marker.className = "required";
  marker.textContent = "*";
  label.appendChild(marker);
}
export function updateNguonVonFieldState(planId) {
  const gtNguonVon = document.getElementById("gt-nguonvon");
  if (!gtNguonVon) return;
  if (planId) {
    const kh = this.model.getLatestPlan(planId);
    if (kh && kh.loaiHinhMuaSam === "Dự án") {
      if (kh.nguonVon) {
        gtNguonVon.value = kh.nguonVon;
      }
      setReadonlyVisual(gtNguonVon, true);
      return;
    }
  }
  setReadonlyVisual(gtNguonVon, false);
}
export function setupConditionalUI() {
  const statusSelect = document.getElementById("gt-trangthai");
  const phanLoSelect = document.getElementById("gt-phanlo");
  if (statusSelect) {
    statusSelect.addEventListener("change", () => {
      this.updateAwardedContractorUI();
      this.updatePackageFieldsVisibility();
    });
  }
  if (phanLoSelect) {
    phanLoSelect.addEventListener("change", () => {
      this.updateAwardedContractorUI();
      this.updatePackageFieldsVisibility();
    });
  }
  const linhVucSelect = document.getElementById("gt-linhvuc");
  if (linhVucSelect) {
    linhVucSelect.addEventListener("change", () => {
      this.updatePackageFieldsVisibility();
    });
  }
  const hinhThucSelect = document.getElementById("gt-hinhthuc");
  if (hinhThucSelect) {
    hinhThucSelect.addEventListener("change", () => {
      this.updatePackageFieldsVisibility();
    });
  }
  const khCdtSelect = document.getElementById("kh-chudautuid");
  if (khCdtSelect) {
    khCdtSelect.addEventListener("change", (e) => {
      if (e.target.value === "__NEW_INVESTOR__") {
        this.editChuDauTu(null);
        e.target.value = "";
      }
    });
  }
  const gtKeHoachSelect = document.getElementById("gt-kehoachid");
  if (gtKeHoachSelect) {
    gtKeHoachSelect.addEventListener("change", async (e) => {
      this.updateNguonVonFieldState(e.target.value);
      const idInput = document.getElementById("form-goithau-id");
      const isNewPackage = !idInput || !idInput.value;
      if (isNewPackage && e.target.value) {
        if (typeof this.checkAndInheritCanceledPackage === "function") {
          await trackPackageInheritance(
            this,
            () => this.checkAndInheritCanceledPackage(e.target.value),
          );
        }
      }
    });
  }
  const ntLoaiSelect = document.getElementById("nt-loai");
  if (ntLoaiSelect) {
    ntLoaiSelect.addEventListener("change", () => {
      const singleSection = document.getElementById("nt-single-details");
      const jvSection = document.getElementById("nt-joint-venture-details");
      if (ntLoaiSelect.value === "Liên danh") {
        setVisible(singleSection, false);
        setVisible(jvSection, true, "block");
        const membersList = document.getElementById("nt-joint-venture-members-list");
        if (membersList && membersList.children.length === 0) {
          this.addJointVentureMemberCard();
          this.addJointVentureMemberCard();
        }
      } else {
        setVisible(singleSection, true, "grid");
        setVisible(jvSection, false);
      }
    });
  }
}
export function setupFileUploads() {
  const alertInvalidImage = () => {
    this.view.customAlert("Tệp không hợp lệ", "Vui lòng chọn tệp hình ảnh hợp lệ (PNG, JPG, WEBP).", "alert-triangle");
  };
  const alertTooLarge = () => {
    this.view.customAlert("Tệp quá lớn", "Dung lượng ảnh quá lớn. Vui lòng tải lên ảnh dưới 3MB để hệ thống lưu trữ tối ưu.", "alert-triangle");
  };
  bindImageUploadPreview({
    uploadZone: document.getElementById("cg-upload-zone"),
    fileInput: document.getElementById("cg-anhchungchi"),
    previewContainer: document.getElementById("cg-preview-container"),
    previewImg: document.getElementById("cg-anh-preview"),
    removeBtn: document.getElementById("btn-cg-remove-file"),
    onLoad: (dataUrl) => {
      this.tempChuyenGiaImageBase64 = dataUrl;
    },
    onRemove: () => {
      this.tempChuyenGiaImageBase64 = "";
    },
    alertInvalid: alertInvalidImage,
    alertTooLarge
  });
  bindImageUploadPreview({
    uploadZone: document.getElementById("cg-upload-zone-chuky"),
    fileInput: document.getElementById("cg-anhchuky"),
    previewContainer: document.getElementById("cg-preview-container-chuky"),
    previewImg: document.getElementById("cg-anh-preview-chuky"),
    removeBtn: document.getElementById("btn-cg-remove-file-chuky"),
    onLoad: (dataUrl) => {
      this.tempChuyenGiaSignatureBase64 = dataUrl;
    },
    onRemove: () => {
      this.tempChuyenGiaSignatureBase64 = "";
    },
    alertInvalid: alertInvalidImage,
    alertTooLarge
  });
  bindImageUploadPreview({
    uploadZone: document.getElementById("nt-upload-zone-dau"),
    fileInput: document.getElementById("nt-anhdau"),
    previewContainer: document.getElementById("nt-preview-container-dau"),
    previewImg: document.getElementById("nt-anh-preview-dau"),
    removeBtn: document.getElementById("btn-nt-remove-file-dau"),
    onLoad: (dataUrl) => {
      this.tempNhaThauStampBase64 = dataUrl;
    },
    onRemove: () => {
      this.tempNhaThauStampBase64 = "";
    },
    alertInvalid: alertInvalidImage,
    alertTooLarge
  });
}
export function setupActionListeners() {
  const bindTableSearch = (inputId, table, renderMethod) => {
    onById(inputId, "input", debounce(() => {
      const search = document.getElementById(inputId)?.value || "";
      if (paginatedSearchHasChanged(this.model, table, search)) {
        this.model.currentPage[table] = 1;
      }
      this.view[renderMethod]();
    }));
  };
  bindTableSearch("search-kehoach", "kehoach", "renderKeHoachTable");
  bindTableSearch("search-goithau", "goithau", "renderGoiThauTable");
  bindTableSearch("search-chudautu", "chudautu", "renderChuDauTuTable");
  bindTableSearch("search-nhathau", "nhathau", "renderNhaThauTable");
  bindTableSearch("search-chuyengia", "chuyengia", "renderChuyenGiaTable");
  bindTableSearch("search-hopdong", "hopdong", "renderHopDongTable");
  onById("filter-goithau-trangthai", "change", () => {
    this.model.currentPage.goithau = 1;
    this.view.renderGoiThauTable();
  });
  onById("filter-goithau-hinhthuc", "change", () => {
    this.model.currentPage.goithau = 1;
    this.view.renderGoiThauTable();
  });
  onById("filter-goithau-nam", "change", () => {
    this.model.currentPage.goithau = 1;
    this.view.renderGoiThauTable();
  });
  onById("filter-goithau-thang", "change", () => {
    this.model.currentPage.goithau = 1;
    this.view.renderGoiThauTable();
  });
  onById("filter-kehoach-nam", "change", () => {
    this.model.currentPage.kehoach = 1;
    this.view.renderKeHoachTable();
  });
  onById("filter-kehoach-thang", "change", () => {
    this.model.currentPage.kehoach = 1;
    this.view.renderKeHoachTable();
  });
  onById("filter-hopdong-nam", "change", () => {
    this.model.currentPage.hopdong = 1;
    this.view.renderHopDongTable();
  });
  onById("filter-hopdong-thang", "change", () => {
    this.model.currentPage.hopdong = 1;
    this.view.renderHopDongTable();
  });
  const runWorkflow = async (methodName, ...args) => {
    await this.ensureWorkflowReady(methodName);
    return this[methodName](...args);
  };
  onById("btn-add-kehoach", "click", () => runWorkflow("editKeHoach", null));
  onById("btn-add-goithau", "click", () => runWorkflow("editGoiThau", null));
  onById("btn-add-chudautu", "click", () => runWorkflow("editChuDauTu", null));
  onById("btn-add-nhathau", "click", () => runWorkflow("editNhaThau", null));
  onById("btn-add-chuyengia", "click", () => runWorkflow("editChuyenGia", null));
  onById("btn-add-hopdong", "click", () => runWorkflow("editHopDong", null));
  [
    "kh-tongmuc",
    "gt-gia",
    "gt-giatrungthau",
    "gt-giatribaomothau",
    "hd-giatri",
    "edit-pkg-price"
  ].forEach((inputId) => bindCurrencyInput(inputId, (value) => this.model.formatVND(value)));
  const hsdthInput = document.getElementById("gt-hieuluchsdt");
  if (hsdthInput) {
    hsdthInput.addEventListener("input", () => {
      const hsdthVal = parseInt(hsdthInput.value) || 0;
      const bdmInput = document.getElementById("gt-hieuluchbaomothau");
      if (bdmInput) {
        bdmInput.value = hsdthVal > 0 ? hsdthVal + 30 : "";
      }
    });
  }
  const gtThoiGianDongThau = document.getElementById("gt-thoigiandongthau");
  if (gtThoiGianDongThau) {
    gtThoiGianDongThau.addEventListener("change", () => this.validateGiaHanRealtime());
    gtThoiGianDongThau.addEventListener("input", () => this.validateGiaHanRealtime());
  }
  onAll("[data-close]", "click", (event) => {
    const btn = event.currentTarget;
    const modalId = btn.getAttribute("data-close");
    this.closeModal(modalId);
  });
  onById("form-kehoach", "submit", (e) => this.handleKeHoachSubmit(e));
  onById("form-goithau", "submit", (e) => this.handleGoiThauSubmit(e));
  onById("form-phathanh-hsmt", "submit", (e) => this.handlePhatHanhHsmtSubmit(e));
  const btnPhathanhExport = document.getElementById("btn-phathanh-export-excel");
  const btnPhathanhImport = document.getElementById("btn-phathanh-import-excel");
  const inputPhathanhImport = document.getElementById("phathanh-excel-file-input");
  if (btnPhathanhExport && !btnPhathanhExport._hasExcelListener) {
    btnPhathanhExport._hasExcelListener = true;
    btnPhathanhExport.addEventListener("click", () => {
      const id = document.getElementById("phathanh-gt-id").value;
      const gt = this.model.state.goithau.find((g) => g.id === id);
      if (gt) {
        this.exportPhatHanhPhanLoExcel(gt);
      }
    });
  }
  if (btnPhathanhImport && inputPhathanhImport && !btnPhathanhImport._hasExcelListener) {
    btnPhathanhImport._hasExcelListener = true;
    inputPhathanhImport._hasExcelListener = true;
    btnPhathanhImport.addEventListener("click", () => inputPhathanhImport.click());
    inputPhathanhImport.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        this.importPhatHanhPhanLoExcel(e.target.files[0]);
        inputPhathanhImport.value = "";
      }
    });
  }
  const phathanhGiatribaomothau = document.getElementById("phathanh-giatribaomothau");
  if (phathanhGiatribaomothau) {
    bindCurrencyElement(phathanhGiatribaomothau, (value) => this.model.formatVND(value));
  }
  document.querySelectorAll('input[name="phathanh-yeucauthamdinh"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      const show = e.target.value === "REQUIRED";
      const soBaoCaoContainer = document.getElementById("phathanh-sobaocao-container");
      const ngayBaoCaoContainer = document.getElementById("phathanh-ngaybaocao-container");
      const soBaoCaoInp = document.getElementById("phathanh-sobaocaothamdinh");
      const ngayBaoCaoInp = document.getElementById("phathanh-ngaybaocaothamdinh");
      // `.form-group` is a flex column with a row gap; revealing it as a block
      // drops that gap and the input lands 6px above its neighbour in the grid.
      setVisible(soBaoCaoContainer, show);
      setVisible(ngayBaoCaoContainer, show);
      setRequired(soBaoCaoInp, show);
      setRequired(ngayBaoCaoInp, show);
      if (!show) {
        if (soBaoCaoInp) {
          soBaoCaoInp.value = "";
        }
        if (ngayBaoCaoInp) {
          ngayBaoCaoInp.value = "";
          if (ngayBaoCaoInp._flatpickr) {
            ngayBaoCaoInp._flatpickr.clear();
          }
        }
      }
    });
  });
  const gtHinhThucSelect = document.getElementById("gt-hinhthuc");
  const gtPhuongThucSelect = document.getElementById("gt-phuongthuc");
  const gtPhuongThucContainer = document.getElementById("gt-phuongthuc-container");
  const gtLinhVucSelect = document.getElementById("gt-linhvuc");
  const gtPhuongPhapDanhGiaSelect = document.getElementById("gt-phuongphapdanhgia");
  const gtPhuongPhapDanhGiaContainer = document.getElementById("gt-phuongphapdanhgia-container");
  const gtTrongSoKyThuatContainer = document.getElementById("gt-trongsokythuat-container");
  const gtTrongSoKyThuatInput = document.getElementById("gt-trongsokythuat");
  const gtGoiThauThuocRadios = Array.from(document.querySelectorAll('input[name="gt-goithauthuoc"]'));
  const isMedicinePackage = () => gtLinhVucSelect?.value === "Hàng hóa"
    && gtGoiThauThuocRadios.some((radio) => radio.checked && radio.value === "1");
  const validateTrongSoKyThuat = (showEmptyError = false) => {
    if (!gtTrongSoKyThuatInput || !gtTrongSoKyThuatContainer) return true;
    const valRaw = gtTrongSoKyThuatInput.value;
    const clearFeedback = () => setFieldFeedback(gtTrongSoKyThuatInput);
    const invalidFeedback = (message) => setFieldFeedback(gtTrongSoKyThuatInput, {
      state: "invalid",
      message,
      color: "var(--danger)"
    });
    if (!isCombinedEvaluationMethod(gtPhuongPhapDanhGiaSelect.value)) {
      clearFeedback();
      return true;
    }
    if (valRaw === "") {
      if (showEmptyError) {
        invalidFeedback("Vui lòng nhập trọng số kỹ thuật");
      } else {
        clearFeedback();
      }
      return false;
    }
    const val = parseInt(valRaw);
    const linhVucVal = gtLinhVucSelect ? gtLinhVucSelect.value : "";
    const phuongThucVal = gtPhuongThucSelect ? gtPhuongThucSelect.value : "";
    if (linhVucVal === "Tư vấn") {
      if (val < 70 || val > 80) {
        invalidFeedback("Đối với gói thầu tư vấn, trọng số kỹ thuật phải nằm trong khoảng 70% - 80%");
        return false;
      }
    } else if (isMedicinePackage()) {
      if (val < 30 || val > 40) {
        invalidFeedback("Đối với gói thầu thuốc, trọng số kỹ thuật phải nằm trong khoảng 30% - 40%");
        return false;
      }
    } else {
      if (phuongThucVal === "Một giai đoạn hai túi hồ sơ" || phuongThucVal === "Hai giai đoạn hai túi hồ sơ") {
        if (val < 10) {
          invalidFeedback("Trọng số kỹ thuật tối thiểu là 10%");
          return false;
        }
        if (val > 50) {
          invalidFeedback("Không cho phép nhập trọng số kỹ thuật lớn hơn 50%");
          return false;
        }
        if (val > 30 && val <= 50) {
          setFieldFeedback(gtTrongSoKyThuatInput, {
            state: "warning",
            message: "Lưu ý: Trọng số kỹ thuật lớn hơn 30% (mức khuyến nghị thông thường là 10% - 30%)",
            color: "#d97706"
          });
          return true;
        }
      }
    }
    clearFeedback();
    return true;
  };
  const updateTrongSoKyThuatVisibility = () => {
    if (!gtTrongSoKyThuatContainer || !gtPhuongPhapDanhGiaSelect) return;
    if (isCombinedEvaluationMethod(gtPhuongPhapDanhGiaSelect.value)) {
      setVisible(gtTrongSoKyThuatContainer, true);
      setRequired(gtTrongSoKyThuatInput, true);
      validateTrongSoKyThuat();
    } else {
      setVisible(gtTrongSoKyThuatContainer, false);
      setRequired(gtTrongSoKyThuatInput, false);
      if (gtTrongSoKyThuatInput) gtTrongSoKyThuatInput.value = "";
      setFieldFeedback(gtTrongSoKyThuatInput);
    }
  };
  const updatePhuongPhapDanhGiaOptions = (forceDefault = false) => {
    if (!gtPhuongPhapDanhGiaSelect || !gtPhuongPhapDanhGiaContainer) return;
    const linhVucVal = gtLinhVucSelect ? gtLinhVucSelect.value : "";
    const phuongThucVal = gtPhuongThucSelect ? gtPhuongThucSelect.value : "";
    const hinhThucVal = gtHinhThucSelect ? gtHinhThucSelect.value : "";
    if (!hinhThucVal || hinhThucVal === "Chỉ định thầu rút gọn" || hinhThucVal === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
      setVisible(gtPhuongPhapDanhGiaContainer, false);
      setRequired(gtPhuongPhapDanhGiaSelect, false);
      gtPhuongPhapDanhGiaSelect.value = "";
      setVisible(gtTrongSoKyThuatContainer, false);
      return;
    }
    const currentVal = gtPhuongPhapDanhGiaSelect.value;
    const methods = getEvaluationMethods({
      linhVuc: linhVucVal,
      hinhThucLuaChon: hinhThucVal,
      phuongThucLuaChon: phuongThucVal,
    });
    setVisible(gtPhuongPhapDanhGiaContainer, true);
    if (methods.length === 0) {
      gtPhuongPhapDanhGiaSelect.innerHTML = trustedHTML('<option value="">Không áp dụng cho tổ hợp đã chọn</option>');
      gtPhuongPhapDanhGiaSelect.value = "";
      setDisabled(gtPhuongPhapDanhGiaSelect, true);
      setRequired(gtPhuongPhapDanhGiaSelect, false);
      updateTrongSoKyThuatVisibility();
      initCustomSelect("gt-phuongphapdanhgia");
      return;
    }
    setDisabled(gtPhuongPhapDanhGiaSelect, false);
    setRequired(gtPhuongPhapDanhGiaSelect, true);
    gtPhuongPhapDanhGiaSelect.innerHTML = trustedHTML(methods
      .map((method) => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`)
      .join(""));
    const currentLabel = evaluationMethodLabel(currentVal);
    if (!forceDefault && currentLabel && methods.includes(currentLabel)) {
      gtPhuongPhapDanhGiaSelect.value = currentLabel;
    } else {
      gtPhuongPhapDanhGiaSelect.value = linhVucVal === "Tư vấn"
        ? EVALUATION_METHODS.COMBINED
        : EVALUATION_METHODS.LOWEST_PRICE;
    }
    updateTrongSoKyThuatVisibility();
    initCustomSelect("gt-phuongphapdanhgia");
  };
  if (gtPhuongPhapDanhGiaSelect) {
    gtPhuongPhapDanhGiaSelect.addEventListener("change", updateTrongSoKyThuatVisibility);
    this.updateTrongSoKyThuatVisibility = updateTrongSoKyThuatVisibility;
    this.updatePhuongPhapDanhGiaOptions = updatePhuongPhapDanhGiaOptions;
  }
  if (gtTrongSoKyThuatInput) {
    gtTrongSoKyThuatInput.addEventListener("input", validateTrongSoKyThuat);
    gtTrongSoKyThuatInput.addEventListener("change", validateTrongSoKyThuat);
    this.validateTrongSoKyThuat = validateTrongSoKyThuat;
  }
  gtGoiThauThuocRadios.forEach((radio) => {
    radio.addEventListener("change", () => validateTrongSoKyThuat());
  });
  if (gtPhuongThucSelect) {
    gtPhuongThucSelect.addEventListener("change", () => {
      updatePhuongPhapDanhGiaOptions();
    });
  }
  if (gtHinhThucSelect && gtPhuongThucSelect && gtPhuongThucContainer) {
    const handleHinhThucChange = () => {
      const val = gtHinhThucSelect.value;
      const linhVucVal = gtLinhVucSelect ? gtLinhVucSelect.value : "";
      const gtQuaMangSelect2 = document.getElementById("gt-quatmang");
      if (!val) {
        setVisible(gtPhuongThucContainer, false);
        setRequired(gtPhuongThucSelect, false);
      } else {
        setVisible(gtPhuongThucContainer, true);
        setRequired(gtPhuongThucSelect, true);
        if (linhVucVal === "Tư vấn") {
          if (val === "Chỉ định thầu rút gọn" || val === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
            gtPhuongThucSelect.value = "Không có";
            setDisabled(gtPhuongThucSelect, true);
          } else {
            gtPhuongThucSelect.value = "Một giai đoạn hai túi hồ sơ";
            setDisabled(gtPhuongThucSelect, true);
          }
        } else {
          if (val === "Chào hàng cạnh tranh") {
            gtPhuongThucSelect.value = "Một giai đoạn một túi hồ sơ";
            setDisabled(gtPhuongThucSelect, true);
          } else if (val === "Chỉ định thầu rút gọn" || val === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
            gtPhuongThucSelect.value = "Không có";
            setDisabled(gtPhuongThucSelect, true);
          } else {
            setDisabled(gtPhuongThucSelect, false);
          }
        }
      }
      if (gtQuaMangSelect2) {
        if (val === "Chỉ định thầu rút gọn" || val === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
          gtQuaMangSelect2.value = "Không qua mạng";
          setDisabled(gtQuaMangSelect2, true);
        } else {
          setDisabled(gtQuaMangSelect2, false);
        }
        if (this.handleQuaMangChange) {
          this.handleQuaMangChange();
        }
      }
      initCustomSelect("gt-phuongthuc");
      initCustomSelect("gt-quatmang");
      updatePhuongPhapDanhGiaOptions();
      const toChuyenGiaSection = document.getElementById("to-chuyengia-section");
      const toThamDinhSection = document.getElementById("to-thamdinh-section");
      if (toChuyenGiaSection && toThamDinhSection) {
        if (val === "Chào hàng cạnh tranh") {
          setVisible(toChuyenGiaSection, true);
          setVisible(toThamDinhSection, false);
        } else if (val === "Đấu thầu rộng rãi" || val === "Đấu thầu hạn chế" || val === "Chỉ định thầu") {
          setVisible(toChuyenGiaSection, true);
          setVisible(toThamDinhSection, true);
        } else if (val === "Chỉ định thầu rút gọn" || val === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
          setVisible(toChuyenGiaSection, false);
          setVisible(toThamDinhSection, false);
        } else {
          setVisible(toChuyenGiaSection, true);
          setVisible(toThamDinhSection, false);
        }
      }
    };
    gtHinhThucSelect.addEventListener("change", handleHinhThucChange);
    this.handleHinhThucChange = handleHinhThucChange;
  }
  const gtTuyChonContainer = document.getElementById("gt-tuychonmuathem-container");
  const gtPhanLoContainer = document.getElementById("gt-phanlo-container");
  const gtPhanLoTableContainer = document.getElementById("gt-phanlo-table-container");
  if (gtLinhVucSelect && gtHinhThucSelect && gtPhuongThucSelect && gtPhuongThucContainer) {
    const handleLinhVucChange = () => {
      const val = gtLinhVucSelect.value;
      const options = gtHinhThucSelect.querySelectorAll("option");
      if (val === "Tư vấn") {
        options.forEach((opt) => {
          const optVal = opt.value;
          if (optVal === "Đấu thầu rộng rãi" || optVal === "Đấu thầu hạn chế" || optVal === "Chỉ định thầu" || optVal === "Chỉ định thầu rút gọn" || optVal === "" || optVal === "Tất cả hình thức") {
            setRuntimeStyle(opt, "display", "");
          } else {
            setRuntimeStyle(opt, "display", "none");
          }
        });
        if (gtHinhThucSelect.value !== "Đấu thầu rộng rãi" && gtHinhThucSelect.value !== "Đấu thầu hạn chế" && gtHinhThucSelect.value !== "Chỉ định thầu" && gtHinhThucSelect.value !== "Chỉ định thầu rút gọn") {
          gtHinhThucSelect.value = "Đấu thầu rộng rãi";
        }
        setDisabled(gtHinhThucSelect, false);
      } else {
        options.forEach((opt) => setRuntimeStyle(opt, "display", ""));
        setDisabled(gtHinhThucSelect, false);
      }
      if (this.handleHinhThucChange) {
        this.handleHinhThucChange();
      }
      updatePhuongPhapDanhGiaOptions(true);
      if (gtTuyChonContainer) {
        setVisible(gtTuyChonContainer, true);
        if (this.handleTuyChonMuaThemChange) this.handleTuyChonMuaThemChange();
      }
      if (gtPhanLoContainer) {
        setVisible(gtPhanLoContainer, true);
        if (this.handlePhanLoChange) this.handlePhanLoChange();
      }
      const gtGoiThauThuocContainer = document.getElementById("gt-goithauthuoc-container");
      if (gtGoiThauThuocContainer) {
        if (val === "Hàng hóa") {
          setVisible(gtGoiThauThuocContainer, true);
        } else {
          setVisible(gtGoiThauThuocContainer, false);
          const radioNo = document.querySelector('input[name="gt-goithauthuoc"][value="0"]');
          if (radioNo) radioNo.checked = true;
        }
      }
    };
    gtLinhVucSelect.addEventListener("change", handleLinhVucChange);
    this.handleLinhVucChange = handleLinhVucChange;
  }
  const gtTuyChonMuaThemSelect = document.getElementById("gt-tuychonmuathem");
  const gtTuyChonMuaThemTableContainer = document.getElementById("gt-tuychonmuathem-table-container");
  if (gtTuyChonMuaThemSelect && gtTuyChonMuaThemTableContainer) {
    const handleTuyChonMuaThemChange = () => {
      if (gtTuyChonMuaThemSelect.value === "Có") {
        setVisible(gtTuyChonMuaThemTableContainer, true, "block");
        const tbody = document.getElementById("tuychonmuathem-tbody");
        if (tbody && tbody.children.length === 0) {
          this.addTuyChonMuaThemRow();
        }
      } else {
        setVisible(gtTuyChonMuaThemTableContainer, false);
      }
    };
    gtTuyChonMuaThemSelect.addEventListener("change", handleTuyChonMuaThemChange);
    this.handleTuyChonMuaThemChange = handleTuyChonMuaThemChange;
  }
  onById("btn-them-tuychonmuathem", "click", () => this.addTuyChonMuaThemRow());
  const gtPhanLoSelect = document.getElementById("gt-phanlo");
  if (gtPhanLoSelect && gtPhanLoTableContainer) {
    const handlePhanLoChange = () => {
      if (gtPhanLoSelect.value === "Có") {
        setVisible(gtPhanLoTableContainer, true, "block");
        const tbody = document.getElementById("phanlo-tbody");
        if (tbody && tbody.children.length === 0) {
          this.addPhanLoRow();
        }
      } else {
        setVisible(gtPhanLoTableContainer, false);
      }
    };
    gtPhanLoSelect.addEventListener("change", handlePhanLoChange);
    this.handlePhanLoChange = handlePhanLoChange;
  }
  onById("btn-them-phanlo", "click", () => this.addPhanLoRow());
  onById("btn-them-giahan", "click", () => this.addGiaHanRow());
  onById("btn-them-yeucaulamro", "click", () => this.addYeuCauLamRoRow());
  onById("btn-them-traloilamro", "click", () => this.addTraLoiLamRoRow());
  setupInlineExcelControls(this);
  const gtQuaMangSelect = document.getElementById("gt-quatmang");
  const gtTrongNuocSelect = document.getElementById("gt-trongnuocquocte");
  if (gtQuaMangSelect && gtTrongNuocSelect) {
    const handleQuaMangChange = () => {
      if (gtQuaMangSelect.value === "Qua mạng") {
        gtTrongNuocSelect.value = "Trong nước";
        setDisabled(gtTrongNuocSelect, true);
      } else {
        setDisabled(gtTrongNuocSelect, false);
      }
    };
    gtQuaMangSelect.addEventListener("change", handleQuaMangChange);
    this.handleQuaMangChange = handleQuaMangChange;
  }
  onById("form-chudautu", "submit", (e) => this.handleChuDauTuSubmit(e));
  onById("form-nhathau", "submit", (e) => this.handleNhaThauSubmit(e));
  onById("form-chuyengia", "submit", (e) => this.handleChuyenGiaSubmit(e));
  const formHopDong = document.getElementById("form-hopdong");
  if (formHopDong) {
    formHopDong.addEventListener("submit", (e) => this.handleHopDongSubmit(e));
  }
  document.querySelectorAll(".btn-import-excel").forEach((btn) => {
    if (btn._hasExcelListener) return;
    btn._hasExcelListener = true;
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-type");
      runWorkflow("triggerExcelImport", type);
    });
  });
  document.querySelectorAll(".btn-download-excel-template-direct").forEach((btn) => {
    if (btn._hasExcelListener) return;
    btn._hasExcelListener = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const type = btn.getAttribute("data-type");
      runWorkflow("triggerExcelTemplateDownload", type);
    });
  });
  document.querySelectorAll(".btn-import-excel-direct").forEach((btn) => {
    if (btn._hasExcelListener) return;
    btn._hasExcelListener = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const type = btn.getAttribute("data-type");
      runWorkflow("triggerExcelImport", type);
    });
  });
}
export function updatePackageFieldsVisibility(isReadOnly = false) {
  const trangThai = document.getElementById("gt-trangthai")?.value;
  const formGoiThau = document.getElementById("form-goithau");
  const originalStatus = formGoiThau?.getAttribute("data-original-status") || "";
  const htVal = document.getElementById("gt-hinhthuc")?.value || "";
  const gtTrangThai = document.getElementById("gt-trangthai");
  if (gtTrangThai) {
    const formGroup = gtTrangThai.closest(".form-group");
    if (htVal === "Chỉ định thầu rút gọn" || htVal === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
      setVisible(formGroup, false);
      setRequired(gtTrangThai, false);
    } else {
      setVisible(formGroup, true);
      setRequired(gtTrangThai, true);
    }
  }
  const fieldPolicy = this.model?.domainContract?.packageFieldPolicy || {};
  const statusOrder = Array.isArray(fieldPolicy.statusOrder) ? fieldPolicy.statusOrder : [];
  const originalIdx = statusOrder.indexOf(originalStatus);
  const statusSelect = document.getElementById("gt-trangthai");
  if (statusSelect) {
    if (statusOrder.length && statusSelect.querySelectorAll("option").length !== statusOrder.length) {
      const selectedStatus = statusSelect.value || trangThai;
      statusSelect.replaceChildren(...statusOrder.map((label) => {
        const option = document.createElement("option");
        option.value = label;
        option.textContent = label;
        option.selected = label === selectedStatus;
        return option;
      }));
    }
    statusSelect.querySelectorAll("option").forEach((opt) => {
      const optVal = opt.value;
      const optIdx = statusOrder.indexOf(optVal);
      if (originalIdx >= 0 && optIdx >= 0 && optIdx < originalIdx) {
        setDisabled(opt, true);
      } else {
        setDisabled(opt, false);
      }
    });
  }
  const fieldControlIds = {
    keHoachId: "gt-kehoachid", tenGoiThau: "gt-ten", giaGoiThau: "gt-gia",
    thoiGianThucHien: "gt-thoigian", linhVuc: "gt-linhvuc",
    hinhThucLuaChon: "gt-hinhthuc", phuongThucLuaChon: "gt-phuongthuc",
    quaMang: "gt-quatmang", trongNuocQuocTe: "gt-trongnuocquocte",
    tuyChonMuaThem: "gt-tuychonmuathem", phanLo: "gt-phanlo",
    nguonVon: "gt-nguonvon", loaiHopDong: "gt-loaihopdong"
  };
  const lockedFields = (fieldPolicy.lockedAfterInvitation || [])
    .map((field) => fieldControlIds[field]).filter(Boolean);
  const isLocked = isReadOnly ? false : originalIdx >= 1;
  lockedFields.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    const formGroup = input.closest(".form-group");
    if (isLocked) {
      setVisible(formGroup, false);
      setDisabled(input, true);
    } else {
      setDisabled(input, false);
      if (id === "gt-phuongthuc") {
        const lv = document.getElementById("gt-linhvuc")?.value;
        const ht2 = document.getElementById("gt-hinhthuc")?.value;
        if (lv === "Tư vấn" || ht2 === "Chào hàng cạnh tranh" || ht2 === "Chỉ định thầu rút gọn" || ht2 === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
          setDisabled(input, true);
        }
        initCustomSelect(id);
      }
      if (id === "gt-quatmang") {
        const ht2 = document.getElementById("gt-hinhthuc")?.value;
        if (ht2 === "Chỉ định thầu rút gọn" || ht2 === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
          setDisabled(input, true);
        }
        initCustomSelect(id);
      }
      const nonConditional = [
        "gt-kehoachid",
        "gt-ten",
        "gt-gia",
        "gt-thoigian",
        "gt-linhvuc",
        "gt-hinhthuc",
        "gt-quatmang",
        "gt-trongnuocquocte",
        "gt-nguonvon",
        "gt-loaihopdong",
        "gt-thoigiantochuc",
        "gt-thoigianbatdautochuc",
        "gt-tuychonmuathem",
        "gt-phanlo"
      ];
      if (nonConditional.includes(id) && formGroup) {
        setVisible(formGroup, true);
      }
    }
  });
  const tuyChonTable = document.getElementById("gt-tuychonmuathem-table-container");
  const phanLoTable = document.getElementById("gt-phanlo-table-container");
  if (isLocked) {
    setVisible(tuyChonTable, false);
    setVisible(phanLoTable, false);
  }
  const phuongThuc = document.getElementById("gt-phuongthuc")?.value || "";
  const is1G2T = phuongThuc === "Một giai đoạn hai túi hồ sơ";
  const isOpenedOrLaterStatus = ["Đã mở thầu", "Đang chấm thầu", "Đã có kết quả một phần", "Đã có kết quả", "Hủy thầu"].includes(trangThai);
  const fields = [
    { id: "gt-soquyetdinh", required: true, label: "Số QĐ phê duyệt" },
    { id: "gt-ngayquyetdinh", required: true, label: "Ngày QĐ phê duyệt" },
    { id: "gt-thoigiandangtai", required: true, label: "Thời gian đăng tải thông báo" },
    { id: "gt-thoigiandongthau", required: true, label: "Thời gian đóng thầu" },
    { id: "gt-thoigianmothau", required: isOpenedOrLaterStatus, label: is1G2T ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu" },
    { id: "gt-thoigianmoehsdxtc", required: is1G2T && isOpenedOrLaterStatus, label: "Thời gian mở E-HSĐXTC" }
  ];
  fields.forEach((f) => {
    const input = document.getElementById(f.id);
    if (!input) return;
    const formGroup = input.closest(".form-group");
    if (!formGroup) return;
    const label = formGroup.querySelector("label");
    if (htVal === "Chỉ định thầu rút gọn" || htVal === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
      if (["gt-soquyetdinh", "gt-ngayquyetdinh", "gt-thoigiandangtai", "gt-thoigiandongthau", "gt-thoigianmothau", "gt-thoigianmoehsdxtc"].includes(f.id)) {
        setVisible(formGroup, false);
        setRequired(input, false);
        return;
      }
    }
    if (trangThai === "Chuẩn bị") {
      setVisible(formGroup, false);
      setRequired(input, false);
      if (label) {
        setDynamicFieldLabel(label, f.label);
      }
    } else if (trangThai === "Đang mời thầu" && (f.id === "gt-thoigianmothau" || f.id === "gt-thoigianmoehsdxtc")) {
      setVisible(formGroup, false);
      setRequired(input, false);
    } else if (f.id === "gt-thoigianmoehsdxtc" && !is1G2T) {
      setVisible(formGroup, false);
      setRequired(input, false);
    } else {
      setVisible(formGroup, true);
      if (f.required) {
        setRequired(input, true);
        setDynamicFieldLabel(label, f.label, true);
      } else {
        setRequired(input, false);
        if (label) {
          setDynamicFieldLabel(label, f.label);
        }
      }
    }
  });
  const maInput = document.getElementById("gt-ma");
  if (maInput) {
    const formGroup = maInput.closest(".form-group");
    const label = formGroup?.querySelector("label");
    if (trangThai === "Chuẩn bị") {
      setRequired(maInput, false);
      if (label) label.innerHTML = trustedHTML("Mã thông báo mời thầu");
    } else {
      setRequired(maInput, true);
      if (label && !label.querySelector(".required")) {
        label.innerHTML = trustedHTML('Mã thông báo mời thầu <span class="required">*</span>');
      }
    }
  }
  const giaHanContainer = document.getElementById("gt-giahan-container");
  setVisible(giaHanContainer, trangThai !== "Chuẩn bị");
  const yeuCauLamRoContainer = document.getElementById("gt-yeucaulamro-container");
  const traLoiLamRoContainer = document.getElementById("gt-traloilamro-container");
  const showClarifications = trangThai !== "Chuẩn bị";
  setVisible(yeuCauLamRoContainer, showClarifications);
  setVisible(traLoiLamRoContainer, showClarifications);
  const linhVuc = document.getElementById("gt-linhvuc")?.value || "";
  const phanLo = document.getElementById("gt-phanlo")?.value || "";
  this.recalculateTotalLotPrice();
  const mainBaoDamInput = document.getElementById("gt-giatribaomothau");
  const hieulucHsdtInput = document.getElementById("gt-hieuluchsdt");
  const containerBaoDam = document.getElementById("gt-giatribaomothau-container");
  const containerHsdt = document.getElementById("gt-hieuluchsdt-container");
  const containerHlBaoDam = document.getElementById("gt-hieuluchbaomothau-container");
  const containerTyleBaoDamHd = document.getElementById("gt-tylebaodamhopdong-container");
  const tyleBaoDamHdInput = document.getElementById("gt-tylebaodamhopdong");
  const thBaoDam = document.getElementById("th-baodam-phanlo");
  const ht = document.getElementById("gt-hinhthuc")?.value || "";
  const noBidSecurity = linhVuc === "Tư vấn" || ht === "Chỉ định thầu rút gọn" || ht === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
  const showTyleBaoDamHd = ht !== "Chỉ định thầu rút gọn" && ht !== "Lựa chọn nhà thầu trong trường hợp đặc biệt" && linhVuc !== "Tư vấn";
  setVisible(containerTyleBaoDamHd, showTyleBaoDamHd);
  if (tyleBaoDamHdInput) {
    setDisabled(tyleBaoDamHdInput, showTyleBaoDamHd ? isReadOnly : true);
    if (!showTyleBaoDamHd) {
      tyleBaoDamHdInput.value = "";
    }
  }
  if (noBidSecurity) {
    setVisible(containerBaoDam, false);
    setVisible(containerHlBaoDam, false);
    setRequired(mainBaoDamInput, false);
    setVisible(thBaoDam, false);
    document.querySelectorAll(".col-baodam-phanlo-cell").forEach((cell) => {
      setVisible(cell, false);
      const input = cell.querySelector("input");
      setRequired(input, false);
    });
  } else {
    setVisible(containerBaoDam, true);
    setVisible(containerHlBaoDam, trangThai !== "Chuẩn bị");
    const isMoiThauOrLater = trangThai !== "Chuẩn bị";
    setRequired(mainBaoDamInput, isMoiThauOrLater);
    if (phanLo === "Có") {
      if (mainBaoDamInput) {
        setReadonlyVisual(mainBaoDamInput, true);
        setRequired(mainBaoDamInput, false);
      }
      setVisible(thBaoDam, true, "table-cell");
      document.querySelectorAll(".col-baodam-phanlo-cell").forEach((cell) => {
        setVisible(cell, true, "");
        const input = cell.querySelector("input");
        setRequired(input, isMoiThauOrLater);
      });
      this.recalculateTotalLotSecurities();
    } else {
      if (mainBaoDamInput) {
        setReadonlyVisual(mainBaoDamInput, false);
      }
      setVisible(thBaoDam, false);
      document.querySelectorAll(".col-baodam-phanlo-cell").forEach((cell) => {
        setVisible(cell, false);
        const input = cell.querySelector("input");
        setRequired(input, false);
      });
    }
  }
  const showHsdtDuration = trangThai !== "Chuẩn bị";
  setVisible(containerHsdt, showHsdtDuration);
  setRequired(hieulucHsdtInput, showHsdtDuration);
  const gtGoiThauThuocContainer = document.getElementById("gt-goithauthuoc-container");
  if (gtGoiThauThuocContainer) {
    if (isLocked) {
      setVisible(gtGoiThauThuocContainer, false);
      gtGoiThauThuocContainer.querySelectorAll('input[name="gt-goithauthuoc"]').forEach((r) => setDisabled(r, true));
    } else {
      setVisible(gtGoiThauThuocContainer, linhVuc === "Hàng hóa");
      gtGoiThauThuocContainer.querySelectorAll('input[name="gt-goithauthuoc"]').forEach((r) => setDisabled(r, isReadOnly));
    }
  }
}
export function recalculateTotalLotSecurities() {
  const phanLo = document.getElementById("gt-phanlo")?.value;
  const linhVuc = document.getElementById("gt-linhvuc")?.value;
  const ht = document.getElementById("gt-hinhthuc")?.value;
  if (phanLo === "Có" && linhVuc !== "Tư vấn" && ht !== "Chỉ định thầu rút gọn" && ht !== "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
    const sum = this.model.sumVND(Array.from(
      document.querySelectorAll("#phanlo-tbody .pl-baodam-input"),
      (input) => input.value
    ));
    const mainBaoDamInput = document.getElementById("gt-giatribaomothau");
    if (mainBaoDamInput) {
      mainBaoDamInput.value = this.model.formatVND(sum);
    }
  }
}
export function recalculateTotalLotPrice() {
  const phanLo = document.getElementById("gt-phanlo")?.value;
  const packagePriceInput = document.getElementById("gt-gia");
  if (!packagePriceInput) return 0;
  setReadonlyVisual(packagePriceInput, phanLo === "Có");
  const derivedHint = document.getElementById("gt-gia-derived-hint");
  if (derivedHint) derivedHint.hidden = phanLo !== "Có";
  if (phanLo !== "Có") {
    return this.model.parseVND(packagePriceInput.value) || 0;
  }
  const total = derivePackagePrice({
    phanLo,
    phanLoList: Array.from(
      document.querySelectorAll("#phanlo-tbody .pl-price-input"),
      (input) => ({ giaTriPhanLo: input.value })
    )
  });
  packagePriceInput.value = this.model.formatVND(total);
  return total;
}
export function updateAwardedContractorUI(defaultDataList = null) {
  const trangThai = document.getElementById("gt-trangthai")?.value;
  const phanLo = document.getElementById("gt-phanlo")?.value;
  const condBlock = document.getElementById("conditional-awarded-contractor");
  const singleContainer = document.getElementById("awarded-single-container");
  const multiContainer = document.getElementById("awarded-multi-container");
  const requiredSingleFields = [
    document.getElementById("gt-nhathautrungthauid"),
    document.getElementById("gt-giatrungthau"),
    document.getElementById("gt-thoigian-goithau"),
    document.getElementById("gt-thoigian-hopdong")
  ];
  if (!condBlock) return;
  if (trangThai !== "Đã có kết quả") {
    setVisible(condBlock, false);
    requiredSingleFields.forEach((input) => setRequired(input, false));
    return;
  }
  setVisible(condBlock, true, "block");
  if (phanLo === "Có") {
    setVisible(singleContainer, false);
    setVisible(multiContainer, true, "block");
    requiredSingleFields.forEach((input) => setRequired(input, false));
    const tbody = document.getElementById("awarded-phanlo-tbody");
    if (tbody) {
      const phanLoList = this._collectPhanLoRows();
      const currentInputsMap = {};
      tbody.querySelectorAll("tr").forEach((tr) => {
        const ten = tr.cells[0]?.textContent;
        if (ten) {
          currentInputsMap[ten] = {
            nhaThauTrungThauId: tr.querySelector(".awarded-pl-nhathau")?.value || "",
            giaTrungThau: this.model.parseVND(tr.querySelector(".awarded-pl-gia")?.value || ""),
            thoiGianGoiThau: tr.querySelector(".awarded-pl-tggoithau")?.value || "",
            thoiGianHopDong: tr.querySelector(".awarded-pl-tghopdong")?.value || ""
          };
        }
      });
      tbody.innerHTML = trustedHTML("");
      if (phanLoList.length === 0) {
        tbody.innerHTML = trustedHTML(`<tr><td colspan="5" class="bf-s-45a963221a">Vui lòng thêm danh sách phần lô ở trên trước.</td></tr>`);
        return;
      }
      const goiThauId = document.getElementById("form-goithau-id")?.value;
      let filteredBids = [];
      if (goiThauId) {
        filteredBids = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(goiThauId));
      }
      phanLoList.forEach((pl) => {
        let lotBids = filteredBids.filter((b) => String(b.maPhanLo) === String(pl.maPhanLo) || String(b.tenPhanLo) === String(pl.tenPhanLo));
        if (lotBids.length === 0) {
          lotBids = filteredBids;
        }
        const uniqueBiddersMap = /* @__PURE__ */ new Map();
        lotBids.forEach((b) => {
          if (b.nhaThauId) {
            const key = String(b.nhaThauId);
            if (!uniqueBiddersMap.has(key) || b.tenNhaThau && !uniqueBiddersMap.get(key).tenNhaThau) {
              uniqueBiddersMap.set(key, b);
            }
          }
        });
        const uniqueBidders = Array.from(uniqueBiddersMap.values());
        const nhathauOptions = uniqueBidders.length > 0
          ? uniqueBidders.map((b) => `<option value="${escapeHtml(b.nhaThauId)}">${escapeHtml(b.tenNhaThau)}</option>`).join("")
          : this.model.state.nhathau.map((n) => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.tenNhaThau)}</option>`).join("");
        const row = document.createElement("tr");
        let matchedData = null;
        if (defaultDataList && defaultDataList.length > 0) {
          matchedData = defaultDataList.find((d) => d.tenPhanLo === pl.tenPhanLo);
        }
        if (!matchedData && currentInputsMap[pl.tenPhanLo]) {
          matchedData = currentInputsMap[pl.tenPhanLo];
        }
        const selectedNt = matchedData?.nhaThauTrungThauId || "";
        const giaTri = matchedData?.giaTrungThau ? this.model.formatVND(matchedData.giaTrungThau) : "";
        const tgGoiThau = matchedData?.thoiGianGoiThau || "";
        const tgHopDong = matchedData?.thoiGianHopDong || "";
        row.innerHTML = trustedHTML(`
                    <td class="bf-s-9595fa5530">${escapeHtml(pl.tenPhanLo)}</td>
                    <td>
                        <select class="awarded-pl-nhathau bf-s-80504d4030" required>
                            <option value="">-- Chọn Nhà thầu --</option>
                            ${nhathauOptions}
                        </select>
                    </td>
                    <td>
                        <input type="text" class="awarded-pl-gia input-gia bf-s-80504d4030" required value="${escapeHtml(giaTri)}" placeholder="Nhập giá trúng">
                    </td>
                    <td>
                        <input type="text" class="awarded-pl-tggoithau bf-s-80504d4030" required value="${escapeHtml(tgGoiThau)}" placeholder="Ví dụ: 90 ngày">
                    </td>
                    <td>
                        <input type="text" class="awarded-pl-tghopdong bf-s-80504d4030" required value="${escapeHtml(tgHopDong)}" placeholder="Ví dụ: 90 ngày">
                    </td>
                `);
        const sel = row.querySelector(".awarded-pl-nhathau");
        if (sel) sel.value = selectedNt;
        const giaInput = row.querySelector(".awarded-pl-gia");
        bindCurrencyElement(giaInput, (value) => this.model.formatVND(value));
        tbody.appendChild(row);
      });
    }
  } else {
    setVisible(singleContainer, true, "block");
    setVisible(multiContainer, false);
    requiredSingleFields.forEach((input) => setRequired(input, true));
  }
}
export function _collectAwardedPhanLoRows() {
  const phanLo = document.getElementById("gt-phanlo")?.value;
  const trangThai = document.getElementById("gt-trangthai")?.value;
  if (phanLo !== "Có" || trangThai !== "Đã có kết quả") return [];
  const tbody = document.getElementById("awarded-phanlo-tbody");
  if (!tbody) return [];
  const rows = [];
  tbody.querySelectorAll("tr").forEach((tr) => {
    const cells = tr.querySelectorAll("td");
    if (cells.length < 2) return;
    const tenPhanLo = cells[0].textContent;
    const nhaThauTrungThauId = tr.querySelector(".awarded-pl-nhathau")?.value || "";
    const giaTrungThau = this.model.parseVND(tr.querySelector(".awarded-pl-gia")?.value || "");
    const thoiGianGoiThau = tr.querySelector(".awarded-pl-tggoithau")?.value.trim() || "";
    const thoiGianHopDong = tr.querySelector(".awarded-pl-tghopdong")?.value.trim() || "";
    if (nhaThauTrungThauId || giaTrungThau > 0 || thoiGianGoiThau || thoiGianHopDong) {
      rows.push({
        tenPhanLo,
        nhaThauTrungThauId,
        giaTrungThau,
        thoiGianGoiThau,
        thoiGianHopDong
      });
    }
  });
  return rows;
}
