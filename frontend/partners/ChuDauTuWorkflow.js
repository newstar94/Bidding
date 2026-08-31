import { trustedHTML } from "../shared/trustedTypes.js";
import { normalizeVietnamTaxCode } from "../app/domUtils.js";
import { bindPartnerTaxCodeLookup, findStoredPartnerLookupData } from "./partnerTaxLookup.js";
import {
  mutatePersistAndSync,
  persistAndSync,
  refreshRecordBeforeDelete,
} from "../shared/MutationService.js";
import {
  createNextVersion,
  getNextVersion,
  getVersionFamily,
  preserveRowVersion,
  rememberSelectedVersion,
  removeAllVersions,
  removeLatestVersion,
} from "../shared/VersionedEntityService.js";
import { clearFormValidation } from "../shared/FormBinder.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { getCurrentDateYmd, getVersionLabel } from "../shared/formatters.js";
import {
  applyPartnerValidationErrors,
  collectPartnerFormData,
  createPartnerLookupHandlers,
  loadPartnerFormData,
  PARTNER_FORM_CONFIGS,
  buildInitialPartnerVersion,
  resetPartnerFormData,
  validatePartnerRecord
} from "./PartnerFormController.js";
const todayYmd = getCurrentDateYmd;
export async function deleteChuDauTu(id) {
  const target = await refreshRecordBeforeDelete(this, "chudautu", id);
  if (!target) return;
  const family = getVersionFamily(this.model.state.chudautu, target);
  const familyIds = new Set(family.map((item) => String(item.id)));
  const hasPlans = this.model.state.kehoach.some((k) => familyIds.has(String(k.chuDauTuId)));
  if (hasPlans) {
    await this.view.customAlert(
      "Không thể xóa",
      "Không thể xóa chủ đầu tư này vì có Kế hoạch Lựa chọn nhà thầu đang thuộc quyền quản lý của họ.",
      "x-circle"
    );
    return;
  }
  const choice = family.length >= 2
    ? await this.view.customVersionDeleteChoice(
      "Xác nhận xóa",
      `Chủ đầu tư "${target.tenChuDauTu || target.maChuDauTu || "Chưa nhập tên"}" có ${family.length} phiên bản. Vui lòng chọn cách thức xóa:`,
      "Xóa phiên bản gần nhất",
      "Xóa toàn bộ",
    )
    : await this.view.customConfirm(
      "Xác nhận xóa",
      "Bạn có chắc chắn muốn xóa chủ đầu tư này?",
      "trash-2",
    ) ? 2 : null;
  if (choice === null) return;
  const result = choice === 1
    ? removeLatestVersion(this.model.state.chudautu, target)
    : removeAllVersions(this.model.state.chudautu, target);
  this.model.replaceTableState("chudautu", result.records);
  this.model.markDeleted("chudautu", result.removed);
  await persistAndSync(this, "chudautu", {
    changes: { deletions: { chudautu: result.removed } },
    afterPersist: () => this.view.renderChuDauTuTable()
  });
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
  let upsertRecords;
  if (id) {
    const currentCdt = this.model.state.chudautu.find((c) => c.id === id);
    const nextVersion = getNextVersion(this.model.state.chudautu, currentCdt);
    const isNewVersion = await this.view.customConfirm(
      "Lưu Chủ đầu tư",
      `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${getVersionLabel(nextVersion)}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${getVersionLabel(currentCdt.phienBan)})`,
      "save"
    );
    if (isNewVersion) {
      const timestamp = this.model.getCurrentDateTimeString();
      const versionDraft = this.model.state.chudautu.map((record) => ({ ...record }));
      const draftCurrent = versionDraft.find((record) => record.id === currentCdt.id);
      data = createNextVersion(versionDraft, draftCurrent, data, {
        id: generateRecordId("chudautu"), timestamp
      });
      if (data.ngayApDung === (currentCdt.ngayApDung || String(currentCdt.createdAt || "").slice(0, 10))) {
        data.ngayApDung = todayYmd();
      }
      upsertRecords = [...getVersionFamily(versionDraft, draftCurrent), data];
    } else {
      data.id = id;
      data.rootId = currentCdt.rootId || currentCdt.id;
      data.phienBan = currentCdt.phienBan || "00";
      data.isLatest = currentCdt.isLatest !== void 0 ? currentCdt.isLatest : 1;
      data.createdAt = currentCdt.createdAt || this.model.getCurrentDateTimeString();
      data.updatedAt = this.model.getCurrentDateTimeString();
      preserveRowVersion(data, currentCdt);
      upsertRecords = [data];
    }
  } else {
    const newId = generateRecordId("chudautu");
    data = buildInitialPartnerVersion(data, {
      id: newId,
      timestamp: this.model.getCurrentDateTimeString(),
      records: this.model.state.chudautu,
      config: PARTNER_FORM_CONFIGS.chudautu,
    });
    upsertRecords = [data];
  }
  rememberSelectedVersion(this.model.state, "selectedChuDauTuVersion", data);
  // Persisting also queues the record for server sync, so it must finish
  // before autoSync builds its payload.
  await persistInvestorFormChanges(this, upsertRecords);
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

export function persistInvestorFormChanges(controller, changedInvestors) {
  return mutatePersistAndSync(controller, {
    upserts: { chudautu: changedInvestors },
  }, {
    backgroundSync: true,
    afterCanonicalSync: async () => {
      await controller.closeModal("modal-chudautu");
      await controller.view.renderChuDauTuTable();
    },
  });
}
import { generateRecordId } from "../shared/idUtils.js";
