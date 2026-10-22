import { apiFetch } from "../shared/apiClient.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { trustedHTML } from "../shared/trustedTypes.js";

// Show the generated Word document(s) before downloading. Resolves true when
// the user chooses to download, false when they close the preview.

const STYLESHEET_URL = new URL("./WordPreviewDialog.css?no-inline", import.meta.url).pathname;

export function previewUrlFor(downloadUrl) {
  const value = String(downloadUrl || "");
  return /^\/api\/document-jobs\/[^/?#]+\/download$/u.test(value)
    ? value.replace(/\/download$/u, "/preview")
    : "";
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function fetchPreview(previewUrl) {
  const response = await apiFetch(previewUrl, { handleHttpErrors: false, timeoutMs: 60_000 });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    throw new Error(payload?.error || "Không thể tạo bản xem trước cho tài liệu này.");
  }
  return Array.isArray(payload?.documents) ? payload.documents : [];
}

export async function confirmWordPreview({ downloadUrl, filename }) {
  const previewUrl = previewUrlFor(downloadUrl);
  if (!previewUrl || typeof globalThis.document?.createElement !== "function") return true;
  await loadStyleOnce(STYLESHEET_URL).catch(() => {});
  const dialog = node("dialog", "bf-word-preview");
  dialog.setAttribute("aria-labelledby", "bf-word-preview-title");
  const header = node("div", "bf-word-preview-header");
  const title = node("h2", "", "Xem trước tài liệu");
  title.id = "bf-word-preview-title";
  const subtitle = node("p", "bf-word-preview-subtitle", filename || "");
  const heading = node("div");
  heading.append(title, subtitle);
  const actions = node("div", "bf-word-preview-actions");
  const close = node("button", "btn btn-outline", "Đóng");
  close.type = "button";
  const download = node("button", "btn btn-primary", "Tải xuống");
  download.type = "button";
  actions.append(close, download);
  header.append(heading, actions);
  const tabs = node("div", "bf-word-preview-tabs");
  tabs.setAttribute("role", "tablist");
  const page = node("article", "bf-word-preview-page");
  page.setAttribute("aria-live", "polite");
  page.textContent = "Đang tạo bản xem trước…";
  const note = node("p", "bf-word-preview-note", "Bản xem trước hiển thị nội dung và bảng biểu; định dạng trang, phông chữ và hình ảnh chính xác có trong file tải về.");
  dialog.append(header, tabs, page, note);
  document.body.append(dialog);

  const result = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    close.addEventListener("click", () => finish(false));
    download.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
  });
  dialog.showModal();
  download.focus();

  try {
    const documents = await fetchPreview(previewUrl);
    const show = (index) => {
      page.innerHTML = trustedHTML(documents[index]?.html || "<p>Tài liệu không có nội dung văn bản.</p>");
      [...tabs.children].forEach((tab, tabIndex) => tab.setAttribute("aria-selected", String(tabIndex === index)));
      page.scrollTop = 0;
    };
    if (documents.length > 1) {
      documents.forEach((item, index) => {
        const tab = node("button", "bf-word-preview-tab", item.filename || `Tài liệu ${index + 1}`);
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.addEventListener("click", () => show(index));
        tabs.append(tab);
      });
    } else {
      tabs.hidden = true;
    }
    if (documents.length) show(0);
    else page.textContent = "Không có nội dung để xem trước.";
  } catch (error) {
    page.textContent = `${error.message} Bạn vẫn có thể tải tài liệu xuống.`;
    tabs.hidden = true;
  }
  return result;
}
