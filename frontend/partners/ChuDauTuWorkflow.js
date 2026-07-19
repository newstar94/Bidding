import { trustedHTML } from "../shared/trustedTypes.js";
﻿import { normalizeVietnamTaxCode } from "../app/domUtils.js";
import { bindPartnerTaxCodeLookup, findStoredPartnerLookupData } from "./partnerTaxLookup.js";
import { persistAndSync } from "../shared/MutationService.js";
import { createInitialVersion, createNextVersion, getNextVersion, preserveRowVersion, rememberSelectedVersion } from "../shared/VersionedEntityService.js";
import { clearFormValidation } from "../shared/FormBinder.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { getCurrentDateYmd } from "../shared/formatters.js";
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
export async function deleteChuDauTu(id) {
  const hasPlans = this.model.state.kehoach.some((k) => k.chuDauTuId === id);
  if (hasPlans) {
    await this.view.customAlert(
      "Không thể xóa",
      "Không thể xóa chủ đầu tư này vì có Kế hoạch Lựa chọn nhà thầu đang thuộc quyền quản lý của họ.",
      "x-circle"
    );
    return;
  }
  const confirmed = await this.view.customConfirm(
    "Xác nhận xóa",
    "Bạn có chắc chắn muốn xóa chủ đầu tư này?",
    "trash-2"
  );
  if (confirmed) {
    this.model.state.chudautu = this.model.state.chudautu.filter((c) => c.id !== id);
    this.model.markDeleted("chudautu", id);
    await persistAndSync(this, "chudautu", {
      afterPersist: () => this.view.renderChuDauTuTable()
    });
  }
}
export async function editChuDauTu(id) {
  if (!document.getElementById("modal-chudautu")) {
    await this.ensureLazyModal?.("modal-chudautu");
  }
  const form = document.getElementById("form-chudautu");
  clearFormValidation(form);
  if (id) {
    this.switchTab("chudautu", "chinhsua", true);
    document.getElementById("modal-chudautu-title").textContent = "Cập nhật Chủ đầu tư";
    const cdt = this.model.state.chudautu.find((c) => c.id === id);
    await loadPartnerFormData(document, form, cdt, PARTNER_FORM_CONFIGS.chudautu, {
      formatDate: (value) => this.model.formatForDateInput(value),
      initAddressDropdowns: (...args) => this.initAddressDropdowns(...args)
    });
  } else {
    this.switchTab("chudautu", "taomoi", true);
    document.getElementById("modal-chudautu-title").textContent = "Thêm Chủ đầu tư mới";
    await resetPartnerFormData(document, form, PARTNER_FORM_CONFIGS.chudautu, {
      effectiveDate: this.model.formatForDateInput(todayYmd()),
      initAddressDropdowns: (...args) => this.initAddressDropdowns(...args)
    });
    document.getElementById("cdt-coquanchuquan").value = "";
  }
  const lookupHandlers = createPartnerLookupHandlers({
    form,
    config: PARTNER_FORM_CONFIGS.chudautu.lookup
  });
  bindPartnerTaxCodeLookup({
    codeInput: document.getElementById("cdt-ma"),
    taxInput: document.getElementById("cdt-mst"),
    partnerRole: "CDT",
    resolveLocalData: (lookup) => findStoredPartnerLookupData(this.model.getLatestChuDauTu(), lookup),
    clearLookupData: lookupHandlers.clearLookupData,
    applyLookupData: lookupHandlers.applyLookupData
  });
  this.view.openModal("modal-chudautu");
}
export async function handleChuDauTuSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-chudautu");
  const maSoThueInput = document.getElementById("cdt-mst");
  maSoThueInput.value = normalizeVietnamTaxCode(maSoThueInput.value);
  if (!this.view.validateForm(form)) return;
  const id = document.getElementById("form-chudautu-id").value;
  let data = collectPartnerFormData(document, form, PARTNER_FORM_CONFIGS.chudautu, {
    convertDate: (value) => this.model.convertDMYToYMD(value),
    fallbackDate: todayYmd()
  });
  const validationErrors = validatePartnerRecord(data, this.model.state.chudautu, id, PARTNER_FORM_CONFIGS.chudautu);
  if (!applyPartnerValidationErrors(document, validationErrors, (control) => this.view.focusInvalidControl(control))) return;
  if (id) {
    const currentCdt = this.model.state.chudautu.find((c) => c.id === id);
    const nextVersion = getNextVersion(this.model.state.chudautu, currentCdt);
    const isNewVersion = await this.view.customConfirm(
      "Lưu Chủ đầu tư",
      `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${Number(nextVersion)}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentCdt.phienBan || 0)})`,
      "save"
    );
    if (isNewVersion) {
      const timestamp = this.model.getCurrentDateTimeString();
      data = createNextVersion(this.model.state.chudautu, currentCdt, data, {
        id: generateRecordId("chudautu"), timestamp
      });
      if (data.ngayApDung === (currentCdt.ngayApDung || String(currentCdt.createdAt || "").slice(0, 10))) {
        data.ngayApDung = todayYmd();
      }
      this.model.state.chudautu.push(data);
    } else {
      data.id = id;
      data.rootId = currentCdt.rootId || currentCdt.id;
      data.phienBan = currentCdt.phienBan || "00";
      data.isLatest = currentCdt.isLatest !== void 0 ? currentCdt.isLatest : 1;
      data.createdAt = currentCdt.createdAt || this.model.getCurrentDateTimeString();
      data.updatedAt = this.model.getCurrentDateTimeString();
      preserveRowVersion(data, currentCdt);
      const idx = this.model.state.chudautu.findIndex((c) => c.id === id);
      this.model.state.chudautu[idx] = data;
    }
  } else {
    const newId = generateRecordId("chudautu");
    data = createInitialVersion(data, { id: newId, timestamp: this.model.getCurrentDateTimeString() });
    this.model.state.chudautu.push(data);
  }
  rememberSelectedVersion(this.model.state, "selectedChuDauTuVersion", data);
  // Persisting also queues the record for server sync, so it must finish
  // before autoSync builds its payload.
  await persistAndSync(this, "chudautu", {
    afterPersist: async () => {
      await this.closeModal("modal-chudautu");
      this.view.renderChuDauTuTable();
    }
  });
  const planModal = document.getElementById("modal-kehoach");
  if (planModal && planModal.classList.contains("active")) {
    const cdtSelect = document.getElementById("kh-chudautuid");
    if (cdtSelect) {
      cdtSelect.innerHTML = trustedHTML('<option value="">-- Chọn Chủ đầu tư --</option>' + this.model.getLatestChuDauTu().map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.tenChuDauTu)}</option>`).join("") + '<option value="__NEW_INVESTOR__" class="bf-s-5762556293">+ Thêm chủ đầu tư mới</option>');
      cdtSelect.value = data.id;
    }
  }
  const contractModal = document.getElementById("modal-hopdong");
  if (contractModal && contractModal.classList.contains("active")) {
    const cdtSelect = document.getElementById("hd-chudautuid");
    if (cdtSelect) {
      cdtSelect.innerHTML = trustedHTML('<option value="">-- Chọn Chủ đầu tư --</option>' + this.model.getLatestChuDauTu().map((c) => `<option value="${escapeHtml(c.id)}" data-search="${escapeHtml(`${c.maChuDauTu || ""} ${c.tenChuDauTu || ""}`)}">${escapeHtml(c.tenChuDauTu || "")}</option>`).join("") + '<option value="__NEW_INVESTOR__" class="bf-s-5762556293">+ Thêm chủ đầu tư mới</option>');
      cdtSelect.value = data.id;
      cdtSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}
import { generateRecordId } from "../shared/idUtils.js";
