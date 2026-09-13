import { getAdminJson, postAdminIntegrationJson } from "./AdminApi.js";
import { adminStateMarkup } from "./AdminStateView.js";
import { trustedHTML } from "../shared/trustedTypes.js";

function escapeText(value) {
  if (typeof document === "undefined") {
    return String(value ?? "").replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
  const node = document.createElement("span");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function stateCopy(error) {
  const code = String(error?.code || "");
  if (code === "CHUAN_HOA_ADMIN_NOT_MAPPED") return "Tài khoản chưa được ánh xạ quyền Super Admin của Chuẩn Hóa.";
  if (code === "CHUAN_HOA_INTEGRATION_NOT_CONFIGURED") return "Tích hợp chưa được cấu hình ở máy chủ BiddingFlow.";
  if (code === "CHUAN_HOA_INTEGRATION_TIMEOUT") return "Chuẩn Hóa chưa phản hồi xác định. Không tự chạy lại thao tác.";
  return error?.message || "Không thể tải trạng thái tích hợp Chuẩn Hóa.";
}

export function confirmChuanHoaEntitlement({ userId, durationDays }, confirmImpl = (message) => globalThis.confirm?.(message) === true) {
  return confirmImpl(`Xác nhận gia hạn entitlement tại Chuẩn Hóa cho user ${userId || "(chưa nhập)"} trong ${durationDays || "0"} ngày?`);
}

export function adminChuanHoaMarkup(payload) {
  const data = payload?.data || {};
  const status = data.status || payload?.status || "unknown";
  const capabilities = data.capabilities || {};
  const mutation = capabilities.activation ? `<section class="card mt-3"><div class="card-header"><h3 class="card-title">Thao tác Chuẩn Hóa</h3><p class="text-secondary small mb-0">Mọi mutation được xác thực và ghi audit tại Chuẩn Hóa.</p></div><div class="card-body"><form data-chuan-hoa-extend class="row g-2 mb-4"><div class="col-md-6"><label class="form-label" for="chuan-hoa-user-id">User ID</label><input required class="form-control" id="chuan-hoa-user-id" name="userId"></div><div class="col-md-6"><label class="form-label" for="chuan-hoa-product-id">Product ID</label><input required class="form-control" id="chuan-hoa-product-id" name="productId"></div><div class="col-md-6"><label class="form-label" for="chuan-hoa-features">Feature codes</label><input required class="form-control" id="chuan-hoa-features" name="featureCodes" placeholder="feature.a,feature.b"></div><div class="col-md-3"><label class="form-label" for="chuan-hoa-days">Số ngày</label><input required min="1" max="3660" type="number" class="form-control" id="chuan-hoa-days" name="durationDays" value="30"></div><div class="col-md-3"><label class="form-label" for="chuan-hoa-reason">Lý do</label><input required class="form-control" id="chuan-hoa-reason" name="reason"></div><div class="col-12"><button class="btn btn-primary" type="submit">Xác nhận gia hạn</button><span class="ms-2 text-secondary" data-chuan-hoa-mutation-status role="status"></span></div></form><hr><form data-chuan-hoa-key class="row g-2"><div class="col-md-6"><label class="form-label" for="chuan-hoa-key-product">Product ID cho VIP key</label><input required class="form-control" id="chuan-hoa-key-product" name="productId"></div><div class="col-md-6"><label class="form-label" for="chuan-hoa-key-features">Feature codes</label><input required class="form-control" id="chuan-hoa-key-features" name="featureCodes" placeholder="FORMAT_SCAN,AUTOFIX"></div><div class="col-md-3"><label class="form-label" for="chuan-hoa-key-devices">Số thiết bị tối đa</label><input required min="1" max="100000" type="number" class="form-control" id="chuan-hoa-key-devices" name="maxDevices" value="1"></div><div class="col-md-5"><label class="form-label" for="chuan-hoa-key-expiry">Hết hạn (tùy chọn)</label><input class="form-control" id="chuan-hoa-key-expiry" name="expiresAtUtc" type="datetime-local"></div><div class="col-md-4"><label class="form-label" for="chuan-hoa-key-note">Ghi chú</label><input class="form-control" id="chuan-hoa-key-note" name="note"></div><div class="col-12"><button class="btn btn-outline-primary" type="submit">Tạo VIP key</button><span class="ms-2 text-secondary" data-chuan-hoa-key-status role="status"></span></div></form></div></section>` : "";
  return `<div class="bf-admin-cross-app-page"><header class="bf-admin-page-intro"><div><p class="page-pretitle mb-1">Ứng dụng liên kết</p><h2 class="h1 mb-2">Chuẩn Hóa</h2><p class="text-secondary mb-0">Quản trị qua API server-to-server; dữ liệu và nghiệp vụ vẫn thuộc Chuẩn Hóa.</p></div><span class="badge text-dark ${status === "available" ? "bg-success-lt" : "bg-secondary-lt"}">${escapeText(status)}</span></header><section class="card"><div class="card-header"><h3 class="card-title">Nguồn dữ liệu production</h3></div><div class="card-body"><dl class="row mb-0"><dt class="col-sm-4">Ứng dụng đích</dt><dd class="col-sm-8">Chuẩn Hóa</dd><dt class="col-sm-4">Nguồn sự thật</dt><dd class="col-sm-8">Backend Chuẩn Hóa</dd><dt class="col-sm-4">Tài khoản và gói</dt><dd class="col-sm-8">${capabilities.accounts ? "Được hỗ trợ" : "Chưa hỗ trợ"}</dd><dt class="col-sm-4">Subscription/entitlement</dt><dd class="col-sm-8">${capabilities.subscriptions ? "Được hỗ trợ" : "Chưa hỗ trợ"}</dd><dt class="col-sm-4">Thanh toán</dt><dd class="col-sm-8">${capabilities.billing ? "Được hỗ trợ" : "Chưa hỗ trợ"}</dd></dl></div></section><section class="card mt-3"><div class="card-header d-flex flex-wrap gap-2 align-items-center"><h3 class="card-title me-auto mb-0">Dữ liệu quản trị</h3><label class="visually-hidden" for="chuan-hoa-search">Tìm kiếm</label><input id="chuan-hoa-search" class="form-control" style="max-width:280px" placeholder="Tìm email, mã gói, đơn hàng" /><button class="btn btn-primary" type="button" data-chuan-hoa-load>Tải dữ liệu</button></div><div class="card-body"><div class="btn-list mb-3" role="tablist"><button class="btn btn-outline-secondary active" data-chuan-hoa-resource="accounts">Tài khoản</button><button class="btn btn-outline-secondary" data-chuan-hoa-resource="offers">Gói/bảng giá</button><button class="btn btn-outline-secondary" data-chuan-hoa-resource="subscriptions">Entitlement</button><button class="btn btn-outline-secondary" data-chuan-hoa-resource="activation-keys">VIP keys</button><button class="btn btn-outline-secondary" data-chuan-hoa-resource="orders">Đơn hàng</button><button class="btn btn-outline-secondary" data-chuan-hoa-resource="payments">Sự kiện thanh toán</button><button class="btn btn-outline-secondary" data-chuan-hoa-resource="audit">Lịch sử quản trị</button></div><div data-chuan-hoa-results role="region" aria-live="polite">Chọn một mục để tải dữ liệu từ Chuẩn Hóa.</div></div></section>${mutation}<p class="text-secondary small mt-3">Gia hạn entitlement chỉ gửi sau xác nhận rõ ràng và dùng idempotency key; không tự retry khi mất phản hồi.</p></div>`;
}

async function loadCollection(container, resource, search, signal, fetchImpl, page = 1) {
  const target = container.querySelector("[data-chuan-hoa-results]");
  target.textContent = "Đang tải…";
  try {
    const pageNumber = Math.max(1, Number(page) || 1);
    const payload = await getAdminJson(`/api/admin/integrations/chuan-hoa/${resource}`, { query: { page: pageNumber, pageSize: 25, search }, signal, fetchImpl });
    const pageData = payload?.data || {};
    const items = Array.isArray(pageData.items) ? pageData.items : [];
    if (!items.length) { target.textContent = "Không có dữ liệu phù hợp."; return; }
    const headers = resource === "accounts" ? ["Email", "Tên", "Trạng thái"] : resource === "offers" ? ["Sản phẩm", "Phiên bản", "Giá", "Trạng thái"] : resource === "subscriptions" ? ["Sản phẩm", "Nguồn", "Hiệu lực đến", "Trạng thái"] : resource === "payments" ? ["Mã đơn", "Nhà cung cấp", "Sự kiện", "Kết quả"] : resource === "audit" ? ["Thời gian", "Actor", "Hành động", "Kết quả", "Correlation"] : resource === "activation-keys" ? ["Prefix", "Trạng thái", "Đã dùng", "Còn lại", "Hết hạn"] : ["Mã đơn", "Số tiền", "Trạng thái"];
    const rows = items.map(item => resource === "accounts" ? [item.email, item.displayName, item.status] : resource === "offers" ? [item.productCode, item.version, `${item.amountMinor} ${item.currency}`, item.status] : resource === "subscriptions" ? [item.productCode, item.source, item.effectiveUntilUtc, item.status] : resource === "payments" ? [item.stableOrderCode, item.provider, item.eventType, item.processingResult || "N/A"] : resource === "audit" ? [item.occurredAtUtc, item.externalActorId, item.actionCode, item.resultCode, item.correlationId] : resource === "activation-keys" ? [item.keyPrefix, item.status, item.usedDevices, item.remainingDevices, item.expiresAtUtc || "N/A"] : [item.stableOrderCode, `${item.amountMinor} ${item.currency}`, item.status]);
    const total = Number(pageData.total ?? items.length) || 0;
    const current = Number(pageData.page ?? pageNumber) || pageNumber;
    const pageSize = Number(pageData.pageSize) || 25;
    const hasNext = current * pageSize < total;
    target.innerHTML = trustedHTML(`<div class="table-responsive"><table class="table table-vcenter"><thead><tr>${headers.map(h => `<th>${escapeText(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeText(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table><div class="d-flex flex-wrap align-items-center gap-2 justify-content-between"><p class="text-secondary small mb-0">Tổng ${escapeText(total)} bản ghi · trang ${escapeText(current)}</p><div class="btn-list"><button class="btn btn-outline-secondary btn-sm" type="button" data-chuan-hoa-page="prev"${current <= 1 ? " disabled" : ""}>Trang trước</button><button class="btn btn-outline-secondary btn-sm" type="button" data-chuan-hoa-page="next"${hasNext ? "" : " disabled"}>Trang sau</button></div></div></div>`);
    target.querySelector("[data-chuan-hoa-page=prev]")?.addEventListener("click", () => loadCollection(container, resource, search, signal, fetchImpl, current - 1));
    target.querySelector("[data-chuan-hoa-page=next]")?.addEventListener("click", () => loadCollection(container, resource, search, signal, fetchImpl, current + 1));
  } catch (error) { target.textContent = stateCopy(error); }
}

export async function renderAdminChuanHoa(container, {
  signal,
  fetchImpl = globalThis.fetch,
  confirmImpl = (message) => globalThis.confirm?.(message) === true,
} = {}) {
  container.innerHTML = trustedHTML(`<div class="card bf-admin-state"><div class="card-body">Đang kiểm tra trạng thái tích hợp Chuẩn Hóa…</div></div>`);
  try {
    const payload = await getAdminJson("/api/admin/integrations/chuan-hoa/capabilities", { signal, fetchImpl });
    if (!signal?.aborted) {
      const capabilities = payload?.data?.capabilities || {};
      container.innerHTML = trustedHTML(adminChuanHoaMarkup(payload));
      let resource = "accounts";
      const load = () => loadCollection(container, resource, container.querySelector("#chuan-hoa-search")?.value || "", signal, fetchImpl, 1);
      container.querySelectorAll("[data-chuan-hoa-resource]").forEach(button => button.addEventListener("click", () => { resource = button.dataset.chuanHoaResource; container.querySelectorAll("[data-chuan-hoa-resource]").forEach(item => item.classList.toggle("active", item === button)); load(); }));
      container.querySelector("[data-chuan-hoa-load]")?.addEventListener("click", load);
      const mutationForm = container.querySelector("[data-chuan-hoa-extend]");
      mutationForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const form = new FormData(mutationForm);
        if (!confirmChuanHoaEntitlement({ userId: form.get("userId"), durationDays: form.get("durationDays") }, confirmImpl)) return;
        const key = `chuan-hoa-extend:${crypto.randomUUID()}`;
        const status = container.querySelector("[data-chuan-hoa-mutation-status]");
        const submitButton = mutationForm.querySelector("button[type=submit]");
        if (submitButton) submitButton.disabled = true;
        status.textContent = "Đang gửi…";
        try {
          await postAdminIntegrationJson("/api/admin/integrations/chuan-hoa/entitlements/extend", { idempotencyKey: key, retries: 0, signal, fetchImpl, body: { userId: form.get("userId"), productId: form.get("productId"), featureCodes: String(form.get("featureCodes") || "").split(",").map(value => value.trim()).filter(Boolean), durationDays: Number(form.get("durationDays")), reason: form.get("reason") } });
          status.textContent = "Đã ghi nhận tại Chuẩn Hóa.";
          await load();
        } catch (error) { status.textContent = stateCopy(error); }
        finally {
          if (submitButton) submitButton.disabled = false;
        }
      });
      const keyForm = container.querySelector("[data-chuan-hoa-key]");
      keyForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const form = new FormData(keyForm);
        const status = container.querySelector("[data-chuan-hoa-key-status]");
        const submitButton = keyForm.querySelector("button[type=submit]");
        if (submitButton) submitButton.disabled = true;
        status.textContent = "Đang tạo key…";
        try {
          const response = await postAdminIntegrationJson("/api/admin/integrations/chuan-hoa/activation-keys", { idempotencyKey: `chuan-hoa-key:${crypto.randomUUID()}`, retries: 0, signal, fetchImpl, body: { productId: form.get("productId"), featureCodes: String(form.get("featureCodes") || "").split(",").map(value => value.trim()).filter(Boolean), maxDevices: Number(form.get("maxDevices")), expiresAtUtc: form.get("expiresAtUtc") ? new Date(form.get("expiresAtUtc")).toISOString() : null, note: form.get("note") || "" } });
          const created = response?.data || {};
          status.textContent = created.activationKey ? `VIP key vừa tạo (chỉ hiển thị lần này): ${created.activationKey}` : "Đã tạo VIP key.";
          keyForm.reset();
        } catch (error) { status.textContent = stateCopy(error); }
        finally { if (submitButton) submitButton.disabled = false; }
      });
      if (capabilities.activation) {
        const actions = document.createElement("section");
        actions.className = "card mt-3";
        actions.innerHTML = trustedHTML(`<div class="card-header"><h3 class="card-title">Thu hồi và reset thiết bị</h3></div><div class="card-body"><form data-chuan-hoa-revoke-key class="row g-2 mb-3"><div class="col-md-8"><label class="form-label" for="chuan-hoa-revoke-key-id">Activation key ID</label><input required class="form-control" id="chuan-hoa-revoke-key-id" name="keyId"></div><div class="col-md-4 d-flex align-items-end"><button class="btn btn-outline-danger" type="submit">Thu hồi VIP key</button></div><div class="col-12" data-chuan-hoa-revoke-status role="status"></div></form><form data-chuan-hoa-reset-device class="row g-2"><div class="col-md-5"><label class="form-label" for="chuan-hoa-reset-user-id">Account user ID</label><input required class="form-control" id="chuan-hoa-reset-user-id" name="targetId"></div><div class="col-md-5"><label class="form-label" for="chuan-hoa-reset-device-id">Device thumbprint</label><input required class="form-control" id="chuan-hoa-reset-device-id" name="deviceThumbprint"></div><div class="col-md-2 d-flex align-items-end"><button class="btn btn-outline-warning" type="submit">Reset device</button></div><div class="col-12" data-chuan-hoa-reset-status role="status"></div></form></div>`);
        container.querySelector(".bf-admin-cross-app-page")?.append(actions);
        const postDeviceMutation = async (form, endpoint, statusSelector, confirmMessage) => {
          if (!confirmImpl(confirmMessage)) return;
          const values = new FormData(form);
          const status = container.querySelector(statusSelector);
          status.textContent = "Đang gửi…";
          const button = form.querySelector("button[type=submit]");
          if (button) button.disabled = true;
          try {
            await postAdminIntegrationJson(endpoint, { idempotencyKey: `chuan-hoa-admin:${crypto.randomUUID()}`, retries: 0, signal, fetchImpl, body: Object.fromEntries(values.entries()) });
            status.textContent = "Đã cập nhật tại Chuẩn Hóa.";
            form.reset();
          } catch (error) { status.textContent = stateCopy(error); }
          finally { if (button) button.disabled = false; }
        };
        container.querySelector("[data-chuan-hoa-revoke-key]")?.addEventListener("submit", event => { event.preventDefault(); postDeviceMutation(event.currentTarget, "/api/admin/integrations/chuan-hoa/activation-keys/revoke", "[data-chuan-hoa-revoke-status]", "Xác nhận thu hồi VIP key tại Chuẩn Hóa?"); });
        container.querySelector("[data-chuan-hoa-reset-device]")?.addEventListener("submit", event => { event.preventDefault(); postDeviceMutation(event.currentTarget, "/api/admin/integrations/chuan-hoa/accounts/reset-device", "[data-chuan-hoa-reset-status]", "Xác nhận reset thiết bị account tại Chuẩn Hóa?"); });
      }
      load();
    }
  } catch (error) {
    if (signal?.aborted) return;
    container.innerHTML = trustedHTML(`<div class="bf-admin-cross-app-page"><header class="bf-admin-page-intro"><div><p class="page-pretitle mb-1">Ứng dụng liên kết</p><h2 class="h1 mb-2">Chuẩn Hóa</h2><p class="text-secondary mb-0">Dữ liệu và nghiệp vụ vẫn thuộc backend Chuẩn Hóa.</p></div><span class="badge text-dark bg-warning-lt">Chưa sẵn sàng</span></header>${adminStateMarkup("empty", { title: "Tích hợp chưa sẵn sàng", message: escapeText(stateCopy(error)) })}<p class="text-secondary small mt-3">Mã trạng thái: ${escapeText(error?.code || "UNKNOWN")}. Không có thao tác nào được gửi tới ứng dụng đích.</p></div>`);
  }
}
