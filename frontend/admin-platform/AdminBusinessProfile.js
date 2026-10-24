import { getAdminJson, postAdminJson, requiresPrivilegedReauthentication } from "./AdminApi.js";
import { requestAdminValue } from "./AdminBilling.js";
import { adminLoadingMarkup, renderAdminFailure, renderAdminMarkup } from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

// Public operator identity (ADR 0095) shown in the landing and legal footers.
// Every field is optional; an empty field is displayed as "Đang cập nhật".

const FIELD_HINTS = Object.freeze({
  legalName: "Ví dụ: Công ty TNHH ABC. Để trống sẽ hiển thị “Đơn vị vận hành BiddingFlow”.",
  taxCode: "10 chữ số, hoặc 10 chữ số kèm mã chi nhánh (0101234567-001).",
  businessRegistration: "Số giấy chứng nhận, ngày cấp và nơi cấp.",
  email: "Để trống sẽ dùng biddingflow@gmail.com.",
});
const FIELD_TYPES = Object.freeze({ email: "email", phone: "tel" });

export function businessProfileFormMarkup(state) {
  const fields = state.fields.map(({ key, label, maxLength }) => {
    const id = `business-profile-${key}`;
    const hint = FIELD_HINTS[key];
    const hintId = hint ? `${id}-hint` : "";
    const value = escapeHtml(state.profile[key] || "");
    const control = key === "address" || key === "businessRegistration"
      ? `<textarea class="form-control" id="${id}" name="${escapeHtml(key)}" rows="2" maxlength="${Number(maxLength)}"${hintId ? ` aria-describedby="${hintId}"` : ""}>${value}</textarea>`
      : `<input class="form-control" id="${id}" name="${escapeHtml(key)}" type="${FIELD_TYPES[key] || "text"}" maxlength="${Number(maxLength)}" value="${value}"${hintId ? ` aria-describedby="${hintId}"` : ""}>`;
    return `<div class="col-12 col-lg-6 mb-3">
      <label class="form-label" for="${id}">${escapeHtml(label)}</label>
      ${control}
      ${hint ? `<p class="form-hint small text-secondary mb-0" id="${hintId}">${escapeHtml(hint)}</p>` : ""}
    </div>`;
  }).join("");
  const badge = state.configured
    ? '<span class="badge bg-green-lt">Đã cấu hình</span>'
    : '<span class="badge bg-yellow-lt">Chưa cấu hình — footer đang hiển thị “Đang cập nhật”</span>';
  return `<p class="text-secondary">Hiển thị công khai ở chân trang chủ và trang Điều khoản và chính sách. Chỉ nhập thông tin thật của đơn vị vận hành.</p>
    <form class="card" data-business-profile-form novalidate>
      <div class="card-header"><h3 class="card-title">Thông tin doanh nghiệp</h3><div class="card-actions">${badge}</div></div>
      <div class="card-body"><div class="row">${fields}</div></div>
      <div class="card-footer d-flex align-items-center justify-content-between gap-2">
        <p class="text-secondary small mb-0" data-business-profile-status role="status" aria-live="polite">${escapeHtml(state.status || "")}</p>
        <button class="btn btn-primary" type="submit">Lưu thông tin</button>
      </div>
    </form>`;
}

export function readBusinessProfileForm(form, fields) {
  return Object.fromEntries(fields.map(({ key }) => [key, String(form.elements[key]?.value || "").trim()]));
}

async function saveProfile(profile, { fetchImpl, signal, requestPassword }) {
  const mutate = () => postAdminJson("/api/admin/business-profile", { body: { profile }, fetchImpl, signal });
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

export async function renderAdminBusinessProfile(container, { fetchImpl, signal } = {}) {
  renderAdminMarkup(container, adminLoadingMarkup(), { busy: true });
  let payload;
  try {
    payload = await getAdminJson("/api/admin/business-profile", { fetchImpl, signal });
  } catch (error) {
    if (signal?.aborted) return;
    renderAdminFailure(container, error, () => renderAdminBusinessProfile(container, { fetchImpl, signal }));
    return;
  }
  const state = {
    fields: Array.isArray(payload.fields) ? payload.fields : [],
    profile: payload.profile || {},
    configured: payload.configured === true,
    status: "",
  };
  const render = () => renderAdminMarkup(container, businessProfileFormMarkup(state));
  render();
  container.addEventListener("submit", async (event) => {
    const form = event.target.closest?.("[data-business-profile-form]");
    if (!form) return;
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    const profile = readBusinessProfileForm(form, state.fields);
    try {
      const result = await saveProfile(profile, {
        fetchImpl,
        signal,
        requestPassword: () => requestAdminValue({
          title: "Xác thực thao tác quản trị",
          message: "Nhập lại mật khẩu để lưu thông tin doanh nghiệp.",
          label: "Mật khẩu hiện tại",
          type: "password",
        }),
      });
      if (result === null) {
        state.profile = profile;
        state.status = "Đã hủy lưu.";
      } else {
        state.profile = result.profile || profile;
        state.configured = result.configured === true;
        state.status = result.changedFields?.length ? "Đã lưu. Chân trang công khai sẽ cập nhật trong vài phút." : "Đã lưu, không có thay đổi.";
      }
    } catch (error) {
      if (signal?.aborted) return;
      state.profile = profile;
      state.status = error?.message || "Không thể lưu thông tin doanh nghiệp.";
    }
    render();
  }, signal ? { signal } : undefined);
}
