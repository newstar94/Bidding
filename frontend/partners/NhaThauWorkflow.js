import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
﻿import { normalizeVietnamTaxCode } from "../app/domUtils.js";
import { bindPartnerTaxCodeLookup, findStoredPartnerLookupData } from "./partnerTaxLookup.js";
import { persistAndSync, refreshRecordBeforeDelete } from "../shared/MutationService.js";
import { clearFormValidation } from "../shared/FormBinder.js";
import { escapeHtml, safeImageSrc } from "../shared/view_helpers.js";
import {
  createInitialVersion,
  createNextVersion,
  getNextVersion,
  getVersionFamily,
  preserveRowVersion,
  rememberSelectedVersion,
  removeAllVersions,
  removeLatestVersion,
} from "../shared/VersionedEntityService.js";
import { getCurrentDateYmd } from "../shared/formatters.js";
import { setContractorViewOnly } from "../shared/runtimeState.js";
import { canUploadWorkspaceAssets } from "../auth/accessContext.js";
import { generateRecordId } from "../shared/idUtils.js";
import {
  applyPartnerValidationErrors,
  collectPartnerFormData,
  createPartnerLookupHandlers,
  loadPartnerFormData,
  PARTNER_FORM_CONFIGS,
  resetPartnerFormData,
  validatePartnerRecord
} from "./PartnerFormController.js";
const todayYmd = getCurrentDateYmd;
const safeStampSrc = (value) => {
  return safeImageSrc(value);
};
const setNhaThauStampPreview = (value, isReadOnly = false, cacheKey = "", canUpload = true) => {
  const uploadZone = document.getElementById("nt-upload-zone-dau");
  const previewContainer = document.getElementById("nt-preview-container-dau");
  const previewImg = document.getElementById("nt-anh-preview-dau");
  const removeBtn = document.getElementById("btn-nt-remove-file-dau");
  const fileInput = document.getElementById("nt-anhdau");
  const src = safeStampSrc(value);
  if (previewImg) previewImg.src = safeImageSrc(src, cacheKey);
  if (previewContainer) setRuntimeStyle(previewContainer, "display", src ? "flex" : "none");
  if (uploadZone) setRuntimeStyle(uploadZone, "display", src || isReadOnly ? "none" : "flex");
  if (uploadZone) {
    uploadZone.classList.toggle("is-upload-disabled", !canUpload);
    uploadZone.setAttribute("aria-disabled", String(!canUpload));
    uploadZone.title = canUpload
      ? "Tải lên ảnh dấu"
      : "Chỉ Quản lý của tổ chức được tải lên ảnh dấu";
  }
  if (fileInput) fileInput.disabled = isReadOnly || !canUpload;
  if (removeBtn) setRuntimeStyle(removeBtn, "display", isReadOnly || !canUpload ? "none" : "");
};
export async function deleteNhaThau(id) {
  const nt = await refreshRecordBeforeDelete(this, "nhathau", id);
  if (!nt) return;
  const family = getVersionFamily(this.model.state.nhathau, nt);
  const familyIds = new Set(family.map((item) => String(item.id)));
  const wonPackages = this.model.state.goithau.filter((gt) => familyIds.has(String(gt.nhaThauTrungThauId)));
  if (wonPackages.length > 0) {
    const codes = wonPackages.map((gt) => gt.maGoiThau).join(", ");
    await this.view.customAlert(
      "Không thể xóa",
      `Không thể xóa nhà thầu này vì họ đã được công bố trúng thầu tại gói thầu: ${codes}.`,
      "x-circle"
    );
    return;
  }
  const jvMemberIn = (this.model.state.thongtinmothau || []).filter((b) => {
    const members = b.thanhVienLienDanh || [];
    return members.some(
      (m) => nt.maSoThue && String(m.maSoThue).toLowerCase().trim() === String(nt.maSoThue).toLowerCase().trim() || nt.tenNhaThau && String(m.tenNhaThau).toLowerCase().trim() === String(nt.tenNhaThau).toLowerCase().trim()
    );
  });
  if (jvMemberIn.length > 0) {
    const wonJvPackages = [...new Set(jvMemberIn.map((b) => {
      const gt = this.model.state.goithau.find((g) => g.id === b.goiThauId);
      return gt ? gt.maGoiThau || b.goiThauId : b.goiThauId;
    }))].join(", ");
    await this.view.customAlert(
      "Không thể xóa",
      `Không thể xóa nhà thầu này vì họ là thành viên liên danh trong hồ sơ mở thầu của gói thầu: ${wonJvPackages}.`,
      "x-circle"
    );
    return;
  }
  const inContracts = (this.model.state.hopdong || []).filter((h) => familyIds.has(String(h.nhaThauId)));
  if (inContracts.length > 0) {
    const contractNos = inContracts.map((h) => h.soHopDong || h.tenHopDong || h.id).join(", ");
    await this.view.customAlert(
      "Không thể xóa",
      `Không thể xóa nhà thầu này vì họ đang liên kết với hợp đồng: ${contractNos}.`,
      "x-circle"
    );
    return;
  }
  const choice = family.length >= 2
    ? await this.view.customVersionDeleteChoice(
      "Xác nhận xóa",
      `Nhà thầu "${nt.tenNhaThau || nt.maNhaThau || "Chưa nhập tên"}" có ${family.length} phiên bản. Vui lòng chọn cách thức xóa:`,
      "Xóa phiên bản gần nhất",
      "Xóa toàn bộ",
    )
    : await this.view.customConfirm(
      "Xác nhận xóa",
      "Bạn có chắc chắn muốn xóa thông tin nhà thầu này?",
      "trash-2",
    ) ? 2 : null;
  if (choice === null) return;
  const result = choice === 1
    ? removeLatestVersion(this.model.state.nhathau, nt)
    : removeAllVersions(this.model.state.nhathau, nt);
  this.model.state.nhathau = result.records;
  this.model.markDeleted("nhathau", result.removed.map((item) => item.id));
  await persistAndSync(this, "nhathau", {
    afterPersist: () => this.view.renderNhaThauTable()
  });
}
export async function editNhaThau(id, isReadOnly = false) {
  if (!document.getElementById("modal-nhathau")) {
    await this.ensureLazyModal?.("modal-nhathau");
  }
  try {
    const form = document.getElementById("form-nhathau");
    if (!form) throw new Error("Không tìm thấy form nhập nhà thầu (form-nhathau)");
    clearFormValidation(form);
    const canUploadAssets = canUploadWorkspaceAssets(
      this.model.state.activeuser || {},
      this.model.state.activerole,
    );
    const inputs = form.querySelectorAll("input, select, textarea");
    inputs.forEach((inp) => {
      inp.disabled = isReadOnly;
      if (inp.tagName === "INPUT") {
        inp.readOnly = isReadOnly;
      }
    });
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      setRuntimeStyle(submitBtn, "display", isReadOnly ? "none" : "");
    }
    const cancelBtn = form.querySelector('button[data-close="modal-nhathau"]');
    if (cancelBtn) {
      cancelBtn.textContent = isReadOnly ? "Đóng" : "Hủy";
    }
    if (id) {
      if (isReadOnly) {
        setContractorViewOnly(true);
      } else {
        setContractorViewOnly(false);
        this.switchTab("nhathau", "chinhsua", true);
      }
      const titleEl = document.getElementById("modal-nhathau-title");
      if (titleEl) titleEl.textContent = isReadOnly ? "Thông tin Nhà thầu (Chỉ xem)" : "Cập nhật Nhà thầu";
      const nt = this.model.state.nhathau.find((n) => n.id === id);
      if (!nt) throw new Error("Không tìm thấy dữ liệu nhà thầu với ID " + id);
      await loadPartnerFormData(document, form, nt, PARTNER_FORM_CONFIGS.nhathau, {
        formatDate: (value) => this.model.formatForDateInput(value),
        initAddressDropdowns: (...args) => this.initAddressDropdowns(...args),
        isReadOnly
      });
      if (isReadOnly) {
        if (document.getElementById("nt-tinh")) document.getElementById("nt-tinh").disabled = true;
        if (document.getElementById("nt-xa")) document.getElementById("nt-xa").disabled = true;
      }
      this.tempNhaThauStampBase64 = safeStampSrc(nt.anhDau);
      setNhaThauStampPreview(
        this.tempNhaThauStampBase64,
        isReadOnly,
        nt.updatedAt || nt.createdAt,
        canUploadAssets,
      );
    } else {
      setContractorViewOnly(false);
      this.switchTab("nhathau", "taomoi", true);
      const titleEl = document.getElementById("modal-nhathau-title");
      if (titleEl) titleEl.textContent = "Thêm Nhà thầu mới";
      await resetPartnerFormData(document, form, PARTNER_FORM_CONFIGS.nhathau, {
        effectiveDate: this.model.formatForDateInput(todayYmd()),
        initAddressDropdowns: (...args) => this.initAddressDropdowns(...args)
      });
      this.tempNhaThauStampBase64 = "";
      setNhaThauStampPreview("", false, "", canUploadAssets);
    }
    const partnerCodeInput = document.getElementById("nt-ma");
    const partnerTaxInput = document.getElementById("nt-mst");
    partnerCodeInput?.__bfPartnerTaxLookupCleanup?.();
    if (!isReadOnly) {
      const lookupHandlers = createPartnerLookupHandlers({
        form,
        config: PARTNER_FORM_CONFIGS.nhathau.lookup
      });
      bindPartnerTaxCodeLookup({
        codeInput: partnerCodeInput,
        taxInput: partnerTaxInput,
        partnerRole: "NT",
        resolveLocalData: (lookup) => findStoredPartnerLookupData(this.model.getLatestNhaThau(), lookup),
        clearLookupData: lookupHandlers.clearLookupData,
        applyLookupData: lookupHandlers.applyLookupData
      });
    }
    this.view.openModal("modal-nhathau");
  } catch (err) {
    console.error("editNhaThau failed: ", err);
    if (this.view && typeof this.view.customAlert === "function") {
      this.view.customAlert("Lỗi giao diện", "Không thể mở khung nhập nhà thầu: " + err.message, "x-circle");
    } else {
      this.view.customAlert("Lỗi giao diện", "Lỗi giao diện: " + err.message, "x-circle");
    }
  }
}
export async function handleNhaThauSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-nhathau");
  const maNhaThauInput = document.getElementById("nt-ma");
  const maSoThueInput = document.getElementById("nt-mst");
  maSoThueInput.value = normalizeVietnamTaxCode(maSoThueInput.value);
  if (!this.view.validateForm(form)) return;
  const id = document.getElementById("form-nhathau-id").value;
  const maNhaThau = maNhaThauInput.value.trim();
  const partnerData = collectPartnerFormData(document, form, PARTNER_FORM_CONFIGS.nhathau, {
    convertDate: (value) => this.model.convertDMYToYMD(value),
    fallbackDate: todayYmd()
  });
  const validationErrors = validatePartnerRecord(partnerData, this.model.state.nhathau, id, PARTNER_FORM_CONFIGS.nhathau);
  if (!applyPartnerValidationErrors(document, validationErrors, (control) => this.view.focusInvalidControl(control))) return;
  const currentNtForStamp = id ? this.model.state.nhathau.find((n) => n.id === id) : null;
  const stampValue = safeStampSrc(this.tempNhaThauStampBase64);
  if (
    stampValue.startsWith("data:image/")
    && !canUploadWorkspaceAssets(
      this.model.state.activeuser || {},
      this.model.state.activerole,
    )
  ) {
    await this.view.customAlert(
      "Từ chối truy cập",
      "Chỉ Quản lý của tổ chức được tải lên ảnh dấu.",
      "lock",
    );
    return;
  }
  const stampIsNewUpload = stampValue.startsWith("data:image/");
  const stampExt = stampValue ? this.model.getFileExtensionFromBase64(stampValue) : "";
  let data = {
    ...partnerData,
    loaiNhaThau: "Độc lập",
    anhDau: stampValue,
    tenAnhDau: stampValue
      ? stampIsNewUpload
        ? `DAU_${maNhaThau || "NHA_THAU"}.${stampExt}`
        : currentNtForStamp?.tenAnhDau || `DAU_${maNhaThau || "NHA_THAU"}.${stampExt}`
      : ""
  };
  if (id) {
    const currentNt = this.model.state.nhathau.find((n) => n.id === id);
    const nextVersion = getNextVersion(this.model.state.nhathau, currentNt);
    const isNewVersion = await this.view.customConfirm(
      "Lưu Nhà thầu",
      `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${Number(nextVersion)}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentNt.phienBan || 0)})`,
      "save"
    );
    if (isNewVersion) {
      const timestamp = this.model.getCurrentDateTimeString();
      data = createNextVersion(this.model.state.nhathau, currentNt, data, {
        id: generateRecordId("nhathau"), timestamp
      });
      if (data.ngayApDung === (currentNt.ngayApDung || String(currentNt.createdAt || "").slice(0, 10))) {
        data.ngayApDung = todayYmd();
      }
      this.model.state.nhathau.push(data);
    } else {
      data.id = id;
      data.rootId = currentNt.rootId || currentNt.id;
      data.phienBan = currentNt.phienBan || "00";
      data.isLatest = currentNt.isLatest !== void 0 ? currentNt.isLatest : 1;
      data.createdAt = currentNt.createdAt || this.model.getCurrentDateTimeString();
      data.updatedAt = this.model.getCurrentDateTimeString();
      preserveRowVersion(data, currentNt);
      const idx = this.model.state.nhathau.findIndex((n) => n.id === id);
      this.model.state.nhathau[idx] = data;
    }
  } else {
    const newId = generateRecordId("nhathau");
    data = createInitialVersion(data, { id: newId, timestamp: this.model.getCurrentDateTimeString() });
    this.model.state.nhathau.push(data);
  }
  rememberSelectedVersion(this.model.state, "selectedNhaThauVersion", data);
  // Persisting also queues the record for server sync, so it must finish
  // before autoSync builds its payload.
  await persistAndSync(this, "nhathau", {
    afterPersist: async () => {
      await this.closeModal("modal-nhathau");
      this.view.renderNhaThauTable();
    }
  });
  const contractModal = document.getElementById("modal-hopdong");
  if (contractModal && contractModal.classList.contains("active")) {
    const ntSelect = document.getElementById("hd-nhathauid");
    if (ntSelect) {
      ntSelect.innerHTML = trustedHTML('<option value="">-- Chọn Nhà thầu --</option>' + this.model.getLatestNhaThau().map((n) => `<option value="${escapeHtml(n.id)}" data-search="${escapeHtml(`${n.maNhaThau || ""} ${n.tenNhaThau || ""}`)}">${escapeHtml(n.tenNhaThau || "")}</option>`).join("") + '<option value="__NEW_CONTRACTOR__" class="bf-s-5762556293">+ Thêm nhà thầu mới</option>');
      ntSelect.value = data.id;
      ntSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}
