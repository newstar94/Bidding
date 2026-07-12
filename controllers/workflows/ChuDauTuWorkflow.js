import { normalizeOrganizationName, normalizePersonName, normalizeVietnamTaxCode } from "../main_controller/domUtils.js";
import { applyRawAddressToAddressControls, composeInternalAddress, parseStoredInternalAddress } from "../utils/PartnerHelpers.js";
import { bindPartnerTaxCodeLookup, findStoredPartnerLookupData } from "./partnerTaxLookup.js";
import { persistAndSync } from "../domain/MutationService.js";
import { clearFormValidation, resetFormState, setFormValues } from "../forms/FormBinder.js";
import { escapeHtml } from "../../views/subviews/view_helpers.js";
import { getCurrentDateYmd } from "../../views/utils/formatters.js";
const todayYmd = getCurrentDateYmd;
export async function deleteChuDauTu(id) {
  const hasPlans = this.model.state.kehoach.some((k) => k.chuDauTuId === id);
  if (hasPlans) {
    await this.view.customAlert(
      "Không thể xóa",
      "Không thể xóa chủ đầu tư này vì có Kế hoạch Lựa chọn nhà thầu đang thuộc quyền quản lý của họ.",
      "x-circle"
    );
    return;
  }
  const confirmed = await this.view.customConfirm(
    "Xác nhận xóa",
    "Bạn có chắc chắn muốn xóa chủ đầu tư này?",
    "trash-2"
  );
  if (confirmed) {
    this.model.state.chudautu = this.model.state.chudautu.filter((c) => c.id !== id);
    this.model.markDeleted("chudautu", id);
    await this.model.persistData("chudautu");
    await this.autoSync();
  }
}
export async function editChuDauTu(id) {
  if (!document.getElementById("modal-chudautu")) {
    await this.ensureLazyModal?.("modal-chudautu");
  }
  const form = document.getElementById("form-chudautu");
  clearFormValidation(form);
  if (id) {
    this.switchTab("chudautu", "chinhsua", true);
    document.getElementById("modal-chudautu-title").textContent = "Cập nhật Chủ đầu tư";
    const cdt = this.model.state.chudautu.find((c) => c.id === id);
    form.dataset.diaChiGoc = cdt.diaChiGoc || "";
    setFormValues(document, cdt, {
      id: "form-chudautu-id",
      maChuDauTu: "cdt-ma",
      maSoThue: "cdt-mst",
      tenChuDauTu: "cdt-ten",
      tenVietTat: "cdt-tenviettat",
      ngayApDung: { target: "cdt-ngayapdung", format: (value) => this.model.formatForDateInput(value || String(cdt.createdAt || "").slice(0, 10)) },
      chucVuNguoiDungDau: "cdt-chucvunguoidungdau",
      daiDienCdt: { target: "cdt-daidiencdt", format: normalizePersonName },
      chucVuDaiDien: "cdt-chucvudaidien",
      danhXung: { target: "cdt-danhxung", defaultValue: "Ông" },
      soDienThoai: "cdt-sdt",
      soTaiKhoan: "cdt-sotaikhoan",
      noiMoTaiKhoan: "cdt-noimotaikhoan",
      email: "cdt-email",
      maQHNS: "cdt-maqhns",
      coQuanChuQuan: "cdt-coquanchuquan"
    });
    const storedAddress = parseStoredInternalAddress(cdt.diaChi || "");
    if (storedAddress.requiresLookup) {
      await this.initAddressDropdowns("cdt-tinh", "cdt-xa", "", "");
      await applyRawAddressToAddressControls(cdt.diaChiGoc || cdt.diaChi || "", {
        detailInputId: "cdt-diachichitiet",
        provinceSelectId: "cdt-tinh",
        wardSelectId: "cdt-xa"
      });
    } else {
      document.getElementById("cdt-diachichitiet").value = storedAddress.detail;
      await this.initAddressDropdowns("cdt-tinh", "cdt-xa", storedAddress.provinceName, storedAddress.wardName);
    }
  } else {
    this.switchTab("chudautu", "taomoi", true);
    document.getElementById("modal-chudautu-title").textContent = "Thêm Chủ đầu tư mới";
    resetFormState(form);
    form.dataset.diaChiGoc = "";
    document.getElementById("form-chudautu-id").value = "";
    document.getElementById("cdt-coquanchuquan").value = "";
    document.getElementById("cdt-diachichitiet").value = "";
    document.getElementById("cdt-ngayapdung").value = this.model.formatForDateInput(todayYmd());
    await this.initAddressDropdowns("cdt-tinh", "cdt-xa", "", "");
  }
  bindPartnerTaxCodeLookup({
    codeInput: document.getElementById("cdt-ma"),
    taxInput: document.getElementById("cdt-mst"),
    partnerRole: "CDT",
    resolveLocalData: (lookup) => findStoredPartnerLookupData(this.model.getLatestChuDauTu(), lookup),
    clearLookupData: () => {
      document.getElementById("cdt-ten").value = "";
      document.getElementById("cdt-tenviettat").value = "";
      document.getElementById("cdt-daidiencdt").value = "";
      document.getElementById("cdt-chucvudaidien").value = "";
      document.getElementById("cdt-sdt").value = "";
      document.getElementById("cdt-email").value = "";
      document.getElementById("cdt-sotaikhoan").value = "";
      document.getElementById("cdt-noimotaikhoan").value = "";
      document.getElementById("cdt-diachichitiet").value = "";
      document.getElementById("cdt-tinh").value = "";
      document.getElementById("cdt-xa").innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
      document.getElementById("cdt-xa").disabled = true;
      form.dataset.diaChiGoc = "";
    },
    applyLookupData: async (data) => {
      if (data.org_code) document.getElementById("cdt-ma").value = data.org_code;
      document.getElementById("cdt-mst").value = data.tax_code || "";
      document.getElementById("cdt-ten").value = normalizeOrganizationName(data.name);
      document.getElementById("cdt-tenviettat").value = data.short_name || "";
      document.getElementById("cdt-daidiencdt").value = normalizePersonName(data.representative_name || "");
      document.getElementById("cdt-chucvudaidien").value = data.representative_position || "";
      document.getElementById("cdt-sdt").value = data.phone || "";
      document.getElementById("cdt-email").value = data.email || "";
      document.getElementById("cdt-sotaikhoan").value = data.bank_account || "";
      document.getElementById("cdt-noimotaikhoan").value = data.bank_name || "";
      document.getElementById("cdt-chucvunguoidungdau").value = data.head_position || "";
      document.getElementById("cdt-maqhns").value = data.budget_code || "";
      document.getElementById("cdt-coquanchuquan").value = data.parent_agency || "";
      if (data.address) {
        form.dataset.diaChiGoc = data.address;
        await applyRawAddressToAddressControls(data.address, {
          detailInputId: "cdt-diachichitiet",
          provinceSelectId: "cdt-tinh",
          wardSelectId: "cdt-xa"
        });
      } else {
        document.getElementById("cdt-diachichitiet").value = "";
        document.getElementById("cdt-tinh").value = "";
        document.getElementById("cdt-xa").innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
        document.getElementById("cdt-xa").disabled = true;
        form.dataset.diaChiGoc = "";
      }
    }
  });
  this.view.openModal("modal-chudautu");
}
export async function handleChuDauTuSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-chudautu");
  const maChuDauTuInput = document.getElementById("cdt-ma");
  const maSoThueInput = document.getElementById("cdt-mst");
  maSoThueInput.value = normalizeVietnamTaxCode(maSoThueInput.value);
  if (!this.view.validateForm(form)) return;
  const id = document.getElementById("form-chudautu-id").value;
  const maChuDauTu = maChuDauTuInput.value.trim();
  const maSoThue = maSoThueInput.value.trim();
  if (maChuDauTu) {
    const latestChuDauTu = this.model.getLatestChuDauTu();
    const isDuplicate = latestChuDauTu.some((c) => c.maChuDauTu === maChuDauTu && (c.id !== id && c.rootId !== id && (c.rootId || c.id) !== (this.model.state.chudautu.find((orig) => orig.id === id)?.rootId || id)));
    if (isDuplicate) {
      const inputEl = document.getElementById("cdt-ma");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Mã chủ đầu tư này đã tồn tại trong hệ thống. Vui lòng nhập mã khác!";
          inputEl.addEventListener("input", () => {
            formGroup.classList.remove("invalid");
            errText.textContent = originalErr;
          }, { once: true });
        }
      }
      inputEl.focus();
      return;
    }
  }
  if (maSoThue) {
    const mstRegex = /^\d{9,14}$|^\d{10}-\d{3}$/;
    if (!mstRegex.test(maSoThue)) {
      const inputEl = document.getElementById("cdt-mst");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Mã số thuế không đúng định dạng (phải gồm từ 9 đến 14 chữ số).";
          inputEl.addEventListener("input", () => {
            formGroup.classList.remove("invalid");
            errText.textContent = originalErr;
          }, { once: true });
        }
      }
      inputEl.focus();
      return;
    }
    const latestChuDauTu = this.model.getLatestChuDauTu();
    const isDuplicate = latestChuDauTu.some((c) => c.maSoThue === maSoThue && (c.id !== id && c.rootId !== id && (c.rootId || c.id) !== (this.model.state.chudautu.find((orig) => orig.id === id)?.rootId || id)));
    if (isDuplicate) {
      const inputEl = document.getElementById("cdt-mst");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Mã số thuế này đã tồn tại trong hệ thống. Vui lòng nhập mã số thuế khác!";
          inputEl.addEventListener("input", () => {
            formGroup.classList.remove("invalid");
            errText.textContent = originalErr;
          }, { once: true });
        }
      }
      inputEl.focus();
      return;
    }
  }
  const phone = document.getElementById("cdt-sdt").value.trim();
  if (phone && !/^[0-9\s+\-()]{9,15}$/.test(phone)) {
    const inputEl = document.getElementById("cdt-sdt");
    const formGroup = inputEl.closest(".form-group");
    if (formGroup) {
      formGroup.classList.add("invalid");
      const errText = formGroup.querySelector(".error-text");
      if (errText) {
        const originalErr = errText.textContent;
        errText.textContent = "Số điện thoại không đúng định dạng (từ 9 đến 15 chữ số).";
        inputEl.addEventListener("input", () => {
          formGroup.classList.remove("invalid");
          errText.textContent = originalErr;
        }, { once: true });
      }
    }
    inputEl.focus();
    return;
  }
  const email = document.getElementById("cdt-email").value.trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const inputEl = document.getElementById("cdt-email");
    const formGroup = inputEl.closest(".form-group");
    if (formGroup) {
      formGroup.classList.add("invalid");
      const errText = formGroup.querySelector(".error-text");
      if (errText) {
        const originalErr = errText.textContent;
        errText.textContent = "Email không đúng định dạng.";
        inputEl.addEventListener("input", () => {
          formGroup.classList.remove("invalid");
          errText.textContent = originalErr;
        }, { once: true });
      }
    }
    inputEl.focus();
    return;
  }
  const tinhSelect = document.getElementById("cdt-tinh");
  const huyenSelect = document.getElementById("cdt-xa");
  const tinhName = tinhSelect.options[tinhSelect.selectedIndex]?.getAttribute("data-name") || "";
  const huyenName = huyenSelect.options[huyenSelect.selectedIndex]?.getAttribute("data-name") || "";
  const diachichitiet = document.getElementById("cdt-diachichitiet").value.trim();
  const diaChiCombined = composeInternalAddress(diachichitiet, huyenName, tinhName);
  let data = {
    maChuDauTu: document.getElementById("cdt-ma").value.trim(),
    maSoThue,
    tenChuDauTu: normalizeOrganizationName(document.getElementById("cdt-ten").value),
    tenVietTat: document.getElementById("cdt-tenviettat").value.trim(),
    chucVuNguoiDungDau: document.getElementById("cdt-chucvunguoidungdau").value.trim(),
    daiDienCdt: normalizePersonName(document.getElementById("cdt-daidiencdt").value),
    chucVuDaiDien: document.getElementById("cdt-chucvudaidien").value.trim(),
    danhXung: document.getElementById("cdt-danhxung").value,
    diaChi: diaChiCombined,
    diaChiGoc: form.dataset.diaChiGoc || "",
    soDienThoai: document.getElementById("cdt-sdt").value.trim(),
    soTaiKhoan: document.getElementById("cdt-sotaikhoan").value.trim(),
    noiMoTaiKhoan: document.getElementById("cdt-noimotaikhoan").value.trim(),
    email: document.getElementById("cdt-email").value.trim(),
    maQHNS: document.getElementById("cdt-maqhns").value.trim(),
    coQuanChuQuan: document.getElementById("cdt-coquanchuquan").value.trim()
    ,ngayApDung: this.model.convertDMYToYMD(document.getElementById("cdt-ngayapdung").value) || todayYmd()
  };
  if (id) {
    const currentCdt = this.model.state.chudautu.find((c) => c.id === id);
    const rootId = currentCdt.rootId || currentCdt.id;
    const versions = this.model.state.chudautu.filter((c) => c.rootId === rootId || c.id === rootId);
    const maxVerNum = Math.max(...versions.map((v) => parseInt(v.phienBan || 0)));
    const nextVerStr = String(maxVerNum + 1).padStart(2, "0");
    const isNewVersion = await this.view.customConfirm(
      "Lưu Chủ đầu tư",
      `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${maxVerNum + 1}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentCdt.phienBan || 0)})`,
      "save"
    );
    if (isNewVersion) {
      versions.forEach((c) => {
        c.isLatest = 0;
      });
      data.id = window.generateRecordId("chudautu");
      data.rootId = rootId;
      data.phienBan = nextVerStr;
      data.isLatest = 1;
      data.createdAt = this.model.getCurrentDateTimeString();
      if (data.ngayApDung === (currentCdt.ngayApDung || String(currentCdt.createdAt || "").slice(0, 10))) {
        data.ngayApDung = todayYmd();
      }
      data.updatedAt = this.model.getCurrentDateTimeString();
      this.model.state.chudautu.push(data);
    } else {
      data.id = id;
      data.rootId = currentCdt.rootId || currentCdt.id;
      data.phienBan = currentCdt.phienBan || "00";
      data.isLatest = currentCdt.isLatest !== void 0 ? currentCdt.isLatest : 1;
      data.createdAt = currentCdt.createdAt || this.model.getCurrentDateTimeString();
      data.updatedAt = this.model.getCurrentDateTimeString();
      const idx = this.model.state.chudautu.findIndex((c) => c.id === id);
      this.model.state.chudautu[idx] = data;
    }
  } else {
    const newId = window.generateRecordId("chudautu");
    data.id = newId;
    data.rootId = newId;
    data.phienBan = "00";
    data.isLatest = 1;
    data.createdAt = this.model.getCurrentDateTimeString();
    data.updatedAt = this.model.getCurrentDateTimeString();
    this.model.state.chudautu.push(data);
  }
  // Persisting also queues the record for server sync, so it must finish
  // before autoSync builds its payload.
  await persistAndSync(this, "chudautu", {
    afterPersist: () => {
      this.view.closeModal("modal-chudautu");
      this.view.renderChuDauTuTable();
    }
  });
  const planModal = document.getElementById("modal-kehoach");
  if (planModal && planModal.classList.contains("active")) {
    const cdtSelect = document.getElementById("kh-chudautuid");
    if (cdtSelect) {
      cdtSelect.innerHTML = '<option value="">-- Chọn Chủ đầu tư --</option>' + this.model.getLatestChuDauTu().map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.tenChuDauTu)}${escapeHtml(this.model.getPendingLabel("chudautu", c.id))}</option>`).join("") + '<option value="__NEW_INVESTOR__" style="color: var(--primary); font-weight: 700;">+ Thêm chủ đầu tư mới</option>';
      cdtSelect.value = data.id;
    }
  }
  const contractModal = document.getElementById("modal-hopdong");
  if (contractModal && contractModal.classList.contains("active")) {
    const cdtSelect = document.getElementById("hd-chudautuid");
    if (cdtSelect) {
      cdtSelect.innerHTML = '<option value="">-- Chọn Chủ đầu tư --</option>' + this.model.getLatestChuDauTu().map((c) => `<option value="${escapeHtml(c.id)}" data-search="${escapeHtml(`${c.maChuDauTu || ""} ${c.tenChuDauTu || ""}`)}">${escapeHtml(c.tenChuDauTu || "")}${escapeHtml(this.model.getPendingLabel("chudautu", c.id))}</option>`).join("") + '<option value="__NEW_INVESTOR__" style="color: var(--primary); font-weight: 700;">+ Thêm chủ đầu tư mới</option>';
      cdtSelect.value = data.id;
      cdtSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}
