import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { getAppController } from "../app/controllerRef.js";
import { bindCurrencyElement } from "../app/domUtils.js";
import { getExcelPreviewFieldError } from "./excelPreviewValidation.js";
import { isCompetitiveQuotationPackage } from "./packageAppraisal.js";
import { normalizeEhsmtAppraisalRequirement } from "./timelineRuleEngine.js";
import { escapeAttribute, escapeHtml } from "../shared/view_helpers.js";

export function getExcelPreviewKeys(row = {}) {
  const source = row?.data || row || {};
  return Object.keys(source).filter((key) => !key.startsWith("_"));
}

export function renderExcelPreview(rows, importType) {
  const formatDateToDMY = (str) => {
    if (!str) return "";
    if (str.match(/^\d{4}-\d{2}-\d{2}/)) {
      const parts = str.substring(0, 10).split("-");
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return str;
  };
  const formatDatetimeToDMYHM = (str) => {
    if (!str) return "";
    if (str.match(/^\d{4}-\d{2}-\d{2}/)) {
      const datePart = str.substring(0, 10);
      const timePart = str.substring(11, 16) || "00:00";
      const parts = datePart.split("-");
      return `${parts[2]}/${parts[1]}/${parts[0]} ${timePart}`;
    }
    return str;
  };
  let modal = document.getElementById("modal-excel-preview");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-excel-preview";
    modal.className = "modal-overlay";
    modal.innerHTML = trustedHTML(`
            <div class="modal-card bf-s-5447c39f9a">
                <div class="modal-header bf-s-d5564bfe2a">
                    <h3 class="bf-s-de52e3be99">Xem trước dữ liệu nhập từ Excel</h3>
                    <button type="button" class="modal-close" data-bf-action="close-modal" data-modal-id="modal-excel-preview">&times;</button>
                </div>
                <div class="modal-body bf-s-829c923308">
                    <div id="excel-preview-container" class="bf-s-65d1f1c3d7">
                        <div class="table-container bf-s-c90c7cddfd">
                            <table class="data-table bf-s-448ca2b6ae">
                                <thead id="excel-preview-header"></thead>
                                <tbody id="excel-preview-tbody"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="modal-footer bf-s-6dd5824fd5">
                    <button type="button" class="btn btn-outline" id="btn-cancel-excel-import" data-bf-action="close-modal" data-modal-id="modal-excel-preview">Hủy bỏ</button>
                    <button type="button" class="btn btn-primary bf-s-65d1f1c3d7" id="btn-save-excel-import">Lưu dữ liệu</button>
                </div>
            </div>
        `);
    document.body.appendChild(modal);
    const saveBtn = modal.querySelector("#btn-save-excel-import");
    if (saveBtn) {
      saveBtn.onclick = () => {
        getAppController()?.saveExcelImport?.();
      };
    }
  }
  const previewContainer = document.getElementById("excel-preview-container");
  const tableHeader = document.getElementById("excel-preview-header");
  const tableBody = document.getElementById("excel-preview-tbody");
  if (!previewContainer || !tableBody || !tableHeader) return;
  modal.classList.add("active");
  if (rows.length === 0) {
    tableBody.innerHTML = trustedHTML(`<tr><td colspan="5" class="bf-s-ed899dffb6">Không tìm thấy dữ liệu hợp lệ trong file Excel</td></tr>`);
    setRuntimeStyle(previewContainer, "display", "block");
    return;
  }
  const labelMap = {
    maKeHoach: "Mã kế hoạch",
    tenKeHoach: "Tên kế hoạch",
    loaiHinhMuaSam: "Loại hình",
    tenDuAnDuToan: "Dự án / Dự toán",
    donViTrinhCdt: "Đơn vị trình của chủ đầu tư",
    tenVietTatDonViTrinh: "Tên viết tắt đơn vị trình",
    tongMucDauTu: "Tổng mức đầu tư",
    ngayPheDuyet: "Ngày phê duyệt",
    quyetDinhPheDuyet: "QĐ phê duyệt",
    thoiGianDangMa: "Thời gian đăng mã",
    maGoiThau: "Mã gói thầu",
    tenGoiThau: "Tên gói thầu",
    keHoachId: "Mã Kế hoạch LCNT",
    giaGoiThau: "Giá gói thầu",
    hinhThucLuaChon: "Hình thức LCNT",
    phuongThucLuaChon: "Phương thức LCNT",
    trangThai: "Trạng thái",
    loaiHopDong: "Loại hợp đồng",
    nguonVon: "Nguồn vốn",
    maChuDauTu: "Mã CĐT",
    tenChuDauTu: "Tên chủ đầu tư",
    maSoThue: "Mã số thuế",
    diaChi: "Địa chỉ",
    soDienThoai: "Điện thoại",
    email: "Email",
    chucVuNguoiDungDau: "Chức vụ người đứng đầu",
    daiDienCdt: "Đại diện CĐT",
    chucVuDaiDien: "Chức vụ người đại diện",
    danhXung: "Danh xưng",
    maQHNS: "Mã QHNS",
    tenNhaThau: "Tên nhà thầu",
    loaiNhaThau: "Loại nhà thầu",
    nguoiDaiDien: "Người đại diện",
    soTaiKhoan: "Số tài khoản",
    noiMoTaiKhoan: "Nơi mở tài khoản",
    hoTen: "Họ và tên",
    soCCCD: "Số CCCD",
    ngayCapCCCD: "Ngày cấp CCCD",
    noiCapCCCD: "Nơi cấp CCCD",
    soChungChi: "Số chứng chỉ",
    ngayCapChungChi: "Ngày cấp CC",
    donViCapChungChi: "Đơn vị cấp CC",
    soHopDong: "Số hợp đồng",
    tenHopDong: "Tên hợp đồng",
    ngayKy: "Ngày ký",
    giaTri: "Giá trị hợp đồng",
    soNgayThucHien: "Số ngày thực hiện",
    maDinhDanh: "Mã nhà thầu",
    maNhaThau: "Mã nhà thầu",
    nhaThauId: "Nhà thầu",
    maPhanLo: "Mã phần lô",
    tenPhanLo: "Tên phần lô",
    giaDuThau: "Giá dự thầu",
    tyLeGiamGia: "Tỷ lệ giảm (%)",
    giaSauGiamGia: "Giá sau giảm giá",
    giaXepHang: "Giá xếp hạng",
    giaDeNghiTrungThau: "Giá đề nghị trúng thầu",
    chapThuanGiaDeNghiTrungThauDuoi50: "Chấp thuận giá đề nghị trúng thầu dưới 50%",
    hieuLucHsdt: "Hiệu lực E-HSDT",
    giaTriDamBao: "Giá trị đảm bảo",
    hieuLucBaoDamNgay: "Hiệu lực ĐB (ngày)",
    thoiGianThucHien: "Thời gian thực hiện",
    danhGiaHopLe: "Đánh giá hợp lệ",
    danhGiaNangLuc: "Đánh giá năng lực",
    danhGiaKyThuat: "Đánh giá kỹ thuật",
    danhGiaKetLuan: "Kết luận",
    giaTrungThau: "Giá trúng thầu",
    thoiGianGoiThau: "Thời gian thực hiện gói thầu",
    thoiGianHopDong: "Thời gian thực hiện hợp đồng",
    lyDoTruot: "Lý do trượt thầu"
  };
  const firstRow = rows[0].data || rows[0];
  const keys = getExcelPreviewKeys(firstRow);
  let headerHtml = "<tr>";
  keys.forEach((k) => {
    const label = labelMap[k] || k;
    const isNumericColumn = ["tongMucDauTu", "giaGoiThau", "giaTri", "giaTriPhanLo", "giaTrungThau", "giaDuThau", "giaSauGiamGia", "giaXepHang", "giaDeNghiTrungThau", "giaTriDamBao"].includes(k);
    headerHtml += `<th class="excel-preview-column ${isNumericColumn ? "excel-preview-column--numeric" : ""}">${escapeHtml(label)}</th>`;
  });
  headerHtml += '<th class="bf-s-c84c3abe48">Thông tin kiểm tra</th></tr>';
  tableHeader.innerHTML = trustedHTML(headerHtml);
  tableBody.innerHTML = trustedHTML(rows.map((r, rowIndex) => {
    const rowErrors = [];
    const fieldErrorMap = {};
    const isDuplicateRow = (r._valid === false || r._valid === "false") && (r._comment && (r._comment.includes("trùng lặp") || r._comment.includes("tồn tại")));
    keys.forEach((k) => {
      const err = getExcelPreviewFieldError(importType, k, r[k], r);
      if (err) {
        rowErrors.push(err);
        fieldErrorMap[k] = err;
      }
      if (isDuplicateRow) {
        const isDupField = importType === "chuyengia" && (k === "soCCCD" || k === "soChungChi") || importType === "kehoach" && k === "maKeHoach" || importType === "goithau" && k === "maGoiThau" || importType === "chudautu" && (k === "maChuDauTu" || k === "maSoThue") || importType === "nhathau" && (k === "maNhaThau" || k === "maSoThue") || importType === "hopdong" && k === "soHopDong";
        if (isDupField) {
          fieldErrorMap[k] = r._comment || "Trùng lặp dữ liệu";
        }
      }
    });
    if (r._valid === false || r._valid === "false") {
      if (r._comment && r._comment !== "Hợp lệ") {
        rowErrors.push(r._comment);
      }
    }
    r._valid = rowErrors.length === 0;
    r._comment = rowErrors.length > 0 ? rowErrors.join("; ") : "Hợp lệ";
    const statusHtml = r._valid ? '<span class="badge badge-success"><i data-lucide="check"></i> Hợp lệ</span>' : `<span class="badge badge-danger" title="${escapeAttribute(r._comment)}"><i data-lucide="alert-circle"></i> Lỗi dữ liệu</span>`;
    let rowHtml = `<tr data-row-index="${rowIndex}">`;
    keys.forEach((k) => {
      let val = r[k];
      let align = "left";
      let inputType = "text";
      let inputClass = "excel-preview-input";
      const dateKeys = ["ngayPheDuyet", "ngayQuyetDinh", "ngayKy", "ngayQdChiDinh", "ngayTrinhDuToan", "ngayPheDuyetDuToan", "ngayCapCCCD", "ngayCapChungChi"];
      const datetimeKeys = ["thoiGianDangMa", "thoiGianDangTai", "thoiGianDongThau", "thoiGianMoThau"];
      const numberKeys = ["tongMucDauTu", "giaGoiThau", "giaTri", "giaTriPhanLo", "giaTrungThau", "giaDuThau", "giaSauGiamGia", "giaXepHang", "giaDeNghiTrungThau", "giaTriDamBao", "thoiGianThucHien", "hieuLucBaoDamNgay", "hieuLucHsdt"];
      if (numberKeys.includes(k)) {
        inputType = "number";
        align = "right";
        inputClass += " excel-preview-input--numeric";
        val = val !== void 0 && val !== null && val !== "" ? parseFloat(String(val).replace(/[^0-9.-]/g, "")) : "";
      } else if (dateKeys.includes(k)) {
        inputType = "text";
        inputClass += " flatpickr-date";
        val = formatDateToDMY(val);
      } else if (datetimeKeys.includes(k)) {
        inputType = "text";
        inputClass += " flatpickr-datetime";
        val = formatDatetimeToDMYHM(val);
      } else if (k === "nhaThauId") {
        const matchedNt = getAppController()?.model?.state?.nhathau?.find((n) => n.id === val);
        if (matchedNt) val = matchedNt.tenNhaThau;
      }
      if (k === "maKeHoach" || k === "maGoiThau" || k === "maChuDauTu" || k === "maNhaThau" || k === "soHopDong" || k === "soChungChi" || k === "maDinhDanh") {
        inputClass += " excel-preview-input--emphasized";
      }
      const errorText = fieldErrorMap[k];
      const label = labelMap[k] || k;
      const feedbackId = `excel-preview-error-${rowIndex}-${k.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      rowHtml += `<td class="excel-preview-cell ${align === "right" ? "excel-preview-cell--numeric" : ""}">
                <input type="${inputType}" class="${inputClass} ${errorText ? "is-invalid" : ""}" data-key="${escapeAttribute(k)}" value="${escapeAttribute(val !== void 0 && val !== null && val !== "" ? val : "")}" aria-label="${escapeAttribute(`${label}, dòng ${rowIndex + 1}`)}" aria-invalid="${errorText ? "true" : "false"}" ${errorText ? `aria-describedby="${escapeAttribute(feedbackId)}"` : ""}>
                ${errorText ? `<div id="${escapeAttribute(feedbackId)}" class="invalid-feedback excel-preview-feedback bf-s-1fd4829323">${escapeHtml(errorText)}</div>` : ""}
            </td>`;
    });
    rowHtml += `<td class="bf-s-0c5104285b">${statusHtml}</td></tr>`;
    return rowHtml;
  }).join(""));
  tableBody.onchange = (e) => {
    const input = e.target.closest("input.excel-preview-input");
    if (!input) return;
    const tr = input.closest("tr");
    const rowIndex = parseInt(tr.getAttribute("data-row-index"), 10);
    const key = input.getAttribute("data-key");
    let val = input.value.trim();
    const controller = getAppController();
    if (controller && controller._excelImportData) {
      const importType2 = controller._excelImportType;
      const row = controller._excelImportData[rowIndex];
      const dateKeys = ["ngayPheDuyet", "ngayQuyetDinh", "ngayKy", "ngayQdChiDinh", "ngayTrinhDuToan", "ngayPheDuyetDuToan", "ngayCapCCCD", "ngayCapChungChi"];
      const datetimeKeys = ["thoiGianDangMa", "thoiGianDangTai", "thoiGianDongThau", "thoiGianMoThau"];
      const numberKeys = ["tongMucDauTu", "giaGoiThau", "giaTri", "giaTriPhanLo", "giaTrungThau", "giaDuThau", "giaSauGiamGia", "giaXepHang", "giaDeNghiTrungThau", "giaTriDamBao", "thoiGianThucHien", "hieuLucBaoDamNgay", "hieuLucHsdt"];
      if (numberKeys.includes(key)) {
        row[key] = val !== "" ? parseFloat(val) : 0;
      } else if (dateKeys.includes(key)) {
        if (val.includes("/")) {
          const parts = val.split("/");
          row[key] = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
        } else {
          row[key] = val;
        }
      } else if (datetimeKeys.includes(key)) {
        if (val.includes("/")) {
          const spaceParts = val.split(" ");
          const dateParts = spaceParts[0].split("/");
          const timePart = spaceParts[1] ? spaceParts[1] : "00:00";
          row[key] = `${dateParts[2]}-${dateParts[1].padStart(2, "0")}-${dateParts[0].padStart(2, "0")} ${timePart}:00`;
        } else {
          row[key] = val;
        }
      } else {
        row[key] = val;
      }
      controller.revalidateExcelImportData();
      const trs = tableBody.querySelectorAll("tr[data-row-index]");
      trs.forEach((rowTr) => {
        const rIndex = parseInt(rowTr.getAttribute("data-row-index"), 10);
        const rData = controller._excelImportData[rIndex];
        if (!rData) return;
        const rInputs = rowTr.querySelectorAll("input.excel-preview-input");
        const rErrors = [];
        const isDup = (rData._valid === false || rData._valid === "false") && (rData._comment && (rData._comment.includes("trùng lặp") || rData._comment.includes("tồn tại")));
        rInputs.forEach((inp) => {
          const k = inp.getAttribute("data-key");
          let err = getExcelPreviewFieldError(importType2, k, rData[k], rData);
          const td = inp.closest("td");
          if (!err && isDup) {
            const isDupField = importType2 === "chuyengia" && (k === "soCCCD" || k === "soChungChi") || importType2 === "kehoach" && k === "maKeHoach" || importType2 === "goithau" && k === "maGoiThau" || importType2 === "chudautu" && (k === "maChuDauTu" || k === "maSoThue") || importType2 === "nhathau" && (k === "maNhaThau" || k === "maSoThue") || importType2 === "hopdong" && k === "soHopDong";
            if (isDupField) {
              err = rData._comment;
            }
          }
          const existingFeedback = td.querySelector(".invalid-feedback");
          if (existingFeedback) existingFeedback.remove();
          if (err) {
            rErrors.push(err);
            inp.classList.add("is-invalid");
            inp.setAttribute("aria-invalid", "true");
            const feedback = document.createElement("div");
            const feedbackId = `excel-preview-error-${rIndex}-${k.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
            feedback.id = feedbackId;
            feedback.className = "invalid-feedback excel-preview-feedback";
            feedback.innerText = err;
            inp.setAttribute("aria-describedby", feedbackId);
            td.appendChild(feedback);
          } else {
            inp.classList.remove("is-invalid");
            inp.setAttribute("aria-invalid", "false");
            inp.removeAttribute("aria-describedby");
          }
        });
        if (rErrors.length > 0) {
          rData._valid = false;
          rData._comment = rErrors.join("; ");
        }
        const statusTd = rowTr.querySelector("td:last-child");
        if (statusTd) {
          statusTd.innerHTML = trustedHTML(rData._valid ? '<span class="badge badge-success"><i data-lucide="check"></i> Hợp lệ</span>' : `<span class="badge badge-danger" title="${escapeAttribute(rData._comment)}"><i data-lucide="alert-circle"></i> Lỗi dữ liệu</span>`);
          if (window.lucide) {
            window.lucide.createIcons({ root: statusTd });
          }
        }
      });
    }
  };
  tableBody.onfocusin = (e) => {
    const input = e.target.closest("input.excel-preview-input");
    if (input) input.select();
  };
  setRuntimeStyle(previewContainer, "display", "block");
  getAppController()?.initFlatpickr?.(tableBody);
  lucide.createIcons();
}
export function populatePhathanhHsmtForm(gt, model) {
  const form = document.getElementById("form-phathanh-hsmt");
  if (form) {
    form.querySelectorAll(".form-group").forEach((fg) => fg.classList.remove("invalid"));
  }
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  setVal("phathanh-gt-id", gt.id);
  setVal("phathanh-magoithau", gt.maGoiThau || "");
  setVal("phathanh-sototrinh", gt.soToTrinhHsmt || "");
  setVal("phathanh-ngaytrinh", gt.ngayTrinhHsmt ? model.formatForDateInput(gt.ngayTrinhHsmt) : "");
  setVal("phathanh-soquyetdinh", gt.soQuyetDinh || "");
  setVal("phathanh-hieuluchsdt", gt.hieuLucHsdt || "");
  setVal("phathanh-giatribaomothau", gt.giaTriDamBaoDuThau ? model.formatVND(gt.giaTriDamBaoDuThau) : "");
  setVal("phathanh-ngayquyetdinh", gt.ngayQuyetDinh ? model.formatForDateInput(gt.ngayQuyetDinh) : "");
  setVal("phathanh-thoigiandangtai", gt.thoiGianDangTai ? model.formatForDatetimeLocal(gt.thoiGianDangTai) : "");
  setVal("phathanh-thoigiandongthau", gt.thoiGianDongThau ? model.formatForDatetimeLocal(gt.thoiGianDongThau) : "");
  const isCompetitiveQuotation = isCompetitiveQuotationPackage(gt);
  const appraisalSection = document.getElementById("phathanh-thamdinh-section");
  if (appraisalSection) setRuntimeStyle(appraisalSection, "display", isCompetitiveQuotation ? "none" : "block");
  const appraisalRequirement = isCompetitiveQuotation ? "NOT_REQUIRED" : normalizeEhsmtAppraisalRequirement(gt);
  const hasAudit = appraisalRequirement === "REQUIRED";
  const auditRadios = document.querySelectorAll('input[name="phathanh-yeucauthamdinh"]');
  auditRadios.forEach((radio) => {
    radio.checked = radio.value === appraisalRequirement;
  });
  setVal("phathanh-sobaocaothamdinh", hasAudit ? gt.soBaoCaoThamDinhHsmt || "" : "");
  setVal("phathanh-ngaybaocaothamdinh", hasAudit && gt.ngayBaoCaoThamDinhHsmt ? model.formatForDateInput(gt.ngayBaoCaoThamDinhHsmt) : "");
  const soBaoCaoContainer = document.getElementById("phathanh-sobaocao-container");
  const ngayBaoCaoContainer = document.getElementById("phathanh-ngaybaocao-container");
  const soBaoCaoInp = document.getElementById("phathanh-sobaocaothamdinh");
  const ngayBaoCaoInp = document.getElementById("phathanh-ngaybaocaothamdinh");
  if (soBaoCaoContainer) setRuntimeStyle(soBaoCaoContainer, "display", hasAudit ? "block" : "none");
  if (ngayBaoCaoContainer) setRuntimeStyle(ngayBaoCaoContainer, "display", hasAudit ? "block" : "none");
  if (hasAudit) {
    if (soBaoCaoInp) soBaoCaoInp.setAttribute("required", "true");
    if (ngayBaoCaoInp) ngayBaoCaoInp.setAttribute("required", "true");
  } else {
    if (soBaoCaoInp) soBaoCaoInp.removeAttribute("required");
    if (ngayBaoCaoInp) ngayBaoCaoInp.removeAttribute("required");
  }
  const isTuVan = gt.linhVuc === "Tư vấn";
  const isPhanLo = gt.phanLo === "Có";
  const baodamContainer = document.getElementById("phathanh-baodam-container");
  const baodamInput = document.getElementById("phathanh-giatribaomothau");
  const phanloBaodamContainer = document.getElementById("phathanh-phanlo-baodam-container");
  const phanloBaodamTbody = document.getElementById("phathanh-phanlo-baodam-tbody");
  if (baodamContainer && baodamInput && phanloBaodamContainer && phanloBaodamTbody) {
    if (isTuVan) {
      setRuntimeStyle(baodamContainer, "display", "none");
      baodamInput.removeAttribute("required");
      setRuntimeStyle(phanloBaodamContainer, "display", "none");
      phanloBaodamTbody.innerHTML = trustedHTML("");
    } else {
      if (isPhanLo) {
        setRuntimeStyle(baodamContainer, "display", "none");
        baodamInput.removeAttribute("required");
        setRuntimeStyle(phanloBaodamContainer, "display", "block");
        phanloBaodamTbody.innerHTML = trustedHTML("");
        const list = gt.phanLoList || [];
        list.forEach((item) => {
          const tr = document.createElement("tr");
          tr.setAttribute("data-id", item.id);
          const baoDamVal = item.baoDamDuThau || "";
          const giaTriVal = item.giaTriPhanLo || 0;
          tr.innerHTML = trustedHTML(`
                        <td class="bf-s-36242379f4">
                            <input type="text" class="phathanh-pl-code-input bf-s-f94af44de1" value="${escapeAttribute(item.maPhanLo || "")}" placeholder="Mã...">
                        </td>
                        <td class="bf-s-36242379f4">
                            <input type="text" class="phathanh-pl-name-input bf-s-f94af44de1" value="${escapeAttribute(item.tenPhanLo || "")}" placeholder="Tên...">
                        </td>
                        <td class="bf-s-36242379f4">
                             <input type="text" class="phathanh-pl-price-input mt-format-vnd bf-s-f94af44de1" value="${escapeAttribute(giaTriVal ? model.formatVND(giaTriVal) : "")}" placeholder="Giá trị...">
                        </td>
                        <td class="bf-s-36242379f4">
                             <input type="text" class="phathanh-pl-baodam-input mt-format-vnd bf-s-f94af44de1" required value="${escapeAttribute(baoDamVal ? model.formatVND(baoDamVal) : "")}" placeholder="Bảo đảm...">
                        </td>
                        <td class="bf-s-36242379f4">
                             <input type="text" class="phathanh-pl-duration-input bf-s-f94af44de1" value="${escapeAttribute(item.thoiGianThucHien || "")}" placeholder="Thời gian...">
                        </td>
                    `);
          phanloBaodamTbody.appendChild(tr);
          bindCurrencyElement(tr.querySelector(".phathanh-pl-price-input"), (value) => model.formatVND(model.parseVND(value)));
          bindCurrencyElement(tr.querySelector(".phathanh-pl-baodam-input"), (value) => model.formatVND(model.parseVND(value)));
        });
      } else {
        setRuntimeStyle(baodamContainer, "display", "block");
        baodamInput.setAttribute("required", "");
        baodamInput.setAttribute("required", "true");
        baodamInput.value = gt.giaTriDamBaoDuThau ? model.formatVND(gt.giaTriDamBaoDuThau) : "";
        setRuntimeStyle(phanloBaodamContainer, "display", "none");
        phanloBaodamTbody.innerHTML = trustedHTML("");
      }
    }
  }
}
export function getPhathanhHsmtFormData(model) {
  const getVal = (id2) => {
    const el = document.getElementById(id2);
    return el ? el.value.trim() : "";
  };
  const id = getVal("phathanh-gt-id");
  const gt = (model?.state?.goithau || []).find((item) => String(item.id) === String(id));
  const isCompetitiveQuotation = isCompetitiveQuotationPackage(gt);
  const maGoiThauVal = getVal("phathanh-magoithau");
  const hieuLucHsdtVal = parseInt(getVal("phathanh-hieuluchsdt")) || 0;
  const giaTriDamBaoVal = model.parseVND(getVal("phathanh-giatribaomothau"));
  const soQuyetDinh = getVal("phathanh-soquyetdinh");
  const thoiGianDangTai = getVal("phathanh-thoigiandangtai");
  const thoiGianDongThau = getVal("phathanh-thoigiandongthau");
  const ngayQuyetDinh = getVal("phathanh-ngayquyetdinh");
  const soToTrinhHsmt = getVal("phathanh-sototrinh");
  const ngayTrinhHsmt = getVal("phathanh-ngaytrinh");
  const phanLoRows = [];
  document.querySelectorAll("#phathanh-phanlo-baodam-tbody tr").forEach((tr) => {
    const trId = tr.getAttribute("data-id");
    const codeInp = tr.querySelector(".phathanh-pl-code-input");
    const nameInp = tr.querySelector(".phathanh-pl-name-input");
    const priceInp = tr.querySelector(".phathanh-pl-price-input");
    const baodamInp = tr.querySelector(".phathanh-pl-baodam-input");
    const durationInp = tr.querySelector(".phathanh-pl-duration-input");
    phanLoRows.push({
      id: trId,
      maPhanLo: codeInp ? codeInp.value.trim() : "",
      tenPhanLo: nameInp ? nameInp.value.trim() : "",
      giaTriPhanLo: priceInp ? model.parseVND(priceInp.value) : 0,
      baoDamDuThau: baodamInp ? model.parseVND(baodamInp.value) : 0,
      thoiGianThucHien: durationInp ? durationInp.value.trim() : ""
    });
  });
  const auditRadioChecked = document.querySelector('input[name="phathanh-yeucauthamdinh"]:checked');
  const yeuCauThamDinhHsmtCode = isCompetitiveQuotation ? "NOT_REQUIRED" : auditRadioChecked?.value || "UNDETERMINED";
  const yeuCauThamDinhHsmt = yeuCauThamDinhHsmtCode === "REQUIRED" ? "Có" : yeuCauThamDinhHsmtCode === "NOT_REQUIRED" ? "Không" : "";
  const soBaoCaoThamDinhHsmt = yeuCauThamDinhHsmtCode === "REQUIRED"
    ? getVal("phathanh-sobaocaothamdinh")
    : gt?.soBaoCaoThamDinhHsmt || "";
  const ngayBaoCaoThamDinhHsmt = yeuCauThamDinhHsmtCode === "REQUIRED"
    ? getVal("phathanh-ngaybaocaothamdinh")
    : gt?.ngayBaoCaoThamDinhHsmt || "";
  return {
    id,
    maGoiThauVal,
    hieuLucHsdtVal,
    giaTriDamBaoVal,
    soQuyetDinh,
    thoiGianDangTai,
    thoiGianDongThau,
    ngayQuyetDinh,
    soToTrinhHsmt,
    ngayTrinhHsmt,
    yeuCauThamDinhHsmt,
    yeuCauThamDinhHsmtCode,
    soBaoCaoThamDinhHsmt,
    ngayBaoCaoThamDinhHsmt,
    phanLoRows
  };
}
export function isGoiThauDetailTabActive() {
  const detailPane = document.getElementById("tab-goithau-detail");
  return !!(detailPane && detailPane.classList.contains("active"));
}
export function getGoiThauFormInputValues(model) {
  const getVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  };
  const getRawVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : "";
  };
  const phuongPhapDanhGia = getRawVal("gt-phuongphapdanhgia");
  const trongSoKyThuatRaw = getVal("gt-trongsokythuat");
  return {
    id: getVal("form-goithau-id"),
    keHoachId: getVal("gt-kehoachid"),
    tenGoiThau: getVal("gt-ten"),
    giaGoiThau: model.parseVND(getVal("gt-gia")),
    thoiGianThucHien: getVal("gt-thoigian"),
    hinhThucLuaChon: getRawVal("gt-hinhthuc"),
    phuongThucLuaChon: getRawVal("gt-phuongthuc"),
    phuongPhapDanhGia,
    trongSoKyThuat: phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && trongSoKyThuatRaw !== ""
      ? parseInt(trongSoKyThuatRaw)
      : null,
    trangThai: getRawVal("gt-trangthai"),
    linhVuc: getRawVal("gt-linhvuc"),
    isThuoc: document.querySelector('input[name="gt-goithauthuoc"]:checked')?.value === "1" ? 1 : 0,
    tuyChonMuaThem: getRawVal("gt-tuychonmuathem"),
    nguonVon: getRawVal("gt-nguonvon"),
    loaiHopDong: getRawVal("gt-loaihopdong"),
    thoiGianToChuc: getVal("gt-thoigiantochuc"),
    thoiGianBatDauToChuc: getVal("gt-thoigianbatdautochuc"),
    quaMang: getRawVal("gt-quatmang"),
    trongNuocQuocTe: getRawVal("gt-trongnuocquocte"),
    phanLo: getRawVal("gt-phanlo"),
    soQuyetDinh: getVal("gt-soquyetdinh"),
    ngayQuyetDinh: getVal("gt-ngayquyetdinh"),
    thoiGianDangTai: getVal("gt-thoigiandangtai"),
    thoiGianDongThau: getVal("gt-thoigiandongthau"),
    thoiGianMoThau: getVal("gt-thoigianmothau"),
    thoiGianMoEhsdxtc: getVal("gt-thoigianmoehsdxtc"),
    giaTriDamBaoDuThau: getVal("gt-giatribaomothau"),
    hieuLucHsdt: getVal("gt-hieuluchsdt") !== "" ? parseInt(getVal("gt-hieuluchsdt")) : null,
    hieuLucDamBaoDuThau: getVal("gt-hieuluchbaomothau") !== "" ? parseInt(getVal("gt-hieuluchbaomothau")) : null,
    tyLeBaoDamHopDong: getVal("gt-tylebaodamhopdong") !== "" ? parseFloat(getVal("gt-tylebaodamhopdong")) : null,
    nhaThauTrungThauId: getRawVal("gt-nhathautrungthauid"),
    giaTrungThau: model.parseVND(getVal("gt-giatrungthau")),
    thoiGianGoiThau: getVal("gt-thoigian-goithau"),
    thoiGianHopDong: getVal("gt-thoigian-hopdong")
  };
}
