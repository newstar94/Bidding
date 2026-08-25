import { getJson, postJson } from "../shared/apiClient.js";
import {
  activateDialogAccessibility,
  deactivateDialogAccessibility,
} from "../shared/dialogAccessibility.js";

const STATUS_LABELS = Object.freeze({
  RESOLVED: "Đã xác định",
  AMBIGUOUS: "Có nhiều hồ sơ phù hợp",
  UNRESOLVED: "Chưa xác định",
  MANUAL_REVIEW_REQUIRED: "Cần rà soát thủ công",
});

export function isLegalVersioningEnabled(root = globalThis.document) {
  return root?.querySelector?.('meta[name="bf-legal-versioning-enabled"]')?.content === "true";
}

function element(tag, className = "", value = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== "") node.textContent = String(value);
  return node;
}

function loadStyles(root) {
  if (root.querySelector('link[data-legal-binding-styles="true"]')) return;
  const link = root.createElement("link");
  link.rel = "stylesheet";
  link.href = "/frontend/legal-versioning/LegalBindingPanel.css";
  link.dataset.legalBindingStyles = "true";
  root.head.appendChild(link);
}

function definition(label, value) {
  return [element("dt", "", label), element("dd", "", value || "—")];
}

function safeSourceUri(value) {
  try {
    const parsed = new URL(String(value || ""), globalThis.location?.origin);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

export function renderLegalBinding(summary, binding) {
  summary.replaceChildren();
  const status = element(
    "span", "legal-binding-status",
    STATUS_LABELS[binding.status] || binding.status || "Chưa xác định",
  );
  status.dataset.status = binding.status || "UNRESOLVED";
  const values = element("dl");
  values.append(
    ...definition("Lý do", binding.reason),
    ...definition("Ngày neo", binding.anchorDate),
    ...definition("Nguồn ngày neo", binding.anchorSource),
    ...definition("Phiên bản profile", binding.profileVersionId),
    ...definition("Binding revision", binding.bindingRevision),
    ...definition("Target rowVersion", binding.targetRowVersion),
  );
  summary.append(status, values);
}

function renderSources(root, payload) {
  root.replaceChildren();
  (payload.sources || []).forEach((source) => {
    const article = element("article", "legal-binding-source");
    article.append(
      element("h3", "", `${source.documentType} ${source.documentNumber}`),
      element("p", "", source.title),
      element("p", "", `Hiệu lực: ${source.effectiveFrom}${source.effectiveTo ? ` – ${source.effectiveTo}` : " trở đi"}`),
      element("code", "", `SHA-256: ${source.contentSha256}`),
    );
    const sourceUri = safeSourceUri(source.sourceUri);
    if (sourceUri) {
      const link = element("a", "", "Mở nguồn chính thức");
      link.href = sourceUri;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      article.appendChild(link);
    } else {
      article.appendChild(element("p", "", "Nguồn liên kết không hợp lệ"));
    }
    root.appendChild(article);
  });
}

export function openLegalBindingPanel({
  targetType, targetId, targetRowVersion, canResolve = false,
  trigger = null, root = document, read = getJson, write = postJson,
} = {}) {
  if (!root?.body || !targetId) return () => {};
  loadStyles(root);
  root.getElementById("legal-binding-modal")?.remove();
  const modal = element("div", "modal-overlay active legal-binding-modal");
  modal.id = "legal-binding-modal";
  const card = element("div", "modal-card legal-binding-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "legal-binding-title");
  const header = element("header", "legal-binding-header");
  const copy = element("div");
  copy.append(
    element("p", "legal-binding-eyebrow", "PHIÊN BẢN PHÁP LÝ"),
    element("h2", "", "Ràng buộc pháp lý lịch sử"),
  );
  copy.querySelector("h2").id = "legal-binding-title";
  const close = element("button", "btn btn-outline", "Đóng");
  close.type = "button";
  close.setAttribute("data-close", "");
  header.append(copy, close);
  const live = element("p", "legal-binding-live", "Đang tải binding…");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  const summary = element("section", "legal-binding-summary");
  const actions = element("div", "legal-binding-actions");
  const sourcesButton = element("button", "btn btn-outline", "Xem nguồn chính xác");
  sourcesButton.type = "button";
  sourcesButton.hidden = true;
  const resolveButton = element("button", "btn btn-primary", "Resolve và ghi binding");
  resolveButton.type = "button";
  resolveButton.hidden = !canResolve;
  const assistantButton = element("button", "btn btn-outline", "Hỏi trợ lý về tuân thủ");
  assistantButton.type = "button";
  assistantButton.addEventListener("click", () => {
    globalThis.dispatchEvent(new CustomEvent("bf:assistant-target", { detail: {
      targetType: targetType === "package" ? "goithau" : "kehoach",
      targetId,
      versionId: targetId,
    }}));
  });
  actions.append(sourcesButton, resolveButton, assistantButton);
  const sources = element("section", "legal-binding-sources");
  card.append(header, live, summary, actions, sources);
  modal.appendChild(card);
  root.body.appendChild(modal);
  activateDialogAccessibility(modal, trigger);
  let binding = null;
  let disposed = false;
  const endpoint = `/api/legal-versioning/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/binding`;
  const load = async () => {
    try {
      binding = await read(endpoint, { retries: 0 });
      if (disposed) return;
      renderLegalBinding(summary, binding);
      sourcesButton.hidden = !binding.profileVersionId;
      live.textContent = "Đã tải binding pháp lý hiện hành của phiên bản này.";
    } catch (error) {
      if (disposed) return;
      live.textContent = error?.message || "Không thể tải binding pháp lý.";
      live.setAttribute("role", "alert");
    }
  };
  sourcesButton.addEventListener("click", async () => {
    if (!binding?.profileVersionId) return;
    sourcesButton.disabled = true;
    live.textContent = "Đang kiểm tra hash và tải nguồn chính xác…";
    try {
      const payload = await read(
        `/api/legal-versioning/profiles/${encodeURIComponent(binding.profileVersionId)}/sources`,
        { retries: 0 },
      );
      if (!disposed) {
        renderSources(sources, payload);
        live.textContent = `Đã tải ${payload.sources?.length || 0} nguồn pháp lý.`;
      }
    } catch (error) {
      live.textContent = error?.message || "Không thể tải nguồn pháp lý.";
    } finally {
      sourcesButton.disabled = false;
    }
  });
  resolveButton.addEventListener("click", async () => {
    resolveButton.disabled = true;
    live.textContent = "Đang resolve theo facts của đúng phiên bản…";
    try {
      binding = await write(`${endpoint}/resolve`, {
        expectedBindingRevision: Number(binding?.bindingRevision || 0),
        expectedTargetRowVersion: Number(targetRowVersion || 1),
      });
      if (!disposed) {
        renderLegalBinding(summary, binding);
        sourcesButton.hidden = !binding.profileVersionId;
        live.textContent = "Đã ghi binding bất biến mới.";
      }
    } catch (error) {
      live.textContent = error?.status === 409
        ? "Facts hoặc binding đã thay đổi. Hãy đóng và tải lại phiên bản."
        : error?.message || "Không thể resolve binding.";
      live.setAttribute("role", "alert");
    } finally {
      resolveButton.disabled = false;
    }
  });
  const dispose = () => {
    disposed = true;
    deactivateDialogAccessibility(modal);
    modal.remove();
  };
  close.addEventListener("click", dispose);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) dispose();
  });
  load();
  return dispose;
}

export function bindLegalBindingAction(container, options = {}, root = document) {
  if (!container || !isLegalVersioningEnabled(root)) return () => {};
  const button = element("button", "btn btn-outline", "Pháp lý");
  button.type = "button";
  button.addEventListener("click", () => openLegalBindingPanel({
    ...options, trigger: button, root,
  }));
  container.appendChild(button);
  return () => button.remove();
}
