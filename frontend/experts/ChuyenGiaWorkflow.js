import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { safeImageSrc } from "../shared/view_helpers.js";
import { collectFormValues, resetFormState, setFormValues } from "../shared/FormBinder.js";
import {
  persistAndSync,
  refreshRecordBeforeDelete,
  stageLocalRecords,
} from "../shared/MutationService.js";
import { canUploadWorkspaceAssets } from "../auth/accessContext.js";
import { isPlanBreakdownEditSessionActive } from "../plans/planBreakdownDraft.js";
import { markPlanVersionDraftRecordsDirty } from "../plans/PlanVersionDraftSession.js";
import { getVersionLabel } from "../shared/formatters.js";
import {
  createInitialVersion,
  createNextVersion,
  getNextVersion,
  getVersionFamily,
  preserveRowVersion,
  rememberSelectedVersion,
  removeAllVersions,
  removeLatestVersion,
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

export async function persistExpertFormChanges(controller, changedExperts, {
  draft = isPlanBreakdownEditSessionActive(controller),
} = {}) {
  if (draft) {
    await markPlanVersionDraftRecordsDirty(controller, "chuyengia", changedExperts);
    await controller.closeModal("modal-chuyengia");
    controller.view.renderChuyenGiaTable();
    return { ok: true, draft: true };
  }
  stageLocalRecords(controller.model, "chuyengia", changedExperts);
  return persistAndSync(controller, "chuyengia", {
    backgroundSync: true,
    changes: { upserts: { chuyengia: changedExperts } },
    afterLocalDurable: () => {
      const render = controller.view.renderChuyenGiaTable();
      const close = controller.closeModal("modal-chuyengia");
      controller.view.showToast?.("Đã lưu chuyên gia", "Thông tin chuyên gia đã được lưu.", "success");
      return Promise.all([render, close]);
    },
    afterCanonicalSync: async () => {
      await controller.view.renderChuyenGiaTable();
    },
  });
}

const safeExpertImageSrc = (value) => {
  return safeImageSrc(value);
};
export async function deleteChuyenGia(id) {
  if (this.model.state.activerole === "employee") {
    await this.view.customAlert("Từ chối truy cập", "Tài khoản Chuyên viên không được phép xóa Chuyên gia khỏi hệ thống!", "lock");
    return;
  }
  const target = await refreshRecordBeforeDelete(this, "chuyengia", id);
  if (!target) return;
  const family = getVersionFamily(this.model.state.chuyengia, target);
  const familyIds = new Set(family.map((item) => String(item.id)));
  const assignedPackages = this.model.state.goithau.filter((gt) => {
    // Deleted package families remain hydrated as archived history so their
    // audit relationships stay intact. Only live package history can block a
    // new expert deletion.
    if (gt.archivedAt) return false;
    const inChuyenGia = (gt.toChuyenGia || []).some((item) => familyIds.has(String(item.chuyenGiaId)));
    const inThamDinh = (gt.toThamDinh || []).some((item) => familyIds.has(String(item.chuyenGiaId)));
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
  const choice = family.length >= 2
    ? await this.view.customVersionDeleteChoice(
      "Xác nhận xóa",
      `Chuyên gia "${target.hoTen || "Chưa nhập tên"}" có ${family.length} phiên bản. Vui lòng chọn cách thức xóa:`,
      "Xóa phiên bản gần nhất",
      "Xóa toàn bộ",
    )
    : await this.view.customConfirm(
      "Xác nhận xóa",
      "Bạn có chắc muốn xóa chuyên gia đấu thầu này khỏi hệ thống?",
      "trash-2",
    ) ? 2 : null;
  if (choice === null) return;
  const result = choice === 1
    ? removeLatestVersion(this.model.state.chuyengia, target)
    : removeAllVersions(this.model.state.chuyengia, target);
  this.model.replaceTableState("chuyengia", result.records);
  this.model.markDeleted("chuyengia", result.removed);
  await persistAndSync(this, "chuyengia", {
    changes: { deletions: { chuyengia: result.removed } },
    afterPersist: () => this.view.renderChuyenGiaTable()
  });
}
export function editChuyenGia(id) {
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
  const canUploadAssets = canUploadWorkspaceAssets(
    this.model.state.activeuser || {},
    this.model.state.activerole,
  );
  previewImg.onerror = () => {
    setRuntimeStyle(previewContainer, "display", "none");
    setRuntimeStyle(uploadZone, "display", "flex");
  };
  previewImgChuky.onerror = () => {
    setRuntimeStyle(previewContainerChuky, "display", "none");
    setRuntimeStyle(uploadZoneChuky, "display", "flex");
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
      setRuntimeStyle(previewContainer, "display", "flex");
      setRuntimeStyle(uploadZone, "display", "none");
    } else {
      this.tempChuyenGiaImageBase64 = "";
      previewImg.src = "";
      setRuntimeStyle(previewContainer, "display", "none");
      setRuntimeStyle(uploadZone, "display", "flex");
    }
    const signatureImageSrc = safeExpertImageSrc(cg.anhChuKy);
    if (signatureImageSrc) {
      this.tempChuyenGiaSignatureBase64 = signatureImageSrc;
      previewImgChuky.src = safeImageSrc(signatureImageSrc, cg.updatedAt || cg.createdAt);
      setRuntimeStyle(previewContainerChuky, "display", "flex");
      setRuntimeStyle(uploadZoneChuky, "display", "none");
    } else {
      this.tempChuyenGiaSignatureBase64 = "";
      previewImgChuky.src = "";
      setRuntimeStyle(previewContainerChuky, "display", "none");
      setRuntimeStyle(uploadZoneChuky, "display", "flex");
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
    setRuntimeStyle(previewContainer, "display", "none");
    setRuntimeStyle(uploadZone, "display", "flex");
    this.tempChuyenGiaSignatureBase64 = "";
    previewImgChuky.src = "";
    setRuntimeStyle(previewContainerChuky, "display", "none");
    setRuntimeStyle(uploadZoneChuky, "display", "flex");
  }
  [
    {
      zone: uploadZone,
      input: document.getElementById("cg-anhchungchi"),
      remove: document.getElementById("btn-cg-remove-file"),
    },
    {
      zone: uploadZoneChuky,
      input: document.getElementById("cg-anhchuky"),
      remove: document.getElementById("btn-cg-remove-file-chuky"),
    },
  ].forEach(({ zone, input, remove }) => {
    if (input) input.disabled = !canUploadAssets;
    if (zone) {
      zone.classList.toggle("is-upload-disabled", !canUploadAssets);
      zone.setAttribute("aria-disabled", String(!canUploadAssets));
      zone.title = canUploadAssets
        ? "Tải lên hình ảnh"
        : "Chỉ Quản lý của tổ chức được tải lên hình ảnh này";
    }
    if (remove) setRuntimeStyle(remove, "display", canUploadAssets ? "" : "none");
  });
  this.view.openModal("modal-chuyengia");
}
export async function handleChuyenGiaSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-chuyengia");
  const formValues = collectFormValues(document, CHUYEN_GIA_FORM_FIELDS, "chuyengia");
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
  const canUploadAssets = canUploadWorkspaceAssets(
    this.model.state.activeuser || {},
    this.model.state.activerole,
  );
  if (
    !canUploadAssets
    && [this.tempChuyenGiaImageBase64, this.tempChuyenGiaSignatureBase64]
      .some((value) => String(value || "").startsWith("data:image"))
  ) {
    await this.view.customAlert(
      "Từ chối truy cập",
      "Chỉ Quản lý của tổ chức được tải lên ảnh chứng chỉ và ảnh chữ ký.",
      "lock",
    );
    return;
  }
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
      `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${getVersionLabel(nextVersion)}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${getVersionLabel(currentCg.phienBan)})`,
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
      preserveRowVersion(data, currentCg);
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
  const changedExperts = getVersionFamily(this.model.state.chuyengia, data);
  await persistExpertFormChanges(this, changedExperts);
}
import { generateRecordId } from "../shared/idUtils.js";
