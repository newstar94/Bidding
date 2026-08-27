import { apiFetch } from "../shared/apiClient.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { trustedHTML } from "../shared/trustedTypes.js";

const STYLE_URL = new URL("./CommercialControlCenter.css", import.meta.url).pathname;
const state = { overview: null, draft: null, validation: null, loading: false, controller: null };

// Backend values remain stable English identifiers; these labels are only for
// the Vietnamese administration UI.
const POLICY_LABELS = Object.freeze({
  baseTerm: "Kỳ hạn gói cơ bản",
  connectedAdvantageBasisPoints: "Mức ưu đãi gói Kết nối",
  creditPackExpiry: "Thời hạn lượt mua thêm",
  downgrade: "Hạ cấp gói",
  graceDays: "Số ngày gia hạn",
  latePayment: "Xử lý thanh toán trễ",
  organizationPurchaseAuthority: "Quyền mua theo tổ chức",
  renewalAnchor: "Mốc gia hạn",
  partialBatch: "Xử lý khi thiếu lượt",
});
const POLICY_KIND_LABELS = Object.freeze({
  blocked_decision: "Chưa chốt quyết định",
  configured: "Đã cấu hình",
  fixed_days: "Số ngày cố định",
  end_of_term: "Cuối kỳ hạn",
  manual_review: "Cần duyệt thủ công",
  reject_all: "Từ chối toàn bộ lượt",
  process_affordable_in_stable_order: "Xử lý theo thứ tự ổn định",
});
const PROVIDER_LABELS = Object.freeze({
  fake: "Mô phỏng thanh toán (kiểm thử)",
  payos: "payOS",
});
const ENVIRONMENT_LABELS = Object.freeze({
  production: "Môi trường thật",
  test: "Môi trường kiểm thử",
  development: "Môi trường phát triển",
});
const MODE_LABELS = Object.freeze({
  shadow: "Chế độ giám sát (chưa kích hoạt)",
  enforce: "Đang áp dụng",
  off: "Đã tắt",
});
const READINESS_LABELS = Object.freeze({
  ready: "Sẵn sàng",
  blocked_external: "Đang chờ cấu hình bên ngoài",
  blocked_decision: "Đang chờ quyết định",
});
const ORDER_STATE_LABELS = Object.freeze({
  pending: "Đang chờ",
  paid: "Đã thanh toán",
  unpaid: "Chưa thanh toán",
  verified: "Đã xác minh",
  applied: "Đã kích hoạt",
  review_required: "Cần xử lý thủ công",
  reversed: "Đã hoàn tác",
  not_ready: "Chưa sẵn sàng",
  cancelled: "Đã hủy",
  expired: "Đã hết hạn",
  create_failed: "Tạo thất bại",
});
const humanize = (value, labels = {}) => (
  value === null || value === undefined || value === ""
    ? "—"
    : labels[value] || String(value)
);
const formatPolicyValue = (name, value) => {
  if (name === "organizationPurchaseAuthority" && Array.isArray(value)) {
    return value.map((item) => humanize(item, { super_admin: "Quản trị viên hệ thống", manager: "Quản lý tổ chức" })).join(", ");
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const kind = humanize(value.kind, POLICY_KIND_LABELS);
    if (value.days != null) return `${kind} · ${Number(value.days).toLocaleString("vi-VN")} ngày`;
    return kind;
  }
  return humanize(value, POLICY_KIND_LABELS);
};

const money = (value) => `${new Intl.NumberFormat("vi-VN").format(Number(value || 0))} ₫`;
const integerInput = (value) => new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
  useGrouping: true,
}).format(Number(value || 0));
const parseIntegerInput = (value) => {
  const normalized = String(value ?? "").trim().replaceAll(".", "");
  if (!/^\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const dateTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh"
}).format(new Date(Number(value) * 1000)) : "—";
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const html = (node, markup) => { if (node) node.innerHTML = trustedHTML(markup); };

async function jsonRequest(path, options = {}) {
  // Keep the shared HTTP recovery hook enabled so sensitive mutations can
  // trigger the application's password step-up dialog and retry once.
  const response = await apiFetch(path, { handleHttpErrors: true, retries: 0, ...options });
  let payload = {};
  try { payload = await response.json(); } catch { /* closed empty response */ }
  if (!response.ok) {
    const error = new Error(payload.error || "Không thể hoàn tất thao tác thương mại.");
    error.code = payload.code || "COMMERCIAL_REQUEST_FAILED";
    error.status = response.status;
    error.details = payload.details || {};
    throw error;
  }
  return payload;
}

function setStatus(message, tone = "neutral") {
  const node = document.getElementById("commercial-status");
  if (!node) return;
  node.dataset.tone = tone;
  node.querySelector("span:last-child").textContent = message;
}

function renderOverview() {
  const overview = state.overview || {};
  const runtime = overview.runtime || {};
  const release = overview.currentRelease;
  const scheduled = overview.scheduledRelease;
  const badge = document.getElementById("commercial-runtime-badge");
  if (badge) {
    badge.textContent = humanize(runtime.mode, MODE_LABELS);
    badge.dataset.tone = runtime.mode === "enforce" ? "success" : runtime.mode === "shadow" ? "warning" : "neutral";
  }
  html(document.getElementById("commercial-release-content"), `
    <div class="commercial-metrics">
      <div><span>Bản phát hành đang hiệu lực</span><strong>${escapeHtml(release?.versionLabel || "Chưa có")}</strong><small>${dateTime(release?.effectiveFrom)}</small></div>
      <div><span>Bản phát hành đã lên lịch</span><strong>${escapeHtml(scheduled?.versionLabel || "Không có")}</strong><small>${dateTime(scheduled?.effectiveFrom)}</small></div>
      <div><span>Đã xác minh thu</span><strong>${money(overview.money?.verifiedCollected)}</strong><small>VND · giao dịch đã xác minh</small></div>
      <div><span>Bản nháp đang mở</span><strong>${Number(overview.drafts?.length || 0)}</strong><small>Phiên bản chỉnh sửa</small></div>
    </div>
    <div class="commercial-release-toolbar">
      <label>Bản nháp
        <select id="commercial-draft-select" class="form-control">
          ${(overview.drafts || []).map((draft) => `<option value="${escapeHtml(draft.id)}" ${draft.id === state.draft?.id ? "selected" : ""}>${escapeHtml(draft.id)} · lần sửa ${draft.revision} · ${humanize(draft.status, { draft: "Bản nháp", open: "Đang mở", published: "Đã phát hành" })}</option>`).join("") || '<option value="">Chưa có bản nháp</option>'}
        </select>
      </label>
      <label>Hiệu lực từ <input id="commercial-effective-at" class="form-control" type="datetime-local"></label>
      <div class="commercial-toolbar-buttons">
        <button type="button" class="btn btn-outline" id="commercial-save" ${state.draft ? "" : "disabled"}>Lưu r${state.draft?.revision || "—"}</button>
        <button type="button" class="btn btn-outline" id="commercial-validate" ${state.draft ? "" : "disabled"}>Kiểm tra</button>
        <button type="button" class="btn btn-primary" id="commercial-publish" ${state.validation?.errors?.length === 0 ? "" : "disabled"}>Xuất bản</button>
      </div>
    </div>
    <p class="commercial-callout">Bản nháp là phiên bản cấu hình đang được chuẩn bị. Bạn có thể lưu và kiểm tra nhiều lần; chỉ khi kiểm tra đạt và bấm “Xuất bản” thì cấu hình mới trở thành bản phát hành áp dụng.</p>
    ${(overview.readinessWarnings || []).map((warning) => `<p class="commercial-callout commercial-callout--warning"><strong>Điều kiện sẵn sàng:</strong> ${escapeHtml(warning)}</p>`).join("")}
  `);
}

function renderOffers() {
  const policyDocument = state.draft?.document;
  if (!policyDocument) return;
  const savings = new Map((state.validation?.simulation?.connectedSavings || []).map((item) => [item.tier, item]));
  html(document.getElementById("commercial-offers-content"), `
    <div class="commercial-table-wrap"><table class="data-table commercial-offer-table" data-mobile-layout="cards">
      <thead><tr><th>Quy mô</th><th>Biến thể</th><th>Đối tượng sở hữu</th><th>Số thành viên</th><th>Giá gói</th><th>Lượt tra cứu kèm theo</th><th>Trạng thái bán</th></tr></thead>
      <tbody>${policyDocument.offers.map((offer, index) => `<tr>
        <td data-label="Quy mô"><strong>${escapeHtml(offer.display?.name || offer.tier)}</strong><small>${escapeHtml(offer.code)}</small></td>
        <td data-label="Biến thể"><span class="commercial-badge" data-tone="${offer.variant === "connected" ? "success" : "neutral"}">${offer.variant === "connected" ? "Kết nối" : "Nội bộ"}</span>${offer.variant === "connected" && savings.get(offer.tier) ? `<small>Tiết kiệm ${(savings.get(offer.tier).savingBasisPoints / 100).toFixed(1)}%</small>` : ""}</td>
        <td data-label="Đối tượng sở hữu">${humanize(offer.ownerKind, { organization: "Tổ chức", account: "Tài khoản cá nhân" })}</td>
        <td data-label="Nhân sự"><input class="form-control" type="text" inputmode="numeric" pattern="[0-9.]*" autocomplete="off" data-offer-index="${index}" data-field="memberQuota" value="${integerInput(offer.memberQuota)}"></td>
        <td data-label="Giá gói"><input class="form-control" type="text" inputmode="numeric" pattern="[0-9.]*" autocomplete="off" data-offer-index="${index}" data-field="price.total" value="${integerInput(offer.price.total)}"></td>
        <td data-label="Lượt tra cứu kèm theo"><input class="form-control" type="text" inputmode="numeric" pattern="[0-9.]*" autocomplete="off" data-offer-index="${index}" data-field="includedProcurementQuota" value="${integerInput(offer.includedProcurementQuota)}"></td>
        <td data-label="Trạng thái bán"><select class="form-control" data-offer-index="${index}" data-field="salesState"><option value="sellable" ${offer.salesState === "sellable" ? "selected" : ""}>Đang bán</option><option value="stopped" ${offer.salesState === "stopped" ? "selected" : ""}>Đã dừng bán</option><option value="non_sellable" ${offer.salesState === "non_sellable" ? "selected" : ""}>Không bán</option></select></td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="commercial-credit-packs">${policyDocument.creditPacks.map((pack, index) => `<label><span>${Number(pack.quantity).toLocaleString("vi-VN")} lượt</span><input class="form-control" type="text" inputmode="numeric" pattern="[0-9.]*" autocomplete="off" data-pack-index="${index}" value="${integerInput(pack.price)}"><small>${escapeHtml(pack.code)}</small></label>`).join("")}</div>
  `);
}

function renderPolicies() {
  const policies = state.draft?.document?.policies || {};
  const validation = state.validation;
  const policyRows = Object.entries(policies).map(([name, value]) => {
    const blocked = value?.kind === "blocked_decision";
    const displayValue = value?.reason || formatPolicyValue(name, value) || JSON.stringify(value);
    return `<li><div><strong>${escapeHtml(humanize(name, POLICY_LABELS))}</strong><small>${escapeHtml(displayValue)}</small></div><span class="commercial-badge" data-tone="${blocked ? "danger" : "neutral"}">${blocked ? "Chưa chốt" : escapeHtml(humanize(value?.kind, POLICY_KIND_LABELS))}</span></li>`;
  }).join("");
  const issues = [...(validation?.errors || []), ...(validation?.warnings || [])];
  html(document.getElementById("commercial-policy-content"), `
    <div class="commercial-policy-editor">
      <label>Kỳ hạn gói cơ bản<select class="form-control" data-policy-field="baseTerm.kind"><option value="blocked_decision" ${policies.baseTerm?.kind === "blocked_decision" ? "selected" : ""}>Chưa chốt quyết định</option><option value="fixed_days" ${policies.baseTerm?.kind === "fixed_days" ? "selected" : ""}>Số ngày cố định</option></select></label>
      <label>Số ngày của kỳ hạn<input class="form-control" type="number" min="1" max="3660" data-policy-field="baseTerm.days" value="${Number(policies.baseTerm?.days || 0)}"></label>
      <label>Mốc gia hạn<select class="form-control" data-policy-field="renewalAnchor.kind"><option value="blocked_decision" ${policies.renewalAnchor?.kind === "blocked_decision" ? "selected" : ""}>Chưa chốt quyết định</option><option value="end_of_term" ${policies.renewalAnchor?.kind === "end_of_term" ? "selected" : ""}>Cuối kỳ hạn</option><option value="manual_review" ${policies.renewalAnchor?.kind === "manual_review" ? "selected" : ""}>Cần duyệt thủ công</option></select></label>
      <label>Xử lý khi thiếu lượt<select class="form-control" data-policy-field="partialBatch.kind"><option value="blocked_decision" ${policies.partialBatch?.kind === "blocked_decision" ? "selected" : ""}>Chưa chốt quyết định</option><option value="reject_all" ${policies.partialBatch?.kind === "reject_all" ? "selected" : ""}>Từ chối toàn bộ lượt</option><option value="process_affordable_in_stable_order" ${policies.partialBatch?.kind === "process_affordable_in_stable_order" ? "selected" : ""}>Xử lý theo thứ tự ổn định</option></select></label>
      <label>Số ngày gia hạn<input class="form-control" type="number" min="0" max="365" data-policy-field="graceDays" value="${Number(policies.graceDays || 0)}"></label>
      <label>Thời hạn lượt mua thêm (ngày)<input class="form-control" type="number" min="1" max="3660" data-policy-field="creditPackExpiry.days" value="${Number(policies.creditPackExpiry?.days || 0)}"></label>
      <label class="commercial-check"><input type="checkbox" data-policy-field="organizationPurchaseAuthority.manager" ${policies.organizationPurchaseAuthority?.includes("manager") ? "checked" : ""}> Cho quản lý hiện tại mua gói cho tổ chức</label>
    </div>
    <ul class="commercial-policy-list">${policyRows || "<li>Chưa có chính sách.</li>"}</ul>
    <div class="commercial-validation" data-tone="${validation?.errors?.length ? "danger" : "success"}">
      <strong>${validation ? `${validation.errors.length} lỗi · ${validation.warnings.length} cảnh báo` : "Chưa chạy validation"}</strong>
      ${issues.slice(0, 8).map((issue) => `<p><code>${escapeHtml(issue.code)}</code> ${escapeHtml(issue.path)} — ${escapeHtml(issue.message)}</p>`).join("")}
    </div>
  `);
}

function renderProviders() {
  const profiles = state.draft?.document?.providerProfiles || [];
  html(document.getElementById("commercial-provider-content"), `
    <ul class="commercial-provider-list">${profiles.map((profile) => `<li>
      <div class="commercial-provider-icon"><i data-lucide="${profile.provider === "payos" ? "landmark" : "flask-conical"}"></i></div>
      <div><strong>${escapeHtml(PROVIDER_LABELS[profile.provider] || profile.alias)}</strong><small>${escapeHtml(humanize(profile.environment, ENVIRONMENT_LABELS))} · ${escapeHtml(humanize(profile.mode, MODE_LABELS))}</small></div>
      <span class="commercial-badge" data-tone="${profile.readiness === "ready" ? "success" : "warning"}">${escapeHtml(humanize(profile.readiness, READINESS_LABELS))}</span>
    </li>`).join("") || "<li>Chưa có cấu hình cổng thanh toán.</li>"}</ul>
    <p class="commercial-callout">payOS hiện chỉ ở chế độ giám sát; giao diện không đọc hoặc hiển thị thông tin bí mật. Hoàn tiền được xử lý thủ công ngoài nền tảng.</p>
  `);
}

function renderOrdersAndHistory() {
  const counts = state.overview?.orderActivationCounts || {};
  const health = state.overview?.health || {};
  const recentOrders = state.overview?.recentOrders || [];
  html(document.getElementById("commercial-order-content"), `
    <div class="commercial-order-states">${Object.entries(counts).map(([key, value]) => `<div><span>${escapeHtml(humanize(key, ORDER_STATE_LABELS))}</span><strong>${Number(value)}</strong></div>`).join("") || '<p class="commercial-empty">Chưa có đơn hàng thương mại.</p>'}</div>
    <div class="commercial-order-states"><div><span>Sự kiện webhook đang chờ</span><strong>${Number(health.webhook?.backlog || 0)}</strong><small>${Number(health.webhook?.oldestAgeSeconds || 0)} giây</small></div><div><span>Đã thanh toán nhưng chưa kích hoạt</span><strong>${Number(health.activation?.paidNotApplied || 0)}</strong><small>${Number(health.activation?.oldestAgeSeconds || 0)} giây</small></div><div><span>Đơn hàng quá hạn</span><strong>${Number(health.orders?.pendingPastExpiry || 0)}</strong></div><div><span>Lỗi âm số dư lượt</span><strong>${Number(health.usage?.negativeInvariantViolations || 0)}</strong></div></div>
    ${(health.alerts || []).map((alert) => `<p class="commercial-callout commercial-callout--warning"><strong>${escapeHtml(alert.code)}:</strong> ${Number(alert.value)} (ngưỡng ${Number(alert.threshold)})</p>`).join("")}
    <div class="commercial-recent-orders"><h4>Đơn hàng cần theo dõi</h4>${recentOrders.length ? recentOrders.map((order) => `<article><div><strong>${escapeHtml(order.publicId)}</strong><small>${escapeHtml(humanize(order.paymentState, ORDER_STATE_LABELS))} · ${escapeHtml(humanize(order.activationState, ORDER_STATE_LABELS))}</small></div><b>${money(order.totalAmount)}</b><div class="commercial-order-actions"><button type="button" class="btn btn-outline commercial-order-action" data-action="reconcile" data-order="${escapeHtml(order.publicId)}">Đối soát</button><button type="button" class="btn btn-outline commercial-order-action" data-action="review" data-order="${escapeHtml(order.publicId)}">Yêu cầu xử lý</button><button type="button" class="btn btn-danger commercial-order-action" data-action="refund" data-order="${escapeHtml(order.publicId)}">Hoàn tiền</button></div></article>`).join("") : '<p class="commercial-empty">Chưa có đơn hàng.</p>'}</div>
    <p class="commercial-callout commercial-callout--warning"><strong>Lịch sử hóa đơn tổ chức:</strong> Chưa chốt quyết định — chưa thêm quyền đọc mới khi chủ sản phẩm chưa phê duyệt.</p>
  `);
  const releases = [state.overview?.currentRelease, state.overview?.scheduledRelease].filter(Boolean);
  html(document.getElementById("commercial-history-content"), `
    <ol class="commercial-history-list">${releases.map((release) => `<li><span></span><div><strong>${escapeHtml(release.versionLabel)}</strong><small>${dateTime(release.effectiveFrom)} · ${escapeHtml(humanize(release.mode, MODE_LABELS))}</small><code>${escapeHtml(release.checksum || "")}</code></div></li>`).join("") || '<li class="commercial-empty">Chưa có bản phát hành đang bán.</li>'}</ol>
    ${state.overview?.currentRelease ? '<button type="button" class="btn btn-outline" id="commercial-clone-release">Tạo bản nháp từ bản đang hiệu lực</button> <button type="button" class="btn btn-danger" id="commercial-stop-sales">Dừng bán</button>' : ""}
  `);
}

function bindDraftInputs() {
  const root = document.getElementById("tab-commercial-admin");
  root?.querySelectorAll("[data-offer-index]").forEach((input) => input.addEventListener("change", () => {
    const offer = state.draft.document.offers[Number(input.dataset.offerIndex)];
    const field = input.dataset.field;
    const numericField = field !== "salesState";
    const value = numericField ? parseIntegerInput(input.value) : input.value;
    const minimum = field === "memberQuota" ? 1 : 0;
    if (numericField && (value === null || value < minimum)) {
      input.setCustomValidity(`Giá trị phải là số nguyên từ ${minimum.toLocaleString("vi-VN")} trở lên.`);
      input.reportValidity();
      const previous = field === "price.total" ? offer.price.total : offer[field];
      input.value = integerInput(previous);
      return;
    }
    input.setCustomValidity("");
    if (field === "price.total") {
      offer.price.total = value;
      offer.price.subtotal = value;
      offer.price.tax = 0;
    } else offer[field] = value;
    state.validation = null;
    renderAll(state.controller);
  }));
  root?.querySelectorAll("[data-pack-index]").forEach((input) => input.addEventListener("change", () => {
    const pack = state.draft.document.creditPacks[Number(input.dataset.packIndex)];
    const value = parseIntegerInput(input.value);
    if (value === null) {
      input.setCustomValidity("Giá trị phải là số nguyên không âm.");
      input.reportValidity();
      input.value = integerInput(pack.price);
      return;
    }
    input.setCustomValidity("");
    pack.price = value;
    state.validation = null;
    renderAll(state.controller);
  }));
  root?.querySelectorAll("[data-policy-field]").forEach((input) => input.addEventListener("change", () => {
    const policies = state.draft.document.policies;
    const path = input.dataset.policyField;
    if (path === "organizationPurchaseAuthority.manager") {
      const values = new Set(policies.organizationPurchaseAuthority || ["super_admin"]);
      input.checked ? values.add("manager") : values.delete("manager");
      values.add("super_admin");
      policies.organizationPurchaseAuthority = [...values];
    } else {
      const parts = path.split(".");
      let target = policies;
      while (parts.length > 1) {
        const part = parts.shift();
        target[part] ||= {};
        target = target[part];
      }
      target[parts[0]] = input.type === "number" ? Number(input.value) : input.value;
    }
    state.validation = null;
    renderAll(state.controller);
  }));
}

function renderAll(controller) {
  renderOverview();
  renderOffers();
  renderPolicies();
  renderProviders();
  renderOrdersAndHistory();
  controller?.view?.createIconsScoped(document.getElementById("tab-commercial-admin"));
  bindEvents(controller);
  bindDraftInputs();
  document.querySelectorAll(".commercial-order-action").forEach((button) => button.addEventListener("click", () => runOrderAction(button.dataset.action, button.dataset.order, controller)));
}

async function runOrderAction(action, publicId, controller) {
  const reason = action === "refund" ? window.prompt("Lý do hoàn tiền thủ công (bắt buộc):", "") : "Đối soát bởi quản trị viên";
  if (action === "refund" && !reason?.trim()) return;
  const amount = action === "refund" ? Number(window.prompt("Số tiền hoàn tiền (VND):", "0")) : null;
  if (action === "refund" && (!Number.isInteger(amount) || amount <= 0)) return;
  const path = action === "refund" ? `/api/billing/admin/orders/${encodeURIComponent(publicId)}/refund` : `/api/billing/admin/orders/${encodeURIComponent(publicId)}/${action}`;
  const options = { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `admin-${action}-${publicId}-${Date.now()}` }, body: JSON.stringify(action === "refund" ? { amount, reason } : { reason }) };
  const actionLabel = action === "refund" ? "Yêu cầu hoàn tiền" : action === "review" ? "Yêu cầu xử lý" : "Yêu cầu đối soát";
  try { await jsonRequest(path, options); setStatus(`${actionLabel} đã gửi cho đơn hàng ${publicId}.`, "success"); await refresh(controller, state.draft?.id); } catch (error) { setStatus(`${error.code}: ${error.message}`, "danger"); }
}

async function loadDraft(id) {
  state.draft = id ? await jsonRequest(`/api/commercial/drafts/${encodeURIComponent(id)}`) : null;
  state.validation = state.draft?.validation
    ? { ...state.draft.validation, validationDigest: state.draft.validationDigest }
    : null;
}

async function refresh(controller, preferredDraftId = "") {
  if (state.loading) return;
  state.loading = true;
    setStatus("Đang đồng bộ trung tâm quản trị thương mại…");
  try {
    state.overview = await jsonRequest("/api/commercial/admin/overview");
    const openDraftIds = new Set((state.overview.drafts || []).map((draft) => draft.id));
    const requestedDraftId = preferredDraftId || state.draft?.id || "";
    const draftId = openDraftIds.has(requestedDraftId)
      ? requestedDraftId
      : state.overview.drafts?.[0]?.id || "";
    await loadDraft(draftId);
    renderAll(controller);
    setStatus(`Đã đồng bộ · ${humanize(state.overview.runtime?.mode, MODE_LABELS)}`, state.overview.readinessWarnings?.length ? "warning" : "success");
  } catch (error) {
    setStatus(`${error.code}: ${error.message}`, "danger");
  } finally {
    state.loading = false;
  }
}

async function mutate(controller, operation, successMessage) {
  try {
    const result = await operation();
    setStatus(successMessage, "success");
    await refresh(controller, result?.id || result?.draftId || state.draft?.id);
  } catch (error) {
    setStatus(`${error.code}: ${error.message}`, "danger");
    if (error.status === 409 && error.code === "COMMERCIAL_POLICY_STALE") await refresh(controller);
  }
}

function bindEvents(controller) {
  const byId = (id) => document.getElementById(id);
  byId("commercial-refresh")?.addEventListener("click", () => refresh(controller), { once: true });
  byId("commercial-create-draft")?.addEventListener("click", () => mutate(controller,
    () => jsonRequest("/api/commercial/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    "Đã tạo bản nháp mới."
  ), { once: true });
  byId("commercial-draft-select")?.addEventListener("change", (event) => refresh(controller, event.target.value), { once: true });
  byId("commercial-save")?.addEventListener("click", () => mutate(controller,
    () => jsonRequest(`/api/commercial/drafts/${encodeURIComponent(state.draft.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "If-Match": `"${state.draft.revision}"` }, body: JSON.stringify({ expectedRevision: state.draft.revision, document: state.draft.document }) }),
    "Đã lưu bản nháp; validation cũ đã hết hiệu lực."
  ), { once: true });
  byId("commercial-validate")?.addEventListener("click", async () => {
    try {
      state.validation = await jsonRequest(`/api/commercial/drafts/${encodeURIComponent(state.draft.id)}/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: state.draft.revision }) });
      renderAll(controller);
      setStatus(state.validation.errors.length ? "Kiểm tra còn lỗi cần xử lý." : "Kiểm tra đạt; có thể xuất bản khi đủ điều kiện.", state.validation.errors.length ? "danger" : "success");
    } catch (error) { setStatus(`${error.code}: ${error.message}`, "danger"); }
  }, { once: true });
  byId("commercial-publish")?.addEventListener("click", async () => {
    const reason = await controller.view.customPrompt("Xuất bản bản phát hành thương mại", "Nhập lý do thay đổi. Thao tác yêu cầu xác thực lại và tạo nhật ký bất biến.", "", "Lý do xuất bản");
    if (!reason) return;
    const local = byId("commercial-effective-at")?.value;
    const effectiveAt = local ? Math.floor(new Date(local).getTime() / 1000) : Math.floor(Date.now() / 1000);
    await mutate(controller, () => jsonRequest(`/api/commercial/drafts/${encodeURIComponent(state.draft.id)}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: state.draft.revision, validationDigest: state.validation.validationDigest, effectiveAt, reason }) }), "Đã tạo bản phát hành bất biến.");
  }, { once: true });
  byId("commercial-clone-release")?.addEventListener("click", () => mutate(controller,
    () => jsonRequest(`/api/commercial/releases/${encodeURIComponent(state.overview.currentRelease.id)}/clone`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    "Đã tạo bản nháp mới từ bản đang hiệu lực."
  ), { once: true });
  byId("commercial-stop-sales")?.addEventListener("click", async () => {
    const reason = await controller.view.customPrompt("Dừng bán bản phát hành", "Quyền lợi đã áp dụng không thay đổi. Nhập lý do dừng các giao dịch mới.", "", "Lý do dừng bán");
    if (!reason) return;
    await mutate(controller, () => jsonRequest(`/api/commercial/releases/${encodeURIComponent(state.overview.currentRelease.id)}/stop-sales`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, scope: { kind: "global" } }) }), "Đã ghi sự kiện dừng bán.");
  }, { once: true });
}

export async function mountCommercialControlCenter(controller) {
  state.controller = controller;
  await loadStyleOnce(STYLE_URL);
  await refresh(controller);
}
