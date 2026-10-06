import {
  getAdminJson,
  patchAdminJson,
  postAdminJson,
  requiresPrivilegedReauthentication,
} from "./AdminApi.js";
import {
  adminLoadingMarkup,
  adminStateMarkup,
  renderAdminFailure,
  renderAdminMarkup,
} from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { requestAdminValue } from "./AdminBilling.js";
import {
  classifyPublicCommercialResponse,
  formatCommercialMoney,
  presentCommercialOffer,
} from "../commercial-policy/PublicCommercialCatalog.js";
import {
  addAdminServicePackage,
  bindPackageManager,
  calculateAdminVat,
  configureAdminExportMapping,
  packageCreatorMarkup,
  packageManagerMarkup,
  packagePreviewMarkup,
  PACKAGE_TIERS,
} from "./AdminServicePackages.js";

function text(value, fallback = "N/A") {
  const normalized = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return escapeHtml(normalized || fallback);
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const source = typeof value === "number" ? value * 1_000 : value;
  const date = new Date(source);
  return Number.isNaN(date.valueOf()) ? text(value) : escapeHtml(date.toLocaleString("vi-VN"));
}

function formatInteger(value) {
  return Number.isSafeInteger(value) ? escapeHtml(value.toLocaleString("vi-VN")) : "N/A";
}

function releaseCard(title, release, actions = "") {
  if (!release) {
    return `<section class="card h-100 bf-admin-release-card is-empty" aria-label="${escapeHtml(title)}"><div class="card-body"><div class="bf-admin-release-heading"><span class="bf-admin-release-dot" aria-hidden="true"></span><div><h3 class="card-title mb-1">${escapeHtml(title)}</h3><p class="text-secondary small mb-0">Chưa có bản phát hành</p></div></div>${adminStateMarkup("empty", { message: "Chưa có bản phát hành ở trạng thái này." })}</div></section>`;
  }
  const sellable = release.nonSellable === true ? "Không bán" : (release.nonSellable === false ? "Có thể bán" : "N/A");
  const statusClass = release.nonSellable === true ? "is-stopped" : (release.nonSellable === false ? "is-live" : "is-unknown");
  return `<section class="card h-100 bf-admin-release-card ${statusClass}" aria-label="${escapeHtml(title)}"><div class="card-header"><div class="bf-admin-release-heading"><span class="bf-admin-release-dot" aria-hidden="true"></span><div><h3 class="card-title mb-1">${escapeHtml(title)}</h3><p class="text-secondary small mb-0">${text(release.mode)} · ${text(release.scopeKey)}</p></div></div>${actions ? `<div class="card-actions">${actions}</div>` : ""}</div><div class="card-body"><div class="bf-admin-release-version"><span class="text-secondary small">Phiên bản</span><strong>${text(release.versionLabel)}</strong></div><dl class="bf-admin-release-facts"><div><dt>Tình trạng bán</dt><dd><span class="badge ${release.nonSellable === true ? "bg-secondary-lt" : "bg-success-lt"}">${sellable}</span></dd></div><div><dt>Hiệu lực</dt><dd>${formatDate(release.effectiveFrom)}</dd></div></dl></div></section>`;
}

function workflowGuideMarkup({ draftOpen = false, dirty = false, validated = false } = {}) {
  const activeStep = dirty || draftOpen ? (validated ? 3 : 2) : 1;
  const step = (number, title, description) => `<div class="bf-admin-workflow-step${activeStep === number ? " is-active" : ""}${activeStep > number ? " is-complete" : ""}"><span>${activeStep > number ? "✓" : number}</span><div><strong>${title}</strong><small>${description}</small></div></div>`;
  return `<aside class="bf-admin-workflow-guide" aria-label="Quy trình quản lý gói">${step(1, "Xem gói đang bán", "Kiểm tra nội dung khách hàng đang thấy")}<div class="bf-admin-workflow-line" aria-hidden="true"></div>${step(2, "Chỉnh sửa bản nháp", dirty ? "Có thay đổi chưa lưu" : "Lưu thay đổi vào một phiên bản riêng")}<div class="bf-admin-workflow-line" aria-hidden="true"></div>${step(3, "Kiểm tra và xuất bản", validated ? "Đã kiểm tra, có thể xuất bản" : "Chỉ bản đã kiểm tra mới có thể phát hành")}</aside><nav class="nav nav-tabs bf-admin-plan-tabs" aria-label="Các khu vực quản lý gói"><a class="nav-link" href="#admin-plan-catalog-title">Danh mục hiện hành</a><a class="nav-link" href="#admin-plan-release-title">Bản nháp và xuất bản</a><a class="nav-link" href="#admin-plan-model-title">Mô hình quyền lợi</a><a class="nav-link" href="#admin-plan-history-title">Lịch sử</a></nav>`;
}

function draftTable(drafts) {
  if (!drafts.length) return adminStateMarkup("empty", { message: "Chưa có bản nháp chính sách thương mại đang mở." });
  const rows = drafts.map((draft) => `<tr><td><strong>${text(draft?.id)}</strong></td><td>${text(draft?.status)}</td><td class="text-end">${Number.isSafeInteger(draft?.revision) ? escapeHtml(draft.revision) : "N/A"}</td><td>${text(draft?.baseReleaseId ?? draft?.base_release_id)}</td><td>${formatDate(draft?.updatedAt ?? draft?.updated_at)}</td><td class="text-end"><button class="btn btn-sm btn-outline-primary" type="button" data-admin-draft-open="${text(draft?.id)}">Mở</button></td></tr>`).join("");
  return `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Bản nháp</th><th>Trạng thái</th><th class="text-end">Lần sửa</th><th>Phiên bản gốc</th><th>Cập nhật</th><th><span class="visually-hidden">Thao tác</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function releaseHistoryMarkup(releases) {
  if (!releases.length) return adminStateMarkup("empty", { message: "Chưa có lịch sử phát hành thương mại." });
  const rows = releases.map((release) => `<tr><td><strong>${text(release?.versionLabel)}</strong><div class="small text-secondary">${text(release?.id)}</div></td><td>${text(release?.mode)}</td><td>${text(release?.scopeKey)}</td><td>${formatDate(release?.effectiveFrom)}</td><td>${release?.nonSellable === true ? "Đã dừng bán" : (release?.nonSellable === false ? "Có thể bán" : "N/A")}</td><td>${text(release?.baseReleaseId)}</td><td>${formatDate(release?.createdAt)}</td></tr>`).join("");
  return `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Phiên bản</th><th>Chế độ</th><th>Phạm vi</th><th>Hiệu lực</th><th>Tình trạng bán</th><th>Phiên bản gốc</th><th>Được tạo</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function planModelMarkup() {
  return `<section class="card mt-3" aria-labelledby="admin-plan-model-title"><div class="card-header"><div><h3 class="card-title" id="admin-plan-model-title">Khả năng cấu hình gói hiện hành</h3><p class="text-secondary small mb-0">Chỉ những trường được commercial policy hiện tại xác thực mới có thể chỉnh sửa.</p></div></div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody><tr><th scope="row">Giá theo năm</th><td><span class="badge bg-success-lt">Được hỗ trợ</span></td></tr><tr><th scope="row">Giá theo tháng</th><td><span class="badge bg-success-lt">Được hỗ trợ</span> · nhập giá và kỳ hạn trong bản nháp</td></tr><tr><th scope="row">Số ngày dùng thử</th><td>N/A · chưa có hợp đồng thương mại</td></tr><tr><th scope="row">Hạn mức lưu trữ</th><td>N/A · chưa có nguồn dữ liệu có thẩm quyền</td></tr><tr><th scope="row">Hạn mức tài liệu</th><td>N/A · hiện chỉ có quyền xuất tài liệu, không có quota</td></tr></tbody></table></div></section>`;
}

const CAPABILITY_LABELS = Object.freeze({
  "document.export.word": "Xuất Word",
  "document.export.excel": "Xuất Excel",
  "document.export.award_result_excel": "Xuất kết quả lựa chọn nhà thầu",
});

function offerRightsMarkup(offer, presented) {
  const explicitBenefits = presented.benefits.map((benefit) => `<li>${text(benefit)}</li>`).join("");
  const capabilities = offer?.exportCapabilities && typeof offer.exportCapabilities === "object"
    ? Object.entries(CAPABILITY_LABELS).map(([key, label]) => `<li>${escapeHtml(label)}: <strong>${offer.exportCapabilities[key] === true ? "Có" : "Không"}</strong></li>`).join("")
    : "";
  const structured = [
    Number.isSafeInteger(offer?.memberQuota) ? `<li>Hạn mức thành viên: <strong>${formatInteger(offer.memberQuota)}</strong></li>` : "",
    Number.isSafeInteger(offer?.includedProcurementQuota) ? `<li>Lượt Mua Sắm Công kèm theo: <strong>${formatInteger(offer.includedProcurementQuota)}</strong></li>` : "",
    typeof offer?.violationCheckEnabled === "boolean" ? `<li>Kiểm tra vi phạm nhà thầu: <strong>${offer.violationCheckEnabled ? "Có" : "Không"}</strong></li>` : "",
  ].filter(Boolean).join("");
  const items = `${explicitBenefits}${structured}${capabilities}`;
  return items ? `<ul class="bf-admin-plan-benefits mb-0">${items}</ul>` : '<p class="text-secondary mb-0">Chưa công bố mô tả quyền lợi.</p>';
}

function offerCard(offer) {
  const presented = presentCommercialOffer(offer);
  const salesState = ({ sellable: "Đang bán", stopped: "Đã dừng bán", non_sellable: "Không bán" })[offer?.salesState] || "N/A";
  const ownerKind = offer?.ownerKind === "account" ? "Cá nhân" : (offer?.ownerKind === "organization" ? "Tổ chức" : "N/A");
  return `<div class="col-md-6 col-xl-4"><article class="card h-100 bf-admin-plan-card${presented.recommended ? " is-recommended" : ""}" data-admin-offer-code="${text(presented.code, "")}"><div class="card-header"><div><div class="d-flex flex-wrap gap-2 mb-1"><span class="badge bg-primary-lt">${text(presented.variantLabel, offer?.variant)}</span>${presented.recommended ? '<span class="badge bg-success-lt">Được đề xuất</span>' : ""}</div><h4 class="card-title">${text(presented.name, presented.code)}</h4><div class="text-secondary small">${text(presented.code)}</div></div></div><div class="card-body"><div class="bf-admin-plan-price">${text(presented.priceLabel)} <small class="text-secondary fw-normal">${text(presented.periodLabel, "")}</small></div>${presented.description ? `<p class="text-secondary mt-2">${text(presented.description)}</p>` : ""}<div class="bf-admin-plan-meta my-3"><div><span class="text-secondary small d-block">Đối tượng</span><strong>${ownerKind}</strong></div><div><span class="text-secondary small d-block">Trạng thái bán</span><strong>${text(salesState)}</strong></div></div><h5>Quyền lợi</h5>${offerRightsMarkup(offer, presented)}</div></article></div>`;
}

function creditPackMarkup(packs, currency) {
  if (!packs.length) return "";
  const rows = packs.map((pack) => `<tr><td><strong>${text(pack?.code)}</strong></td><td class="text-end">${formatInteger(pack?.quantity)}</td><td class="text-end">${Number.isFinite(pack?.price) ? escapeHtml(formatCommercialMoney(pack.price, currency)) : "N/A"}</td></tr>`).join("");
  return `<section class="card mt-3" aria-labelledby="admin-credit-packs-title"><div class="card-header"><h3 class="card-title" id="admin-credit-packs-title">Gói lượt Mua Sắm Công</h3></div><div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Mã gói lượt</th><th class="text-end">Số lượt</th><th class="text-end">Giá</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function catalogMarkup(catalogPayload) {
  const classification = classifyPublicCommercialResponse(catalogPayload);
  if (classification.state === "unavailable") {
    return adminStateMarkup("error", { title: "Không thể đọc danh mục gói", message: "Dữ liệu danh mục hiện hành không đúng định dạng." });
  }
  if (classification.state === "off") {
    return adminStateMarkup("empty", { title: "Danh mục đang tắt", message: "Chưa có gói dịch vụ được công bố để bán." });
  }
  const catalog = classification.catalog;
  const offers = Array.isArray(catalog?.offers) ? catalog.offers : [];
  const otherPeriods = offers.filter((offer) => !["monthly", "yearly"].includes(offer.price?.period));
  const packs = Array.isArray(catalog?.creditPacks) ? catalog.creditPacks : [];
  const offerContent = offers.length
    ? `${packageManagerMarkup({ offers }, { published: true, id: "published" })}${otherPeriods.length ? `<div class="row row-cards mt-3">${otherPeriods.map(offerCard).join("")}</div>` : ""}`
    : adminStateMarkup("empty", { message: "Release hiện hành chưa công bố gói dịch vụ." });
  return `<section aria-labelledby="admin-plan-catalog-title"><div class="d-flex flex-column flex-md-row align-items-md-end justify-content-between gap-2 mb-3"><div><h3 class="h2 mb-1" id="admin-plan-catalog-title">Danh mục gói đang công bố</h3><p class="text-secondary mb-0">Release <strong>${text(catalog?.releaseId)}</strong> · ${text(catalog?.currency)}</p></div><span class="badge bg-success-lt align-self-start">Dữ liệu hiện hành</span></div>${offerContent}${creditPackMarkup(packs, catalog?.currency)}</section>`;
}

function validationMarkup(validation) {
  if (!validation) return "";
  const errors = Array.isArray(validation.errors) ? validation.errors : [];
  const expired = validation.readinessExpiresAt && validation.readinessExpiresAt < Date.now() / 1_000;
  if (!errors.length && expired) return '<div class="alert alert-warning" role="status">Kết quả kiểm tra đã hết hạn. Hãy kiểm tra lại trước khi xuất bản.</div>';
  if (!errors.length) return '<div class="alert alert-success" role="status">Kiểm tra đạt. Bản nháp sẵn sàng để xuất bản trong thời hạn cho phép.</div>';
  const items = errors.map((error) => `<li><strong>${text(error?.path, "Dữ liệu")}</strong>: ${text(error?.message || error?.code, "Không hợp lệ")}</li>`).join("");
  return `<div class="alert alert-danger" role="alert"><div class="fw-bold mb-1">Còn ${errors.length} lỗi</div><ul class="mb-0">${items}</ul></div>`;
}

function validationReady(validation) {
  return Boolean(
    validation?.validationDigest
    && !(validation?.errors || []).length
    && (!validation.readinessExpiresAt || validation.readinessExpiresAt >= Date.now() / 1_000),
  );
}

function offerFieldId(index, name) {
  return `admin-offer-${index}-${String(name).replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "")}`;
}

function offerField(index, name, value, { type = "text", readonly = false, min = null } = {}) {
  const minAttribute = min === null ? "" : ` min="${escapeHtml(min)}"`;
  return `<input id="${offerFieldId(index, name)}" class="form-control" type="${escapeHtml(type)}" data-admin-offer-field="${escapeHtml(name)}" value="${escapeHtml(value ?? "")}"${readonly ? " readonly" : ""}${minAttribute} data-offer-index="${index}">`;
}

function offerSelect(index, name, value, options) {
  return `<select id="${offerFieldId(index, name)}" class="form-select" data-admin-offer-field="${escapeHtml(name)}" data-offer-index="${index}">${options.map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}"${value === optionValue ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function offerCheckbox(index, name, checked, label) {
  return `<label class="form-check" for="${offerFieldId(index, name)}"><input id="${offerFieldId(index, name)}" class="form-check-input" type="checkbox" data-admin-offer-field="${escapeHtml(name)}" data-offer-index="${index}"${checked ? " checked" : ""}><span class="form-check-label">${escapeHtml(label)}</span></label>`;
}

function offerEditorMarkup(offer, index) {
  const display = offer?.display && typeof offer.display === "object" ? offer.display : {};
  const price = offer?.price && typeof offer.price === "object" ? offer.price : {};
  const capabilities = offer?.exportCapabilities;
  const capabilityFields = capabilities === null
    ? `<div class="alert alert-warning mb-0" role="status">Quyền xuất chưa được cấu hình. Giá trị hiện có được giữ nguyên đến khi bạn xác nhận.<div class="mt-2"><button type="button" class="btn btn-sm btn-outline-primary" data-admin-plan-action="configure-exports" data-offer-index="${index}">Cấu hình quyền xuất</button></div></div>`
    : Object.entries(CAPABILITY_LABELS).map(([key, label]) => offerCheckbox(index, `capability:${key}`, capabilities?.[key] === true, label)).join("");
  return `<article class="card mb-3 bf-admin-offer-editor" data-admin-offer-editor data-offer-index="${index}"><div class="card-header"><div><div class="text-secondary small mb-1">Gói ${index + 1}</div><h4 class="card-title mb-1">${text(display.name, offer?.code)}</h4><div class="text-secondary small">${text(offer?.code)}</div></div><span class="badge bg-secondary-lt">${text(offer?.salesState, "N/A")}</span></div><div class="card-body"><section class="bf-admin-editor-group" aria-labelledby="admin-offer-identity-${index}"><h5 id="admin-offer-identity-${index}">Thông tin hiển thị</h5><p class="text-secondary small">Tên, thứ tự và mô tả xuất hiện trong danh mục công khai.</p><div class="row g-3"><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "code")}">Mã gói</label>${offerField(index, "code", offer?.code, { readonly: true })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "display.name")}">Tên hiển thị</label>${offerField(index, "display.name", display.name)}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "display.order")}">Thứ tự hiển thị</label>${offerField(index, "display.order", display.order, { type: "number", min: 0 })}</div><div class="col-md-3"><label class="form-label" for="${offerFieldId(index, "tier")}">Hạng gói</label>${offerField(index, "tier", offer?.tier, { readonly: true })}</div><div class="col-md-3"><label class="form-label" for="${offerFieldId(index, "variant")}">Biến thể</label>${offerField(index, "variant", offer?.variant, { readonly: true })}</div><div class="col-md-3"><label class="form-label" for="${offerFieldId(index, "ownerKind")}">Chủ thể</label>${offerField(index, "ownerKind", offer?.ownerKind, { readonly: true })}</div><div class="col-md-3"><label class="form-label" for="${offerFieldId(index, "price.period")}">Chu kỳ</label>${offerField(index, "price.period", price.period, { readonly: true })}</div><div class="col-12"><label class="form-label" for="${offerFieldId(index, "display.description")}">Mô tả</label><textarea id="${offerFieldId(index, "display.description")}" class="form-control" rows="2" data-admin-offer-field="display.description" data-offer-index="${index}">${escapeHtml(display.description ?? "")}</textarea></div><div class="col-12"><label class="form-label" for="${offerFieldId(index, "display.benefits")}">Quyền lợi <span class="text-secondary fw-normal">(mỗi dòng một nội dung)</span></label><textarea id="${offerFieldId(index, "display.benefits")}" class="form-control" rows="3" data-admin-offer-field="display.benefits" data-offer-index="${index}">${escapeHtml(Array.isArray(display.benefits) ? display.benefits.join("\n") : "")}</textarea></div></div></section><section class="bf-admin-editor-group" aria-labelledby="admin-offer-commercial-${index}"><h5 id="admin-offer-commercial-${index}">Giá và hạn mức</h5><p class="text-secondary small">Các giá trị này được kiểm tra lại khi bấm “Kiểm tra”.</p><div class="row g-3"><div class="col-md-3"><label class="form-label" for="${offerFieldId(index, "price.subtotal")}">Giá trước thuế</label>${offerField(index, "price.subtotal", price.subtotal, { type: "number", min: 0 })}</div><div class="col-md-3"><label class="form-label" for="${offerFieldId(index, "price.tax")}">Thuế</label>${offerField(index, "price.tax", price.tax, { type: "number", min: 0 })}</div><div class="col-md-3"><label class="form-label" for="${offerFieldId(index, "price.total")}">Tổng tiền</label>${offerField(index, "price.total", price.total, { type: "number", min: 0 })}</div><div class="col-md-3"><label class="form-label" for="${offerFieldId(index, "price.currency")}">Tiền tệ</label>${offerField(index, "price.currency", price.currency, { readonly: true })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "memberQuota")}">Hạn mức thành viên</label>${offerField(index, "memberQuota", offer?.memberQuota, { type: "number", min: 1 })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "includedProcurementQuota")}">Lượt Mua Sắm Công</label>${offerField(index, "includedProcurementQuota", offer?.includedProcurementQuota, { type: "number", min: 0 })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "salesState")}">Trạng thái bán</label>${offerSelect(index, "salesState", offer?.salesState, [["sellable", "Đang bán"], ["stopped", "Đã dừng bán"], ["non_sellable", "Không bán"]])}</div><div class="col-md-6"><label class="form-label" for="${offerFieldId(index, "display.visibility")}">Phạm vi hiển thị</label>${offerSelect(index, "display.visibility", display.visibility ?? "", [["", "Theo cấu hình hiện có"], ["public", "Công khai"], ["hidden", "Ẩn"]])}</div></div></section><section class="bf-admin-editor-group" aria-labelledby="admin-offer-entitlements-${index}"><h5 id="admin-offer-entitlements-${index}">Quyền và tính năng</h5><div class="row g-3"><div class="col-md-6"><label class="form-label d-block">Quyền xuất</label><div class="bf-admin-check-grid">${capabilityFields}</div></div><div class="col-md-6"><label class="form-label d-block">Tùy chọn</label><div class="bf-admin-check-grid">${offerCheckbox(index, "violationCheckEnabled", offer?.violationCheckEnabled === true, "Kiểm tra vi phạm nhà thầu")}${offerCheckbox(index, "display.recommended", display.recommended === true, "Gói được đề xuất")}</div></div></div></section></div></article>`;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function addMonthlyOffer(documentValue, sourceIndex) {
  const next = cloneJson(documentValue);
  const source = next?.offers?.[sourceIndex];
  if (!source || source.price?.period !== "yearly") throw new TypeError("Chọn gói năm để thêm giá tháng.");
  if (next.offers.some((offer) => offer.tier === source.tier && offer.variant === source.variant && offer.price?.period === "monthly")) {
    throw new TypeError("Gói này đã có cấu hình giá tháng.");
  }
  const monthly = cloneJson(source);
  monthly.code = `${source.tier}.${source.variant}.monthly`;
  if (next.offers.some((offer) => offer.code === monthly.code)) throw new TypeError("Mã gói tháng đã tồn tại.");
  monthly.price = { ...monthly.price, period: "monthly", subtotal: null, tax: null, total: null };
  monthly.includedProcurementQuota = source.variant === "internal" ? 0 : null;
  monthly.salesState = "non_sellable";
  monthly.display = { ...monthly.display, benefits: [] };
  delete monthly.display.periodLabel;
  next.offers.push(monthly);
  next.policies ||= {};
  next.policies.monthlyBaseTerm ||= { kind: "blocked_decision", reason: "Chưa cấu hình số ngày hiệu lực gói tháng." };
  return next;
}

function monthlyConfigurationMarkup(documentValue) {
  const offers = Array.isArray(documentValue.offers) ? documentValue.offers : [];
  const candidates = offers.map((offer, index) => ({ offer, index })).filter(({ offer }) => offer.price?.period === "yearly"
    && !offers.some((item) => item.tier === offer.tier && item.variant === offer.variant && item.price?.period === "monthly"));
  const buttons = candidates.map(({ offer, index }) => `<button type="button" class="btn btn-outline-primary btn-sm" data-admin-plan-action="add-monthly" data-source-offer-index="${index}">Thêm giá tháng: ${text(offer.display?.name, offer.code)} · ${offer.variant === "internal" ? "Cơ bản" : "Nâng cao"}</button>`).join("");
  const hasMonthly = offers.some((offer) => offer.price?.period === "monthly");
  const term = documentValue.policies?.monthlyBaseTerm;
  return `<section class="bf-admin-editor-group" aria-labelledby="admin-monthly-pricing-title"><h5 id="admin-monthly-pricing-title">Cấu hình giá hàng tháng</h5><p class="text-secondary small">Thêm gói tháng khi cần, nhập giá, thuế và lượt Mua Sắm Công. Gói mới chưa được bán cho đến khi bạn bật trạng thái bán, lưu, kiểm tra và xuất bản.</p><div class="d-flex flex-wrap gap-2 mb-3">${buttons}</div>${hasMonthly ? `<label class="form-label" for="admin-monthly-term-days">Số ngày hiệu lực một kỳ tháng</label><input class="form-control" id="admin-monthly-term-days" type="number" min="1" max="3660" value="${text(term?.kind === "fixed_days" ? term.days : "", "")}"><p class="text-secondary small mt-2">Nhập số ngày theo chính sách bạn quyết định; giá tháng không được suy ra từ giá năm.</p>` : ""}</section>`;
}

function parseIntegerField(field, label, { optional = false, nullable = false } = {}) {
  const raw = String(field?.value ?? "").trim();
  if (nullable && raw === "") return null;
  if (optional && raw === "") return undefined;
  if (!/^(0|[1-9]\d*)$/u.test(raw)) {
    const error = new TypeError(`${label} phải là số nguyên không âm.`);
    error.field = field;
    throw error;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    const error = new TypeError(`${label} vượt quá giới hạn số nguyên an toàn.`);
    error.field = field;
    throw error;
  }
  return value;
}

export function serializeDraftDocument(root, originalDocument) {
  const incomplete = Boolean(root.querySelector?.("[data-admin-allow-incomplete]"));
  const advancedField = root.querySelector?.("#admin-plan-advanced-document");
  let advanced;
  try {
    advanced = JSON.parse(advancedField?.value || "");
  } catch {
    const error = new TypeError("JSON cấu hình nâng cao không hợp lệ.");
    error.field = advancedField;
    throw error;
  }
  if (!advanced || Array.isArray(advanced) || typeof advanced !== "object") {
    const error = new TypeError("Cấu hình nâng cao phải là một object JSON.");
    error.field = advancedField;
    throw error;
  }
  delete advanced.offers;
  const monthlyDays = root.querySelector?.("#admin-monthly-term-days");
  if (monthlyDays && (monthlyDays.value !== "" || !incomplete)) {
    advanced.policies ||= {};
    advanced.policies.monthlyBaseTerm = {
      ...advanced.policies.monthlyBaseTerm,
      kind: "fixed_days",
      days: parseIntegerField(monthlyDays, "Số ngày hiệu lực gói tháng"),
    };
  } else if (monthlyDays) {
    advanced.policies ||= {};
    const term = advanced.policies.monthlyBaseTerm;
    if (term?.kind !== "blocked_decision") advanced.policies.monthlyBaseTerm = { ...term, kind: "blocked_decision", reason: "Chưa cấu hình số ngày hiệu lực gói tháng." };
  }
  const annualDays = root.querySelector?.("#admin-annual-term-days");
  if (annualDays) {
    advanced.policies ||= {};
    const term = advanced.policies.baseTerm;
    if (annualDays.value !== "") advanced.policies.baseTerm = { ...term, kind: "fixed_days", days: parseIntegerField(annualDays, "Số ngày hiệu lực gói năm") };
    else if (term?.kind !== "blocked_decision") advanced.policies.baseTerm = { ...term, kind: "blocked_decision", reason: "Chưa cấu hình số ngày hiệu lực gói năm." };
  }
  for (const field of root.querySelectorAll?.("[data-admin-policy-choice]") || []) {
    if (!field.value) continue;
    const key = field.dataset.adminPolicyChoice;
    advanced.policies ||= {};
    if (advanced.policies[key]?.kind === field.value) continue;
    advanced.policies[key] = { ...advanced.policies[key], kind: field.value };
    delete advanced.policies[key].reason;
  }
  const originalOffers = Array.isArray(originalDocument?.offers) ? originalDocument.offers : [];
  const editors = [...(root.querySelectorAll?.("[data-admin-offer-editor]") || [])];
  if (editors.length !== originalOffers.length) throw new TypeError("Danh sách gói không khớp tài liệu gốc.");
  const offers = editors.map((editor, index) => {
    const offer = cloneJson(originalOffers[index]);
    const field = (name) => editor.querySelector?.(`[data-admin-offer-field="${name}"]`);
    const display = offer.display && typeof offer.display === "object" ? offer.display : (offer.display = {});
    const price = offer.price && typeof offer.price === "object" ? offer.price : (offer.price = {});
    display.name = String(field("display.name")?.value ?? "");
    const description = String(field("display.description")?.value ?? "");
    if (description === "") delete display.description; else display.description = description;
    const order = parseIntegerField(field("display.order"), "Thứ tự hiển thị", { optional: true });
    if (order === undefined) delete display.order; else display.order = order;
    const recommended = Boolean(field("display.recommended")?.checked);
    if (Object.hasOwn(display, "recommended") || recommended) display.recommended = recommended;
    else delete display.recommended;
    const visibility = String(field("display.visibility")?.value ?? "");
    if (visibility === "") delete display.visibility; else display.visibility = visibility;
    const benefits = String(field("display.benefits")?.value ?? "").split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
    if (Object.hasOwn(display, "benefits") || benefits.length) display.benefits = benefits;
    else delete display.benefits;
    price.subtotal = parseIntegerField(field("price.subtotal"), "Giá trước thuế", { nullable: incomplete });
    price.tax = parseIntegerField(field("price.tax"), "Thuế", { nullable: incomplete });
    price.total = parseIntegerField(field("price.total"), "Tổng tiền", { nullable: incomplete });
    offer.memberQuota = parseIntegerField(field("memberQuota"), "Hạn mức thành viên", { nullable: incomplete });
    offer.includedProcurementQuota = parseIntegerField(field("includedProcurementQuota"), "Lượt Mua Sắm Công", { nullable: incomplete });
    offer.violationCheckEnabled = Boolean(field("violationCheckEnabled")?.checked);
    offer.salesState = String(field("salesState")?.value ?? "");
    if (offer.exportCapabilities !== null) {
      offer.exportCapabilities ||= {};
      for (const key of Object.keys(CAPABILITY_LABELS)) {
        offer.exportCapabilities[key] = Boolean(field(`capability:${key}`)?.checked);
      }
    }
    return offer;
  });
  return { ...advanced, offers };
}

export function draftEditorMarkup(draft, validation = null, { selectedIndex = 0, creator = false, sourceIndex = null } = {}) {
  if (!draft) return "";
  const documentValue = draft.document && typeof draft.document === "object" ? draft.document : {};
  const offers = Array.isArray(documentValue.offers) ? documentValue.offers : [];
  const advanced = cloneJson(documentValue) || {};
  delete advanced.offers;
  const policies = documentValue.policies || {};
  const policyChoice = (key, label, options) => `<div class="col-md-6"><label class="form-label" for="admin-policy-${key}">${label}</label><select class="form-select" id="admin-policy-${key}" data-admin-policy-choice="${key}"><option value="">Giữ chính sách hiện có${policies[key]?.kind === "blocked_decision" ? " · Chưa chốt" : ""}</option>${options.map(([value, caption]) => `<option value="${value}"${policies[key]?.kind === value ? " selected" : ""}>${caption}</option>`).join("")}</select></div>`;
  const terms = `<details class="bf-admin-package-policies mb-3"><summary>Chính sách chung & kỳ hạn</summary><div class="row g-3 mt-1">${["fixed_days", "blocked_decision", undefined].includes(policies.baseTerm?.kind) ? `<div class="col-md-6"><label class="form-label" for="admin-annual-term-days">Số ngày hiệu lực một kỳ năm</label><input class="form-control" id="admin-annual-term-days" type="number" min="1" max="3660" value="${text(policies.baseTerm?.kind === "fixed_days" ? policies.baseTerm.days : "", "")}"></div>` : '<div class="col-12 text-secondary">Kỳ năm giữ chính sách hiện có; xem cấu hình nâng cao để rà soát.</div>'}${policyChoice("renewalAnchor", "Khi gia hạn", [["start_new_term", "Bắt đầu kỳ mới"], ["end_of_term", "Từ cuối kỳ hiện tại"]])}${policyChoice("partialBatch", "Khi lượt không đủ cho toàn bộ danh sách", [["reject_all", "Từ chối toàn bộ"], ["process_affordable_in_stable_order", "Xử lý phần đủ lượt theo thứ tự ổn định"]])}</div>${monthlyConfigurationMarkup(documentValue)}</details>`;
  const panes = offers.map((offer, index) => `<div data-admin-package-pane="${index}"${selectedIndex === index ? "" : " hidden"}>${offerEditorMarkup(offer, index)}</div>`).join("");
  const selected = offers[selectedIndex];
  return `<section class="card bf-admin-editor-shell" id="admin-commercial-editor" data-draft-id="${text(draft.id)}" data-admin-allow-incomplete><div class="card-header"><div><div class="text-secondary small mb-1">Bản nháp thương mại · Lần sửa ${text(draft.revision)}</div><h3 class="card-title mb-1">Các gói đăng ký</h3><p class="text-secondary small mb-0">Thay đổi chưa có hiệu lực cho đến khi xuất bản. ${offers.length} giá theo kỳ.</p></div><button class="btn btn-primary" type="button" data-admin-plan-action="new-package">Tạo gói</button></div><div class="card-body"><div id="admin-plan-validation" class="bf-admin-validation-panel">${validationMarkup(validation)}</div><div data-admin-package-list${selected && !creator ? " hidden" : ""}>${packageManagerMarkup(documentValue)}<p class="text-secondary small mt-2">Khung năm hiện hành gồm 8 gói: Cá nhân/Bạc/Vàng/Kim cương × Cơ bản/Nâng cao. Giá tháng tùy chọn.</p></div>${creator ? packageCreatorMarkup(sourceIndex === null ? null : offers[sourceIndex]) : ""}<div data-admin-package-editor-zone${selected && !creator ? "" : " hidden"}><div class="d-flex align-items-center justify-content-between flex-wrap gap-2 my-3"><button class="btn btn-ghost-primary" type="button" data-admin-package-back>← Danh sách gói</button><div class="btn-group" aria-label="Phần cấu hình gói"><button type="button" class="btn btn-sm btn-primary" data-admin-package-step="0" aria-pressed="true">Thông tin hiển thị</button><button type="button" class="btn btn-sm btn-outline-primary" data-admin-package-step="1" aria-pressed="false">Giá và hạn mức</button><button type="button" class="btn btn-sm btn-outline-primary" data-admin-package-step="2" aria-pressed="false">Quyền và tính năng</button></div></div><div class="bf-admin-package-editor-grid"><div>${panes}</div><aside><h4 class="h3">Thẻ xem trước</h4><div data-admin-package-live-preview>${selected ? packagePreviewMarkup(documentValue, selectedIndex) : ""}</div></aside></div></div>${terms}<details class="bf-admin-advanced mt-4"><summary><span><strong>Cấu hình chính sách nâng cao</strong><small>Chỉ mở khi cần chỉnh phần chưa có biểu mẫu</small></span><span aria-hidden="true">⌄</span></summary><p class="text-secondary small mt-2">Các cấu hình khác được giữ nguyên khi chỉnh từng gói.</p><label class="form-label" for="admin-plan-advanced-document">Cấu hình chính sách nâng cao (JSON)</label><textarea class="form-control font-monospace" id="admin-plan-advanced-document" rows="14" spellcheck="false">${escapeHtml(JSON.stringify(advanced, null, 2))}</textarea><div class="invalid-feedback" id="admin-plan-json-error">JSON không hợp lệ.</div></details><div class="bf-admin-effective-date"><label class="form-label" for="admin-plan-effective">Thời điểm hiệu lực</label><input class="form-control" id="admin-plan-effective" type="datetime-local"><small class="text-secondary">Để trống để áp dụng ngay sau khi xuất bản. Gói đã mua giữ điều kiện cũ.</small></div></div><div class="card-footer bf-admin-editor-actions"><div><button class="btn btn-primary" type="button" data-admin-plan-action="save">Lưu bản nháp</button><button class="btn btn-outline-primary" type="button" data-admin-plan-action="validate">Kiểm tra</button></div><div><button class="btn btn-primary" type="button" data-admin-plan-action="publish"${validationReady(validation) ? "" : " disabled"}>Rà soát và xuất bản</button><button class="btn btn-ghost-secondary" type="button" data-admin-plan-action="close">Đóng</button></div></div></section>`;
}

export function plansMarkup(payload, { editor = "", catalog = null, catalogError = null, dirty = false, validated = false } = {}) {
  const current = payload?.currentRelease || null;
  const scheduled = payload?.scheduledRelease || null;
  const drafts = Array.isArray(payload?.drafts) ? payload.drafts : [];
  const releaseHistory = Array.isArray(payload?.releaseHistory) ? payload.releaseHistory : [];
  const empty = !current && !scheduled && drafts.length === 0;
  const currentActions = current
    ? `<button class="btn btn-sm btn-outline-primary" type="button" data-admin-plan-action="clone" data-release-id="${text(current.id)}">Nhân bản</button> <button class="btn btn-sm btn-outline-danger" type="button" data-admin-plan-action="stop-sales" data-release-id="${text(current.id)}"${current.nonSellable ? " disabled" : ""}>Dừng bán</button>`
    : "";
  const releaseManagement = empty ? adminStateMarkup("empty", { message: "Chưa có phiên bản gói dịch vụ hoặc bản nháp thương mại." }) : `<div class="row row-cards"><div class="col-lg-6">${releaseCard("Bản đang hiệu lực", current, currentActions)}</div><div class="col-lg-6">${releaseCard("Bản đã lên lịch", scheduled)}</div><div class="col-12"><section class="card" aria-labelledby="commercial-drafts-title"><div class="card-header"><div><h3 class="card-title" id="commercial-drafts-title">Bản nháp thương mại</h3><p class="text-secondary small mb-0">Mở bản nháp để quản lý gói theo nhóm và kỳ thanh toán.</p></div></div>${draftTable(drafts)}</section></div></div>`;
  const history = `<section class="card mt-3" aria-labelledby="commercial-release-history-title"><div class="card-header"><div><h3 class="card-title" id="commercial-release-history-title">Lịch sử phát hành thương mại</h3><p class="text-secondary small mb-0">Tối đa 20 bản gần nhất từ kho phát hành bất biến.</p></div></div>${releaseHistoryMarkup(releaseHistory)}</section>`;
  const initial = !current && !scheduled;
  const catalogNotice = catalogError
    ? adminStateMarkup(catalogError.code === "COMMERCIAL_POLICY_DECISION_REQUIRED" ? "empty" : "error", {
      title: catalogError.code === "COMMERCIAL_POLICY_DECISION_REQUIRED" ? "Chưa có bảng giá đang mở bán" : "Chưa tải được bảng giá công khai",
      message: "Bạn vẫn có thể tạo và quản lý gói nháp ở bên dưới. " + catalogError.message,
    }) : "";
  return `<div class="admin-plans-page"><header class="bf-admin-page-intro"><div><p class="page-pretitle mb-1">Thương mại</p><h2 class="h1 mb-2">Gói dịch vụ</h2><p class="text-secondary mb-0">Quản lý giá tháng, giá năm và quyền lợi trước khi phát hành.</p></div><div class="d-flex gap-2 flex-wrap">${initial ? '<button class="btn btn-outline-primary" type="button" data-admin-plan-action="create-template">Tạo bộ 8 gói mẫu</button>' : ""}<button class="btn btn-primary" type="button" data-admin-plan-action="create"${initial ? ' data-admin-create-mode="empty"' : ""}>${initial ? "Tạo gói đầu tiên" : "Tạo gói"}</button></div></header>
    ${workflowGuideMarkup({ draftOpen: Boolean(editor), dirty, validated })}
    <div id="admin-plan-status" aria-live="polite"></div>
    ${editor ? `<div class="bf-admin-page-section">${editor}</div>` : ""}
    <section aria-labelledby="admin-plan-catalog-title" class="bf-admin-page-section"><div class="bf-admin-section-heading"><div><h3 id="admin-plan-catalog-title" class="h2 mb-1">1. Gói đang bán</h3><p class="text-secondary small mb-0">Dữ liệu khách hàng đang thấy.</p></div></div>${catalogNotice || (catalog ? catalogMarkup(catalog) : adminStateMarkup("empty", { title: "Chưa có bảng giá đang mở bán", message: "Tạo gói đầu tiên hoặc bộ 8 gói mẫu để cấu hình." }))}</section>
    <section aria-labelledby="admin-plan-release-title" class="bf-admin-page-section"><div class="bf-admin-section-heading"><div><h3 id="admin-plan-release-title" class="h2 mb-1">2. Phiên bản và xuất bản</h3><p class="text-secondary small mb-0">Lưu bản nháp, kiểm tra rồi phát hành toàn bộ bảng giá.</p></div></div>${releaseManagement}</section>
    <section aria-labelledby="admin-plan-model-title" class="bf-admin-page-section"><div class="bf-admin-section-heading"><div><h3 id="admin-plan-model-title" class="h2 mb-1">3. Mô hình quyền lợi</h3><p class="text-secondary small mb-0">Các khả năng cấu hình được hỗ trợ hiện hành.</p></div></div>${planModelMarkup()}</section>
    <section aria-labelledby="admin-plan-history-title" class="bf-admin-page-section"><div class="bf-admin-section-heading"><div><h3 id="admin-plan-history-title" class="h2 mb-1">Lịch sử phát hành</h3><p class="text-secondary small mb-0">Tra cứu tối đa 20 phiên bản gần nhất.</p></div></div>${history}</section></div>`;
}

function mutationKey(action) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return `admin-plan-${action}-${suffix}`;
}

export async function requestPlanActionInput(action, { requestValue = requestAdminValue, summary = "" } = {}) {
  if (action === "clone") {
    const confirmed = await requestValue({
      title: "Nhân bản bản phát hành",
      message: "Tạo bản nháp mới từ bản đang hiệu lực?",
      label: null,
      confirmLabel: "Nhân bản",
    });
    return confirmed !== null;
  }
  if (action === "stop-sales") {
    const reason = await requestValue({
      title: "Dừng bán bản phát hành",
      message: "Dừng giao dịch mới của bản phát hành này? Quyền lợi đã áp dụng không thay đổi.",
      label: "Lý do dừng bán (bắt buộc)",
      confirmLabel: "Dừng bán",
    });
    return reason === null ? null : String(reason).trim() || null;
  }
  if (action === "publish") {
    const reason = await requestValue({
      title: "Xuất bản gói dịch vụ",
      message: `Xuất bản toàn bộ bản nháp này?${summary ? ` ${summary}` : ""}`,
      label: "Lý do xuất bản (bắt buộc)",
      confirmLabel: "Xuất bản",
    });
    return reason === null ? null : String(reason).trim() || null;
  }
  return null;
}

async function runWithStepUp(operation, { fetchImpl, signal, requestValue = requestAdminValue } = {}) {
  try {
    return await operation();
  } catch (error) {
    if (!requiresPrivilegedReauthentication(error)) throw error;
    const password = await requestValue({
      title: "Xác thực thao tác quản trị",
      message: "Nhập lại mật khẩu để tiếp tục thao tác nhạy cảm.",
      label: "Mật khẩu",
      type: "password",
      autocomplete: "current-password",
      confirmLabel: "Xác thực",
    });
    if (!password) throw error;
    await postAdminJson("/api/auth/privileged-reauth", {
      body: { password }, fetchImpl, signal, retries: 0,
    });
    return operation();
  }
}

function setStatus(container, message, tone = "success") {
  const node = container.querySelector?.("#admin-plan-status");
  const safeTone = tone === "danger" ? "danger" : "success";
  if (node) node.innerHTML = trustedHTML(`<div class="alert alert-${safeTone}" role="status">${escapeHtml(message)}</div>`);
}

export async function renderAdminPlans(container, { fetchImpl, signal } = {}) {
  let overview = null;
  let catalog = null;
  let catalogError = null;
  let draft = null;
  let workingDocument = null;
  let validation = null;
  let dirty = false;
  let busy = false;
  let draftOpenController = null;
  let draftOpenSequence = 0;
  let selectedIndex = 0;
  let creatorOpen = false;
  let creatorDirty = false;
  let creationSource = null;
  let packageStep = 0;
  const managerStates = { draft: { group: "internal", layout: "table" }, published: { group: "internal", layout: "table" } };

  const discardMessage = "Thay đổi chưa lưu sẽ bị bỏ. Bạn có muốn rời khỏi trình chỉnh sửa?";
  const beforeNavigate = (event) => {
    if (!(dirty || creatorDirty) || globalThis.confirm?.(discardMessage) !== false) return;
    event.preventDefault();
  };
  const beforeUnload = (event) => {
    if (!(dirty || creatorDirty)) return;
    event.preventDefault();
    event.returnValue = discardMessage;
  };
  globalThis.addEventListener?.("admin:before-navigate", beforeNavigate);
  globalThis.addEventListener?.("beforeunload", beforeUnload);
  signal?.addEventListener?.("abort", () => {
    draftOpenController?.abort();
    globalThis.removeEventListener?.("admin:before-navigate", beforeNavigate);
    globalThis.removeEventListener?.("beforeunload", beforeUnload);
  }, { once: true });

  const render = () => {
    renderAdminMarkup(container, plansMarkup(overview, {
      editor: draftEditorMarkup(draft && workingDocument ? { ...draft, document: workingDocument } : draft, validation, { selectedIndex, creator: creatorOpen, sourceIndex: creationSource }),
      catalog,
      catalogError,
      draftOpen: Boolean(draft),
      dirty,
      validated: Boolean(validationReady(validation) && !dirty),
    }));
    bind();
    if (dirty || creatorDirty) container.querySelectorAll?.('[data-admin-plan-action="publish"], [data-admin-plan-action="validate"]').forEach(node => { node.disabled = true; });
  };
  const refresh = async ({ keepDraft = false } = {}) => {
    const results = await Promise.allSettled([
      getAdminJson("/api/commercial/admin/overview", { fetchImpl, signal }),
      getAdminJson("/api/public/commercial/offers", { fetchImpl, signal }),
    ]);
    if (results[0].status === "rejected") throw results[0].reason;
    overview = results[0].value;
    if (results[1].status === "rejected") {
      if ([401, 403].includes(results[1].reason?.status) || signal?.aborted) throw results[1].reason;
      catalog = null; catalogError = results[1].reason;
    } else { catalog = results[1].value; catalogError = null; }
    if (!keepDraft) { draft = null; workingDocument = null; validation = null; dirty = false; creatorDirty = false; }
    render();
  };
  const execute = async (action, operation, success, { keepDraft = false } = {}) => {
    if (busy) return;
    busy = true;
    container.querySelectorAll?.("button, textarea, input, select").forEach((node) => { node.disabled = true; });
    try {
      const result = await runWithStepUp(operation, { fetchImpl, signal });
      if (signal?.aborted) return;
      if (result?.document) { draft = result; workingDocument = cloneJson(result.document); dirty = false; }
      try {
        await refresh({ keepDraft: keepDraft || Boolean(result?.document) });
        setStatus(container, success);
      } catch (refreshError) {
        render();
        setStatus(container, `${success} Chưa tải lại được tổng quan: ${refreshError?.message || "lỗi kết nối"}.`, "danger");
      }
    } catch (error) {
      if (!signal?.aborted) setStatus(container, error?.message || "Không thể hoàn tất thao tác.", "danger");
      render();
      setStatus(container, error?.message || "Không thể hoàn tất thao tác.", "danger");
    } finally {
      busy = false;
    }
  };
  const readDocument = () => {
    try {
      const documentValue = serializeDraftDocument(container, workingDocument || draft?.document);
      container.querySelectorAll?.(".is-invalid").forEach((field) => field.classList.remove("is-invalid"));
      return documentValue;
    } catch (error) {
      error?.field?.classList?.add("is-invalid");
      setStatus(container, error?.message || "Dữ liệu bản nháp không hợp lệ.", "danger");
      return null;
    }
  };
  const bind = () => {
    container.querySelectorAll?.("[data-admin-offer-editor]").forEach(editor => {
      const index = Number(editor.dataset.offerIndex);
      const offer = workingDocument?.offers?.[index];
      const badge = editor.querySelector(".card-header > .badge");
      if (badge && offer) badge.textContent = ({ sellable: "Đang bán", stopped: "Đã dừng bán", non_sellable: "Chưa mở bán" })[offer.salesState] || offer.salesState;
      if (offer) {
        const labels = { tier: PACKAGE_TIERS[offer.tier] || offer.tier, variant: ({ internal: "Cơ bản", connected: "Nâng cao" })[offer.variant] || offer.variant, ownerKind: offer.ownerKind === "account" ? "Cá nhân" : offer.ownerKind === "organization" ? "Tổ chức" : offer.ownerKind, "price.period": offer.price?.period === "monthly" ? "Hàng tháng" : "Hàng năm" };
        for (const [name, value] of Object.entries(labels)) {
          const input = editor.querySelector(`[data-admin-offer-field="${name}"]`); if (input) input.value = value;
        }
      }
      const priceGroup = editor.querySelectorAll(".bf-admin-editor-group")[1];
      if (!priceGroup) return;
      const calculator = globalThis.document?.createElement?.("div");
      if (!calculator) return;
      calculator.className = "row g-2 align-items-end mt-3";
      calculator.innerHTML = trustedHTML(`<div class="col-md-5"><label class="form-label" for="admin-offer-vat-${index}">Tính thuế VAT (%)</label><input class="form-control" id="admin-offer-vat-${index}" type="text" inputmode="decimal" placeholder="Nhập tỷ lệ để tính thuế"></div><div class="col-md-7"><button type="button" class="btn btn-outline-primary" data-admin-vat-calculate="${index}">Tính thuế và tổng tiền</button></div>`);
      priceGroup.append(calculator);
      calculator.querySelector("button").addEventListener("click", () => {
        if (busy) return;
        try {
          const amounts = calculateAdminVat(editor.querySelector('[data-admin-offer-field="price.subtotal"]').value, calculator.querySelector("input").value.trim());
          for (const key of ["tax", "total"]) {
            const input = editor.querySelector(`[data-admin-offer-field="price.${key}"]`); input.value = amounts[key]; input.dispatchEvent(new Event("input", { bubbles: true }));
          }
        } catch (error) { setStatus(container, error.message, "danger"); }
      });
    });
    container.querySelectorAll?.("[data-admin-package-manager]").forEach(manager => {
      const id = manager.dataset.adminPackageManager;
      const documentValue = id === "published" ? catalog : workingDocument;
      if (documentValue) bindPackageManager(manager, documentValue, { ...managerStates[id], onState: state => { managerStates[id] = state; } });
    });
    const showPackage = (index) => {
      if (index !== null && !workingDocument?.offers?.[index]) return;
      selectedIndex = index;
      const zone = container.querySelector?.("[data-admin-package-editor-zone]");
      const list = container.querySelector?.("[data-admin-package-list]");
      if (zone) zone.hidden = index === null;
      if (list) list.hidden = index !== null;
      container.querySelectorAll?.("[data-admin-package-pane]").forEach(pane => {
        pane.hidden = Number(pane.dataset.adminPackagePane) !== index;
        pane.querySelectorAll(".bf-admin-editor-group").forEach((group, step) => { group.hidden = step !== packageStep; });
      });
      container.querySelectorAll?.("[data-admin-package-step]").forEach(button => {
        const pressed = Number(button.dataset.adminPackageStep) === packageStep;
        button.setAttribute("aria-pressed", String(pressed)); button.classList.toggle("btn-primary", pressed); button.classList.toggle("btn-outline-primary", !pressed);
      });
      const preview = container.querySelector?.("[data-admin-package-live-preview]");
      if (preview) preview.innerHTML = trustedHTML(packagePreviewMarkup(workingDocument, index));
    };
    container.querySelectorAll?.("[data-admin-package-edit]").forEach(button => button.addEventListener("click", () => {
      if (creatorDirty && globalThis.confirm?.(discardMessage) === false) return;
      const documentValue = readDocument(); if (!documentValue) return;
      workingDocument = documentValue; packageStep = 0; creatorOpen = false; creatorDirty = false; selectedIndex = Number(button.dataset.adminPackageEdit); render();
    }));
    container.querySelector?.("[data-admin-package-back]")?.addEventListener("click", () => {
      const documentValue = readDocument(); if (!documentValue) return;
      workingDocument = documentValue; selectedIndex = null; render();
    });
    container.querySelectorAll?.("[data-admin-package-step]").forEach(button => button.addEventListener("click", () => {
      const documentValue = readDocument(); if (!documentValue) return;
      workingDocument = documentValue; packageStep = Number(button.dataset.adminPackageStep); showPackage(selectedIndex);
    }));
    container.querySelector?.("[data-admin-package-live-preview]")?.addEventListener("click", event => {
      const button = event.target.closest?.("[data-admin-package-period]");
      if (!button || button.disabled) return;
      const documentValue = readDocument(); if (!documentValue) return;
      workingDocument = documentValue; showPackage(Number(button.dataset.adminPackagePeriod));
    });
    container.querySelectorAll?.("[data-admin-package-copy]").forEach(button => button.addEventListener("click", () => {
      if (creatorDirty && globalThis.confirm?.(discardMessage) === false) return;
      const documentValue = readDocument(); if (!documentValue) return;
      workingDocument = documentValue; creationSource = Number(button.dataset.adminPackageCopy); creatorOpen = true; creatorDirty = false; render();
    }));
    container.querySelectorAll?.("[data-admin-package-edit-code]").forEach(button => button.addEventListener("click", async () => {
      if (busy || ((dirty || creatorDirty) && globalThis.confirm?.(discardMessage) === false)) return;
      const code = button.dataset.adminPackageEditCode;
      creatorOpen = false; creatorDirty = false; creationSource = null;
      await execute("edit-package", () => postAdminJson("/api/commercial/drafts", { body: { baseReleaseId: catalog.releaseId }, idempotencyKey: mutationKey("edit-package"), fetchImpl, signal, retries: 0 }), "Gói đã được sao chép vào bản nháp để chỉnh sửa.", { keepDraft: true });
      if (workingDocument) { selectedIndex = workingDocument.offers.findIndex(offer => offer.code === code); render(); }
    }));
    if (draft && !creatorOpen) showPackage(selectedIndex);
    container.querySelectorAll?.("[data-admin-draft-open]").forEach((button) => {
      button.addEventListener("click", async () => {
        if ((dirty || creatorDirty) && !globalThis.confirm("Thay đổi chưa lưu sẽ bị bỏ. Mở bản nháp khác?")) return;
        draftOpenController?.abort();
        const openController = new AbortController();
        draftOpenController = openController;
        const openSequence = ++draftOpenSequence;
        const cancelOpen = () => openController.abort(signal?.reason);
        if (signal?.aborted) cancelOpen();
        else signal?.addEventListener?.("abort", cancelOpen, { once: true });
        try {
          const loadedDraft = await getAdminJson(`/api/commercial/drafts/${encodeURIComponent(button.dataset.adminDraftOpen)}`, { fetchImpl, signal: openController.signal });
          if (openSequence !== draftOpenSequence || openController.signal.aborted) return;
          draft = loadedDraft;
          workingDocument = cloneJson(draft.document);
          dirty = false;
          validation = draft.validation ? { ...draft.validation, validationDigest: draft.validationDigest, readinessExpiresAt: draft.readinessExpiresAt } : null;
          selectedIndex = workingDocument.offers?.length === 1 ? 0 : null;
          creatorOpen = false; creatorDirty = false; creationSource = null; packageStep = 0;
          render();
          container.querySelector?.("#admin-commercial-editor")?.scrollIntoView?.({ block: "start" });
        } catch (error) {
          if (!openController.signal.aborted && openSequence === draftOpenSequence) setStatus(container, error.message, "danger");
        } finally {
          signal?.removeEventListener?.("abort", cancelOpen);
        }
      });
    });
    container.querySelectorAll?.("[data-admin-plan-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.adminPlanAction;
        if (busy) return;
        if (action === "close") {
          if ((dirty || creatorDirty) && !globalThis.confirm("Thay đổi chưa lưu sẽ bị bỏ. Đóng bản nháp?")) return;
          draft = null; workingDocument = null; validation = null; dirty = false; creatorDirty = false; render(); return;
        }
        if (action === "create" || action === "create-template") {
          if ((dirty || creatorDirty) && globalThis.confirm?.("Thay đổi chưa lưu sẽ bị bỏ. Tạo bản nháp mới?") === false) return;
          const key = mutationKey(action);
          creatorOpen = action === "create";
          creatorDirty = false;
          creationSource = null; selectedIndex = null;
          const body = action === "create-template" ? { templateMode: "blank_templates" } : button.dataset.adminCreateMode === "empty" ? { templateMode: "empty" } : {};
          await execute(action, () => postAdminJson("/api/commercial/drafts", { body, idempotencyKey: key, fetchImpl, signal, retries: 0 }), "Đã tạo bản nháp mới.", { keepDraft: true });
          return;
        }
        if (action === "clone") {
          if ((dirty || creatorDirty) && globalThis.confirm?.("Thay đổi chưa lưu sẽ bị bỏ. Nhân bản bản phát hành?") === false) return;
          if (!await requestPlanActionInput(action)) return;
          creatorOpen = false; creatorDirty = false; creationSource = null; selectedIndex = null;
          const key = mutationKey(action);
          await execute(action, () => postAdminJson(`/api/commercial/releases/${encodeURIComponent(button.dataset.releaseId)}/clone`, { body: {}, idempotencyKey: key, fetchImpl, signal, retries: 0 }), "Đã tạo bản nháp từ bản đang hiệu lực.", { keepDraft: true });
          return;
        }
        if (action === "stop-sales") {
          const reason = await requestPlanActionInput(action);
          if (!reason) return;
          const key = mutationKey(action);
          await execute(action, () => postAdminJson(`/api/commercial/releases/${encodeURIComponent(button.dataset.releaseId)}/stop-sales`, { body: { reason, scope: { kind: "global" } }, idempotencyKey: key, fetchImpl, signal, retries: 0 }), "Đã ghi sự kiện dừng bán.");
          return;
        }
        if (!draft) return;
        if (action === "new-package" || action === "cancel-package") {
          if (creatorDirty && action === "new-package" && globalThis.confirm?.(discardMessage) === false) return;
          const documentValue = readDocument(); if (!documentValue) return;
          workingDocument = documentValue; creatorOpen = action === "new-package"; creatorDirty = false; creationSource = null; selectedIndex = null; render(); return;
        }
        if (action === "confirm-package") {
          const documentValue = readDocument(); if (!documentValue) return;
          try {
            const periods = [container.querySelector("#admin-new-package-year").checked ? "yearly" : null, container.querySelector("#admin-new-package-month").checked ? "monthly" : null].filter(Boolean);
            workingDocument = addAdminServicePackage(documentValue, { tier: container.querySelector("#admin-new-package-tier").value, variant: container.querySelector("#admin-new-package-variant").value, name: container.querySelector("#admin-new-package-name").value, periods, sourceIndex: creationSource });
            selectedIndex = documentValue.offers.length; creatorOpen = false; creatorDirty = false; creationSource = null; packageStep = 0; dirty = true; validation = null; render();
            setStatus(container, "Đã thêm gói vào nội dung chưa lưu. Nhập giá và quyền lợi, rồi lưu bản nháp.");
          } catch (error) { setStatus(container, error.message, "danger"); }
          return;
        }
        if (action === "configure-exports") {
          const documentValue = readDocument(); if (!documentValue) return;
          const accepted = await requestAdminValue({ title: "Cấu hình quyền xuất của gói", message: "Chọn lại quyền xuất cho gói trong bản nháp? Ban đầu các quyền sẽ chưa được chọn. Quyền của gói đã mua không thay đổi.", label: null, confirmLabel: "Cấu hình" });
          if (accepted === null || signal?.aborted) return;
          const currentDocument = readDocument(); if (!currentDocument) return;
          workingDocument = configureAdminExportMapping(currentDocument, Number(button.dataset.offerIndex)); dirty = true; validation = null; render(); return;
        }
        if (action === "add-monthly") {
          const documentValue = readDocument();
          if (!documentValue) return;
          try {
            workingDocument = addMonthlyOffer(documentValue, Number(button.dataset.sourceOfferIndex));
            selectedIndex = workingDocument.offers.length - 1; creatorOpen = false;
            validation = null;
            dirty = true;
            render();
            container.querySelectorAll?.('[data-admin-plan-action="publish"], [data-admin-plan-action="validate"]').forEach((node) => { node.disabled = true; });
            setStatus(container, "Đã thêm gói tháng vào bản nháp. Nhập đầy đủ giá, thuế, hạn mức và số ngày hiệu lực trước khi lưu.");
          } catch (error) { setStatus(container, error.message, "danger"); }
          return;
        }
        if (action === "save") {
          if (creatorDirty) { setStatus(container, "Thêm gói vào bản nháp hoặc hủy biểu mẫu tạo gói trước khi lưu.", "danger"); return; }
          const documentValue = readDocument();
          if (!documentValue) return;
          workingDocument = documentValue;
          const revision = draft.revision;
          const key = mutationKey(action);
          validation = null;
          await execute(action, () => patchAdminJson(`/api/commercial/drafts/${encodeURIComponent(draft.id)}`, { body: { expectedRevision: revision, document: documentValue }, expectedRevision: revision, idempotencyKey: key, fetchImpl, signal }), "Đã lưu bản nháp.", { keepDraft: true });
          return;
        }
        if (action === "validate") {
          if (dirty || creatorDirty) {
            setStatus(container, "Bản nháp có thay đổi chưa lưu. Hãy lưu trước khi kiểm tra.", "danger");
            return;
          }
          const key = mutationKey(action);
          const draftId = draft.id;
          const revision = draft.revision;
          try {
            const result = await runWithStepUp(() => postAdminJson(`/api/commercial/drafts/${encodeURIComponent(draftId)}/validate`, { body: { expectedRevision: revision }, idempotencyKey: key, fetchImpl, signal, retries: 0 }), { fetchImpl, signal });
            if (dirty || creatorDirty || draft?.id !== draftId || draft?.revision !== revision || signal?.aborted) return;
            validation = result;
            render();
            setStatus(container, validation.errors?.length ? "Kiểm tra còn lỗi cần xử lý." : "Kiểm tra đạt.", validation.errors?.length ? "danger" : "success");
          } catch (error) { setStatus(container, error.message, "danger"); }
          return;
        }
        if (action === "publish") {
          if (dirty || creatorDirty) {
            setStatus(container, "Bản nháp có thay đổi chưa lưu. Hãy lưu trước khi xuất bản.", "danger");
            return;
          }
          if (!validationReady(validation)) return;
          const rows = workingDocument.offers.map(offer => `${offer.display?.name || offer.code} · ${offer.variant === "internal" ? "Cơ bản" : "Nâng cao"} · ${offer.price.period === "monthly" ? "tháng" : "năm"}: ${formatCommercialMoney(offer.price.total, offer.price.currency)} (${({ sellable: "đang bán", stopped: "dừng bán", non_sellable: "chưa mở bán" })[offer.salesState] || offer.salesState}).`);
          const reason = await requestPlanActionInput(action, { summary: `${rows.join(" ")} Gói đã mua giữ điều kiện cũ.` });
          if (!reason) return;
          if (dirty || creatorDirty || !validationReady(validation)) return;
          const local = container.querySelector?.("#admin-plan-effective")?.value || "";
          const effectiveAt = local ? Math.floor(new Date(local).getTime() / 1000) : Math.floor(Date.now() / 1000);
          if (!Number.isFinite(effectiveAt)) { setStatus(container, "Thời điểm hiệu lực không hợp lệ.", "danger"); return; }
          const key = mutationKey(action);
          await execute(action, () => postAdminJson(`/api/commercial/drafts/${encodeURIComponent(draft.id)}/publish`, { body: { expectedRevision: draft.revision, validationDigest: validation.validationDigest, effectiveAt, reason }, idempotencyKey: key, fetchImpl, signal, retries: 0 }), "Đã xuất bản bản nháp.");
        }
      });
    });
    container.querySelectorAll?.("[data-admin-offer-field], #admin-plan-advanced-document, #admin-monthly-term-days, #admin-annual-term-days, [data-admin-policy-choice]").forEach((field) => {
      const markDirty = () => {
        dirty = true;
        validation = null;
        const status = container.querySelector?.("#admin-plan-status");
        if (status) status.innerHTML = trustedHTML('<div class="alert alert-warning" role="status">Có thay đổi chưa lưu. Hãy lưu bản nháp trước khi kiểm tra hoặc xuất bản.</div>');
        container.querySelectorAll?.('[data-admin-plan-action="publish"], [data-admin-plan-action="validate"]').forEach((button) => { button.disabled = true; });
        if (field.matches?.("[data-admin-offer-field]") && selectedIndex !== null) {
          const candidate = cloneJson(workingDocument);
          const offer = candidate?.offers?.[selectedIndex];
          if (offer) {
            const pane = container.querySelector(`[data-admin-package-pane="${selectedIndex}"]`);
            pane.querySelectorAll("[data-admin-offer-field]").forEach(input => {
              const key = input.dataset.adminOfferField;
              if (input.readOnly) return;
              if (key.startsWith("capability:")) { if (offer.exportCapabilities) offer.exportCapabilities[key.slice(11)] = input.checked; return; }
              const value = input.type === "checkbox" ? input.checked : input.type === "number" ? (/^(0|[1-9]\d*)$/u.test(input.value) ? Number(input.value) : null) : input.value;
              if (key.startsWith("display.")) offer.display[key.slice(8)] = key === "display.benefits" ? input.value.split(/\r?\n/u).filter(Boolean) : value;
              else if (key.startsWith("price.")) offer.price[key.slice(6)] = value;
              else offer[key] = value;
            });
            container.querySelector("[data-admin-package-live-preview]").innerHTML = trustedHTML(packagePreviewMarkup(candidate, selectedIndex));
          }
        }
      };
      field.addEventListener("input", markDirty);
      field.addEventListener("change", markDirty);
    });
  };

  // Keep the draft guard attached to the stable route host. The editor is
  // re-rendered after opening a draft and after every action, so listeners on
  // individual fields can otherwise be lost between renders.
  const markStableEditorDirty = (event) => {
    if (event.target?.closest?.("[data-admin-package-creator]")) {
      creatorDirty = true;
      container.querySelectorAll?.('[data-admin-plan-action="publish"], [data-admin-plan-action="validate"]').forEach(node => { node.disabled = true; });
      return;
    }
    if (!event.target?.matches?.("[data-admin-offer-field], #admin-plan-advanced-document, #admin-monthly-term-days, #admin-annual-term-days, [data-admin-policy-choice]")) return;
    dirty = true;
    validation = null;
  };
  container.addEventListener?.("input", markStableEditorDirty);
  container.addEventListener?.("change", markStableEditorDirty);
  signal?.addEventListener?.("abort", () => {
    container.removeEventListener?.("input", markStableEditorDirty);
    container.removeEventListener?.("change", markStableEditorDirty);
  }, { once: true });

  renderAdminMarkup(container, adminLoadingMarkup("Đang tải phiên bản gói dịch vụ…"), { busy: true });
  try { await refresh(); }
  catch (error) {
    if (signal?.aborted) return;
    renderAdminFailure(container, error, () => renderAdminPlans(container, { fetchImpl, signal }));
  }
}
