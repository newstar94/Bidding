import { normalizeOrganizationName, normalizePersonName, normalizeVietnamTaxCode } from "../main_controller/domUtils.js";
import { applyRawAddressToAddressControls, composeInternalAddress, parseStoredInternalAddress } from "../utils/PartnerHelpers.js";
import { bindPartnerTaxCodeLookup, findStoredPartnerLookupData } from "./partnerTaxLookup.js";
import { persistAndSync } from "../domain/MutationService.js";
import { clearFormValidation, resetFormState, setFormValues } from "../forms/FormBinder.js";
import { escapeHtml, safeImageSrc } from "../../views/subviews/view_helpers.js";
import { rememberSelectedVersion } from "../domain/VersionedEntityService.js";
import { getCurrentDateYmd } from "../../views/utils/formatters.js";
const todayYmd = getCurrentDateYmd;
const safeStampSrc = (value) => {
  const src = String(value || "").trim();
  if (/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) return src;
  if (/^\/uploads\/nha_thau\/[a-z0-9._-]+$/i.test(src)) return src;
  return "";
};
const setNhaThauStampPreview = (value, isReadOnly = false, cacheKey = "") => {
  const uploadZone = document.getElementById("nt-upload-zone-dau");
  const previewContainer = document.getElementById("nt-preview-container-dau");
  const previewImg = document.getElementById("nt-anh-preview-dau");
  const removeBtn = document.getElementById("btn-nt-remove-file-dau");
  const src = safeStampSrc(value);
  if (previewImg) previewImg.src = safeImageSrc(src, cacheKey);
  if (previewContainer) previewContainer.style.display = src ? "flex" : "none";
  if (uploadZone) uploadZone.style.display = src || isReadOnly ? "none" : "flex";
  if (removeBtn) removeBtn.style.display = isReadOnly ? "none" : "";
};
export async function deleteNhaThau(id) {
  const nt = this.model.state.nhathau.find((n) => n.id === id);
  if (!nt) return;
  const wonPackages = this.model.state.goithau.filter((gt) => gt.nhaThauTrungThauId === id);
  if (wonPackages.length > 0) {
    const codes = wonPackages.map((gt) => gt.maGoiThau).join(", ");
    await this.view.customAlert(
      "Không thể xóa",
      `Không thể xóa nhà thầu này vì họ đã được công bố trúng thầu tại gói thầu: ${codes}.`,
      "x-circle"
    );
    return;
  }
  const jvMemberIn = (this.model.state.thongtinmothau || []).filter((b) => {
    const members = b.thanhVienLienDanh || [];
    return members.some(
      (m) => nt.maSoThue && String(m.maSoThue).toLowerCase().trim() === String(nt.maSoThue).toLowerCase().trim() || nt.tenNhaThau && String(m.tenNhaThau).toLowerCase().trim() === String(nt.tenNhaThau).toLowerCase().trim()
    );
  });
  if (jvMemberIn.length > 0) {
    const wonJvPackages = [...new Set(jvMemberIn.map((b) => {
      const gt = this.model.state.goithau.find((g) => g.id === b.goiThauId);
      return gt ? gt.maGoiThau || b.goiThauId : b.goiThauId;
    }))].join(", ");
    await this.view.customAlert(
      "Không thể xóa",
      `Không thể xóa nhà thầu này vì họ là thành viên liên danh trong hồ sơ mở thầu của gói thầu: ${wonJvPackages}.`,
      "x-circle"
    );
    return;
  }
  const inContracts = (this.model.state.hopdong || []).filter((h) => h.nhaThauId === id);
  if (inContracts.length > 0) {
    const contractNos = inContracts.map((h) => h.soHopDong || h.tenHopDong || h.id).join(", ");
    await this.view.customAlert(
      "Không thể xóa",
      `Không thể xóa nhà thầu này vì họ đang liên kết với hợp đồng: ${contractNos}.`,
      "x-circle"
    );
    return;
  }
  const confirmed = await this.view.customConfirm(
    "Xác nhận xóa",
    "Bạn có chắc chắn muốn xóa thông tin nhà thầu này?",
    "trash-2"
  );
  if (confirmed) {
    this.model.state.nhathau = this.model.state.nhathau.filter((n) => n.id !== id);
    this.model.markDeleted("nhathau", id);
    await this.model.persistData("nhathau");
    await this.autoSync();
  }
}
export async function editNhaThau(id, isReadOnly = false) {
  if (!document.getElementById("modal-nhathau")) {
    await this.ensureLazyModal?.("modal-nhathau");
  }
  try {
    const form = document.getElementById("form-nhathau");
    if (!form) throw new Error("Không tìm thấy form nhập nhà thầu (form-nhathau)");
    clearFormValidation(form);
    const inputs = form.querySelectorAll("input, select, textarea");
    inputs.forEach((inp) => {
      inp.disabled = isReadOnly;
      if (inp.tagName === "INPUT") {
        inp.readOnly = isReadOnly;
      }
    });
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.style.display = isReadOnly ? "none" : "";
    }
    const cancelBtn = form.querySelector('button[data-close="modal-nhathau"]');
    if (cancelBtn) {
      cancelBtn.textContent = isReadOnly ? "Đóng" : "Hủy";
    }
    if (id) {
      if (isReadOnly) {
        window._nhaThauViewOnly = true;
      } else {
        window._nhaThauViewOnly = false;
        this.switchTab("nhathau", "chinhsua", true);
      }
      const titleEl = document.getElementById("modal-nhathau-title");
      if (titleEl) titleEl.textContent = isReadOnly ? "Thông tin Nhà thầu (Chỉ xem)" : "Cập nhật Nhà thầu";
      const nt = this.model.state.nhathau.find((n) => n.id === id);
      if (!nt) throw new Error("Không tìm thấy dữ liệu nhà thầu với ID " + id);
      form.dataset.diaChiGoc = nt.diaChiGoc || "";
      setFormValues(document, nt, {
        id: "form-nhathau-id",
        maNhaThau: "nt-ma",
        tenNhaThau: "nt-ten",
        tenVietTat: "nt-tenviettat",
        ngayApDung: { target: "nt-ngayapdung", format: (value) => this.model.formatForDateInput(value || String(nt.createdAt || "").slice(0, 10)) },
        maSoThue: "nt-mst",
        nguoiDaiDien: { target: "nt-nguoidaidien", format: normalizePersonName },
        chucVuDaiDien: "nt-chucvudaidien",
        danhXung: { target: "nt-danhxung", defaultValue: "Ông" },
        soDienThoai: "nt-sdt",
        email: "nt-email",
        soTaiKhoan: "nt-sotaikhoan",
        noiMoTaiKhoan: "nt-noimotaikhoan",
        maNganHang: "nt-manganhang"
      });
      const storedAddress = parseStoredInternalAddress(nt.diaChi || "");
      if (storedAddress.requiresLookup) {
        await this.initAddressDropdowns("nt-tinh", "nt-xa", "", "", isReadOnly);
        await applyRawAddressToAddressControls(nt.diaChiGoc || nt.diaChi || "", {
          detailInputId: "nt-diachichitiet",
          provinceSelectId: "nt-tinh",
          wardSelectId: "nt-xa"
        });
      } else {
        if (document.getElementById("nt-diachichitiet")) document.getElementById("nt-diachichitiet").value = storedAddress.detail;
        await this.initAddressDropdowns("nt-tinh", "nt-xa", storedAddress.provinceName, storedAddress.wardName, isReadOnly);
      }
      if (isReadOnly) {
        if (document.getElementById("nt-tinh")) document.getElementById("nt-tinh").disabled = true;
        if (document.getElementById("nt-xa")) document.getElementById("nt-xa").disabled = true;
      }
      this.tempNhaThauStampBase64 = safeStampSrc(nt.anhDau);
      setNhaThauStampPreview(this.tempNhaThauStampBase64, isReadOnly, nt.updatedAt || nt.createdAt);
    } else {
      window._nhaThauViewOnly = false;
      this.switchTab("nhathau", "taomoi", true);
      const titleEl = document.getElementById("modal-nhathau-title");
      if (titleEl) titleEl.textContent = "Thêm Nhà thầu mới";
      resetFormState(form);
      form.dataset.diaChiGoc = "";
      if (document.getElementById("nt-diachichitiet")) document.getElementById("nt-diachichitiet").value = "";
      if (document.getElementById("nt-ngayapdung")) document.getElementById("nt-ngayapdung").value = this.model.formatForDateInput(todayYmd());
      await this.initAddressDropdowns("nt-tinh", "nt-xa", "", "", false);
      const idInput = document.getElementById("form-nhathau-id");
      if (idInput) idInput.value = "";
      this.tempNhaThauStampBase64 = "";
      setNhaThauStampPreview("", false);
    }
    const partnerCodeInput = document.getElementById("nt-ma");
    const partnerTaxInput = document.getElementById("nt-mst");
    partnerCodeInput?.__bfPartnerTaxLookupCleanup?.();
    if (!isReadOnly) {
      bindPartnerTaxCodeLookup({
        codeInput: partnerCodeInput,
        taxInput: partnerTaxInput,
        partnerRole: "NT",
        resolveLocalData: (lookup) => findStoredPartnerLookupData(this.model.getLatestNhaThau(), lookup),
        clearLookupData: () => {
          document.getElementById("nt-ten").value = "";
          document.getElementById("nt-tenviettat").value = "";
          document.getElementById("nt-nguoidaidien").value = "";
          document.getElementById("nt-chucvudaidien").value = "";
          document.getElementById("nt-sdt").value = "";
          document.getElementById("nt-email").value = "";
          document.getElementById("nt-sotaikhoan").value = "";
          document.getElementById("nt-noimotaikhoan").value = "";
          document.getElementById("nt-manganhang").value = "";
          document.getElementById("nt-diachichitiet").value = "";
          document.getElementById("nt-tinh").value = "";
          document.getElementById("nt-xa").innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
          document.getElementById("nt-xa").disabled = true;
          form.dataset.diaChiGoc = "";
        },
        applyLookupData: async (data) => {
          if (data.org_code) document.getElementById("nt-ma").value = data.org_code;
          document.getElementById("nt-mst").value = data.tax_code || "";
          document.getElementById("nt-ten").value = normalizeOrganizationName(data.name);
          document.getElementById("nt-tenviettat").value = data.short_name || "";
          document.getElementById("nt-nguoidaidien").value = normalizePersonName(data.representative_name || "");
          document.getElementById("nt-chucvudaidien").value = data.representative_position || "";
          document.getElementById("nt-sdt").value = data.phone || "";
          document.getElementById("nt-email").value = data.email || "";
          document.getElementById("nt-sotaikhoan").value = data.bank_account || "";
          document.getElementById("nt-noimotaikhoan").value = data.bank_name || "";
          document.getElementById("nt-manganhang").value = data.bank_code || "";
          if (data.address) {
            form.dataset.diaChiGoc = data.address;
            await applyRawAddressToAddressControls(data.address, {
              detailInputId: "nt-diachichitiet",
              provinceSelectId: "nt-tinh",
              wardSelectId: "nt-xa"
            });
          } else {
            document.getElementById("nt-diachichitiet").value = "";
            document.getElementById("nt-tinh").value = "";
            document.getElementById("nt-xa").innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
            document.getElementById("nt-xa").disabled = true;
            form.dataset.diaChiGoc = "";
          }
        }
      });
    }
    this.view.openModal("modal-nhathau");
  } catch (err) {
    console.error("editNhaThau failed: ", err);
    if (this.view && typeof this.view.customAlert === "function") {
      this.view.customAlert("Lỗi giao diện", "Không thể mở khung nhập nhà thầu: " + err.message, "x-circle");
    } else {
      this.view.customAlert("Lỗi giao diện", "Lỗi giao diện: " + err.message, "x-circle");
    }
  }
}
export async function handleNhaThauSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-nhathau");
  const maNhaThauInput = document.getElementById("nt-ma");
  const maSoThueInput = document.getElementById("nt-mst");
  maSoThueInput.value = normalizeVietnamTaxCode(maSoThueInput.value);
  if (!this.view.validateForm(form)) return;
  const id = document.getElementById("form-nhathau-id").value;
  const maNhaThau = maNhaThauInput.value.trim();
  const tenNhaThau = normalizeOrganizationName(document.getElementById("nt-ten").value);
  const maSoThue = maSoThueInput.value.trim();
  if (maNhaThau) {
    const latestNhaThau = this.model.getLatestNhaThau();
    const dupMa = latestNhaThau.some(
      (n) => n.id !== id && n.rootId !== id && (n.rootId || n.id) !== (this.model.state.nhathau.find((orig) => orig.id === id)?.rootId || id) && n.maNhaThau && n.maNhaThau.trim().toLowerCase() === maNhaThau.toLowerCase()
    );
    if (dupMa) {
      const inputEl = document.getElementById("nt-ma");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Mã nhà thầu này đã tồn tại trong hệ thống. Vui lòng nhập mã khác!";
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
      const inputEl = document.getElementById("nt-mst");
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
    const latestNhaThau = this.model.getLatestNhaThau();
    const dupMST = latestNhaThau.some(
      (n) => n.id !== id && n.rootId !== id && (n.rootId || n.id) !== (this.model.state.nhathau.find((orig) => orig.id === id)?.rootId || id) && n.maSoThue && n.maSoThue.trim().toLowerCase() === maSoThue.toLowerCase()
    );
    if (dupMST) {
      const inputEl = document.getElementById("nt-mst");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Mã số thuế này đã được đăng ký cho một nhà thầu khác trong hệ thống!";
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
  const phone = document.getElementById("nt-sdt").value.trim();
  if (phone && !/^[0-9\s+\-()]{9,15}$/.test(phone)) {
    const inputEl = document.getElementById("nt-sdt");
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
  const email = document.getElementById("nt-email").value.trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const inputEl = document.getElementById("nt-email");
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
  const tinhSelect = document.getElementById("nt-tinh");
  const huyenSelect = document.getElementById("nt-xa");
  const tinhName = tinhSelect.options[tinhSelect.selectedIndex]?.getAttribute("data-name") || "";
  const huyenName = huyenSelect.options[huyenSelect.selectedIndex]?.getAttribute("data-name") || "";
  const diachichitiet = document.getElementById("nt-diachichitiet").value.trim();
  const diaChiCombined = composeInternalAddress(diachichitiet, huyenName, tinhName);
  const currentNtForStamp = id ? this.model.state.nhathau.find((n) => n.id === id) : null;
  const stampValue = safeStampSrc(this.tempNhaThauStampBase64);
  const stampIsNewUpload = stampValue.startsWith("data:image/");
  const stampExt = stampValue ? this.model.getFileExtensionFromBase64(stampValue) : "";
  let data = {
    maNhaThau,
    tenNhaThau,
    tenVietTat: document.getElementById("nt-tenviettat").value.trim(),
    loaiNhaThau: "Độc lập",
    maSoThue,
    nguoiDaiDien: normalizePersonName(document.getElementById("nt-nguoidaidien").value),
    chucVuDaiDien: document.getElementById("nt-chucvudaidien").value.trim(),
    danhXung: document.getElementById("nt-danhxung").value,
    soDienThoai: document.getElementById("nt-sdt").value.trim(),
    email: document.getElementById("nt-email").value.trim(),
    diaChi: diaChiCombined,
    diaChiGoc: form.dataset.diaChiGoc || "",
    soTaiKhoan: document.getElementById("nt-sotaikhoan").value.trim(),
    noiMoTaiKhoan: document.getElementById("nt-noimotaikhoan").value.trim(),
    maNganHang: document.getElementById("nt-manganhang").value.trim(),
    anhDau: stampValue,
    tenAnhDau: stampValue
      ? stampIsNewUpload
        ? `DAU_${maNhaThau || "NHA_THAU"}.${stampExt}`
        : currentNtForStamp?.tenAnhDau || `DAU_${maNhaThau || "NHA_THAU"}.${stampExt}`
      : "",
    ngayApDung: this.model.convertDMYToYMD(document.getElementById("nt-ngayapdung").value) || todayYmd()
  };
  if (id) {
    const currentNt = this.model.state.nhathau.find((n) => n.id === id);
    const rootId = currentNt.rootId || currentNt.id;
    const versions = this.model.state.nhathau.filter((n) => n.rootId === rootId || n.id === rootId);
    const maxVerNum = Math.max(...versions.map((v) => parseInt(v.phienBan || 0)));
    const nextVerStr = String(maxVerNum + 1).padStart(2, "0");
    const isNewVersion = await this.view.customConfirm(
      "Lưu Nhà thầu",
      `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${maxVerNum + 1}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentNt.phienBan || 0)})`,
      "save"
    );
    if (isNewVersion) {
      versions.forEach((n) => {
        n.isLatest = 0;
      });
      data.id = window.generateRecordId("nhathau");
      data.rootId = rootId;
      data.phienBan = nextVerStr;
      data.isLatest = 1;
      data.createdAt = this.model.getCurrentDateTimeString();
      if (data.ngayApDung === (currentNt.ngayApDung || String(currentNt.createdAt || "").slice(0, 10))) {
        data.ngayApDung = todayYmd();
      }
      data.updatedAt = this.model.getCurrentDateTimeString();
      this.model.state.nhathau.push(data);
    } else {
      data.id = id;
      data.rootId = currentNt.rootId || currentNt.id;
      data.phienBan = currentNt.phienBan || "00";
      data.isLatest = currentNt.isLatest !== void 0 ? currentNt.isLatest : 1;
      data.createdAt = currentNt.createdAt || this.model.getCurrentDateTimeString();
      data.updatedAt = this.model.getCurrentDateTimeString();
      const idx = this.model.state.nhathau.findIndex((n) => n.id === id);
      this.model.state.nhathau[idx] = data;
    }
  } else {
    const newId = window.generateRecordId("nhathau");
    data.id = newId;
    data.rootId = newId;
    data.phienBan = "00";
    data.isLatest = 1;
    data.createdAt = this.model.getCurrentDateTimeString();
    data.updatedAt = this.model.getCurrentDateTimeString();
    this.model.state.nhathau.push(data);
  }
  rememberSelectedVersion(this.model.state, "selectedNhaThauVersion", data);
  // Persisting also queues the record for server sync, so it must finish
  // before autoSync builds its payload.
  await persistAndSync(this, "nhathau", {
    afterPersist: () => {
      this.view.closeModal("modal-nhathau");
      this.view.renderNhaThauTable();
    }
  });
  const contractModal = document.getElementById("modal-hopdong");
  if (contractModal && contractModal.classList.contains("active")) {
    const ntSelect = document.getElementById("hd-nhathauid");
    if (ntSelect) {
      ntSelect.innerHTML = '<option value="">-- Chọn Nhà thầu --</option>' + this.model.getLatestNhaThau().map((n) => `<option value="${escapeHtml(n.id)}" data-search="${escapeHtml(`${n.maNhaThau || ""} ${n.tenNhaThau || ""}`)}">${escapeHtml(n.tenNhaThau || "")}${escapeHtml(this.model.getPendingLabel("nhathau", n.id))}</option>`).join("") + '<option value="__NEW_CONTRACTOR__" style="color: var(--primary); font-weight: 700;">+ Thêm nhà thầu mới</option>';
      ntSelect.value = data.id;
      ntSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}
