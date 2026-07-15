import { validateExtensionRows } from "./packageValidation.js";
import { captureModalReturnState, hasModalReturnState, updateModalReturnAction } from "../app/modalReturnState.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { resetPackageFormEditableState, setPackageSubTableActionsVisible } from "./packageFormState.js";
import { clearCompetitiveQuotationAppraisal, isCompetitiveQuotationPackage } from "./packageAppraisal.js";
import { persistAndSync } from "../shared/MutationService.js";
import { createInitialVersion, createNextVersion, preparePackageSnapshot, rememberSelectedVersion } from "../shared/VersionedEntityService.js";
import { apiFetch } from "../shared/apiClient.js";
export { deleteGoiThau, openPackageWizardStep } from "./packageLifecycleWorkflow.js";

export async function editGoiThau(id, isReadOnly = false) {
  if (!document.getElementById("modal-goithau")) {
    await this.ensureLazyModal?.("modal-goithau");
  }
  const modal = document.getElementById("modal-goithau");
  const form = document.getElementById("form-goithau");
  const gt = id ? this.model.state.goithau.find((g) => String(g.id) === String(id)) : null;
  resetPackageFormEditableState(form);
  setPackageSubTableActionsVisible(true);
  const khSelect = document.getElementById("gt-kehoachid");
  khSelect.innerHTML = '<option value="">-- Chọn Kế hoạch --</option>' + this.model.getLatestPlans().map((k) => `<option value="${escapeHtml(k.id)}" data-search="${escapeHtml(`${k.maKeHoach || ""} ${k.tenKeHoach || ""}`)}">${escapeHtml(k.tenKeHoach)}${escapeHtml(this.model.getPendingLabel("kehoach", k.id))}</option>`).join("");
  khSelect.disabled = false;
  this.makeSearchableSelect(khSelect, "Tìm kiếm Kế hoạch LCNT...");
  const ntSelect = document.getElementById("gt-nhathautrungthauid");
  let filteredBids = [];
  if (id) {
    filteredBids = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(id));
  }
  if (filteredBids.length > 0) {
    ntSelect.innerHTML = '<option value="">-- Chọn Nhà thầu trúng thầu --</option>' + filteredBids.map((b) => `<option value="${escapeHtml(b.nhaThauId)}" data-search="${escapeHtml(`${b.maNhaThau || ""} ${b.tenNhaThau || ""}`)}">${escapeHtml(b.tenNhaThau)}</option>`).join("");
  } else {
    ntSelect.innerHTML = '<option value="">-- (Chưa có nhà thầu tham gia mở thầu) --</option>';
  }
  this.makeSearchableSelect(ntSelect, "Tìm kiếm Nhà thầu trúng thầu...");
  const roleLabelMap = { super_admin: "Super Admin / Quản lý / Chuyên viên", manager: "Quản lý / Chuyên viên", employee: "Chuyên viên" };
  const restoreEmpValue = () => {
    const empSelect = document.getElementById("gt-nhanvienphutrach");
    if (empSelect) {
      if (id) {
        const assignment = this.model.state.assignments.find((a) => a.targetId === gt.id && a.type === "goithau");
        empSelect.value = assignment ? assignment.empId : "";
      } else {
        if (this.model.state.activerole === "employee") {
          const currentUserId = sessionStorage.getItem("bf_user_id");
          empSelect.value = currentUserId || "";
        } else {
          empSelect.value = "";
        }
      }
      if (this.model.state.activerole === "employee") {
        empSelect.disabled = true;
      } else {
        empSelect.disabled = false;
      }
      this.makeSearchableSelect(empSelect, "Tìm kiếm Chuyên viên phụ trách...");
    }
  };
  const _populateEmpDropdown = () => {
    const empDropdown = document.getElementById("gt-nhanvienphutrach");
    if (!empDropdown) return;
    const employees = Array.isArray(this.model.state.employees) ? this.model.state.employees : [];
    const optHtml = employees.map((e) => {
      const roleLabel = roleLabelMap[e.role] || e.role;
      const matchedExpert = this.model.state.chuyengia.find((cg) => cg.hoTen.toLowerCase().trim() === e.name.toLowerCase().trim());
      const extraSearch = matchedExpert ? `${matchedExpert.soCCCD || ""} ${matchedExpert.soChungChi || ""}` : "";
      return `<option value="${escapeHtml(e.id)}" data-search="${escapeHtml(`${e.name} ${roleLabel} ${e.email || ""} ${extraSearch}`)}">${escapeHtml(e.name)} — ${escapeHtml(roleLabel)}${e.email ? ` (${escapeHtml(e.email)})` : ""}</option>`;
    }).join("");
    empDropdown.innerHTML = '<option value="">-- Chọn Chuyên viên phụ trách --</option>' + optHtml;
    restoreEmpValue();
  };
  if (!this.model.state.employees || this.model.state.employees.length === 0) {
    apiFetch("/api/auth/users").then((r) => r.json()).then((users) => {
      this.model.state.employees = users.map((u) => ({
        id: String(u.id || ""),
        name: u.name,
        email: u.email || "",
        phone: "",
        role: u.role
      }));
      _populateEmpDropdown();
    }).catch((err) => {
      console.error("Failed to load users:", err);
      _populateEmpDropdown();
    });
  } else {
    _populateEmpDropdown();
  }
  const toChuyenGiaTbody = document.getElementById("to-chuyengia-tbody");
  toChuyenGiaTbody.innerHTML = this.model.state.chuyengia.map((cg) => `
        <tr data-expert-id="${escapeHtml(cg.id)}">
            <td style="text-align: center; vertical-align: middle;">
                <input type="checkbox" name="tochuyengia-select" value="${escapeHtml(cg.id)}" style="width: 18px; height: 18px; min-width: auto; cursor: pointer; display: inline-block;">
            </td>
            <td style="font-weight: 600; padding: 10px 14px; vertical-align: middle; color: var(--text-main); text-align: left !important;">${escapeHtml(cg.hoTen)} <small class="text-muted" style="display: block;">Số CC: ${escapeHtml(cg.soChungChi)}</small></td>
            <td style="vertical-align: middle;">
                <select name="tochuyengia-chucvu" style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-family: var(--font-primary); font-size: 0.84rem; font-weight: 600;" disabled>
                    <option value="Tổ viên">Tổ viên</option>
                    <option value="Tổ trưởng">Tổ trưởng</option>
                </select>
            </td>
            <td style="vertical-align: middle;">
                <input type="text" name="tochuyengia-congviec" placeholder="Nhập công việc..." disabled style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-family: var(--font-primary); font-size: 0.84rem; font-weight: 600;">
            </td>
        </tr>
    `).join("");
  const toThamDinhTbody = document.getElementById("to-thamdinh-tbody");
  toThamDinhTbody.innerHTML = this.model.state.chuyengia.map((cg) => `
        <tr data-expert-id="${escapeHtml(cg.id)}">
            <td style="text-align: center; vertical-align: middle;">
                <input type="checkbox" name="tothamdinh-select" value="${escapeHtml(cg.id)}" style="width: 18px; height: 18px; min-width: auto; cursor: pointer; display: inline-block;">
            </td>
            <td style="font-weight: 600; padding: 10px 14px; vertical-align: middle; color: var(--text-main); text-align: left !important;">${escapeHtml(cg.hoTen)} <small class="text-muted" style="display: block;">Số CC: ${escapeHtml(cg.soChungChi)}</small></td>
            <td style="vertical-align: middle;">
                <select name="tothamdinh-chucvu" style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-family: var(--font-primary); font-size: 0.84rem; font-weight: 600;" disabled>
                    <option value="Tổ viên">Tổ viên</option>
                    <option value="Tổ trưởng">Tổ trưởng</option>
                </select>
            </td>
            <td style="vertical-align: middle;">
                <input type="text" name="tothamdinh-congviec" placeholder="Nhập công việc..." disabled style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-family: var(--font-primary); font-size: 0.84rem; font-weight: 600;">
            </td>
        </tr>
    `).join("");
  const setupCheckboxListeners = (tbodyId, selectName, roleName, jobName, otherTbodyId) => {
    const tbody = document.getElementById(tbodyId);
    const checkboxes = tbody.querySelectorAll(`input[name="${selectName}"]`);
    const hasAnotherSelectedExpert = (currentCheckbox) => Array.from(checkboxes).some((input) => input !== currentCheckbox && input.checked);
    checkboxes.forEach((cb) => {
      const row = cb.closest("tr");
      const roleSelect = row.querySelector(`select[name="${roleName}"]`);
      if (roleSelect) {
        roleSelect.addEventListener("change", () => {
          this.enforceSingleLeader(tbodyId, roleName, roleSelect);
          const jobInput = row.querySelector(`input[name="${jobName}"]`);
          if (jobInput) {
            if (tbodyId === "to-chuyengia-tbody") {
              jobInput.value = roleSelect.value === "Tổ trưởng" ? "Tổng hợp, lập HSMT, đánh giá HSDT" : "Lập HSMT, đánh giá HSDT";
            } else if (tbodyId === "to-thamdinh-tbody") {
              jobInput.value = roleSelect.value === "Tổ trưởng" ? "Tổng hợp, thẩm định HSMT, thẩm định KQLCNT" : "Thẩm định HSMT, thẩm định KQLCNT";
            }
          }
        });
      }
      cb.addEventListener("change", (e) => {
        const newChecked = cb.checked;
        const expertId = cb.value;
        const roleSelect2 = row.querySelector(`select[name="${roleName}"]`);
        const jobInput = row.querySelector(`input[name="${jobName}"]`);
        if (roleSelect2) {
          if (newChecked) {
            roleSelect2.disabled = false;
            if (!hasAnotherSelectedExpert(cb)) {
              const leaderOption = Array.from(roleSelect2.options).find((option) => option.value === "Tổ trưởng") || roleSelect2.options[1] || roleSelect2.options[0];
              if (leaderOption) {
                roleSelect2.value = leaderOption.value;
                roleSelect2.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          } else {
            roleSelect2.value = "Tổ viên";
            roleSelect2.disabled = true;
          }
        }
        if (jobInput) {
          jobInput.disabled = !newChecked;
          if (newChecked) {
            if (tbodyId === "to-chuyengia-tbody") {
              jobInput.value = roleSelect2.value === "Tổ trưởng" ? "Tổng hợp, lập HSMT, đánh giá HSDT" : "Lập HSMT, đánh giá HSDT";
            } else if (tbodyId === "to-thamdinh-tbody") {
              jobInput.value = roleSelect2.value === "Tổ trưởng" ? "Tổng hợp, thẩm định HSMT, thẩm định KQLCNT" : "Thẩm định HSMT, thẩm định KQLCNT";
            }
          } else {
            jobInput.value = "";
          }
        }
        const otherRow = document.querySelector(`#${otherTbodyId} tr[data-expert-id="${expertId}"]`);
        if (otherRow) {
          otherRow.style.display = newChecked ? "none" : "";
        }
        this.enforceSingleLeader(tbodyId, roleName, roleSelect2);
      });
    });
  };
  setupCheckboxListeners("to-chuyengia-tbody", "tochuyengia-select", "tochuyengia-chucvu", "tochuyengia-congviec", "to-thamdinh-tbody");
  setupCheckboxListeners("to-thamdinh-tbody", "tothamdinh-select", "tothamdinh-chucvu", "tothamdinh-congviec", "to-chuyengia-tbody");
  if (id) {
    captureModalReturnState(this.model.state.activetab || "goithau", this.model.state.activeaction || null);
    this.switchTab("goithau", "chinhsua", true);
    document.getElementById("modal-goithau-title").textContent = isReadOnly ? "Chi tiết Gói thầu" : "Cập nhật Gói thầu";
    document.getElementById("form-goithau").setAttribute("data-original-status", gt.trangThai);
    document.getElementById("form-goithau-id").value = gt.id;
    const existingGtCode = this.model.getPackageBaseCode(gt.maGoiThau);
    document.getElementById("gt-ma").value = existingGtCode;
    const gtMaInput = document.getElementById("gt-ma");
    if (gtMaInput) {
      if (existingGtCode && existingGtCode.trim() !== "" && gt.trangThai !== "Chuẩn bị") {
        gtMaInput.setAttribute("readonly", "true");
      } else {
        gtMaInput.removeAttribute("readonly");
      }
    }
    const khSelect2 = document.getElementById("gt-kehoachid");
    const latestPlan = this.model.getLatestPlan(gt.keHoachId);
    khSelect2.value = latestPlan ? latestPlan.id : gt.keHoachId;
    khSelect2.dispatchEvent(new Event("change"));
    document.getElementById("gt-ten").value = gt.tenGoiThau;
    document.getElementById("gt-gia").value = this.model.formatVND(gt.giaGoiThau);
    document.getElementById("gt-thoigian").value = gt.thoiGianThucHien;
    document.getElementById("gt-hinhthuc").value = gt.hinhThucLuaChon;
    document.getElementById("gt-phuongthuc").value = gt.phuongThucLuaChon;
    document.getElementById("gt-trangthai").value = gt.trangThai;
    document.getElementById("gt-linhvuc").value = gt.linhVuc || "";
    const isThuocVal = gt.isThuoc === 1 || gt.isThuoc === "1" ? "1" : "0";
    const radioToCheck = document.querySelector(`input[name="gt-goithauthuoc"][value="${isThuocVal}"]`);
    if (radioToCheck) radioToCheck.checked = true;
    document.getElementById("gt-tuychonmuathem").value = gt.tuyChonMuaThem || "Không";
    document.getElementById("gt-nguonvon").value = gt.nguonVon || "Ngân sách nhà nước";
    document.getElementById("gt-loaihopdong").value = gt.loaiHopDong || "Trọn gói";
    document.getElementById("gt-thoigiantochuc").value = gt.thoiGianToChuc || "";
    document.getElementById("gt-thoigianbatdautochuc").value = gt.thoiGianBatDauToChuc || "";
    document.getElementById("gt-quatmang").value = gt.quaMang || "Qua mạng";
    document.getElementById("gt-trongnuocquocte").value = gt.trongNuocQuocTe || "Trong nước";
    document.getElementById("gt-phanlo").value = gt.phanLo || "Không";
    document.getElementById("gt-giatribaomothau").value = gt.giaTriDamBaoDuThau ? this.model.formatVND(gt.giaTriDamBaoDuThau) : "";
    document.getElementById("gt-hieuluchsdt").value = gt.hieuLucHsdt || "";
    document.getElementById("gt-hieuluchbaomothau").value = gt.hieuLucDamBaoDuThau || "";
    document.getElementById("gt-tylebaodamhopdong").value = gt.tyLeBaoDamHopDong !== void 0 && gt.tyLeBaoDamHopDong !== null ? gt.tyLeBaoDamHopDong : "";
    this.updatePackageFieldsVisibility(isReadOnly);
    const gtHinhThucEl = document.getElementById("gt-hinhthuc");
    if (gtHinhThucEl) {
      gtHinhThucEl.dispatchEvent(new Event("change"));
    }
    this._isEditMode = true;
    this._loadPhanLoRows(gt.phanLoList || []);
    this._loadTuyChonMuaThemRows(gt.tuyChonMuaThemList || []);
    this._loadGiaHanRows(gt.giaHanList || []);
    this._loadYeuCauLamRoRows(gt.yeuCauLamRoList || []);
    this._loadTraLoiLamRoRows(gt.traLoiLamRoList || []);
    if (gt.trangThai === "Đã có kết quả") {
      if (gt.phanLo !== "Có") {
        const ntSelectVal = document.getElementById("gt-nhathautrungthauid");
        ntSelectVal.value = gt.nhaThauTrungThauId || "";
        ntSelectVal.dispatchEvent(new Event("change"));
        document.getElementById("gt-giatrungthau").value = gt.giaTrungThau ? this.model.formatVND(gt.giaTrungThau) : "";
        document.getElementById("gt-thoigian-goithau").value = gt.thoiGianGoiThau || "";
        document.getElementById("gt-thoigian-hopdong").value = gt.thoiGianHopDong || "";
      }
    }
    let defaultAwardedList = typeof gt.awardedPhanLoList === "string" ? JSON.parse(gt.awardedPhanLoList || "[]") : gt.awardedPhanLoList || [];
    if ((!defaultAwardedList || defaultAwardedList.length === 0) && gt.phanLoList) {
      const plList = typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList || "[]") : gt.phanLoList || [];
      defaultAwardedList = plList.map((pl) => ({
        tenPhanLo: pl.tenPhanLo,
        nhaThauTrungThauId: pl.nhaThauTrungThauId,
        giaTrungThau: pl.giaTrungThau,
        thoiGianGoiThau: pl.thoiGianGoiThau,
        thoiGianHopDong: pl.thoiGianHopDong
      }));
    }
    this.updateAwardedContractorUI(defaultAwardedList || []);
    document.getElementById("gt-soquyetdinh").value = gt.soQuyetDinh || "";
    document.getElementById("gt-ngayquyetdinh").value = gt.ngayQuyetDinh ? this.model.formatForDateInput(gt.ngayQuyetDinh) : "";
    document.getElementById("gt-thoigiandangtai").value = gt.thoiGianDangTai ? this.model.formatForDatetimeLocal(gt.thoiGianDangTai) : "";
    document.getElementById("gt-thoigiandongthau").value = gt.thoiGianDongThau ? this.model.formatForDatetimeLocal(gt.thoiGianDongThau) : "";
    document.getElementById("gt-thoigianmothau").value = gt.thoiGianMoThau ? this.model.formatForDatetimeLocal(gt.thoiGianMoThau) : "";
    const inputMoEhsdxtc = document.getElementById("gt-thoigianmoehsdxtc");
    if (inputMoEhsdxtc) {
      inputMoEhsdxtc.value = gt.thoiGianMoEhsdxtc ? this.model.formatForDatetimeLocal(gt.thoiGianMoEhsdxtc) : "";
    }
    const savedToChuyenGia = gt.toChuyenGia || [];
    savedToChuyenGia.forEach((item) => {
      const row = document.querySelector(`#to-chuyengia-tbody tr[data-expert-id="${item.chuyenGiaId}"]`);
      if (row) {
        const cb = row.querySelector('input[name="tochuyengia-select"]');
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change"));
        }
        const roleSelect = row.querySelector('select[name="tochuyengia-chucvu"]');
        const jobInput = row.querySelector('input[name="tochuyengia-congviec"]');
        if (roleSelect) roleSelect.value = item.chucVu || "Tổ viên";
        if (jobInput) jobInput.value = item.congViec || "";
      }
    });
    const savedToThamDinh = gt.toThamDinh || [];
    savedToThamDinh.forEach((item) => {
      const row = document.querySelector(`#to-thamdinh-tbody tr[data-expert-id="${item.chuyenGiaId}"]`);
      if (row) {
        const cb = row.querySelector('input[name="tothamdinh-select"]');
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change"));
        }
        const roleSelect = row.querySelector('select[name="tothamdinh-chucvu"]');
        const jobInput = row.querySelector('input[name="tothamdinh-congviec"]');
        if (roleSelect) roleSelect.value = item.chucVu || "Tổ viên";
        if (jobInput) jobInput.value = item.congViec || "";
      }
    });
    this.enforceSingleLeader("to-chuyengia-tbody", "tochuyengia-chucvu");
    this.enforceSingleLeader("to-thamdinh-tbody", "tothamdinh-chucvu");
    if (this.updatePhuongPhapDanhGiaOptions) {
      this.updatePhuongPhapDanhGiaOptions();
    }
    document.getElementById("gt-phuongphapdanhgia").value = gt.phuongPhapDanhGia || "";
    if (this.updateTrongSoKyThuatVisibility) {
      this.updateTrongSoKyThuatVisibility();
    }
    document.getElementById("gt-trongsokythuat").value = gt.trongSoKyThuat !== void 0 && gt.trongSoKyThuat !== null ? gt.trongSoKyThuat : "";
  } else {
    captureModalReturnState(this.model.state.activetab || "goithau", this.model.state.activeaction || null);
    this.switchTab("goithau", "taomoi", true);
    document.getElementById("gt-ngayquyetdinh").value = "";
    document.getElementById("gt-thoigiandangtai").value = "";
    document.getElementById("gt-thoigiandongthau").value = "";
    document.getElementById("gt-thoigianmothau").value = "";
    document.getElementById("gt-thoigianmoehsdxtc").value = "";
    const inputMoEhsdxtc = document.getElementById("gt-thoigianmoehsdxtc");
    if (inputMoEhsdxtc) inputMoEhsdxtc.value = "";
    document.getElementById("modal-goithau-title").textContent = isReadOnly ? "Chi tiết Gói thầu" : "Thêm Gói thầu mới";
    form.reset();
    if (this.updatePhuongPhapDanhGiaOptions) {
      this.updatePhuongPhapDanhGiaOptions();
    }
    if (this.updateTrongSoKyThuatVisibility) {
      this.updateTrongSoKyThuatVisibility();
    }
    form.removeAttribute("data-original-status");
    form.removeAttribute("data-rebid-from");
    document.getElementById("form-goithau-id").value = "";
    document.getElementById("gt-linhvuc").value = "Hàng hóa";
    document.getElementById("gt-tuychonmuathem").value = "Không";
    document.getElementById("gt-nguonvon").value = "";
    document.getElementById("gt-loaihopdong").value = "Trọn gói";
    document.getElementById("gt-thoigiantochuc").value = "";
    document.getElementById("gt-thoigianbatdautochuc").value = "";
    document.getElementById("gt-quatmang").value = "Qua mạng";
    document.getElementById("gt-trongnuocquocte").value = "Trong nước";
    document.getElementById("gt-phanlo").value = "Không";
    document.getElementById("gt-giatribaomothau").value = "";
    document.getElementById("gt-hieuluchsdt").value = "";
    document.getElementById("gt-hieuluchbaomothau").value = "";
    document.getElementById("gt-tylebaodamhopdong").value = "";
    const statusSelectReset = document.getElementById("gt-trangthai");
    if (statusSelectReset) {
      statusSelectReset.querySelectorAll("option").forEach((opt) => {
        opt.disabled = false;
      });
      statusSelectReset.value = "Chuẩn bị";
    }
    this.updatePackageFieldsVisibility(isReadOnly);
    this._isEditMode = false;
    this._loadPhanLoRows([]);
    this._loadTuyChonMuaThemRows([]);
    this._loadGiaHanRows([]);
    this._loadYeuCauLamRoRows([]);
    this._loadTraLoiLamRoRows([]);
    document.getElementById("gt-nhathautrungthauid").value = "";
    document.getElementById("gt-giatrungthau").value = "";
    document.getElementById("gt-thoigian-goithau").value = "";
    document.getElementById("gt-thoigian-hopdong").value = "";
    this.updateAwardedContractorUI([]);
    const gtMaInput = document.getElementById("gt-ma");
    if (gtMaInput) {
      gtMaInput.removeAttribute("readonly");
    }
  }
  if (this.handleLinhVucChange) {
    this.handleLinhVucChange();
  } else if (this.handleHinhThucChange) {
    this.handleHinhThucChange();
  }
  if (this.handleQuaMangChange) {
    this.handleQuaMangChange();
  }
  if (this.handlePhanLoChange) {
    this.handlePhanLoChange();
  }
  if (this.handleTuyChonMuaThemChange) {
    this.handleTuyChonMuaThemChange();
  }
  const selectedPlanId = document.getElementById("gt-kehoachid").value;
  this.updateNguonVonFieldState(selectedPlanId);
  this.updatePackageFieldsVisibility(isReadOnly);
  const isOpenedOrLater = gt && ["Đã mở thầu", "Đang chấm thầu", "Đã có kết quả"].includes(gt.trangThai);
  const preOpeningFields = [
    "gt-ma",
    "gt-kehoachid",
    "gt-ten",
    "gt-gia",
    "gt-thoigian",
    "gt-hinhthuc",
    "gt-phuongthuc",
    "gt-quatmang",
    "gt-trongnuocquocte",
    "gt-tuychonmuathem",
    "gt-phanlo",
    "gt-nguonvon",
    "gt-loaihopdong",
    "gt-thoigiantochuc",
    "gt-thoigianbatdautochuc",
    "gt-soquyetdinh",
    "gt-ngayquyetdinh",
    "gt-thoigiandangtai",
    "gt-thoigiandongthau",
    "gt-thoigianmothau",
    "gt-nhanvienphutrach",
    "gt-giatribaomothau",
    "gt-hieuluchsdt",
    "gt-hieuluchbaomothau"
  ];
  preOpeningFields.forEach((fieldId) => {
    const el = document.getElementById(fieldId);
    if (el) {
      el.disabled = !!isOpenedOrLater;
      const wrapper = el.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${fieldId}"]`);
      if (wrapper) {
        const searchInput = wrapper.querySelector(".custom-select-search");
        if (searchInput) {
          searchInput.disabled = !!isOpenedOrLater;
        }
      }
    }
  });
  ["gt-ngayquyetdinh", "gt-thoigiandangtai", "gt-thoigiandongthau", "gt-thoigianmothau"].forEach((id2) => {
    const el = document.getElementById(id2);
    if (el) {
      el.disabled = !!isOpenedOrLater;
    }
  });
  if (isOpenedOrLater) {
    document.querySelectorAll("#to-chuyengia-tbody input, #to-chuyengia-tbody select, #to-thamdinh-tbody input, #to-thamdinh-tbody select").forEach((el) => {
      el.disabled = true;
    });
  } else {
    document.querySelectorAll('#to-chuyengia-tbody input[type="checkbox"], #to-thamdinh-tbody input[type="checkbox"]').forEach((cb) => {
      cb.disabled = false;
    });
    document.querySelectorAll('#to-chuyengia-tbody select, #to-chuyengia-tbody input[type="text"], #to-thamdinh-tbody select, #to-thamdinh-tbody input[type="text"]').forEach((el) => {
      const row = el.closest("tr");
      const cb = row ? row.querySelector('input[type="checkbox"]') : null;
      el.disabled = !(cb && cb.checked);
    });
  }
  if (!isReadOnly && !isOpenedOrLater) {
    this.enforceSingleLeader("to-chuyengia-tbody", "tochuyengia-chucvu");
    this.enforceSingleLeader("to-thamdinh-tbody", "tothamdinh-chucvu");
  }
  document.querySelectorAll("#phanlo-tbody input, #phanlo-tbody select, #phanlo-tbody button, #tuychonmuathem-tbody input, #tuychonmuathem-tbody select, #tuychonmuathem-tbody button").forEach((el) => {
    el.disabled = !!isOpenedOrLater;
  });
  ["btn-them-phanlo", "btn-template-phanlo", "btn-import-excel-phanlo", "btn-them-tuychonmuathem", "btn-template-tuychonmuathem", "btn-import-excel-tuychonmuathem"].forEach((btnId) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.disabled = !!isOpenedOrLater;
    }
  });
  if (this.model.state.activerole === "employee") {
    const empSelect = document.getElementById("gt-nhanvienphutrach");
    if (empSelect) {
      empSelect.disabled = true;
      const wrapper = empSelect.parentNode.querySelector(`.custom-select-wrapper[data-select-id="gt-nhanvienphutrach"]`);
      if (wrapper) {
        const searchInput = wrapper.querySelector(".custom-select-search");
        if (searchInput) {
          searchInput.disabled = true;
        }
      }
    }
  }
  if (!isReadOnly && !isOpenedOrLater && this.handleHinhThucChange) {
    this.handleHinhThucChange();
  }
  if (isReadOnly) {
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      el.disabled = true;
      const wrapper = el.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${el.id}"]`);
      if (wrapper) {
        const searchInput = wrapper.querySelector(".custom-select-search");
        if (searchInput) searchInput.disabled = true;
      }
    });
    form.querySelectorAll("button:not([data-close])").forEach((btn) => {
      btn.disabled = true;
    });
    const formSubmitBtn = form.querySelector('button[type="submit"]');
    if (formSubmitBtn) formSubmitBtn.style.display = "none";
    document.querySelectorAll("#phanlo-tbody input, #phanlo-tbody select, #phanlo-tbody button, #tuychonmuathem-tbody input, #tuychonmuathem-tbody select, #tuychonmuathem-tbody button").forEach((el) => {
      el.disabled = true;
    });
    document.querySelectorAll("#to-chuyengia-tbody input, #to-chuyengia-tbody select, #to-thamdinh-tbody input, #to-thamdinh-tbody select").forEach((el) => {
      el.disabled = true;
    });
    document.querySelectorAll("#gt-giahan-tbody input, #gt-giahan-tbody select, #gt-giahan-tbody button").forEach((el) => {
      el.disabled = true;
    });
    document.querySelectorAll("#gt-yeucaulamro-tbody input, #gt-yeucaulamro-tbody select, #gt-yeucaulamro-tbody button").forEach((el) => {
      el.disabled = true;
    });
    document.querySelectorAll("#gt-traloilamro-tbody input, #gt-traloilamro-tbody select, #gt-traloilamro-tbody button").forEach((el) => {
      el.disabled = true;
    });
    document.querySelectorAll("#awarded-phanlo-tbody input, #awarded-phanlo-tbody select, #awarded-phanlo-tbody button").forEach((el) => {
      el.disabled = true;
    });
    const addButtons = [
      "btn-them-phanlo",
      "btn-template-phanlo",
      "btn-import-excel-phanlo",
      "btn-them-tuychonmuathem",
      "btn-template-tuychonmuathem",
      "btn-import-excel-tuychonmuathem",
      "btn-them-giahan",
      "btn-them-yeucaulamro",
      "btn-them-traloilamro"
    ];
    addButtons.forEach((btnId) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.disabled = true;
        btn.style.display = "none";
      }
    });
    setPackageSubTableActionsVisible(false);
  }
  this.view.openModal("modal-goithau");
}
export async function handleGoiThauSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-goithau");
  if (!this.view.validateForm(form)) return;
  const formVals = this.view.getGoiThauFormInputValues(this.model);
  if (formVals.giaGoiThau < 0) {
    await this.view.customAlert("Dữ liệu không hợp lệ", "Giá gói thầu không được nhỏ hơn 0.", "alert-triangle", document.getElementById("gt-giagoithau"));
    return;
  }
  const mainDongThauStr = formVals.thoiGianDongThau;
  const extensionInputRows = Array.from(document.querySelectorAll("#gt-giahan-tbody tr")).map((tr) => {
    const timeInput = tr.querySelector(".gh-time-input").value.trim();
    const reasonInput = tr.querySelector(".gh-reason-input").value.trim();
    return { timeStr: timeInput, reason: reasonInput };
  });
  const extensionValidation = validateExtensionRows(mainDongThauStr, extensionInputRows);
  if (!extensionValidation.valid) {
    const extensionRow = document.querySelectorAll("#gt-giahan-tbody tr")[extensionValidation.rowIndex];
    const extensionInput = extensionRow?.querySelector(extensionValidation.field === "reason" ? ".gh-reason-input" : ".gh-time-input");
    await this.view.customAlert("Dữ liệu không hợp lệ", extensionValidation.error, "alert-triangle", extensionInput);
    return;
  }
  const ghRows = extensionValidation.rows;
  const id = formVals.id;
  let finalGtId = id;
  let oldPlanId = null;
  if (id) {
    const oldGt = this.model.state.goithau.find((g) => g.id === id);
    if (oldGt) {
      oldPlanId = oldGt.keHoachId;
    }
  }
  const now = /* @__PURE__ */ new Date();
  const formattedTime = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0") + " " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0") + ":" + String(now.getSeconds()).padStart(2, "0");
  let inputCode = document.getElementById("gt-ma").value.trim();
  if (inputCode) {
    let isDuplicate = false;
    if (id) {
      const oldGt = this.model.state.goithau.find((g) => g.id === id);
      const root = oldGt.rootId || oldGt.id;
      isDuplicate = this.model.state.goithau.some(
        (g) => g.maGoiThau.toLowerCase() === inputCode.toLowerCase() && (g.rootId || g.id) !== root
      );
    } else {
      isDuplicate = this.model.state.goithau.some((g) => g.maGoiThau.toLowerCase() === inputCode.toLowerCase());
    }
    if (isDuplicate) {
      const inputEl = document.getElementById("gt-ma");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Mã gói thầu đã tồn tại ở một gói thầu khác. Vui lòng nhập mã duy nhất!";
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
  const valueDate1 = document.getElementById("gt-thoigiandangtai").value;
  const valueDate2 = document.getElementById("gt-thoigiandongthau").value;
  const valueDate3 = document.getElementById("gt-thoigianmothau").value;
  const valueDate4 = document.getElementById("gt-ngayquyetdinh").value;
  const inputMoEhsdxtc = document.getElementById("gt-thoigianmoehsdxtc");
  const valueDate5 = inputMoEhsdxtc ? inputMoEhsdxtc.value : "";
  const formattedDate1 = valueDate1 ? this.model.convertDMYHMSToYMDHMS(valueDate1) : "";
  const formattedDate2 = valueDate2 ? this.model.convertDMYHMSToYMDHMS(valueDate2) : "";
  const formattedDate3 = valueDate3 ? this.model.convertDMYHMSToYMDHMS(valueDate3) : "";
  const formattedDate4 = valueDate4 ? this.model.convertDMYToYMD(valueDate4) : "";
  const formattedDate5 = valueDate5 ? this.model.convertDMYHMSToYMDHMS(valueDate5) : "";
  if (formattedDate1 && formattedDate2) {
    const dangTai = new Date(formattedDate1);
    const dongThau = new Date(formattedDate2);
    if (!isNaN(dangTai.getTime()) && !isNaN(dongThau.getTime()) && dongThau <= dangTai) {
      await this.view.customAlert("Dữ liệu không hợp lệ", "Thời gian đóng thầu phải sau thời gian đăng tải.", "alert-triangle", document.getElementById("gt-thoigiandongthau"));
      return;
    }
  }
  if (formattedDate2 && formattedDate3) {
    const dongThau = new Date(formattedDate2);
    const moThau = new Date(formattedDate3);
    if (!isNaN(dongThau.getTime()) && !isNaN(moThau.getTime()) && moThau < dongThau) {
      await this.view.customAlert("Dữ liệu không hợp lệ", "Thời gian mở thầu phải bằng hoặc sau thời gian đóng thầu.", "alert-triangle", document.getElementById("gt-thoigianmothau"));
      return;
    }
  }
  const toChuyenGia = [];
  document.querySelectorAll("#to-chuyengia-tbody tr").forEach((row) => {
    const cb = row.querySelector('input[name="tochuyengia-select"]');
    if (cb && cb.checked) {
      const roleSelect = row.querySelector('select[name="tochuyengia-chucvu"]');
      const jobInput = row.querySelector('input[name="tochuyengia-congviec"]');
      toChuyenGia.push({
        chuyenGiaId: cb.value,
        chucVu: roleSelect ? roleSelect.value : "Tổ viên",
        congViec: jobInput ? jobInput.value.trim() : ""
      });
    }
  });
  const toThamDinh = [];
  document.querySelectorAll("#to-thamdinh-tbody tr").forEach((row) => {
    const cb = row.querySelector('input[name="tothamdinh-select"]');
    if (cb && cb.checked) {
      const roleSelect = row.querySelector('select[name="tothamdinh-chucvu"]');
      const jobInput = row.querySelector('input[name="tothamdinh-congviec"]');
      toThamDinh.push({
        chuyenGiaId: cb.value,
        chucVu: roleSelect ? roleSelect.value : "Tổ viên",
        congViec: jobInput ? jobInput.value.trim() : ""
      });
    }
  });
  const toChuyenGiaSection = document.getElementById("to-chuyengia-section");
  const isChuyenGiaVisible = toChuyenGiaSection && toChuyenGiaSection.style.display !== "none";
  if (isChuyenGiaVisible) {
    const hasLeaderChuyenGia = toChuyenGia.some((cg) => cg.chucVu === "Tổ trưởng");
    if (!hasLeaderChuyenGia) {
      const target = document.querySelector('#to-chuyengia-tbody select[name="tochuyengia-chucvu"]') || toChuyenGiaSection;
      await this.view.customAlert("Lỗi kiểm tra", "Tổ chuyên gia chấm thầu bắt buộc phải có 1 Tổ trưởng!", "x-circle", target);
      return;
    }
  }
  const toThamDinhSection = document.getElementById("to-thamdinh-section");
  const isThamDinhVisible = toThamDinhSection && toThamDinhSection.style.display !== "none";
  if (isThamDinhVisible) {
    const hasLeaderThamDinh = toThamDinh.some((cg) => cg.chucVu === "Tổ trưởng");
    if (!hasLeaderThamDinh) {
      const target = document.querySelector('#to-thamdinh-tbody select[name="tothamdinh-chucvu"]') || toThamDinhSection;
      await this.view.customAlert("Lỗi kiểm tra", "Tổ thẩm định bắt buộc phải có 1 Tổ trưởng!", "x-circle", target);
      return;
    }
  }
  if (id) {
    const originalPackage = this.model.state.goithau.find((g) => g.id === id);
    if (originalPackage && originalPackage.trangThai && originalPackage.trangThai !== "Chuẩn bị") {
      const isTeamChanged = (newTeam, oldTeam) => {
        const oldT = oldTeam || [];
        if (newTeam.length !== oldT.length) return true;
        for (const item of newTeam) {
          const match = oldT.find((x) => x.chuyenGiaId === item.chuyenGiaId);
          if (!match) return true;
          if (match.chucVu !== item.chucVu || match.congViec !== item.congViec) return true;
        }
        return false;
      };
      if (isTeamChanged(toChuyenGia, originalPackage.toChuyenGia) || isTeamChanged(toThamDinh, originalPackage.toThamDinh)) {
        const confirmed = await this.view.customConfirm(
          "Xác nhận thay đổi",
          "Bạn có chắc chắn muốn thay đổi trạng thái tham gia của chuyên gia này trong tổ không?",
          "help-circle"
        );
        if (!confirmed) {
          return;
        }
      }
    }
  }
  const targetStatus = document.getElementById("gt-trangthai").value;
  const linhVuc = document.getElementById("gt-linhvuc").value;
  const isPhanLo = document.getElementById("gt-phanlo").value === "Có";
  if (targetStatus !== "Chuẩn bị") {
    const hieuLucHsdtVal = parseInt(document.getElementById("gt-hieuluchsdt")?.value) || 0;
    if (hieuLucHsdtVal <= 0) {
      const inputEl = document.getElementById("gt-hieuluchsdt");
      const formGroup = inputEl ? inputEl.closest(".form-group") : null;
      if (formGroup) formGroup.classList.add("invalid");
      await this.view.customAlert("Thiếu thông tin", "Gói thầu bắt buộc phải có Thời gian hiệu lực hồ sơ dự thầu lớn hơn 0 khi ở trạng thái Đang mời thầu hoặc muộn hơn!", "alert-triangle", inputEl);
      return;
    }
    if (linhVuc !== "Tư vấn" && !isPhanLo) {
      const giaTriDbVal = this.model.parseVND(document.getElementById("gt-giatribaomothau")?.value || "0");
      if (giaTriDbVal <= 0) {
        const inputEl = document.getElementById("gt-giatribaomothau");
        const formGroup = inputEl ? inputEl.closest(".form-group") : null;
        if (formGroup) formGroup.classList.add("invalid");
        await this.view.customAlert("Thiếu thông tin", "Gói thầu bắt buộc phải có Giá trị bảo đảm dự thầu lớn hơn 0 khi ở trạng thái Đang mời thầu hoặc muộn hơn (trừ gói tư vấn)!", "alert-triangle", inputEl);
        return;
      }
    }
  }
  const collectedPhanLoList = this._collectPhanLoRows();
  const collectedTuyChonList = this._collectTuyChonMuaThemRows();
  if (isPhanLo) {
    const codes = collectedPhanLoList.map((item) => item.maPhanLo ? item.maPhanLo.trim().toLowerCase() : "");
    const duplicateCodes = codes.filter((code, idx) => code !== "" && codes.indexOf(code) !== idx);
    if (duplicateCodes.length > 0) {
      let duplicateInput = null;
      const duplicateCodeValue = duplicateCodes[0];
      document.querySelectorAll("#phanlo-tbody tr").forEach((tr) => {
        const inp = tr.querySelector(".pl-code-input");
        if (inp && inp.value.trim().toLowerCase() === duplicateCodeValue) {
          duplicateInput = inp;
        }
      });
      if (duplicateInput) {
        duplicateInput.style.borderColor = "var(--danger)";
        const clearError = () => {
          duplicateInput.style.borderColor = "";
          duplicateInput.removeEventListener("input", clearError);
          duplicateInput.removeEventListener("change", clearError);
        };
        duplicateInput.addEventListener("input", clearError);
        duplicateInput.addEventListener("change", clearError);
      }
      await this.view.customAlert(
        "Mã phần lô trùng lặp",
        `Mã phần lô "${duplicateCodes[0].toUpperCase()}" bị trùng lặp. Vui lòng nhập các mã phần lô khác nhau!`,
        "alert-triangle",
        duplicateInput
      );
      return;
    }
    if (targetStatus !== "Chuẩn bị") {
      let emptyInput = null;
      let invalidBaoDamInput = null;
      document.querySelectorAll("#phanlo-tbody tr").forEach((tr) => {
        const inp = tr.querySelector(".pl-code-input");
        if (inp && !inp.value.trim() && !emptyInput) {
          emptyInput = inp;
        }
        const bdInp = tr.querySelector(".pl-baodam-input");
        if (bdInp && linhVuc !== "Tư vấn") {
          const bdVal = this.model.parseVND(bdInp.value) || 0;
          if (BigInt(bdVal) <= 0n && !invalidBaoDamInput) {
            invalidBaoDamInput = bdInp;
          }
        }
      });
      if (emptyInput) {
        this.view.customAlert("Thiếu dữ liệu", "Vui lòng nhập đầy đủ tên phần lô!", "alert-triangle", emptyInput);
        return;
      }
      if (invalidBaoDamInput) {
        this.view.customAlert("Thiếu dữ liệu", "Vui lòng nhập đầy đủ giá trị bảo đảm dự thầu lớn hơn 0 cho tất cả các phần lô!", "alert-triangle", invalidBaoDamInput);
        return;
      }
    }
    const giaGoiThau = formVals.giaGoiThau || 0;
    const totalPhanLoVal = this.model.sumVND(collectedPhanLoList.map((item) => item.giaTriPhanLo));
    if (String(this.model.parseVND(giaGoiThau) || 0) !== String(totalPhanLoVal)) {
      const confirmed = await this.view.customConfirm(
        "Cảnh báo chênh lệch giá",
        `Giá gói thầu (${this.model.formatVND(giaGoiThau)} VND) khác với tổng giá trị của các phần lô (${this.model.formatVND(totalPhanLoVal)} VND).

Bạn có chắc chắn muốn tiếp tục lưu không?`,
        "alert-triangle"
      );
      if (!confirmed) {
        return;
      }
    }
  }
  const phuongPhapDanhGia = formVals.phuongPhapDanhGia;
  const trongSoKyThuat = formVals.trongSoKyThuat;
  const phuongThucLuaChon = formVals.phuongThucLuaChon;
  if (this.validateTrongSoKyThuat) {
    if (!this.validateTrongSoKyThuat(true)) {
      const inputEl = document.getElementById("gt-trongsokythuat");
      await this.view.customAlert("Lỗi kiểm tra", "Giá trị trọng số kỹ thuật không hợp lệ, vui lòng kiểm tra lại thông tin lỗi bên dưới trường nhập liệu!", "x-circle", inputEl);
      return;
    }
    if (phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && linhVuc !== "Tư vấn" && phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ") {
      if (trongSoKyThuat > 30 && trongSoKyThuat <= 50) {
        await this.view.customAlert("Cảnh báo", "Cảnh báo: Trọng số kỹ thuật lớn hơn 30% (mức khuyến nghị thông thường là 10% - 30%).", "alert-triangle");
      }
    }
  }
  const selectedPlanId = formVals.keHoachId;
  const latestPlan = this.model.getLatestPlan(selectedPlanId);
  const planIdToSave = latestPlan ? latestPlan.id : selectedPlanId;
  const gtData = {
    keHoachId: planIdToSave,
    tenGoiThau: formVals.tenGoiThau,
    giaGoiThau: formVals.giaGoiThau,
    thoiGianThucHien: formVals.thoiGianThucHien,
    hinhThucLuaChon: formVals.hinhThucLuaChon,
    phuongThucLuaChon,
    phuongPhapDanhGia,
    trongSoKyThuat,
    trangThai: formVals.trangThai,
    linhVuc,
    isThuoc: linhVuc === "Hàng hóa" ? formVals.isThuoc : 0,
    tuyChonMuaThem: formVals.tuyChonMuaThem,
    nguonVon: formVals.nguonVon,
    loaiHopDong: formVals.loaiHopDong,
    thoiGianToChuc: formVals.thoiGianToChuc,
    thoiGianBatDauToChuc: formVals.thoiGianBatDauToChuc,
    quaMang: formVals.quaMang,
    trongNuocQuocTe: formVals.trongNuocQuocTe,
    phanLo: formVals.phanLo,
    phanLoList: collectedPhanLoList,
    tuyChonMuaThemList: collectedTuyChonList,
    giaHanList: this._collectGiaHanRows(),
    yeuCauLamRoList: this._collectYeuCauLamRoRows(),
    traLoiLamRoList: this._collectTraLoiLamRoRows(),
    soQuyetDinh: formVals.soQuyetDinh,
    ngayQuyetDinh: formattedDate4,
    thoiGianDangTai: formattedDate1,
    thoiGianDongThau: formattedDate2,
    thoiGianMoThau: formattedDate3,
    thoiGianMoEhsdxtc: formattedDate5,
    toChuyenGia,
    toThamDinh: isCompetitiveQuotationPackage({ hinhThucLuaChon: formVals.hinhThucLuaChon }) ? [] : toThamDinh,
    giaTriDamBaoDuThau: linhVuc === "Tư vấn" ? 0 : isPhanLo ? this.model.sumVND(collectedPhanLoList.map((item) => item.baoDamDuThau || 0)) : this.model.parseVND(formVals.giaTriDamBaoDuThau || "0"),
    hieuLucHsdt: formVals.hieuLucHsdt,
    hieuLucDamBaoDuThau: formVals.hieuLucDamBaoDuThau,
    tyLeBaoDamHopDong: formVals.tyLeBaoDamHopDong
  };
  clearCompetitiveQuotationAppraisal(gtData);
  if (gtData.trangThai === "Đã có kết quả") {
    if (!isPhanLo) {
      gtData.nhaThauTrungThauId = formVals.nhaThauTrungThauId;
      gtData.giaTrungThau = formVals.giaTrungThau;
      gtData.thoiGianGoiThau = formVals.thoiGianGoiThau;
      gtData.thoiGianHopDong = formVals.thoiGianHopDong;
      gtData.awardedPhanLoList = [];
    } else {
      gtData.awardedPhanLoList = this._collectAwardedPhanLoRows();
      gtData.nhaThauTrungThauId = "";
      gtData.giaTrungThau = null;
    }
  } else {
    gtData.nhaThauTrungThauId = "";
    gtData.giaTrungThau = null;
    gtData.thoiGianGoiThau = "";
    gtData.thoiGianHopDong = "";
    gtData.awardedPhanLoList = [];
  }
  if (id) {
    const oldGt = this.model.state.goithau.find((g) => g.id === id);
    const newTen = gtData.tenGoiThau;
    const oldTimeDang = oldGt && oldGt.thoiGianDangTai ? String(oldGt.thoiGianDangTai).trim() : "";
    const newTimeDang = String(gtData.thoiGianDangTai || "").trim();
    const oldTimeDong = oldGt && oldGt.thoiGianDongThau ? String(oldGt.thoiGianDongThau).trim() : "";
    const newTimeDong = String(gtData.thoiGianDongThau || "").trim();
    const oldTimeMo = oldGt && oldGt.thoiGianMoThau ? String(oldGt.thoiGianMoThau).trim() : "";
    const newTimeMo = String(gtData.thoiGianMoThau || "").trim();
    let saveAsNewVersion = false;
    if (oldGt && oldTimeDang !== "") {
      const compareDate = (oldStr, newStr) => {
        if (!oldStr && !newStr) return false;
        if (!oldStr || !newStr) return true;
        const d1 = new Date(oldStr);
        const d2 = new Date(newStr);
        if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
          return oldStr !== newStr;
        }
        return d1.getTime() !== d2.getTime();
      };
      const dangChanged = compareDate(oldTimeDang, newTimeDang);
      const dongChanged = compareDate(oldTimeDong, newTimeDong);
      const moChanged = compareDate(oldTimeMo, newTimeMo);
      if (dangChanged || dongChanged || moChanged) {
        saveAsNewVersion = true;
      }
    }
    if (saveAsNewVersion) {
      const newGtId = generateRecordId("goithau");
      finalGtId = newGtId;
      const timestamp = this.model.getCurrentDateTimeString();
      const newPackageVersion = createNextVersion(this.model.state.goithau, oldGt, preparePackageSnapshot(oldGt, {
        maGoiThau: inputCode,
        ...gtData
      }), { id: newGtId, timestamp });
      newPackageVersion.createdAt = oldGt.createdAt || timestamp;
      clearCompetitiveQuotationAppraisal(newPackageVersion);
      this.model.state.goithau.push(newPackageVersion);
      rememberSelectedVersion(this.model.state, "selectedPackageVersion", newPackageVersion);
      const assignedEmpId = document.getElementById("gt-nhanvienphutrach").value;
      if (assignedEmpId) {
        await this.model.addRecord("assignments", { id: generateRecordId("assignments"), empId: assignedEmpId, targetId: newGtId, type: "goithau" });
      }
    } else {
      oldGt.maGoiThau = inputCode;
      Object.assign(oldGt, gtData);
      clearCompetitiveQuotationAppraisal(oldGt);
      oldGt.updatedAt = this.model.getCurrentDateTimeString();
      const assignedEmpId = document.getElementById("gt-nhanvienphutrach").value;
      const oldAssignments = this.model.state.assignments.filter((a) => a.targetId === id && a.type === "goithau");
      const retainedAssignment = assignedEmpId
        ? oldAssignments.find((assignment) => assignment.empId === assignedEmpId)
        : null;
      for (const oldA of oldAssignments.filter((assignment) => assignment !== retainedAssignment)) {
        await this.model.deleteRecord("assignments", oldA.id);
      }
      if (assignedEmpId && !retainedAssignment) {
        await this.model.addRecord("assignments", { id: generateRecordId("assignments"), empId: assignedEmpId, targetId: id, type: "goithau" });
      }
    }
  } else {
    const newGtId = generateRecordId("goithau");
    finalGtId = newGtId;
    const formEl = document.getElementById("form-goithau");
    const rebidFrom = formEl ? formEl.getAttribute("data-rebid-from") : null;
    const timestamp = this.model.getCurrentDateTimeString();
    const newPackage = createInitialVersion({
      maGoiThau: inputCode,
      isRebid: !!rebidFrom,
      rebidFromPackageId: rebidFrom || null,
      ...gtData
    }, { id: newGtId, timestamp });
    clearCompetitiveQuotationAppraisal(newPackage);
    this.model.state.goithau.push(newPackage);
    const assignedEmpId = document.getElementById("gt-nhanvienphutrach").value;
    if (assignedEmpId) {
      await this.model.addRecord("assignments", { id: generateRecordId("assignments"), empId: assignedEmpId, targetId: newGtId, type: "goithau" });
    }
  }
  if (oldPlanId) {
    this.recalculatePlanTotal(oldPlanId);
  }
  if (gtData.keHoachId && gtData.keHoachId !== oldPlanId) {
    this.recalculatePlanTotal(gtData.keHoachId);
  }
  const breakdownPlanId = document.getElementById("breakdown-plan-id")?.value;
  const modalBreakdown = document.getElementById("modal-plan-breakdown");
  if (modalBreakdown && modalBreakdown.classList.contains("active") && breakdownPlanId) {
    this.renderBreakdownPackagesList(breakdownPlanId);
    this.updateBreakdownTotal(breakdownPlanId);
  }
  if (hasModalReturnState("goithau-detail") && finalGtId) {
    updateModalReturnAction(finalGtId);
  }
  const syncResult = await persistAndSync(this, ["goithau", "kehoach", "hopdong", "thongtinmothau"], {
    afterPersist: () => {
      this.view.renderGoiThauTable();
      this.view.renderKeHoachTable();
    }
  });
  if (syncResult && syncResult.ok === false) {
    await this.view.customAlert(
      "Lỗi đồng bộ",
      "Dữ liệu đã được lưu tạm trên máy nhưng chưa ghi được vào cơ sở dữ liệu. Vui lòng kiểm tra lỗi đồng bộ và thử lưu lại.",
      "alert-triangle"
    );
    return;
  }
  this.closeModal("modal-goithau");
  if (this.packageWizard.active) {
    if (this.packageWizard.currentCount < this.packageWizard.totalCount) {
      this.packageWizard.currentCount++;
      setTimeout(() => {
        this.openPackageWizardStep();
      }, 300);
    } else {
      this.packageWizard.active = false;
      this.packageWizard.planId = null;
      this.packageWizard.totalCount = 0;
      this.packageWizard.currentCount = 0;
      await this.view.customAlert("Thành công", "Đã thêm toàn bộ các gói thầu theo kế hoạch thành công!", "check-circle");
    }
  } else {
    await this.view.customAlert("Thành công", "Đã lưu thông tin gói thầu thành công!", "check-circle");
  }
}
export { checkAndInheritCanceledPackage, restoreCanceledPackage } from "./packageRebidWorkflow.js";

export { unifyTableInputsHeight } from "./packageFormState.js";
import { generateRecordId } from "../shared/idUtils.js";
