const PLAN_FIELDS = [
  ["planNo", "Mã kế hoạch", "kh-ma", "text"],
  ["planName", "Tên kế hoạch", "kh-ten", "text"],
  ["projectName", "Tên dự án/dự toán", "kh-duan", "text"],
  ["investorName", "Chủ đầu tư", "kh-chudautuid", "optionText"],
  ["totalInvestment", "Tổng dự toán/Tổng mức đầu tư", "kh-tongmuc", "money"],
  ["capitalDetail", "Nguồn vốn", "kh-nguonvon", "text"],
  ["decisionNo", "Số quyết định phê duyệt", "kh-quyetdinh", "text"],
  ["decisionDate", "Ngày phê duyệt", "kh-ngaypheduyet", "date"],
  ["publicDate", "Thời gian đăng", "kh-thoigiandang", "datetime"],
];

const PACKAGE_FIELDS = [
  ["notifyNo", "Mã thông báo mời thầu", "gt-ma", "text"],
  ["bidName", "Tên gói thầu", "gt-ten", "text"],
  ["bidPrice", "Giá gói thầu", "gt-gia", "money"],
  ["implementationPeriod", "Thời gian thực hiện", "gt-thoigian", "text"],
  ["capitalDetail", "Nguồn vốn", "gt-nguonvon", "text"],
  ["bidField", "Lĩnh vực", "gt-linhvuc", "bidField"],
  ["bidForm", "Hình thức lựa chọn", "gt-hinhthuc", "bidForm"],
  ["bidMode", "Phương thức lựa chọn", "gt-phuongthuc", "bidMode"],
  ["contractType", "Loại hợp đồng", "gt-loaihopdong", "contractType"],
  ["bidCloseDate", "Thời gian đóng thầu", "gt-thoigiandongthau", "datetime"],
  ["bidOpenDate", "Thời gian mở thầu", "gt-thoigianmothau", "datetime"],
];

const ENUMS = {
  bidField: {
    HH: "Hàng hóa",
    XL: "Xây lắp",
    TV: "Tư vấn",
    PTV: "Phi tư vấn",
    HON_HOP: "Hỗn hợp",
  },
  bidForm: {
    DTRR: "Đấu thầu rộng rãi",
    DTHC: "Đấu thầu hạn chế",
    CDT: "Chỉ định thầu",
    CDTRG: "Chỉ định thầu rút gọn",
    CHCT: "Chào hàng cạnh tranh",
    DB: "Lựa chọn nhà thầu trong trường hợp đặc biệt",
  },
  bidMode: {
    "1_MTHS": "Một giai đoạn một túi hồ sơ",
    "1_HTHS": "Một giai đoạn hai túi hồ sơ",
    "2_MTHS": "Hai giai đoạn một túi hồ sơ",
    "2_HTHS": "Hai giai đoạn hai túi hồ sơ",
    NONE: "Không có",
  },
  contractType: {
    TG: "Trọn gói",
    TRON_GOI: "Trọn gói",
    DON_GIA_CO_DINH: "Theo đơn giá cố định",
    DON_GIA_DIEU_CHINH: "Theo đơn giá điều chỉnh",
    THEO_THOI_GIAN: "Theo thời gian",
    HON_HOP: "Hỗn hợp",
  },
};

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function formatMoney(value) {
  if (!hasValue(value)) return null;
  const numeric = typeof value === "number"
    ? value
    : Number(String(value).replace(/[^\d-]/g, ""));
  if (!Number.isSafeInteger(numeric) || numeric < 0) return null;
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(numeric);
}

function formatPortalDate(value, includeTime = false) {
  if (!hasValue(value)) return null;
  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(text);
  if (!match) return text;
  const [, year, month, day, hour, minute] = match;
  if (includeTime && hour && minute) return `${day}/${month}/${year} ${hour}:${minute}`;
  return `${day}/${month}/${year}`;
}

function enumValue(kind, rawValue) {
  if (!hasValue(rawValue)) return { value: null, warning: "Nguồn không có dữ liệu." };
  const value = String(rawValue).trim();
  const table = ENUMS[kind] || {};
  const normalized = table[value] || Object.values(table).find((item) => item === value);
  if (!normalized) {
    return { value: null, warning: `Không nhận diện giá trị nguồn “${value}”.` };
  }
  return { value: normalized, warning: null };
}

function transformValue(kind, rawValue) {
  if (ENUMS[kind]) return enumValue(kind, rawValue);
  if (!hasValue(rawValue)) return { value: null, warning: "Nguồn không có dữ liệu." };
  if (kind === "money") {
    const value = formatMoney(rawValue);
    return value === null
      ? { value: null, warning: "Giá trị tiền từ nguồn không hợp lệ." }
      : { value, warning: null };
  }
  if (kind === "date") return { value: formatPortalDate(rawValue), warning: null };
  if (kind === "datetime") {
    return { value: formatPortalDate(rawValue, true), warning: null };
  }
  return { value: String(rawValue), warning: null };
}

function exactOptionText(control, rawValue) {
  if (!hasValue(rawValue)) {
    return { sourceValue: null, draftValue: null, warning: "Nguồn không có dữ liệu." };
  }
  const sourceValue = String(rawValue).trim();
  const option = Array.from(control?.options || []).find(
    (item) => String(item.textContent || "").trim() === sourceValue,
  );
  return option
    ? { sourceValue, draftValue: String(option.value), warning: null }
    : {
      sourceValue,
      draftValue: null,
      warning: "Không có option nội bộ khớp chính xác; dữ liệu được giữ unset.",
    };
}

function validateControlOption(control, value, warning) {
  if (!control?.options || value === null) return { value, warning };
  const supported = Array.from(control.options).some(
    (option) => String(option.value) === String(value),
  );
  return supported
    ? { value, warning }
    : { value: null, warning: `Biểu mẫu không hỗ trợ giá trị “${value}”.` };
}

export function buildComparisonRows(kind, data, { getControl } = {}) {
  const definitions = kind === "PLAN" ? PLAN_FIELDS : PACKAGE_FIELDS;
  const resolveControl = getControl || ((id) => globalThis.document?.getElementById(id));
  return definitions.map(([field, label, controlId, valueKind]) => {
    const control = resolveControl(controlId);
    const currentValue = String(control?.value ?? "");
    if (valueKind === "optionText") {
      const matched = exactOptionText(control, data?.[field]);
      return {
        field,
        label,
        controlId,
        currentValue,
        ...matched,
        apply: Boolean(
          control && matched.draftValue !== null && !currentValue.trim()
        ),
      };
    }
    const transformed = transformValue(valueKind, data?.[field]);
    const validated = validateControlOption(control, transformed.value, transformed.warning);
    return {
      field,
      label,
      controlId,
      currentValue,
      sourceValue: validated.value,
      draftValue: validated.value,
      warning: validated.warning,
      apply: Boolean(control && validated.value !== null && !currentValue.trim()),
    };
  });
}

function formEvent(type) {
  if (typeof globalThis.Event === "function") {
    return new globalThis.Event(type, { bubbles: true });
  }
  return { type, bubbles: true };
}

export function applySelectedRows(rows, { document = globalThis.document } = {}) {
  let applied = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const control = document?.getElementById(row.controlId);
    if (!row.apply || row.draftValue === null || !control || control.disabled) {
      skipped += 1;
      continue;
    }
    const value = String(row.draftValue);
    if (control._flatpickr?.setDate) control._flatpickr.setDate(value, false);
    else control.value = value;
    control.dispatchEvent(formEvent("input"));
    control.dispatchEvent(formEvent("change"));
    applied += 1;
  }
  return { applied, skipped };
}
