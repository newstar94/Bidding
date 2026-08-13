import { trustedHTML } from "../shared/trustedTypes.js";
import { normalizeOrganizationName, normalizePersonName, normalizeVietnamTaxCode } from "../app/domUtils.js";
import { collectFormValues, resetFormState, setFormValues } from "../shared/FormBinder.js";
import { setValidationError } from "../shared/FormValidation.js";
import { applyRawAddressToAddressControls, composeInternalAddress, parseStoredInternalAddress } from "../shared/PartnerHelpers.js";
import { createInitialVersion } from "../shared/VersionedEntityService.js";

export const PARTNER_FORM_CONFIGS = {
  chudautu: {
    role: "CDT",
    entityLabel: "chủ đầu tư",
    requiredControlIds: ["cdt-ma", "cdt-ten", "cdt-ngayapdung", "cdt-chucvunguoidungdau", "cdt-daidiencdt", "cdt-chucvudaidien", "cdt-danhxung", "cdt-tinh", "cdt-xa", "cdt-diachichitiet"],
    uniqueFields: ["coQuanChuQuan"],
    fields: {
      id: "form-chudautu-id", maChuDauTu: "cdt-ma", maSoThue: "cdt-mst", tenChuDauTu: "cdt-ten",
      tenVietTat: "cdt-tenviettat", ngayApDung: "cdt-ngayapdung", chucVuNguoiDungDau: "cdt-chucvunguoidungdau",
      daiDienCdt: "cdt-daidiencdt", chucVuDaiDien: "cdt-chucvudaidien",
      danhXung: "cdt-danhxung",
      soDienThoai: "cdt-sdt", soTaiKhoan: "cdt-sotaikhoan", noiMoTaiKhoan: "cdt-noimotaikhoan",
      email: "cdt-email", maQHNS: "cdt-maqhns", coQuanChuQuan: "cdt-coquanchuquan"
    },
    codeField: "maChuDauTu", nameField: "tenChuDauTu", representativeField: "daiDienCdt",
    lookup: {
      codeId: "cdt-ma", taxId: "cdt-mst", nameId: "cdt-ten", shortNameId: "cdt-tenviettat",
      preserveEnteredCode: true,
      representativeId: "cdt-daidiencdt", representativePositionId: "cdt-chucvudaidien",
      phoneId: "cdt-sdt", emailId: "cdt-email", bankAccountId: "cdt-sotaikhoan", bankNameId: "cdt-noimotaikhoan",
      extraFields: { head_position: "cdt-chucvunguoidungdau", budget_code: "cdt-maqhns", parent_agency: "cdt-coquanchuquan" },
      address: { detailInputId: "cdt-diachichitiet", provinceSelectId: "cdt-tinh", wardSelectId: "cdt-xa" }
    }
  },
  nhathau: {
    role: "NT",
    entityLabel: "nhà thầu",
    requiredControlIds: ["nt-ma", "nt-ten", "nt-ngayapdung", "nt-nguoidaidien", "nt-danhxung", "nt-tinh", "nt-xa", "nt-diachichitiet"],
    uniqueFields: ["anhDau", "tenAnhDau"],
    fields: {
      id: "form-nhathau-id", maNhaThau: "nt-ma", maSoThue: "nt-mst", tenNhaThau: "nt-ten",
      tenVietTat: "nt-tenviettat", ngayApDung: "nt-ngayapdung", nguoiDaiDien: "nt-nguoidaidien",
      chucVuDaiDien: "nt-chucvudaidien", danhXung: "nt-danhxung",
      soDienThoai: "nt-sdt", email: "nt-email",
      soTaiKhoan: "nt-sotaikhoan", noiMoTaiKhoan: "nt-noimotaikhoan", maNganHang: "nt-manganhang"
    },
    codeField: "maNhaThau", nameField: "tenNhaThau", representativeField: "nguoiDaiDien",
    lookup: {
      codeId: "nt-ma", taxId: "nt-mst", nameId: "nt-ten", shortNameId: "nt-tenviettat",
      preserveEnteredCode: true,
      representativeId: "nt-nguoidaidien", representativePositionId: "nt-chucvudaidien",
      phoneId: "nt-sdt", emailId: "nt-email", bankAccountId: "nt-sotaikhoan", bankNameId: "nt-noimotaikhoan",
      extraFields: { bank_code: "nt-manganhang" },
      address: { detailInputId: "nt-diachichitiet", provinceSelectId: "nt-tinh", wardSelectId: "nt-xa" }
    }
  }
};

function control(root, id) {
  return id ? root?.getElementById?.(id) || null : null;
}

function setValue(root, id, value) {
  const element = control(root, id);
  if (element) element.value = value ?? "";
}

export function deriveInvestorHeadPosition(representativePosition) {
  const position = String(representativePosition || "").trim();
  if (!position) return "";

  let headPosition = position.replace(/^hiệu\s+phó(?=\s|$|[:,-])/iu, "Hiệu trưởng");
  if (headPosition === position) {
    headPosition = position.replace(/^phó(?=\s|$|[:,-])[\s:,-]*/iu, "").trim();
  }
  if (!headPosition || headPosition === position) return position;
  return headPosition.charAt(0).toLocaleUpperCase("vi-VN") + headPosition.slice(1);
}

function bindInvestorHeadPosition(root, config) {
  const representativePosition = control(root, config.representativePositionId);
  const headPosition = control(root, config.extraFields?.head_position);
  if (!representativePosition || !headPosition) return;

  representativePosition.__bfHeadPositionCleanup?.();
  const syncHeadPosition = () => {
    headPosition.value = deriveInvestorHeadPosition(representativePosition.value);
  };
  representativePosition.addEventListener("input", syncHeadPosition);
  representativePosition.addEventListener("change", syncHeadPosition);
  representativePosition.__bfHeadPositionCleanup = () => {
    representativePosition.removeEventListener("input", syncHeadPosition);
    representativePosition.removeEventListener("change", syncHeadPosition);
    delete representativePosition.__bfHeadPositionCleanup;
  };
  syncHeadPosition();
}

export function mapPartnerLookupFields(data, config) {
  const lookupData = { ...data };
  if (config.extraFields?.head_position && !lookupData.head_position) {
    lookupData.head_position = deriveInvestorHeadPosition(lookupData.representative_position);
  }
  const result = {
    [config.codeId]: lookupData.org_code || "",
    [config.taxId]: lookupData.tax_code || "",
    [config.nameId]: normalizeOrganizationName(lookupData.name),
    [config.shortNameId]: lookupData.short_name || "",
    [config.representativeId]: normalizePersonName(lookupData.representative_name || ""),
    [config.representativePositionId]: lookupData.representative_position || "",
    [config.phoneId]: lookupData.phone || "",
    [config.emailId]: lookupData.email || "",
    [config.bankAccountId]: lookupData.bank_account || "",
    [config.bankNameId]: lookupData.bank_name || ""
  };
  Object.entries(config.extraFields || {}).forEach(([sourceKey, targetId]) => {
    result[targetId] = lookupData[sourceKey] || "";
  });
  return Object.fromEntries(Object.entries(result).filter(([id]) => Boolean(id)));
}

export function createPartnerLookupHandlers({ form, config, root = document, applyAddress = applyRawAddressToAddressControls }) {
  bindInvestorHeadPosition(root, config);
  const clearAddress = () => {
    setValue(root, config.address.detailInputId, "");
    setValue(root, config.address.provinceSelectId, "");
    const ward = control(root, config.address.wardSelectId);
    if (ward) {
      ward.innerHTML = trustedHTML('<option value="">-- Chọn Xã/Phường --</option>');
      ward.disabled = true;
    }
    if (form) form.dataset.diaChiGoc = "";
  };

  const clearLookupData = () => {
    Object.keys(mapPartnerLookupFields({}, config))
      .filter((id) => id !== config.codeId && id !== config.taxId)
      .forEach((id) => setValue(root, id, ""));
    clearAddress();
  };

  const applyLookupData = async (data) => {
    const values = mapPartnerLookupFields(data || {}, config);
    Object.entries(values).forEach(([id, value]) => {
      if (id === config.codeId) {
        if (!value) return;
        const enteredCode = control(root, config.codeId)?.value;
        if (config.preserveEnteredCode && String(enteredCode || "").trim()) return;
      }
      setValue(root, id, value);
    });
    if (data?.address) {
      if (form) form.dataset.diaChiGoc = data.address;
      await applyAddress(data.address, config.address);
    } else {
      clearAddress();
    }
  };

  return { clearLookupData, applyLookupData };
}

function selectedName(select) {
  return select?.options?.[select.selectedIndex]?.getAttribute?.("data-name") || "";
}

export function collectPartnerFormData(root, form, config, { convertDate, fallbackDate } = {}) {
  const data = collectFormValues(root, config.fields);
  Object.keys(data).forEach((key) => {
    if (typeof data[key] === "string") data[key] = data[key].trim();
  });
  data.maSoThue = normalizeVietnamTaxCode(data.maSoThue || "");
  data[config.nameField] = normalizeOrganizationName(data[config.nameField] || "");
  data[config.representativeField] = normalizePersonName(data[config.representativeField] || "");
  if (Object.hasOwn(data, "chucVuNguoiDungDau")) {
    data.chucVuNguoiDungDau = deriveInvestorHeadPosition(data.chucVuDaiDien);
  }
  data.ngayApDung = convertDate?.(data.ngayApDung) || fallbackDate || "";
  const address = config.lookup.address;
  data.diaChi = composeInternalAddress(
    control(root, address.detailInputId)?.value.trim() || "",
    selectedName(control(root, address.wardSelectId)),
    selectedName(control(root, address.provinceSelectId))
  );
  data.diaChiGoc = form?.dataset?.diaChiGoc || "";
  return data;
}

export function normalizePartnerRecord(data, config) {
  const normalized = { ...(data || {}) };
  Object.keys(normalized).forEach((key) => {
    if (typeof normalized[key] === "string") normalized[key] = normalized[key].trim();
  });
  normalized.maSoThue = normalizeVietnamTaxCode(normalized.maSoThue || "");
  normalized[config.nameField] = normalizeOrganizationName(
    normalized[config.nameField] || "",
  );
  normalized[config.representativeField] = normalizePersonName(
    normalized[config.representativeField] || "",
  );
  if (Object.hasOwn(normalized, "chucVuNguoiDungDau")) {
    normalized.chucVuNguoiDungDau = deriveInvestorHeadPosition(
      normalized.chucVuDaiDien,
    );
  }
  return normalized;
}

export function buildInitialPartnerVersion(data, {
  id,
  timestamp,
  records = [],
  config = PARTNER_FORM_CONFIGS.chudautu,
  validationErrorCode = "PARTNER_VALIDATION_FAILED",
} = {}) {
  const normalized = normalizePartnerRecord(data, config);
  const validationErrors = validatePartnerRecord(normalized, records, null, config);
  if (validationErrors.length) {
    const error = new Error(validationErrorCode);
    error.code = validationErrorCode;
    error.validationErrors = validationErrors;
    throw error;
  }
  return createInitialVersion(normalized, { id, timestamp });
}

export async function loadPartnerFormData(root, form, record, config, {
  formatDate, initAddressDropdowns, isReadOnly = false
} = {}) {
  form.dataset.diaChiGoc = record.diaChiGoc || "";
  setFormValues(root, {
    ...record,
    [config.representativeField]: normalizePersonName(record[config.representativeField] || ""),
    ngayApDung: formatDate?.(record.ngayApDung || String(record.createdAt || "").slice(0, 10)) || ""
  }, config.fields);
  const stored = parseStoredInternalAddress(record.diaChi || "");
  const address = config.lookup.address;
  if (stored.requiresLookup) {
    await initAddressDropdowns(address.provinceSelectId, address.wardSelectId, "", "", isReadOnly);
    await applyRawAddressToAddressControls(record.diaChiGoc || record.diaChi || "", address);
  } else {
    setValue(root, address.detailInputId, stored.detail);
    await initAddressDropdowns(address.provinceSelectId, address.wardSelectId, stored.provinceName, stored.wardName, isReadOnly);
  }
}

export async function resetPartnerFormData(root, form, config, { effectiveDate, initAddressDropdowns } = {}) {
  resetFormState(form);
  form.dataset.diaChiGoc = "";
  setValue(root, config.fields.id, "");
  setValue(root, config.fields.ngayApDung, effectiveDate || "");
  setValue(root, config.lookup.address.detailInputId, "");
  await initAddressDropdowns?.(
    config.lookup.address.provinceSelectId,
    config.lookup.address.wardSelectId,
    "",
    "",
    false
  );
}

export function validatePartnerRecord(data, records, currentId, config) {
  const errors = [];
  const current = (records || []).find((record) => String(record.id) === String(currentId));
  const currentRoot = String(current?.rootId || current?.id || currentId || "");
  const otherRecords = (records || []).filter((record) => String(record.rootId || record.id) !== currentRoot);
  const code = String(data[config.codeField] || "").trim().toLowerCase();
  if (code && otherRecords.some((record) => String(record[config.codeField] || "").trim().toLowerCase() === code)) {
    errors.push({ controlId: config.lookup.codeId, message: `Mã ${config.entityLabel} này đã tồn tại trong hệ thống. Vui lòng nhập mã khác!` });
  }
  const tax = String(data.maSoThue || "").trim();
  if (tax && !/^\d{9,14}$|^\d{10}-\d{3}$/.test(tax)) {
    errors.push({ controlId: config.lookup.taxId, message: "Mã số thuế không đúng định dạng (phải gồm từ 9 đến 14 chữ số)." });
  } else if (tax && otherRecords.some((record) => String(record.maSoThue || "").trim().toLowerCase() === tax.toLowerCase())) {
    errors.push({ controlId: config.lookup.taxId, message: `Mã số thuế này đã được đăng ký cho một ${config.entityLabel} khác trong hệ thống!` });
  }
  if (data.soDienThoai && !/^[0-9\s+\-()]{9,15}$/.test(data.soDienThoai)) {
    errors.push({ controlId: config.lookup.phoneId, message: "Số điện thoại không đúng định dạng (từ 9 đến 15 chữ số)." });
  }
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
    errors.push({ controlId: config.lookup.emailId, message: "Email không đúng định dạng." });
  }
  return errors;
}

export function applyPartnerValidationErrors(root, errors, focusInvalid) {
  if (!errors?.length) return true;
  const first = errors[0];
  const controlElement = control(root, first.controlId);
  setValidationError(controlElement, first.message);
  focusInvalid?.(controlElement);
  return false;
}
