import { setRuntimeStyle } from "../shared/runtimeStyles.js";
﻿import { captureModalReturnState, hasModalReturnState, updateModalReturnAction } from "../app/modalReturnState.js";
import { selectPartnerVersionForDate } from "../partners/contractorVersionBinding.js";
import { preserveRowVersion, removeAllVersions, removeLatestVersion } from "../shared/VersionedEntityService.js";
import { persistAndSync } from "../shared/MutationService.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { apiFetch } from "../shared/apiClient.js";
import { organizationEmployeeProfile } from "../auth/accessContext.js";
export async function deleteHopDong(id) {
  const targetHd = this.model.state.hopdong.find((h) => h.id === id);
  if (!targetHd) return;
  const rootId = targetHd.rootId || targetHd.id;
  const relatedHds = this.model.state.hopdong.filter((h) => (h.rootId || h.id) === rootId);
  let deleteConfirmed = false;
  let deleteChoice = null;
  if (relatedHds.length >= 2) {
    deleteChoice = await this.view.customVersionDeleteChoice(
      "Xác nhận xóa",
      `Hợp đồng "${targetHd.tenHopDong || targetHd.soHopDong || "Chưa nhập tên"}" có ${relatedHds.length} phiên bản. Vui lòng chọn cách thức xóa:`,
      "Xóa phiên bản gần nhất",
      "Xóa toàn bộ"
    );
    if (deleteChoice === null) return;
  } else {
    const confirmed = await this.view.customConfirm(
      "Xác nhận xóa",
      "Bạn có chắc chắn muốn xóa hợp đồng này không? Mọi phiên bản lịch sử liên quan sẽ bị xóa bỏ.",
      "trash-2"
    );
    if (!confirmed) return;
    deleteConfirmed = true;
  }
  if (deleteChoice === 1) {
    const result = removeLatestVersion(this.model.state.hopdong, targetHd);
    if (!result.removed.length) return;
    this.model.state.hopdong = result.records;
    this.model.markDeleted("hopdong", result.removed.map((item) => item.id));
    await this.model.persistData("hopdong");
    try {
      const syncResult = await this.autoSync();
      if (!syncResult?.ok) {
        await this.view.customAlert("Chưa đồng bộ", "Thao tác xóa đang chờ máy chủ xác nhận. Vui lòng xử lý trạng thái đồng bộ trước khi tiếp tục.", "alert-triangle");
        return;
      }
    } catch (e) {
      await this.view.customAlert("Lỗi đồng bộ", "Hợp đồng đã xóa khỏi giao diện nhưng có lỗi khi đồng bộ với cơ sở dữ liệu. Vui lòng tải lại trang.", "x-circle");
    }
    await this.view.customAlert("Thành công", "Đã xóa phiên bản hợp đồng gần nhất!", "check-circle");
  } else if (deleteChoice === 2 || deleteConfirmed) {
    const result = removeAllVersions(this.model.state.hopdong, targetHd);
    this.model.state.hopdong = result.records;
    this.model.markDeleted("hopdong", result.removed.map((item) => item.id));
    await this.model.persistData("hopdong");
    try {
      const syncResult = await this.autoSync();
      if (!syncResult?.ok) {
        await this.view.customAlert("Chưa đồng bộ", "Thao tác xóa đang chờ máy chủ xác nhận. Vui lòng xử lý trạng thái đồng bộ trước khi tiếp tục.", "alert-triangle");
        return;
      }
    } catch (e) {
      await this.view.customAlert("Lỗi đồng bộ", "Hợp đồng đã xóa khỏi giao diện nhưng có lỗi khi đồng bộ với cơ sở dữ liệu. Vui lòng tải lại trang.", "x-circle");
    }
    if (deleteChoice === 2) {
      await this.view.customAlert("Thành công", "Đã xóa toàn bộ các phiên bản của hợp đồng!", "check-circle");
    }
  }
}
export async function editHopDong(id) {
  if (!document.getElementById("modal-hopdong")) {
    await this.ensureLazyModal?.("modal-hopdong");
    return this.editHopDong(id);
  }
  try {
    const form = document.getElementById("form-hopdong");
    form.querySelectorAll(".form-group").forEach((fg) => fg.classList.remove("invalid"));
    const coQdSelect = document.getElementById("hd-coqdchidinh");
    const qdFieldsContainer = document.getElementById("hd-qdchidinh-fields");
    const soQdInput = document.getElementById("hd-soqdchidinh");
    const ngayQdInput = document.getElementById("hd-ngayqdchidinh");
    const toggleQdFields = () => {
      if (coQdSelect.value === "1") {
        setRuntimeStyle(qdFieldsContainer, "display", "block");
        soQdInput.setAttribute("required", "required");
        ngayQdInput.setAttribute("required", "required");
      } else {
        setRuntimeStyle(qdFieldsContainer, "display", "none");
        soQdInput.removeAttribute("required");
        ngayQdInput.removeAttribute("required");
        soQdInput.closest(".form-group")?.classList.remove("invalid");
        ngayQdInput.closest(".form-group")?.classList.remove("invalid");
      }
    };
    coQdSelect.onchange = toggleQdFields;
    const cdtSelect = document.getElementById("hd-chudautuid");
    document.getElementById("hd-chudautu-version-select").dataset.manualOverride = "";
    const chudautuList = this.model.getLatestChuDauTu();
    cdtSelect.innerHTML = '<option value="">-- Chọn Chủ đầu tư --</option>' + chudautuList.map((c) => `<option value="${escapeHtml(c.id)}" data-search="${escapeHtml(`${c.maChuDauTu || ""} ${c.tenChuDauTu || ""}`)}">${escapeHtml(c.tenChuDauTu || "")}${escapeHtml(this.model.getPendingLabel("chudautu", c.id))}</option>`).join("") + '<option value="__NEW_INVESTOR__" class="bf-s-5762556293">+ Thêm chủ đầu tư mới</option>';
    this.makeSearchableSelect(cdtSelect, "Tìm kiếm Chủ đầu tư...");
    const ntSelect = document.getElementById("hd-nhathauid");
    document.getElementById("hd-nhathau-version-select").dataset.manualOverride = "";
    const nhathauList = this.model.getLatestNhaThau();
    ntSelect.innerHTML = '<option value="">-- Chọn Nhà thầu --</option>' + nhathauList.map((n) => `<option value="${escapeHtml(n.id)}" data-search="${escapeHtml(`${n.maNhaThau || ""} ${n.tenNhaThau || ""}`)}">${escapeHtml(n.tenNhaThau || "")}${escapeHtml(this.model.getPendingLabel("nhathau", n.id))}</option>`).join("") + '<option value="__NEW_CONTRACTOR__" class="bf-s-5762556293">+ Thêm nhà thầu mới</option>';
    this.makeSearchableSelect(ntSelect, "Tìm kiếm Nhà thầu...");
    const khSelect = document.getElementById("hd-kehoachid");
    const planList = typeof this.model.getLatestPlans === "function" ? this.model.getLatestPlans() : Array.isArray(this.model.state.kehoach) ? this.model.state.kehoach : [];
    khSelect.innerHTML = '<option value="">-- Chọn Kế hoạch LCNT --</option>' + planList.map((kh) => `<option value="${escapeHtml(kh.id)}" data-search="${escapeHtml(`${kh.maKeHoach || ""} ${kh.tenKeHoach || ""}`)}">${escapeHtml(kh.tenKeHoach || "")}${escapeHtml(this.model.getPendingLabel("kehoach", kh.id))}</option>`).join("");
    this.makeSearchableSelect(khSelect, "Tìm kiếm Kế hoạch...");
    const getPlanVersionIds = (selectedPlanId) => {
      if (!selectedPlanId) return [];
      const plan = this.model.state.kehoach.find((kh) => kh.id === selectedPlanId);
      if (!plan) return [];
      const rootId = plan.rootId || plan.id;
      return this.model.state.kehoach.filter((kh) => kh.rootId === rootId || kh.id === rootId).map((kh) => kh.id);
    };
    const renderPackagesForPlan = (selectedPlanId, checkedIds = []) => {
      const planVersionIds = getPlanVersionIds(selectedPlanId);
      const gtContainer = document.getElementById("hd-goithau-list");
      if (!selectedPlanId) {
        gtContainer.innerHTML = '<p class="text-muted bf-s-64c2770c2f">Vui lòng chọn Kế hoạch LCNT để hiển thị gói thầu</p>';
        return;
      }
      const goithauList = typeof this.model.getLatestPackages === "function" ? this.model.getLatestPackages() : Array.isArray(this.model.state.goithau) ? this.model.state.goithau : [];
      const selectedContractorId = ntSelect.value;
      const isDirectAward = coQdSelect.value === "1";
      const filteredGoithau = goithauList.filter((g) => {
        if (!planVersionIds.includes(g.keHoachId)) return false;
        if (isDirectAward) return true;
        return g.trangThai === "Đã có kết quả" &&
          (!selectedContractorId || String(g.nhaThauTrungThauId || "") === String(selectedContractorId));
      });
      if (filteredGoithau.length === 0) {
        gtContainer.innerHTML = '<p class="text-muted bf-s-64c2770c2f">Không có gói thầu đủ điều kiện lập hợp đồng</p>';
      } else {
        gtContainer.innerHTML = filteredGoithau.map((g) => `
                    <label class="checkbox-item bf-s-64d00981be">
                         <input type="checkbox" name="hd-goithau-checkbox" value="${escapeHtml(g.id)}" ${checkedIds.includes(g.id) ? "checked" : ""}>
                         <span><strong>${escapeHtml(g.maGoiThau || "")}</strong> - ${escapeHtml(g.tenGoiThau || "")}</span>
                    </label>
                `).join("");
      }
    };
    khSelect.onchange = (e) => {
      renderPackagesForPlan(e.target.value, []);
    };
    const rerenderEligiblePackages = () => {
      const checkedIds = Array.from(
        document.querySelectorAll('input[name="hd-goithau-checkbox"]:checked')
      ).map((checkbox) => checkbox.value);
      renderPackagesForPlan(khSelect.value, checkedIds);
    };
    coQdSelect.onchange = () => {
      toggleQdFields();
      rerenderEligiblePackages();
    };
    const handleCdtChange = (selectedCdtId, selectVersionId = null) => {
      const versionGroup = document.getElementById("hd-chudautu-version-group");
      const versionSelect = document.getElementById("hd-chudautu-version-select");
      const confirmContainer = document.getElementById("hd-chudautu-confirm-container");
      const confirmInfo = document.getElementById("hd-chudautu-confirm-info");
      if (!selectedCdtId) {
        if (versionGroup) setRuntimeStyle(versionGroup, "display", "none");
        if (confirmContainer) setRuntimeStyle(confirmContainer, "display", "none");
        return;
      }
      const cdt = this.model.state.chudautu.find((c) => c.id === selectedCdtId);
      if (!cdt) return;
      const rootId = cdt.rootId || cdt.id;
      const versions = this.model.state.chudautu.filter((c) => c.rootId === rootId || c.id === rootId);
      versions.sort((a, b) => parseInt(b.phienBan || 0) - parseInt(a.phienBan || 0));
      if (versionSelect && versionGroup) {
        versionSelect.innerHTML = versions.map((v) => {
          const label = this.model.getVersionLabel(v.phienBan || "00");
          const effectiveDate = v.ngayApDung ? this.model.formatDate(v.ngayApDung) : "--";
          return `<option value="${escapeHtml(v.id)}">${escapeHtml(label)} · áp dụng ${escapeHtml(effectiveDate)}</option>`;
        }).join("");
        setRuntimeStyle(versionGroup, "display", "flex");
        versionSelect.onchange = (e) => {
          if (e.isTrusted) versionSelect.dataset.manualOverride = "1";
          const selectedVerCdt = this.model.state.chudautu.find((c) => c.id === e.target.value);
          if (selectedVerCdt && confirmContainer && confirmInfo) {
            setRuntimeStyle(confirmContainer, "display", "block");
            confirmInfo.innerHTML = `
                            <strong>Mã:</strong> ${escapeHtml(selectedVerCdt.maChuDauTu || "--")}<br>
                            <strong>Tên:</strong> ${escapeHtml(selectedVerCdt.tenChuDauTu || "--")}<br>
                            <strong>MST:</strong> ${escapeHtml(selectedVerCdt.maSoThue || "--")}<br>
                            <strong>Người ký:</strong> ${escapeHtml(selectedVerCdt.danhXung || "Ông")} ${escapeHtml(selectedVerCdt.daiDienCdt || "--")} (${escapeHtml(selectedVerCdt.chucVuDaiDien || "--")})<br>
                            <strong>Địa chỉ:</strong> ${escapeHtml((selectedVerCdt.diaChi || "").replace(/\s*\|\s*/g, ", "))}<br>
                            <strong>Tài khoản:</strong> ${escapeHtml(selectedVerCdt.soTaiKhoan || "--")} tại ${escapeHtml(selectedVerCdt.noiMoTaiKhoan || "--")}
                        `;
          }
        };
        versionSelect.value = selectVersionId || selectedCdtId;
        versionSelect.dispatchEvent(new Event("change"));
      }
    };
    cdtSelect.onchange = (e) => {
      if (e.target.value === "__NEW_INVESTOR__") {
        e.target.value = "";
        void this.editChuDauTu(null);
        queueMicrotask(() => e.target.dispatchEvent(new Event("change", { bubbles: true })));
        return;
      }
      handleCdtChange(e.target.value);
    };
    const handleNtChange = (selectedNtId, selectVersionId = null) => {
      const versionGroup = document.getElementById("hd-nhathau-version-group");
      const versionSelect = document.getElementById("hd-nhathau-version-select");
      const confirmContainer = document.getElementById("hd-nhathau-confirm-container");
      const confirmInfo = document.getElementById("hd-nhathau-confirm-info");
      if (!selectedNtId) {
        if (versionGroup) setRuntimeStyle(versionGroup, "display", "none");
        if (confirmContainer) setRuntimeStyle(confirmContainer, "display", "none");
        return;
      }
      const nt = this.model.state.nhathau.find((n) => n.id === selectedNtId);
      if (!nt) return;
      const rootId = nt.rootId || nt.id;
      const versions = this.model.state.nhathau.filter((n) => n.rootId === rootId || n.id === rootId);
      versions.sort((a, b) => parseInt(b.phienBan || 0) - parseInt(a.phienBan || 0));
      if (versionSelect && versionGroup) {
        versionSelect.innerHTML = versions.map((v) => {
          const label = this.model.getVersionLabel(v.phienBan || "00");
          const effectiveDate = v.ngayApDung ? this.model.formatDate(v.ngayApDung) : "--";
          return `<option value="${escapeHtml(v.id)}">${escapeHtml(label)} · áp dụng ${escapeHtml(effectiveDate)}</option>`;
        }).join("");
        setRuntimeStyle(versionGroup, "display", "flex");
        versionSelect.onchange = (e) => {
          if (e.isTrusted) versionSelect.dataset.manualOverride = "1";
          const selectedVerNt = this.model.state.nhathau.find((n) => n.id === e.target.value);
          if (selectedVerNt && confirmContainer && confirmInfo) {
            setRuntimeStyle(confirmContainer, "display", "block");
            const isJV = selectedVerNt.loaiNhaThau === "Liên danh";
            let detailsHtml = `
                            <strong>Mã:</strong> ${escapeHtml(selectedVerNt.maNhaThau || "--")}<br>
                            <strong>Tên:</strong> ${escapeHtml(selectedVerNt.tenNhaThau || "--")}<br>
                            <strong>MST:</strong> ${escapeHtml(selectedVerNt.maSoThue || "--")}<br>
                            <strong>Người đại diện:</strong> ${escapeHtml(selectedVerNt.danhXung || "Ông")} ${escapeHtml(selectedVerNt.nguoiDaiDien || "--")}<br>
                            <strong>Địa chỉ:</strong> ${escapeHtml((selectedVerNt.diaChi || "").replace(/\s*\|\s*/g, ", "))}<br>
                            <strong>Tài khoản:</strong> ${escapeHtml(selectedVerNt.soTaiKhoan || "--")} tại ${escapeHtml(selectedVerNt.noiMoTaiKhoan || "--")}
                        `;
            if (isJV) {
              const members = selectedVerNt.thanhVienLienDanh || [];
              const memberDetails = members.map((m, idx) => `
                                <div>+ TV ${idx + 1}: ${escapeHtml(m.tenNhaThau || "--")} (MST: ${escapeHtml(m.maSoThue || "--")}, Đại diện: ${escapeHtml(m.danhXung || "Ông")} ${escapeHtml(m.nguoiDaiDien || "--")})</div>
                            `).join("");
              detailsHtml += `<div class="bf-s-f699900d34">
                                <strong>Thành viên Liên danh (${members.length}):</strong>
                                ${memberDetails}
                            </div>`;
            }
            confirmInfo.innerHTML = detailsHtml;
          }
        };
        versionSelect.value = selectVersionId || selectedNtId;
        versionSelect.dispatchEvent(new Event("change"));
      }
    };
    ntSelect.onchange = (e) => {
      if (e.target.value === "__NEW_CONTRACTOR__") {
        e.target.value = "";
        void this.editNhaThau(null);
        queueMicrotask(() => e.target.dispatchEvent(new Event("change", { bubbles: true })));
        return;
      }
      handleNtChange(e.target.value);
      rerenderEligiblePackages();
    };
    const _roleLabelMap = { super_admin: "Super Admin / Quản lý / Chuyên viên", manager: "Quản lý / Chuyên viên", employee: "Chuyên viên" };
    const restoreHdEmpValue = () => {
      const empSelect = document.getElementById("hd-nhanvienphutrach");
      if (empSelect) {
        if (id) {
          const assignment = this.model.state.assignments.find((a) => a.targetId === id && a.type === "hopdong");
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
    const _populateHdEmpDropdown = () => {
      const empDropdown = document.getElementById("hd-nhanvienphutrach");
      if (!empDropdown) return;
      const employees = Array.isArray(this.model.state.employees) ? this.model.state.employees : [];
      const optHtml = employees.map((e) => {
        const roleLabel = _roleLabelMap[e.role] || e.role;
        const matchedExpert = this.model.state.chuyengia.find((cg) => cg.hoTen.toLowerCase().trim() === e.name.toLowerCase().trim());
        const extraSearch = matchedExpert ? `${matchedExpert.soCCCD || ""} ${matchedExpert.soChungChi || ""}` : "";
        return `<option value="${escapeHtml(e.id)}" data-search="${escapeHtml(`${e.name} ${roleLabel} ${e.email || ""} ${extraSearch}`)}">${escapeHtml(e.name)} — ${escapeHtml(roleLabel)}${e.email ? ` (${escapeHtml(e.email)})` : ""}</option>`;
      }).join("");
      empDropdown.innerHTML = '<option value="">-- Chọn Chuyên viên phụ trách --</option>' + optHtml;
      restoreHdEmpValue();
    };
    if (!this.model.state.employees || this.model.state.employees.length === 0) {
      apiFetch("/api/auth/users").then((r) => r.json()).then((users) => {
        this.model.state.employees = users.map((u) => {
          const employeeProfile = organizationEmployeeProfile(u);
          return {
            id: String(u.id || ""),
            name: employeeProfile.name,
            email: u.email || "",
            phone: employeeProfile.phone,
            role: u.role
          };
        });
        _populateHdEmpDropdown();
      }).catch((err) => {
        console.error("Failed to load users:", err);
        _populateHdEmpDropdown();
      });
    } else {
      _populateHdEmpDropdown();
    }
    const statusSelect = document.getElementById("hd-trangthai");
    if (statusSelect) {
      // The sync endpoint already scopes this collection to the active organization.
      const orgStatuses = Array.isArray(this.model.state.custompaperstatuses) ? this.model.state.custompaperstatuses : [];
      statusSelect.innerHTML = '<option value="">-- Chọn Trạng thái --</option>' + orgStatuses.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("");
    }
    if (id) {
      captureModalReturnState(this.model.state.activetab || "hopdong", this.model.state.activeaction || null);
      this.switchTab("hopdong", "chinhsua", true);
      document.getElementById("modal-hopdong-title").textContent = "Cập nhật Hợp đồng";
      const hd = this.model.state.hopdong.find((h) => h.id === id);
      document.getElementById("form-hopdong-id").value = hd.id;
      document.getElementById("hd-ten").value = hd.tenHopDong;
      document.getElementById("hd-so").value = hd.soHopDong;
      document.getElementById("hd-ngayky").value = this.model.formatForDateInput(hd.ngayKy);
      document.getElementById("hd-ngaythanhly").value = this.model.formatForDateInput(hd.ngayThanhLy);
      const relatedRecordsToLoad = [
        ["chudautu", hd.chuDauTuId],
        ["nhathau", hd.nhaThauId],
        ["kehoach", hd.keHoachId]
      ].filter(([table, recordId]) => recordId && !this.model.state[table]?.some((item) => String(item.id) === String(recordId)));
      await Promise.all(relatedRecordsToLoad.map(([table, recordId]) => this.fetchRecordByLookup(table, recordId)));
      const currentCdt = this.model.state.chudautu.find((c) => c.id === hd.chuDauTuId);
      if (currentCdt) {
        const rootId = currentCdt.rootId || currentCdt.id;
        const latestCdt = chudautuList.find((c) => (c.rootId || c.id) === rootId);
        if (latestCdt) {
          cdtSelect.value = latestCdt.id;
          cdtSelect.dispatchEvent(new Event("change"));
          handleCdtChange(latestCdt.id, hd.chuDauTuId);
        }
      } else {
        cdtSelect.value = "";
        cdtSelect.dispatchEvent(new Event("change"));
        handleCdtChange("");
      }
      const currentNt = this.model.state.nhathau.find((n) => n.id === hd.nhaThauId);
      if (currentNt) {
        const rootId = currentNt.rootId || currentNt.id;
        const latestNt = nhathauList.find((n) => (n.rootId || n.id) === rootId);
        if (latestNt) {
          ntSelect.value = latestNt.id;
          ntSelect.dispatchEvent(new Event("change"));
          handleNtChange(latestNt.id, hd.nhaThauId);
        }
      } else {
        ntSelect.value = "";
        ntSelect.dispatchEvent(new Event("change"));
        handleNtChange("");
      }
      document.getElementById("hd-giatri").value = this.model.formatVND(hd.giaTri);
      document.getElementById("hd-loai").value = hd.loaiHopDong || "Trọn gói";
      document.getElementById("hd-phanloai").value = hd.phanLoai || "Tư vấn";
      coQdSelect.value = hd.coQdChiDinh ? String(hd.coQdChiDinh) : "0";
      soQdInput.value = hd.soQdChiDinh || "";
      ngayQdInput.value = this.model.formatForDateInput(hd.ngayQdChiDinh);
      toggleQdFields();
      document.getElementById("hd-songay").value = hd.soNgayThucHien || "";
      document.getElementById("hd-trangthai-hopdong").value = hd.trangThaiHopDong || "Đang thực hiện";
      if (statusSelect) {
        statusSelect.value = hd.trangThaiHoSo || "";
      }
      if (hd.keHoachId) {
        khSelect.value = hd.keHoachId;
        khSelect.dispatchEvent(new Event("change"));
        renderPackagesForPlan(hd.keHoachId, hd.goiThauIds || []);
      } else {
        khSelect.value = "";
        khSelect.dispatchEvent(new Event("change"));
        renderPackagesForPlan("", []);
      }
    } else {
      captureModalReturnState(this.model.state.activetab || "hopdong", this.model.state.activeaction || null);
      this.switchTab("hopdong", "taomoi", true);
      document.getElementById("modal-hopdong-title").textContent = "Thêm Hợp đồng mới";
      form.reset();
      document.getElementById("hd-phanloai").value = "Tư vấn";
      coQdSelect.value = "0";
      soQdInput.value = "";
      ngayQdInput.value = "";
      toggleQdFields();
      document.getElementById("form-hopdong-id").value = "";
      const ngayKyInp = document.getElementById("hd-ngayky");
      if (ngayKyInp) ngayKyInp.value = "";
      document.getElementById("hd-ngaythanhly").value = "";
      document.getElementById("hd-trangthai-hopdong").value = "Đang thực hiện";
      cdtSelect.value = "";
      cdtSelect.dispatchEvent(new Event("change"));
      handleCdtChange("");
      ntSelect.value = "";
      ntSelect.dispatchEvent(new Event("change"));
      handleNtChange("");
      khSelect.value = "";
      khSelect.dispatchEvent(new Event("change"));
      renderPackagesForPlan("", []);
    }
    if (this.model.state.activerole === "employee") {
      const empSelect = document.getElementById("hd-nhanvienphutrach");
      if (empSelect) {
        empSelect.disabled = true;
        const wrapper = empSelect.parentNode.querySelector(`.custom-select-wrapper[data-select-id="hd-nhanvienphutrach"]`);
        if (wrapper) {
          const searchInput = wrapper.querySelector(".custom-select-search");
          if (searchInput) {
            searchInput.disabled = true;
          }
        }
      }
    }
    this.view.openModal("modal-hopdong");
  } catch (err) {
    this.view.customAlert("Lỗi mở form", "Lỗi mở modal Hợp đồng: " + err.message, "x-circle");
    console.error("editHopDong error:", err);
  }
}
export async function handleHopDongSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-hopdong");
  if (!this.view.validateForm(form)) return;
  const id = document.getElementById("form-hopdong-id").value;
  const tenHopDong = document.getElementById("hd-ten").value.trim();
  const soHopDong = document.getElementById("hd-so").value.trim();
  const ngayKy = document.getElementById("hd-ngayky").value;
  const ngayKyYmd = ngayKy ? this.model.convertDMYToYMD(ngayKy) : "";
  const currentHdForBinding = id ? this.model.state.hopdong.find((h) => h.id === id) : null;
  const selectedChuDauTuId = document.getElementById("hd-chudautu-version-select").value || document.getElementById("hd-chudautuid").value;
  const selectedNhaThauId = document.getElementById("hd-nhathau-version-select").value || document.getElementById("hd-nhathauid").value;
  const preserveCdtBinding = currentHdForBinding && currentHdForBinding.ngayKy === ngayKyYmd && currentHdForBinding.chuDauTuId === selectedChuDauTuId;
  const preserveNtBinding = currentHdForBinding && currentHdForBinding.ngayKy === ngayKyYmd && currentHdForBinding.nhaThauId === selectedNhaThauId;
  const cdtManualOverride = document.getElementById("hd-chudautu-version-select").dataset.manualOverride === "1";
  const ntManualOverride = document.getElementById("hd-nhathau-version-select").dataset.manualOverride === "1";
  const chuDauTuId = preserveCdtBinding || cdtManualOverride ? selectedChuDauTuId : selectPartnerVersionForDate(this.model.state.chudautu || [], selectedChuDauTuId, ngayKyYmd)?.id || selectedChuDauTuId;
  const nhaThauId = preserveNtBinding || ntManualOverride ? selectedNhaThauId : selectPartnerVersionForDate(this.model.state.nhathau || [], selectedNhaThauId, ngayKyYmd)?.id || selectedNhaThauId;
  const ngayThanhLyRaw = document.getElementById("hd-ngaythanhly").value;
  const ngayThanhLy = ngayThanhLyRaw ? this.model.convertDMYToYMD(ngayThanhLyRaw) : "";
  const keHoachId = document.getElementById("hd-kehoachid").value;
  const giaTri = this.model.parseVND(document.getElementById("hd-giatri").value);
  if (giaTri < 0) {
    await this.view.customAlert("Dữ liệu không hợp lệ", "Giá trị hợp đồng không được nhỏ hơn 0.", "alert-triangle", document.getElementById("hd-giatri"));
    return;
  }
  const loaiHopDong = document.getElementById("hd-loai").value;
  const phanLoai = document.getElementById("hd-phanloai").value;
  const coQdChiDinh = parseInt(document.getElementById("hd-coqdchidinh").value) || 0;
  const soQdChiDinh = coQdChiDinh ? document.getElementById("hd-soqdchidinh").value.trim() : "";
  const ngayQdChiDinh = coQdChiDinh ? document.getElementById("hd-ngayqdchidinh").value : "";
  const soNgayThucHien = document.getElementById("hd-songay").value.trim();
  const trangThaiHoSo = document.getElementById("hd-trangthai").value;
  const trangThaiHopDong = document.getElementById("hd-trangthai-hopdong").value;
  if (ngayThanhLy && trangThaiHopDong !== "Đã thanh lý") {
    await this.view.customAlert("Dữ liệu không hợp lệ", "Khi có ngày thanh lý, trạng thái hợp đồng phải là Đã thanh lý.", "alert-triangle", document.getElementById("hd-trangthai-hopdong"));
    return;
  }
  if (!ngayThanhLy && trangThaiHopDong === "Đã thanh lý") {
    await this.view.customAlert("Dữ liệu không hợp lệ", "Hợp đồng đã thanh lý phải có ngày thanh lý.", "alert-triangle", document.getElementById("hd-ngaythanhly"));
    return;
  }
  if (soHopDong) {
    const currentContract = id ? this.model.state.hopdong.find((h) => h.id === id) : null;
    const currentRootId = currentContract ? currentContract.rootId || currentContract.id : "";
    const normalizedContractNumber = soHopDong.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleUpperCase("vi-VN");
    const dupSoHD = (this.model.state.hopdong || []).some(
      (h) => {
        const sameLineage = currentRootId && (h.rootId || h.id) === currentRootId;
        const candidate = String(h.soHopDong || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleUpperCase("vi-VN");
        return h.id !== id && !sameLineage && candidate === normalizedContractNumber;
      }
    );
    if (dupSoHD) {
      const inputEl = document.getElementById("hd-so");
      const formGroup = inputEl?.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Số hợp đồng này đã tồn tại trong hệ thống. Vui lòng nhập số hợp đồng khác!";
          inputEl.addEventListener("input", () => {
            formGroup.classList.remove("invalid");
            errText.textContent = originalErr;
          }, { once: true });
        }
      }
      inputEl?.focus();
      return;
    }
  }
  const checkboxes = document.querySelectorAll('input[name="hd-goithau-checkbox"]:checked');
  const goiThauIds = Array.from(checkboxes).map((cb) => cb.value);
  if (!Array.isArray(this.model.state.hopdong)) {
    this.model.state.hopdong = [];
  }
  let finalHdId = id;
  const assignedEmpId = document.getElementById("hd-nhanvienphutrach").value;
  let data = {
    tenHopDong,
    soHopDong,
    ngayKy: ngayKyYmd,
    chuDauTuId,
    nhaThauId,
    ngayThanhLy,
    chuDauTuThanhLyId: ngayThanhLy ? selectPartnerVersionForDate(this.model.state.chudautu || [], chuDauTuId, ngayThanhLy)?.id || chuDauTuId : "",
    nhaThauThanhLyId: ngayThanhLy ? selectPartnerVersionForDate(this.model.state.nhathau || [], nhaThauId, ngayThanhLy)?.id || nhaThauId : "",
    keHoachId,
    giaTri,
    loaiHopDong,
    phanLoai,
    coQdChiDinh,
    soQdChiDinh,
    ngayQdChiDinh: ngayQdChiDinh ? this.model.convertDMYToYMD(ngayQdChiDinh) : "",
    soNgayThucHien,
    goiThauIds,
    trangThaiHoSo,
    trangThaiHopDong
  };
  if (id) {
    const currentHd = this.model.state.hopdong.find((h) => h.id === id);
    const rootId = currentHd.rootId || currentHd.id;
    const versions = this.model.state.hopdong.filter((h) => h.rootId === rootId || h.id === rootId);
    const maxVerNum = Math.max(...versions.map((v) => parseInt(v.phienBan || 0)));
    const nextVerStr = String(maxVerNum + 1).padStart(2, "0");
    const isNewVersion = await this.view.customConfirm(
      "Lưu Hợp đồng",
      `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${maxVerNum + 1}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentHd.phienBan || 0)})`,
      "save"
    );
    if (isNewVersion) {
      versions.forEach((h) => {
        h.isLatest = 0;
      });
      data.id = generateRecordId("hopdong");
      data.rootId = rootId;
      data.phienBan = nextVerStr;
      data.isLatest = 1;
      data.createdAt = currentHd.createdAt || this.model.getCurrentDateTimeString();
      data.updatedAt = this.model.getCurrentDateTimeString();
      this.model.state.hopdong.push(data);
      finalHdId = data.id;
    } else {
      data.id = id;
      data.rootId = currentHd.rootId || currentHd.id;
      data.phienBan = currentHd.phienBan || "00";
      data.isLatest = currentHd.isLatest !== void 0 ? currentHd.isLatest : 1;
      data.createdAt = currentHd.createdAt || this.model.getCurrentDateTimeString();
      data.updatedAt = this.model.getCurrentDateTimeString();
      preserveRowVersion(data, currentHd);
      const idx = this.model.state.hopdong.findIndex((h) => h.id === id);
      this.model.state.hopdong[idx] = data;
    }
  } else {
    const newId = generateRecordId("hopdong");
    data.id = newId;
    data.rootId = newId;
    data.phienBan = "00";
    data.isLatest = 1;
    data.createdAt = this.model.getCurrentDateTimeString();
    data.updatedAt = this.model.getCurrentDateTimeString();
    this.model.state.hopdong.push(data);
    finalHdId = newId;
  }
  if (finalHdId) {
    const oldAssignments = this.model.state.assignments.filter((a) => a.targetId === finalHdId && a.type === "hopdong");
    const retainedAssignment = assignedEmpId
      ? oldAssignments.find((assignment) => assignment.empId === assignedEmpId)
      : null;
    for (const oldA of oldAssignments.filter((assignment) => assignment !== retainedAssignment)) {
      await this.model.deleteRecord("assignments", oldA.id);
    }
    if (assignedEmpId && !retainedAssignment) {
      await this.model.addRecord("assignments", { id: generateRecordId("assignments"), empId: assignedEmpId, targetId: finalHdId, type: "hopdong" });
    }
  }
  if (hasModalReturnState("hopdong-detail") && finalHdId) {
    updateModalReturnAction(finalHdId);
  }
  await persistAndSync(this, "hopdong", {
    afterPersist: () => {
      this.closeModal("modal-hopdong");
      this.view.renderHopDongTable();
    }
  });
}
import { generateRecordId } from "../shared/idUtils.js";
