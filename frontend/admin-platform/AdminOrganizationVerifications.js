import { getAdminJson, postAdminJson, requiresPrivilegedReauthentication } from "./AdminApi.js";
import { requestAdminValue } from "./AdminBilling.js";
import { adminLoadingMarkup, renderAdminFailure, renderAdminMarkup } from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

// Review queue for organization tax-code verification (ADR 0094). Approving
// grants the badge and exclusive tax code; it never changes access.

const STATUS_LABELS = Object.freeze({
  pending: "Đang chờ",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  cancelled: "Đã hủy",
});

function formatDate(epochSeconds) {
  return epochSeconds ? new Date(epochSeconds * 1000).toLocaleString("vi-VN") : "";
}

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function requestRow(item, pending) {
  const holder = item.verifiedHolder
    ? `<div class="text-warning small">Mã số thuế đang thuộc tổ chức đã xác minh “${escapeHtml(item.verifiedHolder.name)}”.</div>`
    : "";
  const actions = pending
    ? `<div class="btn-list">
        <button type="button" class="btn btn-sm btn-primary" data-verification-approve="${escapeHtml(item.id)}">Duyệt</button>
        <button type="button" class="btn btn-sm btn-outline-danger" data-verification-reject="${escapeHtml(item.id)}">Từ chối</button>
      </div>`
    : `<span class="badge">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>${item.reviewNote ? `<div class="text-secondary small">${escapeHtml(item.reviewNote)}</div>` : ""}`;
  return `<tr>
    <td><div class="fw-bold">${escapeHtml(item.organizationName)}</div>
      <div class="text-secondary small">MST ${escapeHtml(item.taxCode)}</div>${holder}</td>
    <td>${escapeHtml(item.requesterName)}<div class="text-secondary small">${escapeHtml(item.requesterEmail)}</div></td>
    <td><a href="/api/admin/organization-verifications/${encodeURIComponent(item.id)}/document" target="_blank" rel="noopener">${escapeHtml(item.originalFilename)}</a>
      <div class="text-secondary small">${escapeHtml(formatSize(item.sizeBytes))}</div>
      ${item.note ? `<div class="small">${escapeHtml(item.note)}</div>` : ""}</td>
    <td class="text-nowrap">${escapeHtml(formatDate(pending ? item.createdAt : item.reviewedAt || item.createdAt))}</td>
    <td>${actions}</td>
  </tr>`;
}

function pageMarkup(state) {
  const pending = state.status === "pending";
  const rows = state.requests.length
    ? state.requests.map((item) => requestRow(item, pending)).join("")
    : `<tr><td colspan="5" class="text-center text-secondary">${pending ? "Không có hồ sơ chờ duyệt." : "Chưa có hồ sơ đã xử lý."}</td></tr>`;
  return `<div class="mb-3 d-flex flex-wrap align-items-center justify-content-between gap-2">
      <p class="text-secondary mb-0">Duyệt hồ sơ để cấp huy hiệu “Đã xác minh” và quyền giữ riêng mã số thuế. Việc duyệt không thay đổi quyền truy cập hay gói dịch vụ.</p>
      <div class="btn-group" role="group" aria-label="Lọc hồ sơ">
        <button type="button" class="btn ${pending ? "btn-primary" : "btn-outline-primary"}" data-verification-filter="pending" aria-pressed="${pending}">Chờ duyệt</button>
        <button type="button" class="btn ${pending ? "btn-outline-primary" : "btn-primary"}" data-verification-filter="reviewed" aria-pressed="${!pending}">Đã xử lý</button>
      </div>
    </div>
    <p class="text-secondary small" data-verification-status role="status" aria-live="polite">${escapeHtml(state.message || "")}</p>
    <div class="card"><div class="table-responsive"><table class="table table-vcenter card-table">
      <caption class="visually-hidden">Hồ sơ xác minh mã số thuế</caption>
      <thead><tr><th scope="col">Tổ chức</th><th scope="col">Người gửi</th><th scope="col">Giấy tờ</th><th scope="col">${pending ? "Gửi lúc" : "Xử lý lúc"}</th><th scope="col">Thao tác</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
}

export async function reviewVerification(requestId, decision, body, { fetchImpl, signal, requestPassword }) {
  const path = `/api/admin/organization-verifications/${encodeURIComponent(requestId)}/${decision}`;
  const mutate = () => postAdminJson(path, { body, fetchImpl, signal });
  try {
    return await mutate();
  } catch (error) {
    if (!requiresPrivilegedReauthentication(error)) throw error;
    const password = await requestPassword();
    if (password === null) return null;
    await postAdminJson("/api/auth/privileged-reauth", { body: { password }, fetchImpl, signal });
    return mutate();
  }
}

export async function renderAdminOrganizationVerifications(container, { fetchImpl, signal } = {}) {
  const state = { status: "pending", requests: [], message: "" };
  const load = async () => {
    renderAdminMarkup(container, adminLoadingMarkup(), { busy: true });
    try {
      const payload = await getAdminJson("/api/admin/organization-verifications", { query: { status: state.status }, fetchImpl, signal });
      state.requests = Array.isArray(payload.requests) ? payload.requests : [];
      renderAdminMarkup(container, pageMarkup(state));
    } catch (error) {
      if (signal?.aborted) return;
      renderAdminFailure(container, error, load);
    }
  };
  const requestPassword = () => requestAdminValue({
    title: "Xác thực thao tác quản trị",
    message: "Nhập lại mật khẩu để xử lý hồ sơ xác minh.",
    label: "Mật khẩu hiện tại",
    type: "password",
  });
  const run = async (requestId, decision, body) => {
    try {
      const result = await reviewVerification(requestId, decision, body, { fetchImpl, signal, requestPassword });
      if (result === null) { state.message = "Đã hủy thao tác."; renderAdminMarkup(container, pageMarkup(state)); return; }
      state.message = decision === "approve" ? "Đã duyệt hồ sơ." : "Đã từ chối hồ sơ.";
      await load();
    } catch (error) {
      if (decision === "approve" && error?.code === "TAX_CODE_VERIFIED_ELSEWHERE") {
        const holder = error?.details?.holder?.name || "tổ chức khác";
        if (window.confirm(`Mã số thuế đang thuộc “${holder}”. Chuyển quyền giữ mã số thuế sang tổ chức này? Tổ chức “${holder}” sẽ trở về trạng thái chưa xác minh.`)) {
          await run(requestId, decision, { ...body, replaceExisting: true });
        }
        return;
      }
      state.message = error?.message || "Không thể xử lý hồ sơ.";
      renderAdminMarkup(container, pageMarkup(state));
    }
  };
  container.addEventListener("click", async (event) => {
    const filter = event.target.closest("[data-verification-filter]");
    if (filter) {
      state.status = filter.dataset.verificationFilter;
      state.message = "";
      await load();
      return;
    }
    const approve = event.target.closest("[data-verification-approve]");
    if (approve) {
      approve.disabled = true;
      await run(approve.dataset.verificationApprove, "approve", {});
      return;
    }
    const reject = event.target.closest("[data-verification-reject]");
    if (reject) {
      const note = await requestAdminValue({
        title: "Từ chối hồ sơ xác minh",
        message: "Lý do sẽ hiển thị cho quản lý tổ chức.",
        label: "Lý do từ chối",
        confirmLabel: "Từ chối",
        validateValue: (value) => (String(value || "").trim() ? "" : "Vui lòng nhập lý do."),
      });
      if (note === null) return;
      await run(reject.dataset.verificationReject, "reject", { note: String(note).trim() });
    }
  });
  await load();
}
