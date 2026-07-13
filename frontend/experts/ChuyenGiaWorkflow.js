import { safeImageSrc } from "../shared/view_helpers.js";
import { collectFormValues, resetFormState, setFormValues } from "../shared/FormBinder.js";
import { persistAndSync } from "../shared/MutationService.js";
import {
  createInitialVersion,
  createNextVersion,
  getNextVersion,
  rememberSelectedVersion
} from "../shared/VersionedEntityService.js";

const CHUYEN_GIA_FORM_FIELDS = {
  hoTen: "cg-hoten",
  soCCCD: "cg-socccd",
  noiCapCCCD: "cg-noicapcccd",
  ngayCapCCCD: "cg-ngaycapcccd",
  soChungChi: "cg-sochungchi",
  donViCapChungChi: "cg-donvicapchungchi",
  ngayCapChungChi: "cg-ngaycapchungchi"
};

const safeExpertImageSrc = (value) => {
  const src = String(value || "").trim();
  if (/^\/images\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/.test(src)) return src;
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
    await persistAndSync(this, "chuyengia", {
      afterPersist: () => this.view.renderChuyenGiaTable()
    });
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
    setFormValues(document, {
      ...cg,
      ngayCapCCCD: this.model.formatForDateInput(cg.ngayCapCCCD),
      ngayCapChungChi: this.model.formatForDateInput(cg.ngayCapChungChi)
    }, CHUYEN_GIA_FORM_FIELDS);
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
    resetFormState(form);
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
  const formValues = collectFormValues(document, CHUYEN_GIA_FORM_FIELDS);
  const cccdVal = formValues.soCCCD.trim();
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
  const soChungChiVal = formValues.soChungChi.trim();
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
  const ngayCapCCCDYMD = this.model.convertDMYToYMD(formValues.ngayCapCCCD);
  const ngayCapChungChiYMD = this.model.convertDMYToYMD(formValues.ngayCapChungChi);
  const certExt = this.model.getFileExtensionFromBase64(this.tempChuyenGiaImageBase64);
  const sigExt = this.model.getFileExtensionFromBase64(this.tempChuyenGiaSignatureBase64);
  let data = {
    hoTen: formValues.hoTen.trim(),
    soCCCD: cccdVal,
    ngayCapCCCD: ngayCapCCCDYMD,
    noiCapCCCD: formValues.noiCapCCCD.trim(),
    soChungChi: soChungChiVal,
    ngayCapChungChi: ngayCapChungChiYMD,
    donViCapChungChi: formValues.donViCapChungChi.trim(),
    anhChungChi: this.tempChuyenGiaImageBase64,
    tenAnhChungChi: this.tempChuyenGiaImageBase64 ? `CC_${cccdVal}.${certExt}` : "",
    anhChuKy: this.tempChuyenGiaSignatureBase64,
    tenAnhChuKy: this.tempChuyenGiaSignatureBase64 ? `CK_${cccdVal}.${sigExt}` : ""
  };
  if (id) {
    const currentCg = this.model.state.chuyengia.find((c) => c.id === id);
    const nextVersion = getNextVersion(this.model.state.chuyengia, currentCg);
    const isNewVersion = await this.view.customConfirm(
      "Lưu Chuyên gia",
      `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${Number(nextVersion)}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentCg.phienBan || 0)})`,
      "save"
    );
    if (isNewVersion) {
      const timestamp = this.model.getCurrentDateTimeString();
      data = createNextVersion(this.model.state.chuyengia, currentCg, data, {
        id: generateRecordId("chuyengia"),
        timestamp
      });
      data.createdAt = currentCg.createdAt || timestamp;
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
    const newId = generateRecordId("chuyengia");
    data = createInitialVersion(data, {
      id: newId,
      timestamp: this.model.getCurrentDateTimeString()
    });
    this.model.state.chuyengia.push(data);
  }
  rememberSelectedVersion(this.model.state, "selectedChuyenGiaVersion", data);
  this.view.closeModal("modal-chuyengia");
  await persistAndSync(this, "chuyengia", {
    afterPersist: () => this.view.renderChuyenGiaTable()
  });
}
import { generateRecordId } from "../shared/idUtils.js";
