import { apiFetch } from "../shared/apiClient.js";
import { describeApiError } from "../shared/apiErrorText.js";

// Tax-code verification for the active organization (ADR 0094). Verification
// only grants the "verified" badge and exclusive use of the tax code.

const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
const MAX_BYTES = 10 * 1024 * 1024;
let inFlight = null;

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatDate(epochSeconds) {
  return epochSeconds ? new Date(epochSeconds * 1000).toLocaleDateString("vi-VN") : "";
}

export function verificationSummary(state) {
  if (state.status === "verified") {
    return {
      tone: "success",
      title: "Đã xác minh",
      detail: !state.taxCode
        ? "Tổ chức được ghi nhận từ trước khi có bước xác minh mã số thuế."
        : state.method === "legacy"
        ? `Mã số thuế ${state.taxCode} đã được ghi nhận cho tổ chức này.`
        : `Mã số thuế ${state.taxCode} đã được xác minh${state.verifiedAt ? ` ngày ${formatDate(state.verifiedAt)}` : ""}.`,
      canSubmit: false,
    };
  }
  const request = state.request;
  if (request?.status === "pending") {
    return {
      tone: "info",
      title: "Đang chờ duyệt",
      detail: `Đã gửi “${request.originalFilename}” ngày ${formatDate(request.createdAt)}. Tổ chức vẫn hoạt động bình thường trong lúc chờ.`,
      canSubmit: false,
      canCancel: true,
    };
  }
  const rejected = request?.status === "rejected"
    ? ` Hồ sơ trước bị từ chối${request.reviewNote ? `: ${request.reviewNote}` : "."}`
    : "";
  const claimed = state.claimedByVerifiedOrganization
    ? " Mã số thuế này đang được một tổ chức khác giữ; nếu bạn là đại diện hợp pháp, hồ sơ của bạn sẽ được xem xét để chuyển quyền."
    : "";
  return {
    tone: state.claimedByVerifiedOrganization || rejected ? "warning" : "muted",
    title: "Chưa xác minh",
    detail: `Gửi giấy chứng nhận đăng ký doanh nghiệp hoặc quyết định thành lập để nhận huy hiệu “Đã xác minh” và giữ riêng mã số thuế ${state.taxCode}.${rejected}${claimed}`,
    canSubmit: Boolean(state.taxCode),
  };
}

function uploadForm(onSubmit) {
  const form = element("form", "bf-verification-form");
  form.noValidate = true;
  const fileLabel = element("label", "", "Giấy tờ (PDF, JPG hoặc PNG, tối đa 10 MB)");
  const file = element("input", "form-control");
  file.type = "file";
  file.name = "file";
  file.accept = ACCEPT;
  file.required = true;
  file.id = "manager-verification-file";
  fileLabel.htmlFor = file.id;
  const noteLabel = element("label", "", "Ghi chú cho quản trị viên (không bắt buộc)");
  const note = element("textarea", "form-control");
  note.name = "note";
  note.maxLength = 1000;
  note.rows = 2;
  note.id = "manager-verification-note";
  noteLabel.htmlFor = note.id;
  const submit = element("button", "btn btn-primary", "Gửi hồ sơ xác minh");
  submit.type = "submit";
  form.append(fileLabel, file, noteLabel, note, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = file.files?.[0];
    if (!selected) { file.focus(); return; }
    if (selected.size > MAX_BYTES) {
      onSubmit(null, "Tệp vượt quá giới hạn 10 MB.");
      return;
    }
    const body = new FormData();
    body.append("file", selected);
    body.append("note", note.value.trim());
    submit.disabled = true;
    onSubmit(body).finally(() => { submit.disabled = false; });
  });
  return form;
}

export async function renderOrganizationVerification({ view = null } = {}) {
  const card = document.getElementById("manager-verification-card");
  const body = document.getElementById("manager-verification-body");
  if (!card || !body) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await apiFetch("/api/organizations/verification", { handleHttpErrors: false });
      const state = await response.json().catch(() => ({}));
      if (!response.ok) {
        card.hidden = true;
        return;
      }
      const summary = verificationSummary(state);
      card.hidden = false;
      body.replaceChildren();
      const status = element("p", `bf-verification-status bf-verification-${summary.tone}`);
      status.append(element("strong", "", summary.title), document.createTextNode(` — ${summary.detail}`));
      body.append(status);
      const feedback = element("p", "text-muted small");
      feedback.setAttribute("role", "status");
      const refresh = () => { inFlight = null; return renderOrganizationVerification({ view }); };
      if (summary.canSubmit) {
        body.append(uploadForm(async (formData, localError) => {
          if (!formData) { feedback.textContent = localError; return; }
          feedback.textContent = "Đang gửi…";
          const result = await apiFetch("/api/organizations/verification", {
            method: "POST", body: formData, handleHttpErrors: false,
          });
          const payload = await result.json().catch(() => ({}));
          if (!result.ok) {
            feedback.textContent = describeApiError(payload, "Không thể gửi hồ sơ xác minh.");
            return;
          }
          view?.showToast?.("Đã gửi hồ sơ xác minh", payload.message || "", "success");
          await refresh();
        }), feedback);
      }
      if (summary.canCancel) {
        const cancel = element("button", "btn btn-outline", "Hủy hồ sơ đang chờ");
        cancel.type = "button";
        cancel.addEventListener("click", async () => {
          cancel.disabled = true;
          const result = await apiFetch("/api/organizations/verification", { method: "DELETE", handleHttpErrors: false });
          const payload = await result.json().catch(() => ({}));
          if (!result.ok) {
            feedback.textContent = describeApiError(payload, "Không thể hủy hồ sơ.");
            cancel.disabled = false;
            return;
          }
          await refresh();
        });
        body.append(cancel, feedback);
      }
    } catch (error) {
      console.warn("Organization verification could not be loaded:", error);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
