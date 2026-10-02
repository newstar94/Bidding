import { businessListState } from "./BusinessListState.js";
import { resolvePackageResultStatus } from "../packages/lotEvaluationScope.js";
import { presentStatus } from "../packages/LifecyclePolicy.js";

const contractTypes = ["Trọn gói", "Theo đơn giá cố định", "Theo đơn giá điều chỉnh", "Theo thời gian", "Hỗn hợp"];
const yesNo = ["Có", "Không"];
const booleanOptions = [{ value: "1", label: "Có" }, { value: "0", label: "Không" }];
const field = (key, label, kind = "text", options = null) => ({ key, label, kind, options });
const ref = (key, label, table, labelKey, codeKey) => ({ key, label, kind: "reference", table, labelKey, codeKey });
const assignee = () => field("assigneeId", "Người phụ trách", "assignee");
const enumKey = (value) => String(value).trim().toLocaleLowerCase("vi").replace(/đ/g, "d").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
const statusAliases = new Map(["UNKNOWN", "PREPARING", "INVITED", "OPENED", "EVALUATING", "PARTIALLY_AWARDED", "AWARDED", "CANCELLED"].flatMap((code) => {
  const label = presentStatus(code).label;
  return [code, code.replaceAll("_", " "), label].map((value) => [enumKey(value), label]);
}));

export const BUSINESS_LIST_FILTER_FIELDS = Object.freeze({
  kehoach: [
    field("maKeHoach", "Mã kế hoạch"), field("tenKeHoach", "Tên kế hoạch"),
    field("tenDuAnDuToan", "Tên dự án / dự toán"), field("maDuan", "Mã dự án"),
    ref("chuDauTuId", "Chủ đầu tư", "chudautu", "tenChuDauTu", "maChuDauTu"),
    field("loaiHinhMuaSam", "Phân loại", "choice", ["Dự án", "Dự toán mua sắm"]),
    field("pheDuyet", "Nội dung phê duyệt", "choice", ["Kế hoạch", { value: "Dự toán và kế hoạch", label: "Kế hoạch và dự toán" }]),
    field("tongMucDauTu", "Tổng giá trị (VND)", "money"), field("nguonVon", "Nguồn vốn"),
    field("quyetDinhPheDuyet", "Số quyết định phê duyệt"),
    field("ngayPheDuyet", "Thời gian phê duyệt kế hoạch", "date"), field("ngayPheDuyetDuToan", "Ngày phê duyệt dự toán", "date"),
    field("ngayQdPheDuyetDuAn", "Ngày quyết định phê duyệt dự án", "date"), field("thoiGianDangMa", "Thời gian đăng mã", "timestamp"),
  ],
  goithau: [
    field("maGoiThau", "Mã gói thầu"), field("tenGoiThau", "Tên gói thầu"),
    ref("keHoachId", "Kế hoạch", "kehoach", "tenKeHoach", "maKeHoach"),
    field("trangThai", "Trạng thái", "choice", ["Chuẩn bị", "Đang mời thầu", "Đã mở thầu", "Đang chấm thầu", "Đã có kết quả một phần", "Đã có kết quả", "Hủy thầu"]),
    field("hinhThucLuaChon", "Hình thức lựa chọn", "choice", ["Đấu thầu rộng rãi", "Đấu thầu hạn chế", "Chỉ định thầu", "Chỉ định thầu rút gọn", "Chào hàng cạnh tranh", "Lựa chọn nhà thầu trong trường hợp đặc biệt"]),
    field("linhVuc", "Lĩnh vực", "choice", ["Tư vấn", "Phi tư vấn", "Xây lắp", "Hỗn hợp", "Hàng hóa"]),
    field("phuongThucLuaChon", "Phương thức lựa chọn", "choice", ["Một giai đoạn một túi hồ sơ", "Một giai đoạn hai túi hồ sơ", "Hai giai đoạn một túi hồ sơ", "Hai giai đoạn hai túi hồ sơ", "Không có"]),
    field("loaiHopDong", "Loại hợp đồng", "choice", contractTypes),
    ref("nhaThauTrungThauId", "Nhà thầu trúng thầu", "nhathau", "tenNhaThau", "maNhaThau"), assignee(),
    field("giaGoiThau", "Giá gói thầu (VND)", "money"), field("giaTrungThau", "Giá trúng thầu (VND)", "money"),
    field("giaTriDamBaoDuThau", "Giá trị bảo đảm dự thầu (VND)", "money"),
    field("nguonVon", "Nguồn vốn"), field("soQuyetDinh", "Số quyết định"),
    field("quaMang", "Hình thức dự thầu", "choice", ["Qua mạng", "Không qua mạng"]),
    field("trongNuocQuocTe", "Phạm vi lựa chọn", "choice", ["Trong nước", "Quốc tế"]),
    field("phanLo", "Chia phần / lô", "choice", yesNo), field("tuyChonMuaThem", "Tùy chọn mua thêm", "choice", yesNo),
    field("isThuoc", "Gói thầu thuốc", "boolean", booleanOptions),
    field("ngayQuyetDinh", "Ngày quyết định", "date"), field("thoiGianDangTai", "Ngày phát hành hồ sơ", "timestamp"),
    field("thoiGianDongThau", "Thời gian đóng thầu", "timestamp"), field("thoiGianMoThau", "Thời gian mở thầu", "timestamp"),
  ],
  hopdong: [
    field("soHopDong", "Số hợp đồng"), field("tenHopDong", "Tên hợp đồng"),
    ref("chuDauTuId", "Chủ đầu tư", "chudautu", "tenChuDauTu", "maChuDauTu"),
    ref("nhaThauId", "Nhà thầu", "nhathau", "tenNhaThau", "maNhaThau"),
    ref("keHoachId", "Kế hoạch", "kehoach", "tenKeHoach", "maKeHoach"),
    ref("goiThauIds", "Gói thầu", "goithau", "tenGoiThau", "maGoiThau"), assignee(),
    field("trangThaiHopDong", "Trạng thái", "catalog"),
    field("loaiHopDong", "Loại hợp đồng", "choice", contractTypes),
    field("phanLoai", "Phân loại", "choice", ["Tư vấn", "Thẩm định", "Khác"]),
    field("giaTri", "Giá trị hợp đồng (VND)", "money"), field("soNgayThucHien", "Thời gian thực hiện"),
    field("coQdChiDinh", "Có quyết định chỉ định", "boolean", booleanOptions), field("soQdChiDinh", "Số quyết định chỉ định"),
    field("ngayKy", "Ngày ký", "date"), field("ngayThanhLy", "Ngày thanh lý", "date"), field("ngayQdChiDinh", "Ngày quyết định chỉ định", "date"),
  ],
});

export function businessListFilterField(type, key) {
  return BUSINESS_LIST_FILTER_FIELDS[type]?.find((entry) => entry.key === key);
}

export function businessListFilterOperators(definition) {
  if (definition.kind === "text") return ["contains", "not_contains", "equals", "in"];
  if (["date", "timestamp"].includes(definition.kind)) return ["range", "year", "month", "equals", "in"];
  if (definition.kind === "money") return ["range", "equals", "in"];
  return ["in", "equals"];
}

function textValue(value) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > 512) throw new Error("Giá trị bộ lọc không hợp lệ hoặc quá dài.");
  return value.trim();
}

export function businessListDate(value, timestamp = false) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (timestamp && /(?:Z|[+-]\d\d:?\d\d)$/i.test(text)) {
    const date = new Date(text);
    if (!Number.isFinite(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)?.value).join("-");
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(text);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/.exec(text);
  const day = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : local ? `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}` : "";
  const parsed = new Date(`${day}T00:00:00Z`);
  return day && Number(day.slice(0, 4)) >= 1 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : "";
}

function typedValue(definition, raw) {
  const text = textValue(raw);
  if (!text) return "";
  if (definition.kind === "money") {
    if (!/^\d{1,19}$/.test(text) || BigInt(text) > 9223372036854775807n) throw new Error(`${definition.label}: nhập số nguyên không âm trong giới hạn cho phép.`);
    return BigInt(text).toString();
  }
  if (definition.kind === "boolean" && !["0", "1"].includes(text)) throw new Error(`${definition.label}: giá trị lựa chọn không hợp lệ.`);
  if (["date", "timestamp"].includes(definition.kind) && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !businessListDate(text))) throw new Error(`${definition.label}: ngày không hợp lệ.`);
  if (definition.key === "trangThai") return statusAliases.get(enumKey(text)) || text;
  if (definition.key === "pheDuyet") return ["Kế hoạch", "Dự toán và kế hoạch"].find((label) => enumKey(label) === enumKey(text)) || text;
  return text;
}

export function normalizeBusinessListFilters(type, conditions = []) {
  if (!BUSINESS_LIST_FILTER_FIELDS[type] || !Array.isArray(conditions) || conditions.length > 24) throw new Error("Chọn tối đa 24 điều kiện lọc.");
  const result = [];
  for (const condition of conditions) {
    const definition = businessListFilterField(type, condition?.field);
    if (!definition || !businessListFilterOperators(definition).includes(condition.operator)) throw new Error("Trường hoặc phép lọc không hợp lệ.");
    const { operator } = condition;
    let value;
    if (operator === "range") {
      const raw = condition.value;
      if (raw == null || raw === "") continue;
      if (typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => !["min", "max"].includes(key))) throw new Error("Khoảng lọc không hợp lệ.");
      const min = typedValue(definition, raw.min);
      const max = typedValue(definition, raw.max);
      if (!min && !max) continue;
      if (min && max && (definition.kind === "money" ? BigInt(min) > BigInt(max) : min > max)) throw new Error(`${definition.label}: giá trị từ không được lớn hơn giá trị đến.`);
      value = { min, max };
    } else if (["in", "year", "month"].includes(operator)) {
      const raw = condition.value;
      if (raw == null || raw === "") continue;
      const values = Array.isArray(raw) ? raw : operator === "in" ? null : [raw];
      if (!values || values.length > 100) throw new Error("Chọn tối đa 100 giá trị cho mỗi điều kiện.");
      value = [...new Set(values.map((part) => {
        if (operator === "in") return typedValue(definition, part);
        const text = textValue(part);
        if (!text) return "";
        if (!/^\d{1,4}$/.test(text) || Number(text) < 1 || Number(text) > (operator === "year" ? 9998 : 12)) throw new Error("Năm hoặc tháng không hợp lệ.");
        return String(Number(text));
      }).filter(Boolean))];
      if (!value.length) continue;
    } else {
      value = typedValue(definition, condition.value);
      if (value === "") continue;
    }
    result.push({ field: definition.key, operator, value });
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 16384) throw new Error("Bộ lọc vượt quá kích thước cho phép.");
  return result;
}

export function getBusinessListFilters(model, type) {
  return structuredClone(businessListState(model, type).filters);
}

export function setBusinessListFilters(model, type, conditions) {
  const filters = normalizeBusinessListFilters(type, conditions);
  businessListState(model, type).filters = filters;
  return structuredClone(filters);
}

function recordValues(model, type, record, definition) {
  if (definition.key === "assigneeId") {
    return (model?.state?.assignments || []).filter((row) => String(row.targetId) === String(record.id) && row.type === type
      && (!row.organizationId || !record.organizationId || String(row.organizationId) === String(record.organizationId))).map((row) => row.empId);
  }
  if (type === "goithau" && definition.key === "trangThai") return [resolvePackageResultStatus(record)];
  const value = record?.[definition.key];
  return Array.isArray(value) ? value : [value];
}

function comparableRecordValue(definition, value) {
  if (value == null || value === "") return null;
  if (["date", "timestamp"].includes(definition.kind)) return businessListDate(value, definition.kind === "timestamp") || null;
  if (definition.kind === "money") {
    if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
    const text = String(value).trim();
    return /^\d+$/.test(text) ? BigInt(text) : null;
  }
  return String(value);
}

export function matchesBusinessListFilterConditions(model, type, record, conditions) {
  const filters = normalizeBusinessListFilters(type, conditions);
  return filters.every((condition) => {
    const definition = businessListFilterField(type, condition.field);
    const values = recordValues(model, type, record, definition).map((value) => comparableRecordValue(definition, value));
    const { operator, value } = condition;
    if (operator === "contains" || operator === "not_contains") {
      const contains = values.some((part) => String(part ?? "").toLocaleLowerCase("vi").includes(value.toLocaleLowerCase("vi")));
      return operator === "contains" ? contains : !contains;
    }
    if (operator === "range") return values.some((part) => part != null
      && (!value.min || part >= comparableRecordValue(definition, value.min))
      && (!value.max || part <= comparableRecordValue(definition, value.max)));
    if (operator === "year" || operator === "month") return values.some((part) => part
      && value.includes(String(Number(String(part).slice(operator === "year" ? 0 : 5, operator === "year" ? 4 : 7)))));
    const expected = (operator === "in" ? value : [value]).map((part) => comparableRecordValue(definition, part));
    return values.some((part) => part != null && expected.some((target) => definition.kind === "text"
      ? String(part).toLocaleLowerCase("vi") === String(target).toLocaleLowerCase("vi") : part === target));
  });
}

export function matchesBusinessListFilters(model, type, record) {
  return matchesBusinessListFilterConditions(model, type, record, businessListState(model, type).filters);
}
