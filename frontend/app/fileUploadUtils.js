import { setRuntimeStyle } from "../shared/runtimeStyles.js";
export function bindImageUploadPreview(config) {
  const {
    uploadZone,
    fileInput,
    previewContainer,
    previewImg,
    removeBtn,
    onLoad,
    onRemove,
    alertInvalid,
    alertTooLarge
  } = config;
  if (!uploadZone || !fileInput || !previewContainer || !previewImg) return;
  if (fileInput.__bfImageUploadBound) return;
  fileInput.__bfImageUploadBound = true;
  const handleFile = (file) => {
    if (!file) return;
    if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
      alertInvalid?.();
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      alertTooLarge?.();
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      onLoad?.(dataUrl);
      previewImg.src = dataUrl;
      setRuntimeStyle(previewContainer, "display", "flex");
      setRuntimeStyle(uploadZone, "display", "none");
    };
    reader.readAsDataURL(file);
  };
  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadZone.classList.add("dragover");
  });
  uploadZone.addEventListener("dragleave", () => {
    uploadZone.classList.remove("dragover");
  });
  uploadZone.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadZone.classList.remove("dragover");
    if (event.dataTransfer.files.length > 0) {
      handleFile(event.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener("change", (event) => {
    if (event.target.files.length > 0) {
      handleFile(event.target.files[0]);
    }
  });
  if (removeBtn) {
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      onRemove?.();
      fileInput.value = "";
      previewImg.src = "";
      setRuntimeStyle(previewContainer, "display", "none");
      setRuntimeStyle(uploadZone, "display", "flex");
    });
  }
}
