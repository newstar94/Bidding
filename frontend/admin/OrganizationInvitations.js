import { apiFetch } from "../shared/apiClient.js";
import { describeApiError } from "../shared/apiErrorText.js";

// Pending organization invitations (ADR 0093). Managers see the email and
// display name they entered themselves; nothing about the invitee's account.

const STATUS_LABELS = Object.freeze({
  pending: "Đang chờ",
  expired: "Đã hết hạn",
  accepted: "Đã chấp nhận",
  declined: "Đã từ chối",
  revoked: "Đã thu hồi",
});
let lastLoaded = 0;
let inFlight = null;

function cell(text, className = "") {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function formatDate(epochSeconds) {
  if (!epochSeconds) return "";
  return new Date(epochSeconds * 1000).toLocaleDateString("vi-VN");
}

export async function renderOrganizationInvitations({ force = false, view = null } = {}) {
  const tbody = document.getElementById("manager-invitations-tbody");
  if (!tbody) return;
  if (!force && Date.now() - lastLoaded < 30_000) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await apiFetch("/api/organizations/invitations", { handleHttpErrors: false });
      const payload = await response.json().catch(() => ({}));
      const card = document.getElementById("manager-invitations-card");
      if (response.status === 403 || response.status === 409) {
        if (card) card.hidden = true;
        return;
      }
      if (card) card.hidden = false;
      tbody.replaceChildren();
      const rows = (payload.invitations || []).filter((item) => item.status === "pending" || item.status === "expired");
      if (!response.ok) {
        const row = document.createElement("tr");
        row.append(cell(describeApiError(payload, "Không thể tải danh sách lời mời."), "text-muted"));
        row.firstChild.colSpan = 5;
        tbody.append(row);
        return;
      }
      if (!rows.length) {
        const row = document.createElement("tr");
        const empty = cell("Không có lời mời đang chờ.", "text-center text-muted");
        empty.colSpan = 5;
        row.append(empty);
        tbody.append(row);
      }
      for (const item of rows) {
        const row = document.createElement("tr");
        row.append(
          cell(item.employeeName, "fw-bold"),
          cell(item.email),
          cell(STATUS_LABELS[item.status] || item.status),
          cell(formatDate(item.expiresAt)),
        );
        const actions = document.createElement("td");
        if (item.status === "pending") {
          const revoke = document.createElement("button");
          revoke.type = "button";
          revoke.className = "btn btn-outline";
          revoke.textContent = "Thu hồi";
          revoke.setAttribute("aria-label", `Thu hồi lời mời gửi ${item.email}`);
          revoke.addEventListener("click", async () => {
            revoke.disabled = true;
            const result = await apiFetch(`/api/organizations/invitations/${encodeURIComponent(item.id)}`, {
              method: "DELETE",
              handleHttpErrors: false,
            });
            if (!result.ok) {
              const data = await result.json().catch(() => ({}));
              view?.showToast?.("Không thể thu hồi", describeApiError(data, "Không thể thu hồi lời mời."), "error");
              revoke.disabled = false;
              return;
            }
            view?.showToast?.("Đã thu hồi lời mời", item.email, "success");
            await renderOrganizationInvitations({ force: true, view });
          });
          actions.append(revoke);
        }
        row.append(actions);
        tbody.append(row);
      }
      lastLoaded = Date.now();
    } catch (error) {
      console.warn("Organization invitations could not be loaded:", error);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
