import { apiFetch } from "../shared/apiClient.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { offerEditor, offerPreview, describeOfferChanges } from "./CommercialOfferEditor.js";
import { classifyPublicCommercialResponse } from "./PublicCommercialCatalog.js";
import { trustedHTML } from "../shared/trustedTypes.js";

const STYLE_URL = new URL("./CommercialControlCenter.css", import.meta.url).pathname;
const state = { overview: null, draft: null, validation: null, loading: false, controller: null, savedDocument: "", effectiveAt: "", selectedOffer: "", section: "commercial-offers", busy: false, publicCatalogState: "unavailable" };

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

function salesStatusPresentation(offer) {
  const active = offer.salesState === "sellable";
  return {
    label: active ? "Hoạt động" : "Không hoạt động",
    detail: active ? "Đang mở bán" : humanize(offer.salesState, { stopped: "Đã dừng bán", non_sellable: "Không bán" }),
    tone: active ? "success" : "neutral",
  };
}

function landingStatusPresentation(offer) {
  const publicOffer = (state.publicOffers || []).some((item) => item.code === offer.code);
  const intendedPublic = offer.salesState === "sellable" && offer.display?.visibility !== "hidden";
  if (publicOffer && intendedPublic) return { label: "Đang hiển thị", detail: "Có trong catalog công khai", tone: "success" };
  if (publicOffer) return { label: "Đang hiển thị", detail: "Sẽ ẩn sau khi xuất bản", tone: "warning" };
  if (!intendedPublic) {
    return {
      label: "Không hiển thị",
      detail: offer.display?.visibility === "hidden" ? "Đang đặt là Ẩn" : "Gói không hoạt động",
      tone: "neutral",
    };
  }
  if (state.publicCatalogState === "off") return { label: "Không hiển thị", detail: "Thương mại đang tắt", tone: "warning" };
  return {
    label: "Chờ xuất bản",
    detail: state.publicCatalogState === "unavailable" ? "Chưa xác minh được landing" : "Sẽ hiển thị khi bản phát hành có hiệu lực",
    tone: "warning",
  };
}

function offerStatusContent(presentation) {
  return `<span class="commercial-badge" data-tone="${presentation.tone}">${escapeHtml(presentation.label)}</span><small>${escapeHtml(presentation.detail)}</small>`;
}

function offerStatusMarkup(presentation, dataAttribute) {
  return `<div ${dataAttribute}>${offerStatusContent(presentation)}</div>`;
}

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
  document.getElementById("commercial-action-bar")?.remove();
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
      <label>Hiệu lực từ <input id="commercial-effective-at" class="form-control" type="datetime-local" value="${escapeHtml(state.effectiveAt)}"></label>
      <div class="commercial-toolbar-buttons">
        <button type="button" class="btn btn-outline" id="commercial-save" ${state.draft ? "" : "disabled"}>Lưu bản nháp</button>
        <button type="button" class="btn btn-outline" id="commercial-validate" ${state.draft ? "" : "disabled"}>Kiểm tra bản đã lưu</button>
        <button type="button" class="btn btn-primary" id="commercial-publish" ${state.validation?.errors?.length === 0 ? "" : "disabled"}>Xuất bản…</button>
      </div>
    </div>
    <p class="commercial-callout">Bản nháp là phiên bản cấu hình đang được chuẩn bị. Bạn có thể lưu và kiểm tra nhiều lần; chỉ khi kiểm tra đạt và bấm “Xuất bản” thì cấu hình mới trở thành bản phát hành áp dụng.</p>
    ${(overview.readinessWarnings || []).map((warning) => `<p class="commercial-callout commercial-callout--warning"><strong>Điều kiện sẵn sàng:</strong> ${escapeHtml(warning)}</p>`).join("")}
    <p class="commercial-callout">${escapeHtml(state.publicStatus || "Catalog công khai: chưa xác minh.")} <a href="/" target="_blank" rel="noopener">Mở landing ↗</a></p>
  `);
}

function renderOffers() {
  const policyDocument = state.draft?.document;
  if (!policyDocument) {
    html(document.getElementById("commercial-offers-content"), '<p class="commercial-empty">Chưa có bản nháp. Bấm “Tạo bản nháp” để bắt đầu; cấu hình đang áp dụng chưa thay đổi.</p>');
    return;
  }
  const offerRows = policyDocument.offers.map((offer, index) => {
    const salesStatus = salesStatusPresentation(offer);
    const landingStatus = landingStatusPresentation(offer);
    const editorId = `commercial-offer-editor-${index}`;
    const offerName = offer.display?.name || offer.tier;
    const period = offer.display?.periodLabel || humanize(offer.price?.period, { yearly: "/ năm", monthly: "/ tháng", one_time: "Một lần" });
    return `
      <tr data-commercial-offer-row="${escapeHtml(offer.code)}">
        <td data-label="Thứ tự"><strong class="commercial-order-index">${index + 1}</strong></td>
        <td data-label="Tên gói"><strong data-offer-name>${escapeHtml(offerName)}</strong><small>${escapeHtml(offer.code)}</small></td>
        <td data-label="Giá" class="commercial-offer-price" data-offer-price>${money(offer.price.total)}</td>
        <td data-label="Thời gian" data-offer-period>${escapeHtml(period)}</td>
        <td data-label="Đối tượng"><span>${humanize(offer.ownerKind, { account: "Cá nhân", organization: "Tổ chức" })}</span><small>${offer.variant === "connected" ? "Kết nối" : "Nội bộ"}</small></td>
        <td data-label="Tình trạng">${offerStatusMarkup(salesStatus, "data-offer-status")}</td>
        <td data-label="Hiển thị landing">${offerStatusMarkup(landingStatus, "data-offer-landing")}</td>
        <td data-label="Đề xuất"><span data-offer-recommended>${offer.display?.recommended ? "Có" : "Không"}</span></td>
        <td data-label="Chỉnh sửa" class="commercial-offer-action"><button type="button" class="btn btn-outline" data-commercial-offer-edit="${escapeHtml(offer.code)}" aria-expanded="${state.selectedOffer === offer.code}" aria-controls="${editorId}"><i data-lucide="pencil" aria-hidden="true"></i><span>Chỉnh sửa</span></button></td>
      </tr>
      <tr id="${editorId}" class="commercial-offer-editor-row" data-commercial-offer-editor-row="${escapeHtml(offer.code)}" ${state.selectedOffer === offer.code ? "" : "hidden"}>
        <td colspan="9"><div class="commercial-offer-body">${offerEditor(offer, index, state.validation?.errors)}
        <div class="commercial-offer-order"><span>Thứ tự toàn danh mục</span><button type="button" class="btn btn-outline" data-offer-code="${escapeHtml(offer.code)}" data-offer-move="up" ${index === 0 ? "disabled" : ""}>Đưa lên</button><button type="button" class="btn btn-outline" data-offer-code="${escapeHtml(offer.code)}" data-offer-move="down" ${index === policyDocument.offers.length - 1 ? "disabled" : ""}>Đưa xuống</button></div></div></td>
      </tr>`;
  }).join("");
  html(document.getElementById("commercial-offers-content"), `
    <div class="commercial-landing-guide" aria-labelledby="commercial-landing-guide-title">
      <strong id="commercial-landing-guide-title">Để gói xuất hiện trên landing</strong>
      <ol><li>Đặt <b>Tình trạng</b> thành “Hoạt động”.</li><li>Đặt <b>Hiển thị</b> thành “Công khai”.</li><li>Bấm <b>Lưu bản nháp</b>, <b>Kiểm tra bản đã lưu</b>, rồi <b>Xuất bản</b>.</li></ol>
      <p>Chỉnh bản nháp chưa làm landing thay đổi. Bảng dưới đây phân biệt cấu hình đang sửa với catalog công khai hiện tại.</p>
    </div>
    <label class="commercial-search-label">Tìm gói<input id="commercial-offer-search" type="search" class="form-control" placeholder="Tên gói hoặc mã gói"></label>
    <div class="commercial-filter-row">
      <label>Đối tượng<select id="commercial-owner-filter" class="form-control" data-no-custom="true"><option value="">Tất cả</option><option value="account">Cá nhân</option><option value="organization">Tổ chức</option></select></label>
      <label>Biến thể<select id="commercial-variant-filter" class="form-control" data-no-custom="true"><option value="">Tất cả</option><option value="internal">Nội bộ</option><option value="connected">Kết nối</option></select></label>
      <label>Hiển thị dự kiến<select id="commercial-visibility-filter" class="form-control" data-no-custom="true"><option value="">Tất cả</option><option value="public">Công khai</option><option value="hidden">Ẩn khỏi catalog</option></select></label>
    </div>
    <details class="commercial-public-preview"><summary>Gói trong catalog công khai đã xác minh</summary><p>Đây là dữ liệu đọc từ API public, không phải các thay đổi trong bản nháp.</p><div class="commercial-public-grid">${(state.publicOffers || []).map(offer => `<div>${offerPreview(offer, { publicCatalog: true })}</div>`).join('') || '<p>Chưa có gói công khai được xác minh. Xem trạng thái catalog ở trên.</p>'}</div></details>
    <div class="commercial-table-wrap"><table class="data-table commercial-offer-table"><caption class="sr-only">Danh sách gói dịch vụ trong bản nháp thương mại</caption><thead><tr><th>Thứ tự</th><th>Tên gói</th><th>Giá</th><th>Thời gian</th><th>Đối tượng</th><th>Tình trạng</th><th>Hiển thị landing</th><th>Đề xuất</th><th>Chỉnh sửa</th></tr></thead><tbody>${offerRows}</tbody></table></div>
    <p id="commercial-search-empty" hidden>Không có gói khớp tìm kiếm.</p>
    <p class="commercial-callout">Thêm, xóa hoặc đổi định danh offer cần quyết định sản phẩm; các trường của gói hiện có được giữ nguyên.</p>
  `);
  html(document.getElementById("commercial-credit-content"), `
    <div class="commercial-credit-packs">${policyDocument.creditPacks.map((pack, index) => `<label><span>${Number(pack.quantity).toLocaleString("vi-VN")} lượt</span><input class="form-control" type="text" inputmode="numeric" data-pack-index="${index}" value="${integerInput(pack.price)}"><small>${escapeHtml(pack.code)}</small></label>`).join("")}</div>
  `);
  const hint = document.getElementById("commercial-offer-count");
  if (hint) hint.textContent = `${policyDocument.offers.length} gói · ${policyDocument.creditPacks.length} gói lượt mua thêm`;
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
    ${state.overview?.currentRelease ? '<button type="button" class="btn btn-outline" id="commercial-clone-release">Tạo bản nháp từ bản đang hiệu lực</button> <button type="button" class="btn btn-danger" id="commercial-stop-sales">Dừng bán toàn bản phát hành</button>' : ""}
  `);
}

function bindDraftInputs() {
  const root = document.getElementById("tab-commercial-admin");
  root?.querySelectorAll("[data-offer-code][data-field]").forEach((input) => input.addEventListener("change", () => {
    const offer = state.draft.document.offers.find((item) => item.code === input.dataset.offerCode);
    if (!offer) return;
    const field = input.dataset.field;
    const numericField = ["memberQuota", "price.total", "includedProcurementQuota", "display.order"].includes(field);
    let value = numericField ? parseIntegerInput(input.value) : input.value;
    const minimum = field === "memberQuota" ? 1 : 0;
    if (numericField && (value === null || value < minimum)) {
      input.setCustomValidity(`Giá trị phải là số nguyên từ ${minimum.toLocaleString("vi-VN")} trở lên.`);
      input.reportValidity();
      const previous = field === "price.total"
        ? offer.price.total
        : field === "display.order"
          ? offer.display?.order ?? 0
          : offer[field];
      input.value = integerInput(previous);
      return;
    }
    input.setCustomValidity("");
    if (numericField) input.value = integerInput(value);
    if (field === "price.total") {
      offer.price.total = value;
      offer.price.subtotal = value;
      offer.price.tax = 0;
    } else if (field.startsWith("display.")) {
      offer.display ||= {};
      const displayField = field.slice("display.".length);
      if (displayField === "recommended") value = input.checked;
      if (displayField === "benefits") {
        value = input.value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
      }
      offer.display[displayField] = value;
    } else offer[field] = value;
    state.validation = null;
    markDraftChanged();
  }));
  root?.querySelectorAll("[data-offer-code][data-offer-move]").forEach((button) => button.addEventListener("click", () => {
    const offers = state.draft.document.offers;
    const sourceIndex = offers.findIndex((offer) => offer.code === button.dataset.offerCode);
    const targetIndex = sourceIndex + (button.dataset.offerMove === "up" ? -1 : 1);
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= offers.length) return;
    [offers[sourceIndex], offers[targetIndex]] = [offers[targetIndex], offers[sourceIndex]];
    offers.forEach((offer, index) => {
      offer.display ||= {};
      offer.display.order = index;
    });
    state.validation = null;
    renderAll(state.controller);
    markDraftChanged();
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
    input.value = integerInput(value);
    state.validation = null;
    markDraftChanged();
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
    markDraftChanged();
  }));
}

function isDirty() {
  return Boolean(state.draft && JSON.stringify(state.draft.document) !== state.savedDocument);
}

function validationReady() {
  return Boolean(state.validation?.validationDigest && state.validation.errors?.length === 0
    && (!state.validation.readinessExpiresAt || state.validation.readinessExpiresAt >= Date.now() / 1000));
}

function updateActions() {
  const dirty = isDirty();
  const disabled = state.busy || state.loading;
  const save = document.getElementById("commercial-save");
  const validate = document.getElementById("commercial-validate");
  const publish = document.getElementById("commercial-publish");
  if (save) save.disabled = disabled || !state.draft;
  if (validate) validate.disabled = disabled || !state.draft || dirty;
  if (publish) publish.disabled = disabled || dirty || !validationReady();
  document.querySelectorAll("#commercial-refresh, #commercial-create-draft, #commercial-clone-release, #commercial-stop-sales").forEach(button => { button.disabled = disabled; });
  const filtered = ["commercial-offer-search", "commercial-owner-filter", "commercial-variant-filter", "commercial-visibility-filter"].some(id => document.getElementById(id)?.value);
  document.querySelectorAll("[data-offer-move]").forEach(button => {
    const offers = state.draft?.document.offers || [];
    const index = offers.findIndex(offer => offer.code === button.dataset.offerCode);
    button.disabled = disabled || filtered || (button.dataset.offerMove === "up" ? index <= 0 : index >= offers.length - 1);
  });
  document.querySelectorAll("#tab-commercial-admin input, #tab-commercial-admin select, #tab-commercial-admin textarea").forEach(input => { input.disabled = disabled; });
  const notice = document.getElementById("commercial-draft-notice");
  if (notice) notice.textContent = dirty ? "Chưa lưu · Lưu bản nháp trước khi kiểm tra. Landing chưa thay đổi." : state.draft ? "Đang xem bản nháp đã lưu · Chỉ xuất bản mới áp dụng cho khách hàng." : "Chưa có bản nháp · Tạo bản nháp để bắt đầu.";
  const validationNote = document.getElementById("commercial-validation-note");
  if (validationNote) {
    const errors = state.validation?.errors || [];
    validationNote.hidden = !errors.length;
    validationNote.textContent = errors.length ? `${errors.length} lỗi cần xử lý. Mở “Chính sách” để xem chi tiết; lỗi thông tin gói nằm dưới trường tương ứng.` : "";
  }
  const review = document.getElementById("commercial-change-review");
  if (review && state.draft) {
    const changes = describeOfferChanges(JSON.parse(state.reviewBase || state.savedDocument), state.draft.document);
    html(review, `<summary>Thay đổi so với lúc mở bản nháp (${changes.length})</summary><ul>${changes.map(change => `<li>${escapeHtml(change)}</li>`).join("") || '<li>Chưa có thay đổi trong lần chỉnh sửa này. Xuất bản sẽ áp dụng toàn bộ bản nháp đã lưu.</li>'}</ul>`);
  }
}

function markDraftChanged() {
  updateActions();
  state.draft?.document.offers.forEach(offer => {
    const item = [...document.querySelectorAll("[data-commercial-offer-row]")].find(node => node.dataset.commercialOfferRow === offer.code);
    if (!item) return;
    const editorRow = [...document.querySelectorAll("[data-commercial-offer-editor-row]")].find(node => node.dataset.commercialOfferEditorRow === offer.code);
    const preview = editorRow?.querySelector("[data-commercial-preview]");
    html(preview, offerPreview(offer));
    const heading = item.querySelector("[data-offer-name]");
    if (heading) heading.textContent = offer.display?.name || offer.tier;
    const price = item.querySelector("[data-offer-price]");
    if (price) price.textContent = money(offer.price.total);
    const period = item.querySelector("[data-offer-period]");
    if (period) period.textContent = offer.display?.periodLabel || humanize(offer.price?.period, { yearly: "/ năm", monthly: "/ tháng", one_time: "Một lần" });
    html(item.querySelector("[data-offer-status]"), offerStatusContent(salesStatusPresentation(offer)));
    html(item.querySelector("[data-offer-landing]"), offerStatusContent(landingStatusPresentation(offer)));
    const recommended = item.querySelector("[data-offer-recommended]");
    if (recommended) recommended.textContent = offer.display?.recommended ? "Có" : "Không";
  });
}

function showSection(section) {
  state.section = section;
  document.querySelectorAll("[data-commercial-section]").forEach(button => {
    const active = button.dataset.commercialSection === section;
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll(".commercial-panel").forEach(panel => {
    panel.hidden = !["commercial-release", section].includes(panel.id);
  });
}

async function confirmDiscard(controller) {
  return !isDirty() || Boolean(await controller.view.customConfirm("Bỏ thay đổi chưa lưu?", "Bản nháp trên máy chủ được giữ nguyên. Chỉ phần bạn chưa lưu sẽ bị bỏ.", "alert-triangle"));
}

function bindEditorNavigation() {
  document.querySelectorAll("[data-commercial-section]").forEach(button => {
    button.onclick = () => showSection(button.dataset.commercialSection);
  });
  document.querySelectorAll("[data-commercial-offer-edit]").forEach(button => {
    button.addEventListener("click", () => {
      const code = button.dataset.commercialOfferEdit;
      const willOpen = state.selectedOffer !== code;
      state.selectedOffer = willOpen ? code : "";
      document.querySelectorAll("[data-commercial-offer-edit]").forEach(other => {
        other.setAttribute("aria-expanded", String(willOpen && other.dataset.commercialOfferEdit === code));
      });
      document.querySelectorAll("[data-commercial-offer-editor-row]").forEach(row => {
        row.hidden = !(willOpen && row.dataset.commercialOfferEditorRow === code);
      });
    });
  });
  const search = document.getElementById("commercial-offer-search");
  const applyFilters = () => {
    const query = search.value.trim().toLocaleLowerCase("vi");
    const owner = document.getElementById("commercial-owner-filter").value;
    const variant = document.getElementById("commercial-variant-filter").value;
    const visibility = document.getElementById("commercial-visibility-filter").value;
    let visible = 0;
    document.querySelectorAll("[data-commercial-offer-row]").forEach(item => {
      const offer = state.draft.document.offers.find(value => value.code === item.dataset.commercialOfferRow);
      const matches = (item.textContent.toLocaleLowerCase("vi").includes(query)
        || item.dataset.commercialOfferRow.toLocaleLowerCase("vi").includes(query))
        && (!owner || offer.ownerKind === owner) && (!variant || offer.variant === variant)
        && (!visibility || (offer.display?.visibility || "public") === visibility);
      item.hidden = !matches;
      const editor = [...document.querySelectorAll("[data-commercial-offer-editor-row]")].find(row => row.dataset.commercialOfferEditorRow === item.dataset.commercialOfferRow);
      if (editor) editor.hidden = !matches || state.selectedOffer !== item.dataset.commercialOfferRow;
      if (matches) visible++;
    });
    document.getElementById("commercial-search-empty").hidden = visible > 0;
    document.querySelectorAll("[data-offer-move]").forEach(button => {
      const index = state.draft.document.offers.findIndex(offer => offer.code === button.dataset.offerCode);
      button.disabled = Boolean(query || owner || variant || visibility) || (button.dataset.offerMove === "up" ? index === 0 : index === state.draft.document.offers.length - 1);
    });
  };
  if (search) search.oninput = applyFilters;
  for (const id of ["commercial-owner-filter", "commercial-variant-filter", "commercial-visibility-filter"]) {
    const input = document.getElementById(id);
    if (input) input.onchange = applyFilters;
  }
  const effective = document.getElementById("commercial-effective-at");
  if (effective) effective.oninput = () => { state.effectiveAt = effective.value; };
  showSection(state.section);
  updateActions();
}

function renderAll(controller) {
  renderOverview();
  renderOffers();
  renderPolicies();
  renderProviders();
  renderOrdersAndHistory();
  const toolbar = document.querySelector(".commercial-release-toolbar");
  if (toolbar) {
    toolbar.id = "commercial-action-bar";
    document.getElementById("tab-commercial-admin").append(toolbar);
  }
  controller?.view?.createIconsScoped(document.getElementById("tab-commercial-admin"));
  bindEvents(controller);
  bindDraftInputs();
  bindEditorNavigation();
  document.querySelectorAll(".commercial-order-action").forEach((button) => button.addEventListener("click", () => runOrderAction(button.dataset.action, button.dataset.order, controller)));
}

async function runOrderAction(action, publicId, controller) {
  if (state.busy || !await confirmDiscard(controller)) return;
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
  const nextDraft = id ? await jsonRequest(`/api/commercial/drafts/${encodeURIComponent(id)}`) : null;
  if (state.draft?.id !== nextDraft?.id) {
    state.selectedOffer = "";
    state.effectiveAt = "";
    state.reviewBase = nextDraft ? JSON.stringify(nextDraft.document) : "";
  }
  state.draft = nextDraft;
  state.savedDocument = state.draft ? JSON.stringify(state.draft.document) : "";
  state.validation = state.draft?.validation
    ? { ...state.draft.validation, validationDigest: state.draft.validationDigest, readinessExpiresAt: state.draft.readinessExpiresAt }
    : null;
}

async function refresh(controller, preferredDraftId = "") {
  if (state.loading) return;
  state.loading = true;
  updateActions();
    setStatus("Đang đồng bộ trung tâm quản trị thương mại…");
  try {
    state.overview = await jsonRequest("/api/commercial/admin/overview");
    try {
      const response = classifyPublicCommercialResponse(await jsonRequest("/api/public/commercial/offers"));
      state.publicOffers = response.catalog?.offers || [];
      state.publicCatalogState = response.state;
      state.publicStatus = response.state === "off" ? "Catalog công khai đang tắt (kiểm tra cấu hình runtime/trial)."
        : response.catalog ? `Catalog công khai: ${response.catalog.offers.length} gói · bản ${response.catalog.releaseId}. Hiển thị không đồng nghĩa thanh toán đã sẵn sàng.`
          : "Catalog công khai: chưa xác minh được phản hồi.";
    } catch { state.publicOffers = []; state.publicCatalogState = "unavailable"; state.publicStatus = "Catalog công khai: chưa xác minh được. Bản nháp vẫn có thể chỉnh sửa."; }
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
    updateActions();
  }
}

async function mutate(controller, operation, successMessage) {
  if (state.busy) return;
  state.busy = true;
  updateActions();
  try {
    const result = await operation();
    await refresh(controller, result?.id || result?.draftId || state.draft?.id);
    setStatus(successMessage, "success");
  } catch (error) {
    setStatus(`${error.code}: ${error.message}`, "danger");
    // Preserve local edits on a revision conflict; never silently refresh them away.
  } finally {
    state.busy = false;
    updateActions();
  }
}

function bindEvents(controller) {
  const byId = (id) => document.getElementById(id);
  state.events?.abort();
  state.events = new AbortController();
  const eventOptions = { signal: state.events.signal };
  byId("commercial-refresh")?.addEventListener("click", async () => { if (await confirmDiscard(controller)) await refresh(controller); }, eventOptions);
  byId("commercial-create-draft")?.addEventListener("click", async () => { if (!await confirmDiscard(controller)) return; await mutate(controller,
    () => jsonRequest("/api/commercial/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    "Đã tạo bản nháp mới."
  ); }, eventOptions);
  byId("commercial-draft-select")?.addEventListener("change", async (event) => { if (await confirmDiscard(controller)) await refresh(controller, event.target.value); else event.target.value = state.draft?.id || ""; }, eventOptions);
  byId("commercial-save")?.addEventListener("click", () => mutate(controller,
    () => jsonRequest(`/api/commercial/drafts/${encodeURIComponent(state.draft.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "If-Match": `"${state.draft.revision}"` }, body: JSON.stringify({ expectedRevision: state.draft.revision, document: state.draft.document }) }),
    "Đã lưu bản nháp; validation cũ đã hết hiệu lực."
  ), eventOptions);
  byId("commercial-validate")?.addEventListener("click", async () => {
    if (state.busy || isDirty()) return;
    state.busy = true;
    updateActions();
    try {
      state.validation = await jsonRequest(`/api/commercial/drafts/${encodeURIComponent(state.draft.id)}/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: state.draft.revision }) });
      const firstOfferError = state.validation.errors?.find(error => /^offers\[\d+\]/u.test(error.path || ""));
      if (firstOfferError) {
        const index = Number(firstOfferError.path.match(/^offers\[(\d+)\]/u)[1]);
        state.selectedOffer = state.draft.document.offers[index]?.code || "";
        state.section = "commercial-offers";
      } else if (state.validation.errors?.length) state.section = "commercial-policies";
      renderAll(controller);
      setStatus(state.validation.errors.length ? "Kiểm tra còn lỗi cần xử lý." : "Kiểm tra đạt; có thể xuất bản khi đủ điều kiện.", state.validation.errors.length ? "danger" : "success");
    } catch (error) { setStatus(`${error.code}: ${error.message}`, "danger"); }
    finally { state.busy = false; updateActions(); }
  }, eventOptions);
  byId("commercial-publish")?.addEventListener("click", async () => {
    if (isDirty() || state.busy || !validationReady()) { updateActions(); setStatus("Lưu và kiểm tra lại bản nháp trước khi xuất bản.", "warning"); return; }
    const draftId = state.draft.id;
    const revision = state.draft.revision;
    const digest = state.validation.validationDigest;
    const local = state.effectiveAt;
    const configuredAt = local ? Math.floor(new Date(local).getTime() / 1000) : null;
    if (local && !Number.isFinite(configuredAt)) { setStatus("Thời điểm hiệu lực không hợp lệ.", "danger"); return; }
    state.busy = true;
    updateActions();
    try {
      const summary = state.draft.document.offers.map(offer => `${offer.display?.name || offer.code}: ${money(offer.price.total)} · ${offer.salesState === "sellable" ? "Đang bán" : "Không mở bán"} · ${offer.display?.visibility === "hidden" ? "Ẩn khỏi catalog" : "Công khai"}`).join("\n");
      const reason = await controller.view.customPrompt("Kiểm tra cấu hình trước khi xuất bản", `${summary}\n\nHiệu lực: ${configuredAt ? dateTime(configuredAt) : "Ngay sau khi xác nhận"}. Xuất bản toàn bộ bản nháp, gồm chính sách và quyền lợi. Nhập lý do; hệ thống vẫn yêu cầu xác thực lại theo quy định.`, "", "Lý do xuất bản");
      if (!reason) return;
      await jsonRequest(`/api/commercial/drafts/${encodeURIComponent(draftId)}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, validationDigest: digest, effectiveAt: configuredAt ?? Math.floor(Date.now() / 1000), reason }) });
      await refresh(controller);
      setStatus(configuredAt && configuredAt > Date.now() / 1000 ? "Đã lên lịch. Landing chỉ thay đổi khi bản phát hành có hiệu lực." : "Đã xuất bản. Kiểm tra catalog công khai và landing để xác nhận hiển thị.", "success");
    } catch (error) { setStatus(`${error.code}: ${error.message}`, "danger"); }
    finally { state.busy = false; updateActions(); }
  }, eventOptions);
  byId("commercial-clone-release")?.addEventListener("click", async () => { if (!await confirmDiscard(controller)) return; await mutate(controller,
    () => jsonRequest(`/api/commercial/releases/${encodeURIComponent(state.overview.currentRelease.id)}/clone`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    "Đã tạo bản nháp mới từ bản đang hiệu lực."
  ); }, eventOptions);
  byId("commercial-stop-sales")?.addEventListener("click", async () => {
    if (!await confirmDiscard(controller)) return;
    const reason = await controller.view.customPrompt("Dừng bán bản phát hành", "Quyền lợi đã áp dụng không thay đổi. Nhập lý do dừng các giao dịch mới.", "", "Lý do dừng bán");
    if (!reason) return;
    await mutate(controller, () => jsonRequest(`/api/commercial/releases/${encodeURIComponent(state.overview.currentRelease.id)}/stop-sales`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, scope: { kind: "global" } }) }), "Đã ghi sự kiện dừng bán.");
  }, eventOptions);
}

export async function mountCommercialControlCenter(controller) {
  const sameController = state.controller === controller;
  state.controller = controller;
  await loadStyleOnce(STYLE_URL);
  if (!state.unloadGuardInstalled) {
    window.addEventListener("beforeunload", event => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    });
    state.unloadGuardInstalled = true;
  }
  if (sameController && isDirty()) { renderAll(controller); return; }
  await refresh(controller);
}
