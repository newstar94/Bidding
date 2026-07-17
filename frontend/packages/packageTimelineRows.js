export const TIMELINE_TEMPLATE_VERSION = 1;

export const TIMELINE_SECTIONS = Object.freeze([
  ["I", "KHLCNT + DỰ TOÁN", [
    ["1.1", "Chứng thư thẩm định giá, Báo giá", "Đơn vị thẩm định, đơn vị báo giá"],
    ["1.2", "QĐ thành lập tổ", "Chủ đầu tư"],
    ["1.3", "Tờ trình dự toán", "Chủ đầu tư"],
    ["1.4", "QĐ phê duyệt dự toán", "Chủ đầu tư"],
    ["1.5", "Tờ trình kế hoạch", "Chủ đầu tư"],
    ["1.6", "QĐ phê duyệt kế hoạch", "Đơn vị có thẩm quyền/Chủ đầu tư"],
    ["1.7", "Tờ trình kế hoạch + Dự toán", "Chủ đầu tư"],
    ["1.8", "QĐ phê duyệt dự toán + kế hoạch", "Đơn vị có thẩm quyền/Chủ đầu tư"]
  ]],
  ["II", "TƯ VẤN LẬP", [
    ["2.1", "Thư mời", "Chủ đầu tư"], ["2.2", "Đơn xin nhận thầu", "Tư vấn lập"],
    ["2.3", "Biên bản hoàn thiện hợp đồng", "CĐT-TVL"],
    ["2.4", "Tờ trình phê duyệt chỉ định TVL", "Chủ đầu tư", true],
    ["2.5", "QĐ chỉ định TVL", "Chủ đầu tư", true], ["2.6", "Hợp đồng TVL", "CĐT-TVL"],
    ["2.7", "QĐ thành lập TCG", "Tư vấn lập"], ["2.8", "BBNT E-HSMT", "CĐT-TVL"],
    ["2.9", "BBNT BCĐG", "CĐT-TVL"], ["2.10", "Xác định KL hoàn thành", "CĐT-TVL"],
    ["2.11", "Đề nghị thanh toán", "Tư vấn lập"], ["2.12", "Thanh lý HĐ", "CĐT-TVL"]
  ]],
  ["III", "TƯ VẤN THẨM", [
    ["3.1", "Thư mời", "Chủ đầu tư"], ["3.2", "Đơn xin nhận thầu", "Tư vấn thẩm"],
    ["3.3", "Biên bản hoàn thiện hợp đồng", "CĐT-TVT"],
    ["3.4", "Tờ trình phê duyệt chỉ định TVT", "Chủ đầu tư", true],
    ["3.5", "QĐ chỉ định TVT", "Chủ đầu tư", true], ["3.6", "Hợp đồng TVT", "CĐT-TVT"],
    ["3.7", "QĐ thành lập TTĐ", "Tư vấn thẩm"], ["3.8", "BBNT BCTĐ E-HSMT", "CĐT-TVT"],
    ["3.9", "BBNT BCTĐ KQLCNT", "CĐT-TVT"], ["3.10", "Xác định KL hoàn thành", "CĐT-TVT"],
    ["3.11", "Đề nghị thanh toán", "Tư vấn thẩm"], ["3.12", "Thanh lý HĐ", "CĐT-TVT"]
  ]],
  ["IV", "E-HSMT", [
    ["4.1", "Tờ trình E-HSMT", "Tổ chuyên gia TVL"],
    ["4.2", "Báo cáo thẩm định E-HSMT", "Tư vấn thẩm", true],
    ["4.3", "QĐ phê duyệt E-HSMT", "Chủ đầu tư"]
  ]],
  ["V", "KẾT QUẢ LCNT", [
    ["5.1", "BB Đóng mở thầu", "Chủ đầu tư"],
    ["5.2", "Báo cáo đánh giá E-HSDT (E-HSĐXKT)", "Tổ chuyên gia TVL"],
    ["5.3", "Báo cáo thẩm định nhà thầu đạt kỹ thuật", "Tư vấn thẩm", true],
    ["5.4", "Quyết định phê duyệt nhà thầu đạt kỹ thuật", "Chủ đầu tư", true],
    ["5.5", "BB Mở Tài chính", "Chủ đầu tư", true],
    ["5.6", "Báo cáo đánh giá E-HSĐXTC", "Tổ chuyên gia TVL", true],
    ["5.7", "Thư mời đối chiếu tài liệu", "Chủ đầu tư"],
    ["5.8", "BB đối chiếu tài liệu", "Chủ đầu tư - Nhà thầu"],
    ["5.9", "Thương thảo hợp đồng", "Chủ đầu tư - Nhà thầu", true],
    ["5.10", "Báo cáo thẩm định KQLCNT", "Tư vấn thẩm", true],
    ["5.11", "Phê duyệt KQLCNT", "Chủ đầu tư"],
    ["5.12", "Thư chấp thuận và trao hợp đồng", "Chủ đầu tư"],
    ["5.13", "BB hoàn thiện hợp đồng", "Chủ đầu tư - Nhà thầu"]
  ]]
]);

const AUTO_SOURCES = Object.freeze({
  "1.3": ["plan.ngayTrinhDuToan", "", "ngayTrinhDuToan"],
  "1.4": ["plan.qdPheDuyetDuToan", "soQdPheDuyetDuToan", "ngayPheDuyetDuToan"],
  "1.5": ["plan.ngayTrinhKeHoach", "", "ngayTrinhKeHoach"],
  "1.6": ["plan.qdPheDuyet", "quyetDinhPheDuyet", "ngayPheDuyet"],
  "1.7": ["plan.trinhKeHoachDuToan", "", "ngayTrinhKeHoach"],
  "1.8": ["plan.qdPheDuyet", "quyetDinhPheDuyet", "ngayPheDuyet"],
  "4.1": ["package.toTrinhHsmt", "soToTrinhHsmt", "ngayTrinhHsmt"],
  "4.2": ["package.baoCaoThamDinhHsmt", "soBaoCaoThamDinhHsmt", "ngayBaoCaoThamDinhHsmt"],
  "4.3": ["package.qdHsmt", "soQuyetDinh", "ngayQuyetDinh"],
  "5.1": ["package.moThau", "", "thoiGianMoThau"],
  "5.5": ["package.moTaiChinh", "", "thoiGianMoEhsdxtc"],
  "5.11": ["package.qdKqlcnt", "soQuyetDinhKetQua", "ngayQuyetDinhKetQua"]
});
const EVALUATION_SOURCE_CODES = new Set(["5.2", "5.3", "5.6", "5.10"]);
const SEPARATE_PLAN_APPROVAL_CODES = new Set(["1.3", "1.4", "1.5", "1.6"]);
const COMBINED_PLAN_APPROVAL_CODES = new Set(["1.7", "1.8"]);
const TWO_ENVELOPE_CODES = new Set(["5.3", "5.4", "5.5", "5.6"]);
const COMPETITIVE_QUOTATION_APPRAISAL_CODES = new Set(["4.2", "5.3", "5.10"]);

function normalizedLabel(value) {
  return String(value || "").trim().toLocaleLowerCase("vi");
}

export function isTimelineRowApplicable(row, pkg = {}, plan = {}) {
  const code = String(row?.maMoc || "");
  const approvalType = normalizedLabel(plan?.pheDuyet);
  if (approvalType === "dự toán và kế hoạch" && SEPARATE_PLAN_APPROVAL_CODES.has(code)) return false;
  if (approvalType === "kế hoạch" && COMBINED_PLAN_APPROVAL_CODES.has(code)) return false;

  const selectionMethod = normalizedLabel(pkg?.hinhThucLuaChon);
  const isCompetitiveQuotation = selectionMethod === "chào hàng cạnh tranh";
  if (isCompetitiveQuotation && (code.startsWith("3.") || COMPETITIVE_QUOTATION_APPRAISAL_CODES.has(code))) return false;

  const appraisalRequired = normalizedLabel(pkg?.yeuCauThamDinhHsmt);
  if (code === "4.2" && appraisalRequired === "không") return false;

  const selectionProcedure = normalizedLabel(pkg?.phuongThucLuaChon);
  const hasSelectionProcedure = Boolean(selectionProcedure);
  const isTwoEnvelope = selectionProcedure === "một giai đoạn hai túi hồ sơ";
  if (hasSelectionProcedure && !isTwoEnvelope && TWO_ENVELOPE_CODES.has(code)) return false;
  return true;
}

export function applyTimelineApplicability(rows, pkg = {}, plan = {}) {
  return rows.map((row) => ({
    ...row,
    isApplicable: isTimelineRowApplicable(row, pkg, plan)
  }));
}

export function timelineDisplayCode(row, rows = []) {
  const applicableGroupRows = rows.filter((item) => (
    item.isApplicable !== false && item.maNhom === row?.maNhom
  ));
  const displayIndex = applicableGroupRows.findIndex((item) => item.maMoc === row?.maMoc);
  if (displayIndex < 0) return String(row?.maMoc || "");
  const sectionNumber = String(row?.maMoc || "").split(".")[0];
  return `${sectionNumber}.${displayIndex + 1}`;
}

function isoDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : "";
}

function parseMetadata(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function metadataSources(pkg = {}) {
  const metadata = parseMetadata(pkg.danhGiaHsdtMetadata);
  const technical = metadata.technical && typeof metadata.technical === "object" ? metadata.technical : metadata;
  const financial = metadata.financial && typeof metadata.financial === "object" ? metadata.financial : {};
  const result = metadata.result && typeof metadata.result === "object" ? metadata.result : {};
  return {
    "5.2": [technical.soBaoCao || "", technical.ngayBaoCao || ""],
    "5.3": [technical.soBctdKt || "", technical.ngayBctdKt || ""],
    "5.6": [financial.soBaoCao || "", financial.ngayBaoCao || ""],
    "5.10": [result.soBctdKetQua || "", result.ngayBctdKetQua || ""]
  };
}

export function createDefaultTimelineRows() {
  const rows = [];
  let sortOrder = 0;
  TIMELINE_SECTIONS.forEach(([maNhom, tenNhom, definitions]) => {
    definitions.forEach(([maMoc, congViec, donViBanHanh, isOptional = false]) => {
      const source = AUTO_SOURCES[maMoc];
      const evaluationSource = EVALUATION_SOURCE_CODES.has(maMoc);
      rows.push({
        id: "", maNhom, tenNhom, maMoc, congViec, donViBanHanh,
        soVanBan: "", ngayDuKien: "", ngayThucTe: "",
        ghiChu: isOptional ? "Nếu có" : "",
        sourceKey: source?.[0] || (evaluationSource ? `evaluation.${maMoc}` : ""),
        sourceMode: source || evaluationSource ? "AUTO" : "MANUAL",
        isOptional, trangThai: "PENDING", sortOrder, templateVersion: TIMELINE_TEMPLATE_VERSION
      });
      sortOrder += 1;
    });
  });
  return rows;
}

export function applyAutomaticTimelineSources(rows, pkg = {}, plan = {}) {
  const evaluation = metadataSources(pkg);
  return rows.map((sourceRow) => {
    const row = { ...sourceRow };
    if (row.sourceMode !== "AUTO") return row;
    const source = AUTO_SOURCES[row.maMoc];
    let number = "";
    let actualDate = "";
    if (source) {
      const record = source[0].startsWith("plan.") ? plan : pkg;
      number = source[1] ? record?.[source[1]] : "";
      actualDate = source[2] ? record?.[source[2]] : "";
      row.sourceKey = source[0];
    } else if (evaluation[row.maMoc]) {
      [number, actualDate] = evaluation[row.maMoc];
      row.sourceKey = `evaluation.${row.maMoc}`;
    }
    row.soVanBan = String(number || "");
    row.ngayThucTe = isoDate(actualDate);
    if (row.ngayThucTe && row.trangThai === "PENDING") row.trangThai = "DONE";
    return row;
  });
}

function contractSources(contracts = []) {
  const sources = {};
  contracts.forEach((contract) => {
    const classification = String(contract?.phanLoai || "").toLocaleLowerCase("vi");
    const prefix = classification.includes("tvl") || classification.includes("tư vấn lập")
      ? "2"
      : classification.includes("tvt") || classification.includes("tư vấn thẩm") ? "3" : "";
    if (!prefix) return;
    sources[`${prefix}.5`] = [contract.soQdChiDinh || "", contract.ngayQdChiDinh || "", `contract.${prefix}.decision`];
    sources[`${prefix}.6`] = [contract.soHopDong || "", contract.ngayKy || "", `contract.${prefix}.signed`];
    sources[`${prefix}.12`] = [contract.soHopDong || "", contract.ngayThanhLy || "", `contract.${prefix}.liquidated`];
  });
  return sources;
}

export function mergeTimelineRows(pkg = {}, plan = {}, contracts = []) {
  const defaults = createDefaultTimelineRows();
  const stored = Array.isArray(pkg.timelineItems) ? pkg.timelineItems : [];
  const storedByCode = new Map(stored.map((item) => [String(item?.maMoc || ""), item]));
  const merged = defaults.map((item) => ({ ...item, ...(storedByCode.get(item.maMoc) || {}) }));
  const sourced = applyAutomaticTimelineSources(merged, pkg, plan);
  const contractMap = contractSources(contracts);
  const rowsWithContracts = sourced.map((row) => {
    const source = contractMap[row.maMoc];
    if (!source || row.id && row.sourceMode !== "AUTO") return row;
    return {
      ...row,
      sourceMode: "AUTO",
      sourceKey: source[2],
      soVanBan: source[0],
      ngayThucTe: isoDate(source[1]),
      trangThai: source[1] && row.trangThai === "PENDING" ? "DONE" : row.trangThai
    };
  });
  return applyTimelineApplicability(rowsWithContracts, pkg, plan);
}

export function timelineIsOverdue(row, today = new Date()) {
  if (!row?.ngayDuKien || row.ngayThucTe || ["DONE", "NOT_APPLICABLE"].includes(row.trangThai)) return false;
  const deadline = new Date(`${row.ngayDuKien}T23:59:59`);
  return Number.isFinite(deadline.getTime()) && deadline < today;
}

export function calculateTimelineStats(rows, today = new Date()) {
  const applicable = rows.filter((row) => row.isApplicable !== false && row.trangThai !== "NOT_APPLICABLE");
  return {
    total: applicable.length,
    done: applicable.filter((row) => row.trangThai === "DONE").length,
    open: applicable.filter((row) => ["PENDING", "IN_PROGRESS"].includes(row.trangThai)).length,
    overdue: applicable.filter((row) => timelineIsOverdue(row, today)).length
  };
}

export function copyTimelineForNewVersion(previousRows = []) {
  return createDefaultTimelineRows().map((defaultRow) => {
    const previous = previousRows.find((row) => row.maMoc === defaultRow.maMoc);
    if (!previous) return defaultRow;
    const previousData = { ...previous };
    delete previousData.isApplicable;
    const resetProcessMilestone = defaultRow.maNhom === "IV" || defaultRow.maNhom === "V";
    return {
      ...defaultRow,
      ...previousData,
      id: "",
      ...(resetProcessMilestone ? {
        soVanBan: "", ngayDuKien: "", ngayThucTe: "", trangThai: "PENDING",
        sourceMode: defaultRow.sourceMode, sourceKey: defaultRow.sourceKey
      } : {}),
      sortOrder: defaultRow.sortOrder,
      templateVersion: TIMELINE_TEMPLATE_VERSION
    };
  });
}
