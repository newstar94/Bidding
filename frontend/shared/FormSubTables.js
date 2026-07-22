import { trustedHTML } from "./trustedTypes.js";
import { setRuntimeStyle } from "./runtimeStyles.js";
﻿import { parseBidDateTime } from "./dateParseUtils.js";
import { bindCurrencyElement } from "../app/domUtils.js";
import { escapeHtml } from "./view_helpers.js";
import { initCustomSelect, syncCustomSelectDisabled } from "./view_helpers.js";
function normalizeSubRowValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}
function makeSubRowKey(...values) {
  return values.map(normalizeSubRowValue).join("|");
}
export function addPhanLoRow(data = {}) {
  const tbody = document.getElementById("phanlo-tbody");
  if (!tbody) return;
  const rowId = data.id || generateRecordId("phanlo");
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", rowId);
  const code = data.code || data.maPhanLo || "";
  const name = data.name || data.tenPhanLo || "";
  const price = data.price || data.giaTriPhanLo || 0;
  const duration = data.duration || data.thoiGianThucHien || "";
  const baoDamVal = data.baoDamDuThau || "";
  const isMoiThauOrLater = document.getElementById("gt-trangthai")?.value !== "Chuẩn bị";
  const linhVuc = document.getElementById("gt-linhvuc")?.value || "";
  const hinhThuc = document.getElementById("gt-hinhthucluachon")?.value || document.getElementById("gt-hinhthuc")?.value || "";
  const isDirectOrSpecial = hinhThuc === "Chỉ định thầu rút gọn" || hinhThuc === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
  const isBaoDamRequired = isMoiThauOrLater && (linhVuc !== "Tư vấn" && !isDirectOrSpecial);
  const displayStyle = linhVuc !== "Tư vấn" && !isDirectOrSpecial ? "" : "display: none;";
  const requiredAttr = isBaoDamRequired ? "required" : "";
  tr.innerHTML = trustedHTML(`
        <td><input type="text" class="pl-code-input bf-s-e278f41ed9" value="${escapeHtml(code)}" placeholder="Mã phần lô..."></td>
        <td><input type="text" class="pl-name-input bf-s-e278f41ed9" value="${escapeHtml(name)}" placeholder="Nhập tên Lô/Phần..."></td>
        <td><input type="text" class="pl-price-input bf-s-e278f41ed9" value="${price ? this.model.formatVND(price) : ""}" placeholder="Nhập giá trị Lô (VND)..."></td>
        <td class="col-baodam-phanlo-cell" style="${displayStyle}"><input type="text" class="pl-baodam-input mt-format-vnd bf-s-e278f41ed9" ${requiredAttr} value="${baoDamVal ? this.model.formatVND(baoDamVal) : ""}" placeholder="Bảo đảm dự thầu..."></td>
        <td><input type="text" class="pl-duration-input bf-s-e278f41ed9" value="${escapeHtml(duration)}" placeholder="Ví dụ: 90 ngày..."></td>
        <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete remove-pl-row-btn" aria-label="Xóa phần lô" title="Xóa phần lô"><i data-lucide="trash-2" aria-hidden="true"></i></button></td>
    `);
  const priceInput = tr.querySelector(".pl-price-input");
  bindCurrencyElement(priceInput, (value) => this.model.formatVND(this.model.parseVND(value)));
  priceInput.addEventListener("input", () => this.recalculateTotalLotPrice());
  const baodamInput = tr.querySelector(".pl-baodam-input");
  if (baodamInput) {
    bindCurrencyElement(baodamInput, (value) => this.model.formatVND(this.model.parseVND(value)));
    baodamInput.addEventListener("input", () => this.recalculateTotalLotSecurities());
  }
  tr.querySelector(".remove-pl-row-btn").addEventListener("click", () => {
    tr.remove();
    this.recalculateTotalLotPrice();
    this.recalculateTotalLotSecurities();
  });
  tbody.appendChild(tr);
  this.recalculateTotalLotPrice();
  lucide.createIcons();
}
export function _loadPhanLoRows(list) {
  const tbody = document.getElementById("phanlo-tbody");
  if (tbody) tbody.innerHTML = trustedHTML("");
  list.forEach((item) => this.addPhanLoRow(item));
}
export function _collectPhanLoRows() {
  const list = [];
  document.querySelectorAll("#phanlo-tbody tr").forEach((tr) => {
    const id = tr.getAttribute("data-id");
    const codeInput = tr.querySelector(".pl-code-input");
    const code = codeInput ? codeInput.value.trim() : "";
    const nameInput = tr.querySelector(".pl-name-input");
    const name = nameInput ? nameInput.value.trim() : "";
    const priceInput = tr.querySelector(".pl-price-input");
    const priceVal = priceInput ? priceInput.value : "";
    const price = this.model.parseVND(priceVal);
    const baodamInput = tr.querySelector(".pl-baodam-input");
    const baodamVal = baodamInput ? baodamInput.value : "";
    const baoDamDuThau = this.model.parseVND(baodamVal);
    const durationInput = tr.querySelector(".pl-duration-input");
    const duration = durationInput ? durationInput.value.trim() : "";
    if (name) {
      list.push({
        id,
        maPhanLo: code,
        tenPhanLo: name,
        giaTriPhanLo: price,
        baoDamDuThau,
        thoiGianThucHien: duration
      });
    }
  });
  return list;
}
export function addTuyChonMuaThemRow(data = {}) {
  const tbody = document.getElementById("tuychonmuathem-tbody");
  if (!tbody) return;
  const rowId = data.id || generateRecordId("tuychonmuathem");
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", rowId);
  const hangMuc = data.hangMuc || data.name || "";
  const donVi = data.donVi || data.unit || "";
  const soLuong = data.soLuong || data.quantity || "";
  const tyLe = data.tyLe || data.percent || "";
  const giaTriUocTinh = data.giaTriUocTinh || data.price || 0;
  tr.innerHTML = trustedHTML(`
        <td><input type="text" class="tc-name-input bf-s-e278f41ed9" value="${escapeHtml(hangMuc)}" placeholder="Tên tùy chọn mua thêm..."></td>
        <td><input type="text" class="tc-unit-input bf-s-e278f41ed9" value="${escapeHtml(donVi)}" placeholder="Ví dụ: Cái, Bộ..."></td>
        <td><input type="number" class="tc-quantity-input bf-s-e278f41ed9" value="${escapeHtml(soLuong)}" placeholder="Khối lượng..."></td>
        <td><input type="number" class="tc-percent-input bf-s-e278f41ed9" value="${escapeHtml(tyLe)}" placeholder="Tỷ lệ %..."></td>
        <td><input type="text" class="tc-price-input bf-s-e278f41ed9" value="${giaTriUocTinh ? this.model.formatVND(giaTriUocTinh) : ""}" placeholder="Giá trị (VND)..."></td>
        <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete remove-tc-row-btn" aria-label="Xóa tùy chọn" title="Xóa tùy chọn"><i data-lucide="trash-2" aria-hidden="true"></i></button></td>
    `);
  const priceInput = tr.querySelector(".tc-price-input");
  bindCurrencyElement(priceInput, (value) => this.model.formatVND(this.model.parseVND(value)));
  tr.querySelector(".remove-tc-row-btn").addEventListener("click", () => {
    tr.remove();
  });
  tbody.appendChild(tr);
  lucide.createIcons();
}
export function _loadTuyChonMuaThemRows(list) {
  const tbody = document.getElementById("tuychonmuathem-tbody");
  if (tbody) tbody.innerHTML = trustedHTML("");
  list.forEach((item) => this.addTuyChonMuaThemRow(item));
}
export function _collectTuyChonMuaThemRows() {
  const list = [];
  document.querySelectorAll("#tuychonmuathem-tbody tr").forEach((tr) => {
    const id = tr.getAttribute("data-id");
    const nameInput = tr.querySelector(".tc-name-input");
    const name = nameInput ? nameInput.value.trim() : "";
    const unitInput = tr.querySelector(".tc-unit-input");
    const unit = unitInput ? unitInput.value.trim() : "";
    const quantityInput = tr.querySelector(".tc-quantity-input");
    const quantity = quantityInput ? parseFloat(quantityInput.value) || 0 : 0;
    const percentInput = tr.querySelector(".tc-percent-input");
    const percent = percentInput ? parseFloat(percentInput.value) || 0 : 0;
    const priceInput = tr.querySelector(".tc-price-input");
    const priceVal = priceInput ? priceInput.value : "";
    const price = this.model.parseVND(priceVal);
    if (name) {
      list.push({
        id,
        hangMuc: name,
        donVi: unit,
        soLuong: quantity,
        tyLe: percent,
        giaTriUocTinh: price
      });
    }
  });
  return list;
}
export function updateGiaHanIndices() {
  const tbody = document.getElementById("gt-giahan-tbody");
  if (!tbody) return;
  tbody.querySelectorAll("tr").forEach((tr, index) => {
    const indexCell = tr.querySelector(".gh-index-cell");
    if (indexCell) {
      indexCell.textContent = `Lần ${index + 1}`;
    }
  });
  this.validateGiaHanRealtime();
}
export function validateGiaHanRealtime() {
  const mainDongThauStr = document.getElementById("gt-thoigiandongthau")?.value || "";
  const mainDongThauDate = parseBidDateTime(mainDongThauStr);
  const rows = document.querySelectorAll("#gt-giahan-tbody tr");
  const ghRowsData = [];
  rows.forEach((tr, index) => {
    const timeInput = tr.querySelector(".gh-time-input");
    if (!timeInput) return;
    setRuntimeStyle(timeInput, "borderColor", "");
    const oldErr = tr.querySelector(".gh-row-error");
    if (oldErr) oldErr.remove();
    const timeStr = timeInput.value.trim();
    if (!timeStr) return;
    const currentGiaHanDate = parseBidDateTime(timeStr);
    if (!currentGiaHanDate) {
      showRowError(tr, timeInput, "Thời gian không hợp lệ");
      return;
    }
    if (index === 0) {
      if (mainDongThauDate && currentGiaHanDate <= mainDongThauDate) {
        showRowError(tr, timeInput, `Phải lớn hơn đóng thầu gốc (${mainDongThauStr})`);
      }
    } else {
      const prevTimeStr = ghRowsData[index - 1]?.timeStr;
      const prevGiaHanDate = parseBidDateTime(prevTimeStr);
      if (prevGiaHanDate && currentGiaHanDate <= prevGiaHanDate) {
        showRowError(tr, timeInput, `Phải lớn hơn lần trước (${prevTimeStr})`);
      }
    }
    ghRowsData.push({ timeStr, date: currentGiaHanDate });
  });
  function showRowError(row, input, message) {
    setRuntimeStyle(input, "borderColor", "var(--danger)");
    const errSpan = document.createElement("span");
    errSpan.className = "gh-row-error";
    setRuntimeStyle(errSpan, "cssText", "display:block;color:var(--danger);font-size:0.75rem;margin-top:4px;font-weight:600;");
    errSpan.textContent = message;
    input.parentNode.appendChild(errSpan);
  }
}
export function addGiaHanRow(data = {}) {
  const tbody = document.getElementById("gt-giahan-tbody");
  if (!tbody) return;
  const rowId = data.id || generateRecordId("giahan");
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", rowId);
  tr.innerHTML = trustedHTML(`
        <td class="gh-index-cell bf-s-d5b21f1b33">Lần ...</td>
        <td><input type="text" class="gh-time-input flatpickr-datetime bf-s-e278f41ed9" value="${escapeHtml(data.thoiGianDongThau ? this.model.formatForDatetimeLocal(data.thoiGianDongThau) : "")}" placeholder="dd/MM/yyyy HH:mm"></td>
        <td><input type="text" class="gh-reason-input bf-s-e278f41ed9" value="${escapeHtml(data.lyDoGiaHan || "")}" placeholder="Nhập lý do gia hạn..."></td>
        <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete remove-gh-row-btn" aria-label="Xóa lần gia hạn" title="Xóa lần gia hạn"><i data-lucide="trash-2" aria-hidden="true"></i></button></td>
    `);
  const timeInput = tr.querySelector(".gh-time-input");
  timeInput.addEventListener("change", () => this.validateGiaHanRealtime());
  timeInput.addEventListener("input", () => this.validateGiaHanRealtime());
  tr.querySelector(".remove-gh-row-btn").addEventListener("click", () => {
    tr.remove();
    this.updateGiaHanIndices();
  });
  tbody.appendChild(tr);
  this.updateGiaHanIndices();
  lucide.createIcons();
  if (this.view && typeof this.view.initFlatpickr === "function") {
    this.view.initFlatpickr(tr);
  }
}
export function _loadGiaHanRows(list) {
  const tbody = document.getElementById("gt-giahan-tbody");
  if (tbody) tbody.innerHTML = trustedHTML("");
  list.forEach((item) => this.addGiaHanRow(item));
}
export function _collectGiaHanRows() {
  const list = [];
  const seen = /* @__PURE__ */ new Set();
  document.querySelectorAll("#gt-giahan-tbody tr").forEach((tr) => {
    const id = tr.getAttribute("data-id");
    const timeInput = tr.querySelector(".gh-time-input").value.trim();
    const reasonInput = tr.querySelector(".gh-reason-input").value.trim();
    if (timeInput && reasonInput) {
      const key = makeSubRowKey(timeInput, reasonInput);
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ id, thoiGianDongThau: timeInput, lyDoGiaHan: reasonInput });
    }
  });
  return list;
}
export function updateYeuCauLamRoIndices() {
  const tbody = document.getElementById("gt-yeucaulamro-tbody");
  if (!tbody) return;
  tbody.querySelectorAll("tr").forEach((tr, index) => {
    const indexCell = tr.querySelector(".yc-index-cell");
    if (indexCell) {
      indexCell.textContent = index + 1;
    }
  });
}
export function addYeuCauLamRoRow(data = {}) {
  const tbody = document.getElementById("gt-yeucaulamro-tbody");
  if (!tbody) return;
  const rowId = data.id || generateRecordId("yeucaulamro");
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", rowId);
  tr.innerHTML = trustedHTML(`
        <td class="yc-index-cell bf-s-d5b21f1b33">...</td>
        <td><input type="text" class="yc-time-input flatpickr-datetime bf-s-e278f41ed9" value="${escapeHtml(data.thoiGianYeuCau ? this.model.formatForDatetimeLocal(data.thoiGianYeuCau) : "")}" placeholder="dd/MM/yyyy HH:mm" required></td>
        <td><input type="text" class="yc-content-input bf-s-e278f41ed9" value="${escapeHtml(data.noiDungYeuCau || "")}" placeholder="Nhập nội dung yêu cầu làm rõ..." required></td>
        <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete remove-yc-row-btn" aria-label="Xóa yêu cầu làm rõ" title="Xóa yêu cầu làm rõ"><i data-lucide="trash-2" aria-hidden="true"></i></button></td>
    `);
  tr.querySelector(".remove-yc-row-btn").addEventListener("click", () => {
    tr.remove();
    this.updateYeuCauLamRoIndices();
  });
  tbody.appendChild(tr);
  this.updateYeuCauLamRoIndices();
  lucide.createIcons();
  if (this.view && typeof this.view.initFlatpickr === "function") {
    this.view.initFlatpickr(tr);
  }
}
export function _loadYeuCauLamRoRows(list) {
  const tbody = document.getElementById("gt-yeucaulamro-tbody");
  if (tbody) tbody.innerHTML = trustedHTML("");
  list.forEach((item) => this.addYeuCauLamRoRow(item));
}
export function _collectYeuCauLamRoRows() {
  const list = [];
  const seen = /* @__PURE__ */ new Set();
  document.querySelectorAll("#gt-yeucaulamro-tbody tr").forEach((tr) => {
    const id = tr.getAttribute("data-id");
    const timeInput = tr.querySelector(".yc-time-input").value.trim();
    const contentInput = tr.querySelector(".yc-content-input").value.trim();
    if (timeInput && contentInput) {
      const key = makeSubRowKey(timeInput, contentInput);
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ id, thoiGianYeuCau: timeInput, noiDungYeuCau: contentInput });
    }
  });
  return list;
}
export function updateTraLoiLamRoIndices() {
  const tbody = document.getElementById("gt-traloilamro-tbody");
  if (!tbody) return;
  tbody.querySelectorAll("tr").forEach((tr, index) => {
    const indexCell = tr.querySelector(".tl-index-cell");
    if (indexCell) {
      indexCell.textContent = index + 1;
    }
  });
}
export function addTraLoiLamRoRow(data = {}) {
  const tbody = document.getElementById("gt-traloilamro-tbody");
  if (!tbody) return;
  const rowId = data.id || generateRecordId("traloilamro");
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", rowId);
  tr.innerHTML = trustedHTML(`
        <td class="tl-index-cell bf-s-d5b21f1b33">...</td>
        <td><input type="text" class="tl-time-input flatpickr-datetime bf-s-e278f41ed9" value="${escapeHtml(data.thoiGianTraLoi ? this.model.formatForDatetimeLocal(data.thoiGianTraLoi) : "")}" placeholder="dd/MM/yyyy HH:mm" required></td>
        <td><input type="text" class="tl-content-input bf-s-e278f41ed9" value="${escapeHtml(data.noiDungTraLoi || "")}" placeholder="Nhập nội dung trả lời làm rõ..." required></td>
        <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete remove-tl-row-btn" aria-label="Xóa câu trả lời" title="Xóa câu trả lời"><i data-lucide="trash-2" aria-hidden="true"></i></button></td>
    `);
  tr.querySelector(".remove-tl-row-btn").addEventListener("click", () => {
    tr.remove();
    this.updateTraLoiLamRoIndices();
  });
  tbody.appendChild(tr);
  this.updateTraLoiLamRoIndices();
  lucide.createIcons();
  if (this.view && typeof this.view.initFlatpickr === "function") {
    this.view.initFlatpickr(tr);
  }
}
export function _loadTraLoiLamRoRows(list) {
  const tbody = document.getElementById("gt-traloilamro-tbody");
  if (tbody) tbody.innerHTML = trustedHTML("");
  list.forEach((item) => this.addTraLoiLamRoRow(item));
}
export function _collectTraLoiLamRoRows() {
  const list = [];
  const seen = /* @__PURE__ */ new Set();
  document.querySelectorAll("#gt-traloilamro-tbody tr").forEach((tr) => {
    const id = tr.getAttribute("data-id");
    const timeInput = tr.querySelector(".tl-time-input").value.trim();
    const contentInput = tr.querySelector(".tl-content-input").value.trim();
    if (timeInput && contentInput) {
      const key = makeSubRowKey(timeInput, contentInput);
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ id, thoiGianTraLoi: timeInput, noiDungTraLoi: contentInput });
    }
  });
  return list;
}
export function enforceSingleLeader(tbodyId, roleName, changedSelect = null) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const selects = tbody.querySelectorAll(`select[name="${roleName}"]`);
  let leaderSelect = null;
  if (changedSelect && changedSelect.value === "Tổ trưởng") {
    leaderSelect = changedSelect;
  } else {
    for (const sel of selects) {
      if (!sel.disabled && sel.value === "Tổ trưởng") {
        leaderSelect = sel;
        break;
      }
    }
  }
  selects.forEach((sel) => {
    const row = sel.closest("tr");
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb && cb.checked) {
      sel.disabled = false;
    } else {
      sel.disabled = true;
      sel.value = "Tổ viên";
    }
    syncCustomSelectDisabled(sel);
    if (leaderSelect) {
      if (sel !== leaderSelect) {
        const wasLeader = sel.value === "Tổ trưởng";
        sel.value = "Tổ viên";
        if (wasLeader) {
          const jobName = roleName === "tochuyengia-chucvu" ? "tochuyengia-congviec" : "tothamdinh-congviec";
          const jobInput = row.querySelector(`input[name="${jobName}"]`);
          if (jobInput) {
            if (tbodyId === "to-chuyengia-tbody") {
              jobInput.value = "Lập HSMT, đánh giá HSDT";
            } else if (tbodyId === "to-thamdinh-tbody") {
              jobInput.value = "Thẩm định HSMT, thẩm định KQLCNT";
            }
          }
        }
      }
    }
    if (sel.id) initCustomSelect(sel.id);
  });
}
import { generateRecordId } from "./idUtils.js";
