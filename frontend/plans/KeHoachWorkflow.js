import { setRuntimeStyle } from "../shared/runtimeStyles.js";
﻿import { captureModalReturnState, hasModalReturnState, updateModalReturnAction } from "../app/modalReturnState.js";
import { bindCurrencyElement } from "../app/domUtils.js";
import {
  canDeleteVersions,
  createNextVersion,
  preparePackageSnapshot,
  rememberSelectedVersion,
  removeAllVersions,
  removeLatestVersion
} from "../shared/VersionedEntityService.js";
import { persistAndSync } from "../shared/MutationService.js";
import { getHolidays } from "../shared/runtimeState.js";
import { generateRecordId } from "../shared/idUtils.js";
import { escapeHtml } from "../shared/view_helpers.js";
export async function deleteKeHoach(id) {
  const targetPlan = this.model.state.kehoach.find((k) => k.id === id);
  if (!targetPlan) return;
  const rootId = targetPlan.rootId || targetPlan.id;
  const relatedPlans = this.model.state.kehoach.filter((kh) => (kh.rootId || kh.id) === rootId);
  if (relatedPlans.length >= 2) {
    const choice = await this.view.customVersionDeleteChoice(
      "Xác nhận xóa",
      `Kế hoạch "${targetPlan.tenKeHoach}" có ${relatedPlans.length} phiên bản. Vui lòng chọn cách thức xóa:`,
      "Xóa phiên bản gần nhất",
      "Xóa toàn bộ"
    );
    if (choice === null) return;
    if (choice === 1) {
      const preview = removeLatestVersion(this.model.state.kehoach, targetPlan);
      const latestKh = preview.removed[0];
      if (!latestKh) return;
      const deletionCheck = canDeleteVersions(latestKh, [{
        name: "goithau", records: this.model.state.goithau, foreignKey: "keHoachId"
      }]);
      if (!deletionCheck.allowed) {
        await this.view.customAlert(
          "Không thể xóa",
          "Không thể xóa phiên bản gần nhất này vì có các Gói thầu đang liên kết trực tiếp với phiên bản này. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.",
          "x-circle"
        );
        return;
      }
      this.model.state.kehoach = preview.records;
      this.model.markDeleted("kehoach", preview.removed.map((item) => item.id));
      await persistAndSync(this, "kehoach", {
        afterPersist: () => this.view.renderKeHoachTable()
      });
      await this.view.customAlert("Thành công", "Đã xóa phiên bản kế hoạch gần nhất!", "check-circle");
      return;
    } else if (choice === 2) {
      const deletionCheck = canDeleteVersions(relatedPlans, [{
        name: "goithau", records: this.model.state.goithau, foreignKey: "keHoachId"
      }]);
      if (!deletionCheck.allowed) {
        await this.view.customAlert(
          "Không thể xóa",
          "Không thể xóa kế hoạch này vì có các Gói thầu đang liên kết trực tiếp với các phiên bản của kế hoạch này. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.",
          "x-circle"
        );
        return;
      }
      const result = removeAllVersions(this.model.state.kehoach, targetPlan);
      this.model.state.kehoach = result.records;
      this.model.markDeleted("kehoach", result.removed.map((item) => item.id));
      await persistAndSync(this, "kehoach", {
        afterPersist: () => this.view.renderKeHoachTable()
      });
      await this.view.customAlert("Thành công", "Đã xóa toàn bộ các phiên bản của kế hoạch!", "check-circle");
      return;
    }
  } else {
    const deletionCheck = canDeleteVersions(relatedPlans, [{
      name: "goithau", records: this.model.state.goithau, foreignKey: "keHoachId"
    }]);
    if (!deletionCheck.allowed) {
      await this.view.customAlert(
        "Không thể xóa",
        "Không thể xóa kế hoạch này vì có các Gói thầu đang liên kết trực tiếp với kế hoạch này. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.",
        "x-circle"
      );
      return;
    }
    const confirmed = await this.view.customConfirm(
      "Xác nhận xóa",
      `Bạn có chắc chắn muốn xóa kế hoạch "${targetPlan.tenKeHoach}"? Dữ liệu sẽ mất vĩnh viễn.`,
      "trash-2"
    );
    if (confirmed) {
      this.model.state.kehoach = this.model.state.kehoach.filter((kh) => kh.id !== id);
      this.model.markDeleted("kehoach", id);
      await persistAndSync(this, "kehoach", {
        afterPersist: () => this.view.renderKeHoachTable()
      });
    }
  }
}
export async function editKeHoach(id) {
  if (!document.getElementById("modal-kehoach")) {
    await this.ensureLazyModal?.("modal-kehoach");
  }
  const modal = document.getElementById("modal-kehoach");
  const form = document.getElementById("form-kehoach");
  form.querySelectorAll(".form-group").forEach((fg) => fg.classList.remove("invalid"));
  const cdtSelect = document.getElementById("kh-chudautuid");
  const latestCDTs = this.model.getLatestChuDauTu() || [];
  cdtSelect.innerHTML = '<option value="">-- Chọn Chủ đầu tư --</option>' + latestCDTs.map((c) => `<option value="${escapeHtml(c.id)}" data-search="${escapeHtml(`${c.maChuDauTu || ""} ${c.tenChuDauTu || ""}`)}">${escapeHtml(c.tenChuDauTu)}${escapeHtml(this.model.getPendingLabel("chudautu", c.id))}</option>`).join("") + '<option value="__NEW_INVESTOR__" class="bf-s-5762556293">+ Thêm chủ đầu tư mới</option>';
  // The plan modal is lazy-loaded, so this select does not exist when the
  // application's one-time conditional handlers are registered.
  cdtSelect.onchange = async (event) => {
    if (event.target.value !== "__NEW_INVESTOR__") return;
    event.target.value = "";
    await this.ensureWorkflowModules?.("partner");
    await this.editChuDauTu(null);
  };
  this.makeSearchableSelect(cdtSelect, "Tìm kiếm Chủ đầu tư...");
  const loaiHinhSelect = document.getElementById("kh-loaihinh");
  const projectFields = document.getElementById("kh-project-fields");
  const toggleProjectFields = () => {
    if (loaiHinhSelect.value === "Dự án") {
      setRuntimeStyle(projectFields, "display", "block");
    } else {
      setRuntimeStyle(projectFields, "display", "none");
    }
  };
  loaiHinhSelect.onchange = toggleProjectFields;
  const pheDuyetSelect = document.getElementById("kh-pheduyet");
  const pheDuyetFields = document.getElementById("kh-pheduyet-kehoach-fields");
  const setRequiredLabel = (label, text) => {
    if (!label) return;
    label.textContent = `${text} `;
    const marker = document.createElement("span");
    marker.className = "required";
    marker.textContent = "*";
    label.append(marker);
  };
  const togglePheDuyetFields = () => {
    const container = document.getElementById("kh-ngaytrinhkehoach-container");
    const label = document.getElementById("lbl-ngaytrinhkehoach");
    const labelPheDuyet = document.getElementById("lbl-ngaypheduyet");
    const labelQuyetDinh = document.getElementById("lbl-quyetdinh");
    if (pheDuyetSelect.value === "Kế hoạch") {
      setRuntimeStyle(pheDuyetFields, "display", "block");
      if (container) setRuntimeStyle(container, "display", "block");
      setRequiredLabel(label, "Ngày trình kế hoạch");
      setRequiredLabel(labelPheDuyet, "Ngày phê duyệt kế hoạch");
      setRequiredLabel(labelQuyetDinh, "Số QĐ phê duyệt kế hoạch");
    } else if (pheDuyetSelect.value === "Dự toán và kế hoạch") {
      setRuntimeStyle(pheDuyetFields, "display", "none");
      if (container) setRuntimeStyle(container, "display", "block");
      setRequiredLabel(label, "Ngày trình dự toán và kế hoạch");
      setRequiredLabel(labelPheDuyet, "Ngày phê duyệt dự toán và kế hoạch");
      setRequiredLabel(labelQuyetDinh, "Số QĐ phê duyệt dự toán và kế hoạch");
    } else {
      setRuntimeStyle(pheDuyetFields, "display", "none");
      if (container) setRuntimeStyle(container, "display", "none");
      setRequiredLabel(labelPheDuyet, "Ngày phê duyệt");
      setRequiredLabel(labelQuyetDinh, "Số QĐ phê duyệt");
    }
  };
  pheDuyetSelect.onchange = togglePheDuyetFields;
  if (id) {
    captureModalReturnState(this.model.state.activetab || "kehoach", this.model.state.activeaction || null);
    this.switchTab("kehoach", "chinhsua", true);
    document.getElementById("modal-kehoach-title").textContent = "Cập nhật Kế hoạch LCNT";
    const kh = this.model.state.kehoach.find((k) => String(k.id) === String(id));
    const existingCode = this.model.getPlanBaseCode(kh.maKeHoach);
    document.getElementById("form-kehoach-id").value = kh.id;
    document.getElementById("kh-ma").value = existingCode;
    const khMaInput = document.getElementById("kh-ma");
    if (khMaInput) {
      if (existingCode && existingCode.trim() !== "" && kh.thoiGianDangMa) {
        khMaInput.setAttribute("readonly", "true");
      } else {
        khMaInput.removeAttribute("readonly");
      }
    }
    document.getElementById("kh-ten").value = kh.tenKeHoach;
    document.getElementById("kh-loaihinh").value = kh.loaiHinhMuaSam || "";
    document.getElementById("kh-duan").value = kh.tenDuAnDuToan || "";
    document.getElementById("kh-chudautuid").value = kh.chuDauTuId;
    document.getElementById("kh-donvitrinhcdt").value = kh.donViTrinhCdt || "";
    document.getElementById("kh-tenviettatdonvitrinh").value = kh.tenVietTatDonViTrinh || "";
    const tmInput = document.getElementById("kh-tongmuc");
    tmInput.value = kh.tongMucDauTu ? this.model.formatVND(kh.tongMucDauTu) : "";
    tmInput.placeholder = kh.isTongMucTuDong === true || kh.isTongMucTuDong === 1 || !kh.tongMucDauTu ? "Tổng Dự toán/Tổng mức đầu tư" : "Nhập số tiền";
    tmInput.setAttribute("data-initial-val", tmInput.value);
    tmInput.setAttribute("data-was-auto", kh.isTongMucTuDong === true || kh.isTongMucTuDong === 1 || !kh.tongMucDauTu ? "true" : "false");
    tmInput.disabled = false;
    document.getElementById("kh-pheduyet").value = kh.pheDuyet || "";
    togglePheDuyetFields();
    document.getElementById("kh-ngaytrinhkehoach").value = this.model.formatForDateInput(kh.ngayTrinhKeHoach);
    document.getElementById("kh-ngaytrinhdutoan").value = this.model.formatForDateInput(kh.ngayTrinhDuToan);
    document.getElementById("kh-ngaypheduyetdutoan").value = this.model.formatForDateInput(kh.ngayPheDuyetDuToan);
    document.getElementById("kh-quyetdinhpheduyetdutoan").value = kh.soQdPheDuyetDuToan || "";
    document.getElementById("kh-maduan").value = kh.maDuan || "";
    document.getElementById("kh-nguonvon").value = kh.nguonVon || "";
    document.getElementById("kh-thoigian-duan").value = kh.thoiGianDuAn || "";
    document.getElementById("kh-soqdpheduyetduan").value = kh.soQdPheDuyetDuAn || "";
    document.getElementById("kh-ngayqdpheduyetduan").value = this.model.formatForDateInput(kh.ngayQdPheDuyetDuAn);
    document.getElementById("kh-coquanpheduyetduan").value = kh.coQuanPheDuyetDuAn || "";
    document.getElementById("kh-diadiem-quymo").value = kh.diadiemQuymo || "";
    document.getElementById("kh-thongtinkhac").value = kh.thongtinKhac || "";
    toggleProjectFields();
    document.getElementById("kh-ngaypheduyet").value = this.model.formatForDateInput(kh.ngayPheDuyet);
    document.getElementById("kh-quyetdinh").value = kh.quyetDinhPheDuyet;
    document.getElementById("kh-thoigiandang").value = kh.thoiGianDangMa ? this.model.formatForDatetimeLocal(kh.thoiGianDangMa) : "";
  } else {
    captureModalReturnState(this.model.state.activetab || "kehoach", this.model.state.activeaction || null);
    this.switchTab("kehoach", "taomoi", true);
    document.getElementById("modal-kehoach-title").textContent = "Thêm Kế hoạch LCNT mới";
    form.reset();
    document.getElementById("form-kehoach-id").value = "";
    const tmInput = document.getElementById("kh-tongmuc");
    tmInput.value = "";
    tmInput.placeholder = "Tổng Dự toán/Tổng mức đầu tư";
    tmInput.removeAttribute("data-initial-val");
    tmInput.removeAttribute("data-was-auto");
    tmInput.disabled = false;
    document.getElementById("kh-pheduyet").value = "";
    togglePheDuyetFields();
    document.getElementById("kh-ngaytrinhkehoach").value = "";
    document.getElementById("kh-ngaytrinhdutoan").value = "";
    document.getElementById("kh-ngaypheduyetdutoan").value = "";
    document.getElementById("kh-quyetdinhpheduyetdutoan").value = "";
    document.getElementById("kh-donvitrinhcdt").value = "";
    document.getElementById("kh-tenviettatdonvitrinh").value = "";
    document.getElementById("kh-maduan").value = "";
    document.getElementById("kh-nguonvon").value = "";
    document.getElementById("kh-thoigian-duan").value = "";
    document.getElementById("kh-soqdpheduyetduan").value = "";
    document.getElementById("kh-ngayqdpheduyetduan").value = "";
    document.getElementById("kh-coquanpheduyetduan").value = "";
    document.getElementById("kh-diadiem-quymo").value = "";
    document.getElementById("kh-thongtinkhac").value = "";
    toggleProjectFields();
    document.getElementById("kh-ngaypheduyet").value = "";
    document.getElementById("kh-thoigiandang").value = "";
    const khMaInput = document.getElementById("kh-ma");
    if (khMaInput) {
      khMaInput.removeAttribute("readonly");
    }
  }
  lucide.createIcons();
  this.view.openModal("modal-kehoach");
  const addWorkingDays = (startDateStr, days) => {
    if (!startDateStr) return "";
    const parts = startDateStr.split("/");
    if (parts.length !== 3) return "";
    let date = new Date(parts[2], parts[1] - 1, parts[0]);
    if (isNaN(date.getTime())) return "";
    const holidaysData = getHolidays();
    let direction = days < 0 ? -1 : 1;
    let remainingDays = Math.abs(days);
    while (remainingDays > 0) {
      date.setDate(date.getDate() + direction);
      let dayOfWeek = date.getDay();
      let dateStr = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
      let yearStr = String(date.getFullYear());
      let isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const yearWorkingWeekends = holidaysData[yearStr]?.working_weekends || [];
      if (isWeekend && yearWorkingWeekends.includes(dateStr)) {
        isWeekend = false;
      }
      const yearHolidays = holidaysData[yearStr]?.holidays || [];
      const isHoliday = yearHolidays.includes(dateStr);
      if (!isWeekend && !isHoliday) {
        remainingDays--;
      }
    }
    return String(date.getDate()).padStart(2, "0") + "/" + String(date.getMonth() + 1).padStart(2, "0") + "/" + date.getFullYear();
  };
  const trinhDuToanInp = document.getElementById("kh-ngaytrinhdutoan");
  const pheDuyetDuToanInp = document.getElementById("kh-ngaypheduyetdutoan");
  const trinhKeHoachInp = document.getElementById("kh-ngaytrinhkehoach");
  const pheDuyetKeHoachInp = document.getElementById("kh-ngaypheduyet");
  const pheDuyetSel = document.getElementById("kh-pheduyet");
  const updateFlatpickrValue = (inputEl, val) => {
    if (!inputEl) return;
    inputEl.value = val;
    if (inputEl._flatpickr) {
      inputEl._flatpickr.setDate(val, false);
    }
    inputEl.dispatchEvent(new Event("change"));
  };
  if (trinhDuToanInp && !trinhDuToanInp.dataset.hasDateListeners) {
    trinhDuToanInp.dataset.hasDateListeners = "true";
    trinhDuToanInp.addEventListener("change", () => {
      if (pheDuyetSel.value === "Kế hoạch") {
        const nextDate = addWorkingDays(trinhDuToanInp.value, 1);
        updateFlatpickrValue(pheDuyetDuToanInp, nextDate);
      }
    });
  }
  if (pheDuyetDuToanInp && !pheDuyetDuToanInp.dataset.hasDateListeners) {
    pheDuyetDuToanInp.dataset.hasDateListeners = "true";
    pheDuyetDuToanInp.addEventListener("change", () => {
      if (pheDuyetSel.value === "Kế hoạch") {
        updateFlatpickrValue(trinhKeHoachInp, pheDuyetDuToanInp.value);
      }
    });
  }
  if (trinhKeHoachInp && !trinhKeHoachInp.dataset.hasDateListeners) {
    trinhKeHoachInp.dataset.hasDateListeners = "true";
    trinhKeHoachInp.addEventListener("change", () => {
      const nextDate = addWorkingDays(trinhKeHoachInp.value, 1);
      updateFlatpickrValue(pheDuyetKeHoachInp, nextDate);
    });
  }
}
export async function handleKeHoachSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-kehoach");
  if (!this.view.validateForm(form)) return;
  const id = document.getElementById("form-kehoach-id").value;
  let targetPlanId = id;
  const now = /* @__PURE__ */ new Date();
  const formattedTime = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0") + " " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0") + ":" + String(now.getSeconds()).padStart(2, "0");
  let inputCode = document.getElementById("kh-ma").value.trim();
  if (inputCode) {
    let isDuplicate = false;
    if (id) {
      const oldKh = this.model.state.kehoach.find((k) => k.id === id);
      const root = oldKh.rootId || oldKh.id;
      isDuplicate = this.model.state.kehoach.some(
        (k) => k.maKeHoach.toLowerCase() === inputCode.toLowerCase() && (k.rootId || k.id) !== root
      );
    } else {
      isDuplicate = this.model.state.kehoach.some((k) => k.maKeHoach.toLowerCase() === inputCode.toLowerCase());
    }
    if (isDuplicate) {
      const inputEl = document.getElementById("kh-ma");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Mã kế hoạch đã tồn tại ở một kế hoạch khác. Vui lòng nhập mã duy nhất!";
          inputEl.addEventListener("input", () => {
            formGroup.classList.remove("invalid");
            errText.textContent = originalErr;
          }, { once: true });
        }
      }
      this.view.focusInvalidControl(inputEl);
      return;
    }
  }
  const publishTimeVal = document.getElementById("kh-thoigiandang").value;
  const finalPublishTime = publishTimeVal ? this.model.convertDMYHMSToYMDHMS(publishTimeVal) : null;
  const ngayPheDuyetRaw = document.getElementById("kh-ngaypheduyet").value;
  const ngayPheDuyetYMD = this.model.convertDMYToYMD(ngayPheDuyetRaw);
  const pheDuyet = document.getElementById("kh-pheduyet").value;
  const ngayTrinhKeHoachRaw = document.getElementById("kh-ngaytrinhkehoach").value;
  const ngayTrinhKeHoachYMD = this.model.convertDMYToYMD(ngayTrinhKeHoachRaw);
  const ngayTrinhDuToanRaw = document.getElementById("kh-ngaytrinhdutoan").value;
  const ngayTrinhDuToanYMD = this.model.convertDMYToYMD(ngayTrinhDuToanRaw);
  const ngayPheDuyetDuToanRaw = document.getElementById("kh-ngaypheduyetdutoan").value;
  const ngayPheDuyetDuToanYMD = this.model.convertDMYToYMD(ngayPheDuyetDuToanRaw);
  const soQdPheDuyetDuToan = document.getElementById("kh-quyetdinhpheduyetdutoan").value.trim();
  const donViTrinhCdt = document.getElementById("kh-donvitrinhcdt").value.trim();
  const tenVietTatDonViTrinh = document.getElementById("kh-tenviettatdonvitrinh").value.trim();
  const maDuan = document.getElementById("kh-maduan").value.trim();
  const nguonVon = document.getElementById("kh-nguonvon").value.trim();
  const thoiGianDuAn = document.getElementById("kh-thoigian-duan").value.trim();
  const soQdPheDuyetDuAn = document.getElementById("kh-soqdpheduyetduan").value.trim();
  const ngayQdPheDuyetDuAnRaw = document.getElementById("kh-ngayqdpheduyetduan").value;
  const ngayQdPheDuyetDuAnYMD = this.model.convertDMYToYMD(ngayQdPheDuyetDuAnRaw);
  const coQuanPheDuyetDuAn = document.getElementById("kh-coquanpheduyetduan").value.trim();
  const diadiemQuymo = document.getElementById("kh-diadiem-quymo").value.trim();
  const thongtinKhac = document.getElementById("kh-thongtinkhac").value.trim();
  const tmInput = document.getElementById("kh-tongmuc");
  const currentVal = tmInput.value.trim();
  const initialVal = tmInput.getAttribute("data-initial-val") || "";
  const wasAuto = tmInput.getAttribute("data-was-auto") === "true";
  let isTongMucTuDong = false;
  if (!currentVal) {
    isTongMucTuDong = true;
  } else if (wasAuto && currentVal === initialVal) {
    isTongMucTuDong = true;
  }
  const parsedTongMuc = isTongMucTuDong ? 0 : this.model.parseVND(currentVal);
  if (parsedTongMuc < 0) {
    await this.view.customAlert("Dữ liệu không hợp lệ", "Tổng mức đầu tư không được nhỏ hơn 0.", "alert-triangle", tmInput);
    return;
  }
  this.backupKeHoachState = JSON.parse(JSON.stringify(this.model.state.kehoach));
  this.backupGoiThauState = JSON.parse(JSON.stringify(this.model.state.goithau));
  const loaiHinhVal = document.getElementById("kh-loaihinh").value;
  this.tempPlanData = {
    maKeHoach: inputCode,
    tenKeHoach: document.getElementById("kh-ten").value.trim(),
    loaiHinhMuaSam: loaiHinhVal,
    tenDuAnDuToan: document.getElementById("kh-duan").value.trim(),
    chuDauTuId: document.getElementById("kh-chudautuid").value,
    donViTrinhCdt,
    tenVietTatDonViTrinh,
    tongMucDauTu: isTongMucTuDong ? 0 : this.model.parseVND(currentVal),
    isTongMucTuDong,
    ngayPheDuyet: ngayPheDuyetYMD,
    quyetDinhPheDuyet: document.getElementById("kh-quyetdinh").value.trim(),
    thoiGianDangMa: finalPublishTime,
    nguonVon,
    thoiGianDuAn,
    maDuan: loaiHinhVal === "Dự án" ? maDuan : "",
    soQdPheDuyetDuAn: loaiHinhVal === "Dự án" ? soQdPheDuyetDuAn : "",
    ngayQdPheDuyetDuAn: loaiHinhVal === "Dự án" ? ngayQdPheDuyetDuAnYMD : "",
    coQuanPheDuyetDuAn: loaiHinhVal === "Dự án" ? coQuanPheDuyetDuAn : "",
    diadiemQuymo,
    thongtinKhac,
    pheDuyet,
    ngayTrinhKeHoach: ngayTrinhKeHoachYMD,
    ngayTrinhDuToan: pheDuyet === "Kế hoạch" ? ngayTrinhDuToanYMD : "",
    ngayPheDuyetDuToan: pheDuyet === "Kế hoạch" ? ngayPheDuyetDuToanYMD : "",
    soQdPheDuyetDuToan: pheDuyet === "Kế hoạch" ? soQdPheDuyetDuToan : ""
  };
  if (id) {
    this.tempPlanAction = "edit";
    this.tempPlanData.id = id;
    const oldKh = this.model.state.kehoach.find((k) => k.id === id);
    if (oldKh) {
      Object.assign(oldKh, this.tempPlanData);
      oldKh.updatedAt = this.model.getCurrentDateTimeString();
    }
  } else {
    this.tempPlanAction = "create";
    const planId = generateRecordId("kehoach");
    targetPlanId = planId;
    this.tempPlanData.id = planId;
    this.model.state.kehoach.push({
      id: planId,
      phienBan: "00",
      isLatest: 1,
      rootId: planId,
      createdAt: this.model.getCurrentDateTimeString(),
      updatedAt: this.model.getCurrentDateTimeString(),
      ...this.tempPlanData
    });
  }
  if (isTongMucTuDong) {
    this.recalculatePlanTotal(targetPlanId);
  }
  this.view.closeModal("modal-kehoach");
  this.openPlanBreakdownModal(targetPlanId);
}
export async function openPlanBreakdownModal(planId) {
  if (!document.getElementById("modal-plan-breakdown")) {
    this.ensureLazyModal?.("modal-plan-breakdown").then(() => this.openPlanBreakdownModal(planId));
    return;
  }
  const kh = this.model.state.kehoach.find((k) => k.id === planId);
  if (!kh) return;
  document.getElementById("breakdown-plan-id").value = planId;
  document.getElementById("breakdown-modal-subtitle").innerHTML = `
        <strong>Kế hoạch:</strong> ${escapeHtml(kh.tenKeHoach)} <span class="badge badge-info bf-s-9d5367afed">${escapeHtml(this.model.getVersionLabel(kh.phienBan))}</span><br>
        <span class="bf-s-d922053a79"><strong>Mã:</strong> ${escapeHtml(this.model.getPlanBaseCode(kh.maKeHoach) || "(Chưa có)")} | <span id="breakdown-total-display"></span></span>
    `;
  const tbody1 = document.getElementById("tbody-breakdown-dathuchien");
  tbody1.innerHTML = "";
  const list1 = kh.cvDaThucHienList || [];
  if (list1.length === 0) {
    this.addBreakdownRow("dathuchien");
  } else {
    list1.forEach((item) => this.addBreakdownRow("dathuchien", item));
  }
  const tbody2 = document.getElementById("tbody-breakdown-khongapdung");
  tbody2.innerHTML = "";
  const list2 = kh.cvKhongApDungList || [];
  if (list2.length === 0) {
    this.addBreakdownRow("khongapdung");
  } else {
    list2.forEach((item) => this.addBreakdownRow("khongapdung", item));
  }
  const tbody3 = document.getElementById("tbody-breakdown-chuadudieuKien");
  tbody3.innerHTML = "";
  const list3 = kh.cvChuaDuDieuKienList || [];
  if (list3.length === 0) {
    this.addBreakdownRow("chuadudieuKien");
  } else {
    list3.forEach((item) => this.addBreakdownRow("chuadudieuKien", item));
  }
  this.renderBreakdownPackagesList(planId);
  const btnAddPkg = document.getElementById("btn-breakdown-add-package");
  if (btnAddPkg) {
    btnAddPkg.onclick = async () => {
      await this.ensureWorkflowModules?.("package");
      await this.editGoiThau(null);
      const planSelect = document.getElementById("gt-kehoachid");
      if (planSelect) {
        planSelect.value = planId;
        planSelect.setAttribute("readonly", "true");
        setRuntimeStyle(planSelect, "pointerEvents", "none");
        setRuntimeStyle(planSelect, "background", "var(--neutral-soft)");
        planSelect.dispatchEvent(new Event("change"));
      }
    };
  }
  const btnSave = document.getElementById("btn-save-plan-breakdown");
  btnSave.onclick = () => this.savePlanBreakdown();
  const tabBtns = document.querySelectorAll(".breakdown-tab-btn");
  const panes = document.querySelectorAll(".breakdown-pane");
  tabBtns.forEach((btn) => {
    btn.onclick = () => {
      tabBtns.forEach((b) => {
        b.classList.remove("active");
        setRuntimeStyle(b, "borderBottomColor", "transparent");
        setRuntimeStyle(b, "color", "var(--text-muted)");
      });
      panes.forEach((p) => setRuntimeStyle(p, "display", "none"));
      btn.classList.add("active");
      setRuntimeStyle(btn, "borderBottomColor", "var(--primary)");
      setRuntimeStyle(btn, "color", "var(--primary)");
      const targetTab = btn.getAttribute("data-breakdown-tab");
      setRuntimeStyle(document.getElementById(`pane-${targetTab}`), "display", "block");
    };
  });
  tabBtns[0].click();
  this.updateBreakdownTotal(planId);
  this.view.openModal("modal-plan-breakdown");
  lucide.createIcons();
  await this.loadBreakdownPackageDetails(planId);
}
export async function loadBreakdownPackageDetails(planId) {
  if (!planId || typeof this.fetchRecordByLookup !== "function") return;
  const packages = this.model.getLatestPackagesForPlan(planId);
  const incompletePackages = packages.filter((gt) => gt.referenceOnly === true ||
    gt.giaGoiThau === void 0 || gt.giaGoiThau === null ||
    gt.hinhThucLuaChon === void 0 || gt.hinhThucLuaChon === null || gt.hinhThucLuaChon === "");
  if (incompletePackages.length === 0) return;
  await Promise.all(incompletePackages.map((gt) =>
    this.fetchRecordByLookup("goithau", gt.id || gt.maGoiThau).catch((error) => {
      console.error("Failed to load package details for plan breakdown:", error);
      return null;
    })
  ));
  if (String(document.getElementById("breakdown-plan-id")?.value || "") !== String(planId)) return;
  this.renderBreakdownPackagesList(planId);
  this.updateBreakdownTotal(planId);
  lucide.createIcons();
}
export function renderBreakdownPackagesList(planId) {
  const tbody = document.getElementById("tbody-breakdown-goithau");
  if (!tbody) return;
  const pkgs = this.model.getLatestPackagesForPlan(planId);
  if (pkgs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="bf-s-058d4c8b3d"><small>Chưa có gói thầu nào được tạo cho kế hoạch này.</small></td></tr>`;
    return;
  }
  tbody.innerHTML = pkgs.map((gt) => {
    const hinhThuc = gt.hinhThucLuaChon || "--";
    const getStatusBadge = this.view?.getStatusBadge || this.getStatusBadge;
    const trangThaiBadge = typeof getStatusBadge === "function"
      ? getStatusBadge.call(this.view || this, gt.trangThai)
      : escapeHtml(gt.trangThai || "--");
    return `
            <tr class="bf-s-ddc4ced4b2">
                <td class="bf-s-e69a70165f">${escapeHtml(this.model.getPackageBaseCode(gt.maGoiThau) || "--")}</td>
                <td class="bf-s-5af3dfe0e6">${escapeHtml(gt.tenGoiThau)}</td>
                <td class="bf-s-fa7d102d10">${this.model.formatCurrency(gt.giaGoiThau)}</td>
                <td class="bf-s-c6760d4ab4">${escapeHtml(hinhThuc)}</td>
                <td class="bf-s-69a042494b">${trangThaiBadge}</td>
                <td class="bf-s-59809c145b">
                    ${gt.trangThai === "Đã có kết quả" || gt.trangThai === "Hủy thầu" ? `<button type="button" class="btn btn-outline btn-sm bf-s-882b8568ba" data-bf-action="show-package" data-close-before="modal-plan-breakdown" data-id="${escapeHtml(gt.id)}">Xem</button>` : `<button type="button" class="btn btn-outline btn-sm bf-s-882b8568ba" data-bf-action="edit-package" data-id="${escapeHtml(gt.id)}">Sửa</button>`}
                </td>
            </tr>
        `;
  }).join("");
}
export function addBreakdownRow(type, data = null) {
  const tbody = document.getElementById(`tbody-breakdown-${type}`);
  if (!tbody) return;
  const planId = document.getElementById("breakdown-plan-id").value;
  const row = document.createElement("tr");
  setRuntimeStyle(row, "borderBottom", "1px solid var(--border-color)");
  if (type === "dathuchien") {
    row.innerHTML = `
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-name bf-s-fa7eceb10a" required value="${escapeHtml(data?.tenCongViec || "")}" placeholder="Nhập tên phần công việc..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-value text-right bf-s-3f7d24416d" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ""}" placeholder="Nhập giá trị..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-unit bf-s-fa7eceb10a" value="${escapeHtml(data?.donViThucHien || "")}" placeholder="Đơn vị thực hiện..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-doc bf-s-fa7eceb10a" value="${escapeHtml(data?.vanBanPheDuyet || "")}" placeholder="Văn bản phê duyệt..."></td>
            <td class="bf-s-4f08020cfe"><button type="button" class="btn-delete-row bf-s-84f95aa87c" data-bf-action="call" data-fn="removeBreakdownRow" data-args='[null,"dathuchien"]'>&times;</button></td>
        `;
  } else if (type === "khongapdung") {
    row.innerHTML = `
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-name bf-s-fa7eceb10a" required value="${escapeHtml(data?.tenCongViec || "")}" placeholder="Nhập tên phần công việc..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-value text-right bf-s-3f7d24416d" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ""}" placeholder="Nhập giá trị..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-unit bf-s-fa7eceb10a" value="${escapeHtml(data?.donViThucHien || "")}" placeholder="Đơn vị thực hiện..."></td>
            <td class="bf-s-4f08020cfe"><button type="button" class="btn-delete-row bf-s-84f95aa87c" data-bf-action="call" data-fn="removeBreakdownRow" data-args='[null,"khongapdung"]'>&times;</button></td>
        `;
  } else if (type === "chuadudieuKien") {
    row.innerHTML = `
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-name bf-s-fa7eceb10a" required value="${escapeHtml(data?.tenCongViec || "")}" placeholder="Nhập tên phần công việc..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-value text-right bf-s-3f7d24416d" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ""}" placeholder="Nhập giá trị..."></td>
            <td class="bf-s-4f08020cfe"><button type="button" class="btn-delete-row bf-s-84f95aa87c" data-bf-action="call" data-fn="removeBreakdownRow" data-args='[null,"chuadudieuKien"]'>&times;</button></td>
        `;
  }
  const priceInput = row.querySelector(".breakdown-value");
  if (priceInput) {
    bindCurrencyElement(priceInput, (value) => this.model.formatVND(value));
    priceInput.addEventListener("input", () => {
      if (planId) {
        this.updateBreakdownTotal(planId);
      }
    });
  }
  tbody.appendChild(row);
}
export function removeBreakdownRow(btn, type) {
  const planId = document.getElementById("breakdown-plan-id").value;
  const row = btn.closest("tr");
  if (row) {
    row.remove();
    if (planId) {
      this.updateBreakdownTotal(planId);
    }
  }
}
export function updateBreakdownTotal(planId) {
  const kh = this.model.state.kehoach.find((k) => k.id === planId);
  if (!kh) return;
  const parseInputsVal = (type) => {
    const tbody = document.getElementById(`tbody-breakdown-${type}`);
    if (!tbody) return 0;
    return this.model.sumVND(Array.from(tbody.querySelectorAll(".breakdown-value"), (input) => input.value));
  };
  const sumI = parseInputsVal("dathuchien");
  const sumII = parseInputsVal("khongapdung");
  const sumIII = parseInputsVal("chuadudieuKien");
  const pkgs = this.model.getLatestPackagesForPlan(planId);
  const sumIV = this.model.sumVND(pkgs.filter((item) => !item.isRebid).map((item) => item.giaGoiThau || 0));
  const isProject = kh.loaiHinhMuaSam === "Dự án";
  const total = this.model.sumVND(isProject ? [sumI, sumII, sumIII, sumIV] : [sumII, sumIII, sumIV]);
  if (kh.tongMucDauTu && kh.tongMucDauTu > 1 && kh.isTongMucTuDong !== true) {
  } else {
    kh.tongMucDauTu = total;
    kh.isTongMucTuDong = true;
  }
  const labelTitle = isProject ? "Tổng mức đầu tư" : "Tổng dự toán";
  const totalSpan = document.getElementById("breakdown-total-display");
  if (totalSpan) {
    totalSpan.innerHTML = `<strong>${labelTitle}:</strong> <span class="text-blue bf-s-9ffafcc45f">${this.model.formatCurrency(kh.tongMucDauTu)}</span>`;
  }
}
export function recalculatePlanTotal(planId) {
  const kh = this.model.state.kehoach.find((k) => k.id === planId);
  if (!kh) return;
  if (kh.tongMucDauTu && kh.tongMucDauTu > 1 && kh.isTongMucTuDong !== true) {
    return;
  }
  const sumI = this.model.sumVND((kh.cvDaThucHienList || []).map((item) => item.giaTri || 0));
  const sumII = this.model.sumVND((kh.cvKhongApDungList || []).map((item) => item.giaTri || 0));
  const sumIII = this.model.sumVND((kh.cvChuaDuDieuKienList || []).map((item) => item.giaTri || 0));
  const pkgs = this.model.getLatestPackagesForPlan(planId);
  const sumIV = this.model.sumVND(pkgs.filter((item) => !item.isRebid).map((item) => item.giaGoiThau || 0));
  const isProject = kh.loaiHinhMuaSam === "Dự án";
  kh.tongMucDauTu = this.model.sumVND(isProject ? [sumI, sumII, sumIII, sumIV] : [sumII, sumIII, sumIV]);
  kh.isTongMucTuDong = true;
}
export async function savePlanBreakdown() {
  const planId = document.getElementById("breakdown-plan-id").value;
  const kh = this.model.state.kehoach.find((k) => k.id === planId);
  if (!kh) return;
  const parseRows = (type) => {
    const tbody = document.getElementById(`tbody-breakdown-${type}`);
    if (!tbody) return [];
    const rows = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      const name = tr.querySelector(".breakdown-name")?.value.trim();
      const valStr = tr.querySelector(".breakdown-value")?.value || "0";
      const value = this.model.parseVND(valStr);
      if (!name) return;
      if (type === "dathuchien") {
        const donViThucHien = tr.querySelector(".breakdown-unit")?.value.trim() || "";
        const vanBanPheDuyet = tr.querySelector(".breakdown-doc")?.value.trim() || "";
        rows.push({ tenCongViec: name, giaTri: value, donViThucHien, vanBanPheDuyet });
      } else if (type === "khongapdung") {
        const donViThucHien = tr.querySelector(".breakdown-unit")?.value.trim() || "";
        rows.push({ tenCongViec: name, giaTri: value, donViThucHien });
      } else {
        rows.push({ tenCongViec: name, giaTri: value });
      }
    });
    return rows;
  };
  const cvDaThucHien = parseRows("dathuchien");
  const cvKhongApDung = parseRows("khongapdung");
  const cvChuaDuDieuKien = parseRows("chuadudieuKien");
  let finalPlanId = planId;
  if (this.tempPlanAction === "edit") {
    const backupKh = this.backupKeHoachState.find((k) => k.id === this.tempPlanData.id);
    let saveAsNewVersion = false;
    if (backupKh) {
      const oldTime = backupKh.thoiGianDangMa ? String(backupKh.thoiGianDangMa).trim() : "";
      const newTime = this.tempPlanData.thoiGianDangMa ? String(this.tempPlanData.thoiGianDangMa).trim() : "";
      if (oldTime !== "") {
        const oldDate = new Date(oldTime);
        const newDate = new Date(newTime);
        if (isNaN(oldDate.getTime()) || isNaN(newDate.getTime())) {
          saveAsNewVersion = oldTime !== newTime;
        } else {
          saveAsNewVersion = oldDate.getTime() !== newDate.getTime();
        }
      }
    }
    if (saveAsNewVersion) {
      this.model.state.kehoach = JSON.parse(JSON.stringify(this.backupKeHoachState));
      const oldKh = this.model.state.kehoach.find((k) => k.id === this.tempPlanData.id);
      const newId = generateRecordId("kehoach");
      finalPlanId = newId;
      const timestamp = this.model.getCurrentDateTimeString();
      const nextPlan = createNextVersion(this.model.state.kehoach, oldKh, {
        ...this.tempPlanData,
        cvDaThucHienList: cvDaThucHien,
        cvKhongApDungList: cvKhongApDung,
        cvChuaDuDieuKienList: cvChuaDuDieuKien
      }, {
        id: newId,
        timestamp
      });
      nextPlan.createdAt = oldKh.createdAt || timestamp;
      this.model.state.kehoach.push(nextPlan);
      rememberSelectedVersion(this.model.state, "selectedPlanVersion", nextPlan);
      const previousPlanAssignment = this.model.state.assignments.find(
        (assignment) => assignment.targetId === oldKh.id && assignment.type === "kehoach"
      );
      const activeUserId = previousPlanAssignment?.empId || this.model.state.activeuser.id;
      if (activeUserId) {
        await this.model.addRecord("assignments", {
          id: generateRecordId("assignments"),
          empId: activeUserId,
          targetId: newId,
          type: "kehoach"
        });
      }
      const oldPackages = this.model.state.goithau.filter((gt) => gt.keHoachId === oldKh.id);
      for (const gt of oldPackages) {
        const newGtId = generateRecordId("goithau");
        const nextPackage = createNextVersion(this.model.state.goithau, gt, preparePackageSnapshot(gt, {
          keHoachId: newId
        }), {
          id: newGtId,
          timestamp
        });
        nextPackage.createdAt = gt.createdAt || timestamp;
        this.model.state.goithau.push(nextPackage);
        const previousPackageAssignment = this.model.state.assignments.find(
          (assignment) => assignment.targetId === gt.id && assignment.type === "goithau"
        );
        if (previousPackageAssignment?.empId) {
          await this.model.addRecord("assignments", {
            id: generateRecordId("assignments"),
            empId: previousPackageAssignment.empId,
            targetId: newGtId,
            type: "goithau"
          });
        }
      }
    } else {
      const currentKh = this.model.state.kehoach.find((k) => k.id === planId);
      if (currentKh) {
        currentKh.cvDaThucHienList = cvDaThucHien;
        currentKh.cvKhongApDungList = cvKhongApDung;
        currentKh.cvChuaDuDieuKienList = cvChuaDuDieuKien;
      }
    }
  } else {
    const currentKh = this.model.state.kehoach.find((k) => k.id === planId);
    if (currentKh) {
      currentKh.cvDaThucHienList = cvDaThucHien;
      currentKh.cvKhongApDungList = cvKhongApDung;
      currentKh.cvChuaDuDieuKienList = cvChuaDuDieuKien;
    }
    const activeUserId = this.model.state.activeuser.id;
    if (activeUserId) {
      await this.model.addRecord("assignments", {
        id: generateRecordId("assignments"),
        empId: activeUserId,
        targetId: finalPlanId,
        type: "kehoach"
      });
    }
  }
  const targetKh = this.model.state.kehoach.find((k) => k.id === finalPlanId);
  if (targetKh && targetKh.isTongMucTuDong) {
    this.recalculatePlanTotal(finalPlanId);
  }
  this.updateBreakdownTotal(finalPlanId);
  this.backupKeHoachState = null;
  this.backupGoiThauState = null;
  this.tempPlanData = null;
  this.tempPlanAction = null;
  if (hasModalReturnState("kehoach-detail") && finalPlanId) {
    updateModalReturnAction(finalPlanId);
  }
  const syncResult = await persistAndSync(this, ["kehoach", "goithau", "thongtinmothau"], {
    afterPersist: () => {
      this.view.renderKeHoachTable();
      this.view.renderGoiThauTable();
    }
  });
  if (!syncResult?.ok) return;
  this.closeModal("modal-plan-breakdown");
  await this.view.customAlert("Thành công", "Đã lưu kế hoạch và cấu trúc phân chia chi tiết công việc thành công!", "check-circle");
}
