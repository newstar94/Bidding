import { parseBidDateTime } from "./dateParseUtils.js";
import { bindCurrencyElement } from "../main_controller/domUtils.js";
const escapeHtml = (value) => window.escapeHTML(value == null ? "" : value);
function normalizeSubRowValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}
function makeSubRowKey(...values) {
  return values.map(normalizeSubRowValue).join("|");
}
export function addPhanLoRow(data = {}) {
  const tbody = document.getElementById("phanlo-tbody");
  if (!tbody) return;
  const rowId = data.id || window.generateRecordId("phanlo");
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
  tr.innerHTML = `
        <td><input type="text" class="pl-code-input" value="${escapeHtml(code)}" placeholder="Mã phần lô..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="pl-name-input" value="${escapeHtml(name)}" placeholder="Nhập tên Lô/Phần..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="pl-price-input" value="${price ? this.model.formatVND(price) : ""}" placeholder="Nhập giá trị Lô (VND)..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td class="col-baodam-phanlo-cell" style="${displayStyle}"><input type="text" class="pl-baodam-input mt-format-vnd" ${requiredAttr} value="${baoDamVal ? this.model.formatVND(baoDamVal) : ""}" placeholder="Bảo đảm dự thầu..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="pl-duration-input" value="${escapeHtml(duration)}" placeholder="Ví dụ: 90 ngày..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td style="text-align: center;"><button type="button" class="btn btn-icon btn-danger remove-pl-row-btn" style="padding: 4px; border-radius: 4px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button></td>
    `;
  const priceInput = tr.querySelector(".pl-price-input");
  bindCurrencyElement(priceInput, (value) => this.model.formatVND(this.model.parseVND(value)));
  const baodamInput = tr.querySelector(".pl-baodam-input");
  if (baodamInput) {
    bindCurrencyElement(baodamInput, (value) => this.model.formatVND(this.model.parseVND(value)));
    baodamInput.addEventListener("input", () => this.recalculateTotalLotSecurities());
  }
  tr.querySelector(".remove-pl-row-btn").addEventListener("click", () => {
    tr.remove();
    this.recalculateTotalLotSecurities();
  });
  tbody.appendChild(tr);
  lucide.createIcons();
}
export function _loadPhanLoRows(list) {
  const tbody = document.getElementById("phanlo-tbody");
  if (tbody) tbody.innerHTML = "";
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
  const rowId = data.id || window.generateRecordId("tuychonmuathem");
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", rowId);
  const hangMuc = data.hangMuc || data.name || "";
  const donVi = data.donVi || data.unit || "";
  const soLuong = data.soLuong || data.quantity || "";
  const tyLe = data.tyLe || data.percent || "";
  const giaTriUocTinh = data.giaTriUocTinh || data.price || 0;
  tr.innerHTML = `
        <td><input type="text" class="tc-name-input" value="${escapeHtml(hangMuc)}" placeholder="Tên tùy chọn mua thêm..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="tc-unit-input" value="${escapeHtml(donVi)}" placeholder="Ví dụ: Cái, Bộ..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="number" class="tc-quantity-input" value="${escapeHtml(soLuong)}" placeholder="Khối lượng..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="number" class="tc-percent-input" value="${escapeHtml(tyLe)}" placeholder="Tỷ lệ %..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="tc-price-input" value="${giaTriUocTinh ? this.model.formatVND(giaTriUocTinh) : ""}" placeholder="Giá trị (VND)..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td style="text-align: center;"><button type="button" class="btn btn-icon btn-danger remove-tc-row-btn" style="padding: 4px; border-radius: 4px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button></td>
    `;
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
  if (tbody) tbody.innerHTML = "";
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
    timeInput.style.borderColor = "";
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
    input.style.borderColor = "var(--danger)";
    const errSpan = document.createElement("span");
    errSpan.className = "gh-row-error";
    errSpan.style.cssText = "display:block;color:var(--danger);font-size:0.75rem;margin-top:4px;font-weight:600;";
    errSpan.textContent = message;
    input.parentNode.appendChild(errSpan);
  }
}
export function addGiaHanRow(data = {}) {
  const tbody = document.getElementById("gt-giahan-tbody");
  if (!tbody) return;
  const rowId = data.id || window.generateRecordId("giahan");
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", rowId);
  tr.innerHTML = `
        <td class="gh-index-cell" style="font-weight: bold; text-align: center; vertical-align: middle; color: var(--text-main);">Lần ...</td>
        <td><input type="text" class="gh-time-input flatpickr-datetime" value="${data.thoiGianDongThau ? this.model.formatDate(data.thoiGianDongThau) : ""}" placeholder="dd/MM/yyyy HH:mm" style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="gh-reason-input" value="${escapeHtml(data.lyDoGiaHan || "")}" placeholder="Nhập lý do gia hạn..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td style="text-align: center;"><button type="button" class="btn btn-icon btn-danger remove-gh-row-btn" style="padding: 4px; border-radius: 4px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button></td>
    `;
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
  if (tbody) tbody.innerHTML = "";
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
  const rowId = data.id || window.generateRecordId("yeucaulamro");
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", rowId);
  tr.innerHTML = `
        <td class="yc-index-cell" style="font-weight: bold; text-align: center; vertical-align: middle; color: var(--text-main);">...</td>
        <td><input type="text" class="yc-time-input flatpickr-datetime" value="${data.thoiGianYeuCau ? this.model.formatDate(data.thoiGianYeuCau) : ""}" placeholder="dd/MM/yyyy HH:mm" style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);" required></td>
        <td><input type="text" class="yc-content-input" value="${escapeHtml(data.noiDungYeuCau || "")}" placeholder="Nhập nội dung yêu cầu làm rõ..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);" required></td>
        <td style="text-align: center;"><button type="button" class="btn btn-icon btn-danger remove-yc-row-btn" style="padding: 4px; border-radius: 4px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button></td>
    `;
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
  if (tbody) tbody.innerHTML = "";
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
  const rowId = data.id || window.generateRecordId("traloilamro");
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", rowId);
  tr.innerHTML = `
        <td class="tl-index-cell" style="font-weight: bold; text-align: center; vertical-align: middle; color: var(--text-main);">...</td>
        <td><input type="text" class="tl-time-input flatpickr-datetime" value="${data.thoiGianTraLoi ? this.model.formatDate(data.thoiGianTraLoi) : ""}" placeholder="dd/MM/yyyy HH:mm" style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);" required></td>
        <td><input type="text" class="tl-content-input" value="${escapeHtml(data.noiDungTraLoi || "")}" placeholder="Nhập nội dung trả lời làm rõ..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);" required></td>
        <td style="text-align: center;"><button type="button" class="btn btn-icon btn-danger remove-tl-row-btn" style="padding: 4px; border-radius: 4px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button></td>
    `;
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
  if (tbody) tbody.innerHTML = "";
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
    if (window.syncCustomSelectDisabled) {
      window.syncCustomSelectDisabled(sel);
    }
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
    if (window.initCustomSelect && sel.id) {
      window.initCustomSelect(sel.id);
    }
  });
}
