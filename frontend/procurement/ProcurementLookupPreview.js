const PLAN_FIELDS = [
  ["planNo", "Mã kế hoạch", "kh-ma", "text"],
  ["planName", "Tên kế hoạch", "kh-ten", "text"],
  ["planType", "Loại kế hoạch", "kh-loaihinh", "text"],
  ["projectName", "Tên dự án/dự toán", "kh-duan", "text"],
  ["investorCode", "Chủ đầu tư", "kh-chudautuid", "investor"],
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
  ["bidGuarantee", "Giá trị bảo đảm dự thầu", "gt-giatribaomothau", "money"],
  ["implementationPeriod", "Thời gian thực hiện", "gt-thoigian", "text"],
  ["capitalDetail", "Nguồn vốn", "gt-nguonvon", "text"],
  ["bidField", "Lĩnh vực", "gt-linhvuc", "bidField"],
  ["bidForm", "Hình thức lựa chọn", "gt-hinhthuc", "bidForm"],
  ["bidMode", "Phương thức lựa chọn", "gt-phuongthuc", "bidMode"],
  ["onlineMode", "Đấu thầu qua mạng", "gt-quatmang", "text"],
  ["contractType", "Loại hợp đồng", "gt-loaihopdong", "contractType"],
  ["additionalPurchaseOption", "Tùy chọn mua thêm", "gt-tuychonmuathem", "yesNo"],
  ["selectionDuration", "Thời gian tổ chức LCNT", "gt-thoigiantochuc", "text"],
  ["selectionStart", "Thời gian bắt đầu tổ chức", "gt-thoigianbatdautochuc", "text"],
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
    LCNT_DB: "Lựa chọn nhà thầu trong trường hợp đặc biệt",
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
    DGCD: "Theo đơn giá cố định",
    DON_GIA_CO_DINH: "Theo đơn giá cố định",
    DGDC: "Theo đơn giá điều chỉnh",
    DON_GIA_DIEU_CHINH: "Theo đơn giá điều chỉnh",
    TTG: "Theo thời gian",
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
  if (kind === "yesNo") {
    if (typeof rawValue !== "boolean") {
      return { value: null, warning: "Nguồn không có dữ liệu Có/Không hợp lệ." };
    }
    return { value: rawValue ? "Có" : "Không", warning: null };
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

function investorOption(control, data) {
  const investorCode = String(data?.investorCode || "").trim();
  const investorName = String(data?.investorName || "").trim();
  const options = Array.from(control?.options || []);
  const codeMatch = investorCode
    ? options.find((item) => (
      String(item.dataset?.investorCode || "").trim().toLocaleLowerCase("vi")
      === investorCode.toLocaleLowerCase("vi")
    ))
    : null;
  if (codeMatch) {
    return {
      sourceValue: investorCode,
      draftValue: String(codeMatch.value),
      warning: null,
    };
  }
  const nameMatch = investorName
    ? exactOptionText(control, investorName)
    : { sourceValue: investorCode || null, draftValue: null };
  return nameMatch.draftValue !== null
    ? nameMatch
    : {
      sourceValue: investorCode || investorName || null,
      draftValue: null,
      warning: investorCode
        ? "Không có chủ đầu tư nội bộ khớp mã hoặc tên từ nguồn."
        : nameMatch.warning || "Nguồn không có dữ liệu chủ đầu tư.",
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
    if (valueKind === "investor") {
      const matched = investorOption(control, data);
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

function dispatchFormValue(control, value) {
  if (!control || control.disabled) return false;
  control.value = String(value);
  control.dispatchEvent(formEvent("input"));
  control.dispatchEvent(formEvent("change"));
  return true;
}

export function applyPackageDetails(data, {
  document = globalThis.document,
  controller,
} = {}) {
  let applied = 0;
  let skipped = 0;
  const packagePrice = document?.getElementById?.("gt-gia");
  const packageGuarantee = document?.getElementById?.("gt-giatribaomothau");
  const preservedPrice = packagePrice?.value;
  const preservedGuarantee = packageGuarantee?.value;
  const medicine = data?.isMedicinePackage;
  if (typeof medicine === "boolean") {
    const radio = document?.querySelector?.(
      `input[name="gt-goithauthuoc"][value="${medicine ? "1" : "0"}"]`,
    );
    if (radio && !radio.disabled) {
      radio.checked = true;
      radio.dispatchEvent(formEvent("input"));
      radio.dispatchEvent(formEvent("change"));
      applied += 1;
    } else skipped += 1;
  }

  const isMultiLot = data?.isMultiLot;
  const multiLot = document?.getElementById?.("gt-phanlo");
  if (typeof isMultiLot === "boolean") {
    if (dispatchFormValue(multiLot, isMultiLot ? "Có" : "Không")) applied += 1;
    else skipped += 1;
  }

  const lots = Array.isArray(data?.lots) ? data.lots : [];
  if (isMultiLot === true && lots.length && typeof controller?._loadPhanLoRows === "function") {
    controller._loadPhanLoRows(lots.map((lot) => ({
      maPhanLo: lot?.lotNo || "",
      tenPhanLo: lot?.lotName || "",
      giaTriPhanLo: lot?.lotPrice || 0,
      baoDamDuThau: lot?.bidGuarantee || 0,
      thoiGianThucHien: lot?.executionPeriod || data?.implementationPeriod || "",
    })));
    if (packagePrice && preservedPrice) packagePrice.value = preservedPrice;
    if (packageGuarantee && preservedGuarantee) {
      packageGuarantee.value = preservedGuarantee;
    }
    applied += lots.length;
  } else if (lots.length) skipped += lots.length;

  return { applied, skipped };
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
