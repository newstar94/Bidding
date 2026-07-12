import { safeImageSrc } from "../../views/subviews/view_helpers.js";
import { rememberSelectedVersion } from "../domain/VersionedEntityService.js";

const safeExpertImageSrc = (value) => {
  const src = String(value || "").trim();
  if (/^\/uploads\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/.test(src)) return src;
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return src;
  return "";
};
export async function deleteChuyenGia(id) {
  if (this.model.state.activerole === "employee") {
    await this.view.customAlert("Từ chối truy cập", "Tài khoản Chuyên viên không được phép xóa Chuyên gia khỏi hệ thống!", "lock");
    return;
  }
  const assignedPackages = this.model.state.goithau.filter((gt) => {
    const inChuyenGia = (gt.toChuyenGia || []).some((item) => item.chuyenGiaId === id);
    const inThamDinh = (gt.toThamDinh || []).some((item) => item.chuyenGiaId === id);
    return inChuyenGia || inThamDinh;
  });
  if (assignedPackages.length > 0) {
    const details = assignedPackages.map((gt) => {
      const roles = [];
      if ((gt.toChuyenGia || []).some((item) => item.chuyenGiaId === id)) roles.push("Tổ chuyên gia");
      if ((gt.toThamDinh || []).some((item) => item.chuyenGiaId === id)) roles.push("Tổ thẩm định");
      return `${gt.maGoiThau || gt.tenGoiThau} (${roles.join(", ")})`;
    }).join("; ");
    await this.view.customAlert(
      "Không thể xóa",
      `Không thể xóa chuyên gia này vì họ đang tham gia: ${details}`,
      "x-circle"
    );
    return;
  }
  const confirmed = await this.view.customConfirm(
    "Xác nhận xóa",
    "Bạn có chắc muốn xóa chuyên gia đấu thầu này khỏi hệ thống?",
    "trash-2"
  );
  if (confirmed) {
    this.model.state.chuyengia = this.model.state.chuyengia.filter((cg) => cg.id !== id);
    this.model.markDeleted("chuyengia", id);
    await this.model.persistData("chuyengia");
    await this.autoSync();
  }
}
export function editChuyenGia(id) {
  if (this.model.state.activerole === "employee") {
    this.view.customAlert("Từ chối truy cập", "Tài khoản Chuyên viên không được phép thêm hoặc chỉnh sửa thông tin Chuyên gia!", "lock");
    return;
  }
  if (!document.getElementById("modal-chuyengia")) {
    this.ensureLazyModal?.("modal-chuyengia").then(() => this.editChuyenGia(id));
    return;
  }
  const form = document.getElementById("form-chuyengia");
  form.querySelectorAll(".form-group").forEach((fg) => fg.classList.remove("invalid"));
  const uploadZone = document.getElementById("cg-upload-zone");
  const previewContainer = document.getElementById("cg-preview-container");
  const previewImg = document.getElementById("cg-anh-preview");
  const uploadZoneChuky = document.getElementById("cg-upload-zone-chuky");
  const previewContainerChuky = document.getElementById("cg-preview-container-chuky");
  const previewImgChuky = document.getElementById("cg-anh-preview-chuky");
  previewImg.onerror = () => {
    previewContainer.style.display = "none";
    uploadZone.style.display = "flex";
  };
  previewImgChuky.onerror = () => {
    previewContainerChuky.style.display = "none";
    uploadZoneChuky.style.display = "flex";
  };
  if (id) {
    this.switchTab("chuyengia", "chinhsua", true);
    document.getElementById("modal-chuyengia-title").textContent = "Cập nhật Chuyên gia";
    const cg = this.model.state.chuyengia.find((c) => c.id === id);
    document.getElementById("form-chuyengia-id").value = cg.id;
    document.getElementById("cg-hoten").value = cg.hoTen;
    document.getElementById("cg-socccd").value = cg.soCCCD || "";
    document.getElementById("cg-noicapcccd").value = cg.noiCapCCCD || "";
    document.getElementById("cg-ngaycapcccd").value = this.model.formatForDateInput(cg.ngayCapCCCD);
    document.getElementById("cg-sochungchi").value = cg.soChungChi;
    document.getElementById("cg-donvicapchungchi").value = cg.donViCapChungChi || "";
    document.getElementById("cg-ngaycapchungchi").value = this.model.formatForDateInput(cg.ngayCapChungChi);
    const certificateImageSrc = safeExpertImageSrc(cg.anhChungChi);
    if (certificateImageSrc) {
      this.tempChuyenGiaImageBase64 = certificateImageSrc;
      previewImg.src = safeImageSrc(certificateImageSrc, cg.updatedAt || cg.createdAt);
      previewContainer.style.display = "flex";
      uploadZone.style.display = "none";
    } else {
      this.tempChuyenGiaImageBase64 = "";
      previewImg.src = "";
      previewContainer.style.display = "none";
      uploadZone.style.display = "flex";
    }
    const signatureImageSrc = safeExpertImageSrc(cg.anhChuKy);
    if (signatureImageSrc) {
      this.tempChuyenGiaSignatureBase64 = signatureImageSrc;
      previewImgChuky.src = safeImageSrc(signatureImageSrc, cg.updatedAt || cg.createdAt);
      previewContainerChuky.style.display = "flex";
      uploadZoneChuky.style.display = "none";
    } else {
      this.tempChuyenGiaSignatureBase64 = "";
      previewImgChuky.src = "";
      previewContainerChuky.style.display = "none";
      uploadZoneChuky.style.display = "flex";
    }
  } else {
    this.switchTab("chuyengia", "taomoi", true);
    document.getElementById("modal-chuyengia-title").textContent = "Thêm Chuyên gia mới";
    form.reset();
    document.getElementById("form-chuyengia-id").value = "";
    document.getElementById("cg-ngaycapcccd").value = "";
    document.getElementById("cg-ngaycapchungchi").value = "";
    this.tempChuyenGiaImageBase64 = "";
    previewImg.src = "";
    previewContainer.style.display = "none";
    uploadZone.style.display = "flex";
    this.tempChuyenGiaSignatureBase64 = "";
    previewImgChuky.src = "";
    previewContainerChuky.style.display = "none";
    uploadZoneChuky.style.display = "flex";
  }
  this.view.openModal("modal-chuyengia");
}
export async function handleChuyenGiaSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-chuyengia");
  const cccdVal = document.getElementById("cg-socccd").value.trim();
  if (cccdVal !== "" && !/^\d{12}$/.test(cccdVal)) {
    const inputEl = document.getElementById("cg-socccd");
    const formGroup = inputEl.closest(".form-group");
    if (formGroup) {
      formGroup.classList.add("invalid");
      const errText = formGroup.querySelector(".error-text");
      if (errText) {
        const originalErr = errText.textContent;
        errText.textContent = "Số Căn cước công dân phải gồm đúng 12 chữ số.";
        inputEl.addEventListener("input", () => {
          formGroup.classList.remove("invalid");
          errText.textContent = originalErr;
        }, { once: true });
      }
    }
    inputEl.focus();
    return;
  }
  if (!this.view.validateForm(form)) return;
  const id = document.getElementById("form-chuyengia-id").value;
  const soChungChiVal = document.getElementById("cg-sochungchi").value.trim();
  if (cccdVal) {
    const dupCCCD = this.model.state.chuyengia.some(
      (cg) => cg.id !== id && cg.soCCCD && cg.soCCCD.trim() === cccdVal
    );
    if (dupCCCD) {
      const inputEl = document.getElementById("cg-socccd");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Số Căn cước công dân này đã được đăng ký cho một chuyên gia khác!";
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
  if (soChungChiVal) {
    const dupCC = this.model.state.chuyengia.some(
      (cg) => cg.id !== id && cg.soChungChi && cg.soChungChi.trim().toLowerCase() === soChungChiVal.toLowerCase()
    );
    if (dupCC) {
      const inputEl = document.getElementById("cg-sochungchi");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Số chứng chỉ hành nghề này đã được đăng ký cho một chuyên gia khác!";
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
  const ngayCapCCCDYMD = this.model.convertDMYToYMD(document.getElementById("cg-ngaycapcccd").value);
  const ngayCapChungChiYMD = this.model.convertDMYToYMD(document.getElementById("cg-ngaycapchungchi").value);
  const certExt = this.model.getFileExtensionFromBase64(this.tempChuyenGiaImageBase64);
  const sigExt = this.model.getFileExtensionFromBase64(this.tempChuyenGiaSignatureBase64);
  let data = {
    hoTen: document.getElementById("cg-hoten").value.trim(),
    soCCCD: cccdVal,
    ngayCapCCCD: ngayCapCCCDYMD,
    noiCapCCCD: document.getElementById("cg-noicapcccd").value.trim(),
    soChungChi: soChungChiVal,
    ngayCapChungChi: ngayCapChungChiYMD,
    donViCapChungChi: document.getElementById("cg-donvicapchungchi").value.trim(),
    anhChungChi: this.tempChuyenGiaImageBase64,
    tenAnhChungChi: this.tempChuyenGiaImageBase64 ? `CC_${cccdVal}.${certExt}` : "",
    anhChuKy: this.tempChuyenGiaSignatureBase64,
    tenAnhChuKy: this.tempChuyenGiaSignatureBase64 ? `CK_${cccdVal}.${sigExt}` : ""
  };
  if (id) {
    const currentCg = this.model.state.chuyengia.find((c) => c.id === id);
    const rootId = currentCg.rootId || currentCg.id;
    const versions = this.model.state.chuyengia.filter((c) => c.rootId === rootId || c.id === rootId);
    const maxVerNum = Math.max(...versions.map((v) => parseInt(v.phienBan || 0)));
    const nextVerStr = String(maxVerNum + 1).padStart(2, "0");
    const isNewVersion = await this.view.customConfirm(
      "Lưu Chuyên gia",
      `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${maxVerNum + 1}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentCg.phienBan || 0)})`,
      "save"
    );
    if (isNewVersion) {
      versions.forEach((c) => {
        c.isLatest = 0;
      });
      data.id = window.generateRecordId("chuyengia");
      data.rootId = rootId;
      data.phienBan = nextVerStr;
      data.isLatest = 1;
      data.createdAt = currentCg.createdAt || this.model.getCurrentDateTimeString();
      data.updatedAt = this.model.getCurrentDateTimeString();
      this.model.state.chuyengia.push(data);
    } else {
      data.id = id;
      data.rootId = currentCg.rootId || currentCg.id;
      data.phienBan = currentCg.phienBan || "00";
      data.isLatest = currentCg.isLatest !== void 0 ? currentCg.isLatest : 1;
      data.createdAt = currentCg.createdAt || this.model.getCurrentDateTimeString();
      data.updatedAt = this.model.getCurrentDateTimeString();
      const idx = this.model.state.chuyengia.findIndex((c) => c.id === id);
      this.model.state.chuyengia[idx] = data;
    }
  } else {
    const newId = window.generateRecordId("chuyengia");
    data.id = newId;
    data.rootId = newId;
    data.phienBan = "00";
    data.isLatest = 1;
    data.createdAt = this.model.getCurrentDateTimeString();
    data.updatedAt = this.model.getCurrentDateTimeString();
    this.model.state.chuyengia.push(data);
  }
  rememberSelectedVersion(this.model.state, "selectedChuyenGiaVersion", data);
  await this.model.persistData("chuyengia");
  this.view.closeModal("modal-chuyengia");
  this.view.renderChuyenGiaTable();
  await this.autoSync();
}
