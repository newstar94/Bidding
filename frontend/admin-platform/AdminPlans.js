import {
  deleteAdminJson,
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
  const step = (number, title, description) => `<li class="bf-admin-workflow-step${activeStep === number ? " is-active" : ""}${activeStep > number ? " is-complete" : ""}"><strong>${title}</strong><small>${description}</small></li>`;
  return `<section class="card bf-admin-workflow-guide" aria-labelledby="admin-package-workflow-title"><div class="card-body"><h3 class="card-title mb-4" id="admin-package-workflow-title">Bản nháp &amp; mở bán</h3><ol>${step(1, "Tạo hoặc chỉnh sửa gói", dirty ? "Có thay đổi chưa lưu trong bản nháp." : "Bản nháp được lưu riêng để chuẩn bị bảng giá.")}${step(2, "Kiểm tra cấu hình", validated ? "Đã kiểm tra cấu hình của lần sửa hiện tại." : "Giá, kỳ hạn, hạn mức và các gói trùng nhau.")}${step(3, "Rà soát toàn bộ bảng giá rồi phát hành", "Bản mới áp dụng cho giao dịch mới. Giữ nguyên điều kiện của gói đã mua.")}</ol><button class="btn btn-primary" type="button" data-admin-plans-return>Quay lại cấu hình gói</button></div></section>`;
}

function draftTable(drafts) {
  if (!drafts.length) return adminStateMarkup("empty", { message: "Chưa có bản nháp chính sách thương mại đang mở." });
  const rows = drafts.map((draft) => `<tr><td><strong class="bf-admin-draft-id" title="${text(draft?.id)}">${text(draft?.id)}</strong></td><td><span class="badge bg-secondary-lt">${text(draft?.status)}</span></td><td class="text-end">${Number.isSafeInteger(draft?.revision) ? escapeHtml(draft.revision) : "N/A"}</td><td>${text(draft?.baseReleaseId ?? draft?.base_release_id)}</td><td>${formatDate(draft?.updatedAt ?? draft?.updated_at)}</td><td class="text-end"><div class="bf-admin-draft-actions"><button class="btn btn-sm btn-outline-primary" type="button" data-admin-draft-open="${text(draft?.id)}">Mở</button><button class="btn btn-sm btn-outline-danger" type="button" data-admin-draft-archive="${text(draft?.id)}" data-admin-draft-revision="${Number.isSafeInteger(draft?.revision) ? draft.revision : ""}">Bỏ bản nháp</button></div></td></tr>`).join("");
  return `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Bản nháp</th><th>Trạng thái</th><th class="text-end">Lần sửa</th><th>Phiên bản gốc</th><th>Cập nhật</th><th class="text-end">Thao tác</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function releaseHistoryMarkup(releases) {
  if (!releases.length) return '<div class="card-body" data-admin-state="empty"><p class="text-secondary mb-0">Chưa có lịch sử phát hành thương mại.</p></div>';
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
  const sections = {
    externalReadiness: { label: "Điều kiện mở bán", target: "payment" },
    taxInvoice: { label: "Cấu hình thuế", target: "tax" },
    providerProfiles: { label: "Thanh toán payOS", target: "payment" },
  };
  const items = errors.map((error) => {
    const section = Object.hasOwn(sections, error?.path) ? sections[error.path] : null;
    const action = section ? ` <button type="button" class="btn btn-sm btn-outline-danger ms-2" data-admin-validation-target="${section.target}" aria-label="Mở cấu hình: ${section.label}">Mở cấu hình</button>` : "";
    return `<li><strong>${text(section?.label || error?.path, "Dữ liệu")}</strong>: ${text(error?.message || error?.code, "Không hợp lệ")}${action}</li>`;
  }).join("");
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

function offerField(index, name, value, { type = "text", readonly = false, min = null, ariaLabel = null } = {}) {
  const minAttribute = min === null ? "" : ` min="${escapeHtml(min)}"`;
  const ariaAttribute = ariaLabel ? ` aria-label="${escapeHtml(ariaLabel)}"` : "";
  return `<input id="${offerFieldId(index, name)}" class="form-control" type="${escapeHtml(type)}" data-admin-offer-field="${escapeHtml(name)}" value="${escapeHtml(value ?? "")}"${readonly ? " readonly" : ""}${minAttribute}${ariaAttribute} data-offer-index="${index}">`;
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
  const group = (name, title, description, body) => `<section class="bf-admin-editor-group" data-admin-package-section="${name}" aria-labelledby="admin-offer-${name}-${index}"><h5 id="admin-offer-${name}-${index}">${title}</h5><p class="text-secondary small">${description}</p>${body}</section>`;
  const identity = group("identity", "1. Thông tin gói", "Tên, nhóm và đối tượng xuất hiện trong danh mục công khai.", `<div class="row g-3"><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "display.name")}">Tên hiển thị <span class="text-danger" aria-hidden="true">*</span></label>${offerField(index, "display.name", display.name, { ariaLabel: "Tên hiển thị" })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "variant")}">Nhóm gói <span class="text-danger" aria-hidden="true">*</span></label>${offerField(index, "variant", offer?.variant, { readonly: true })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "tier")}">Mức gói</label>${offerField(index, "tier", offer?.tier, { readonly: true })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "ownerKind")}">Đối tượng <span class="text-danger" aria-hidden="true">*</span></label>${offerField(index, "ownerKind", offer?.ownerKind, { readonly: true })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "price.period")}">Kỳ thanh toán</label>${offerField(index, "price.period", price.period, { readonly: true })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "code")}">Mã gói</label>${offerField(index, "code", offer?.code, { readonly: true })}</div><div class="col-12"><label class="form-label" for="${offerFieldId(index, "display.description")}">Mô tả ngắn</label><textarea id="${offerFieldId(index, "display.description")}" class="form-control" rows="2" data-admin-offer-field="display.description" data-offer-index="${index}" placeholder="Ví dụ: Dành cho nhóm triển khai hồ sơ">${escapeHtml(display.description ?? "")}</textarea></div></div>`);
  const pricing = group("commercial", "2. Giá &amp; kỳ hạn", "Giá tháng và giá năm được nhập độc lập; các giá trị sẽ được kiểm tra khi lưu.", `<div class="row g-3"><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "price.subtotal")}">Giá trước thuế</label>${offerField(index, "price.subtotal", price.subtotal, { type: "number", min: 0 })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "price.tax")}">Thuế VAT</label>${offerField(index, "price.tax", price.tax, { type: "number", min: 0 })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "price.total")}">Tổng thanh toán</label>${offerField(index, "price.total", price.total, { type: "number", min: 0 })}</div><div class="col-md-6"><label class="form-label" for="${offerFieldId(index, "price.currency")}">Tiền tệ</label>${offerField(index, "price.currency", price.currency, { readonly: true })}</div></div>`);
  const limits = group("entitlements", "3. Hạn mức &amp; tính năng", "Hạn mức, quyền xuất và các tính năng đi kèm gói.", `<div class="row g-3"><div class="col-md-6"><label class="form-label" for="${offerFieldId(index, "memberQuota")}">Số thành viên tối đa <span class="text-danger" aria-hidden="true">*</span></label>${offerField(index, "memberQuota", offer?.memberQuota, { type: "number", min: 1 })}</div><div class="col-md-6"><label class="form-label" for="${offerFieldId(index, "includedProcurementQuota")}">Lượt Mua Sắm Công trong kỳ</label>${offerField(index, "includedProcurementQuota", offer?.includedProcurementQuota, { type: "number", min: 0, readonly: offer?.variant === "internal" })}</div></div><p class="bf-admin-editor-hint">${offer?.variant === "internal" ? "Cơ bản: không lấy dữ liệu từ Mua Sắm Công." : "Nâng cao: hạn mức đi theo kỳ đã mua."}</p><div class="bf-admin-feature-choices"><div class="bf-admin-check-grid">${capabilityFields}</div><div class="bf-admin-check-grid">${offerCheckbox(index, "violationCheckEnabled", offer?.violationCheckEnabled === true, "Kiểm tra vi phạm nhà thầu")}</div></div><p class="text-secondary small mt-2 mb-0">Quyền xuất chỉ áp dụng cho thao tác xuất tài liệu.</p>`);
  const presentation = group("presentation", "4. Trình bày", "Nội dung hiển thị và trạng thái bán của thẻ gói.", `<div class="row g-3"><div class="col-12"><label class="form-label" for="${offerFieldId(index, "display.benefits")}">Lợi ích hiển thị · mỗi dòng một mục</label><textarea id="${offerFieldId(index, "display.benefits")}" class="form-control" rows="3" data-admin-offer-field="display.benefits" data-offer-index="${index}" placeholder="Nhập nội dung giới thiệu gói">${escapeHtml(Array.isArray(display.benefits) ? display.benefits.join("\n") : "")}</textarea></div><div class="col-md-6"><label class="form-label" for="${offerFieldId(index, "display.order")}">Thứ tự hiển thị</label>${offerField(index, "display.order", display.order, { type: "number", min: 0 })}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "salesState")}">Trạng thái bán</label>${offerSelect(index, "salesState", offer?.salesState, [["sellable", "Đang bán"], ["stopped", "Đã dừng bán"], ["non_sellable", "Chưa mở bán"]])}</div><div class="col-md-4"><label class="form-label" for="${offerFieldId(index, "display.visibility")}">Hiển thị trên bảng giá</label>${offerSelect(index, "display.visibility", display.visibility ?? "", [["", "Theo cấu hình hiện có"], ["public", "Công khai"], ["hidden", "Ẩn"]])}</div><div class="col-md-4"><label class="form-label d-block">Đánh dấu</label><div class="bf-admin-check-grid">${offerCheckbox(index, "display.recommended", display.recommended === true, "Gói được đề xuất")}</div></div></div>`);
  return `<article class="card mb-3 bf-admin-offer-editor" data-admin-offer-editor data-offer-index="${index}"><div class="card-header"><div><div class="text-secondary small mb-1">Gói ${index + 1}</div><h4 class="card-title mb-1">${text(display.name, offer?.code)}</h4><div class="text-secondary small">${text(offer?.code)}</div></div><span class="badge bg-secondary-lt">${text(offer?.salesState, "N/A")}</span></div><div class="card-body">${identity}${pricing}${limits}${presentation}</div></article>`;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function creatorPreviewDocument(source = null) {
  const tier = source?.tier || "personal";
  const variant = source?.variant || "internal";
  const ownerKind = tier === "personal" ? "account" : "organization";
  const name = source?.display?.name || PACKAGE_TIERS[tier] || "Cá nhân";
  const asInteger = value => {
    const normalized = String(value ?? "").trim();
    return /^(0|[1-9]\d*)$/u.test(normalized) && Number.isSafeInteger(Number(normalized)) ? Number(normalized) : null;
  };
  const periods = Array.isArray(source?.periods) && source.periods.length ? source.periods : ["yearly"];
  const prices = source?.prices && typeof source.prices === "object" ? source.prices : {};
  const makeOffer = period => ({
    code: `${tier}.${variant}.${period}`,
    tier,
    variant,
    ownerKind,
    price: {
      period,
      currency: "VND",
      subtotal: asInteger(prices[period]?.subtotal),
      tax: asInteger(prices[period]?.tax),
      total: asInteger(prices[period]?.total),
    },
    memberQuota: asInteger(source?.memberQuota) ?? (tier === "personal" ? 1 : null),
    includedProcurementQuota: variant === "internal" ? 0 : asInteger(source?.includedProcurementQuota),
    exportCapabilities: source?.exportCapabilities && typeof source.exportCapabilities === "object" ? source.exportCapabilities : null,
    violationCheckEnabled: source?.violationCheckEnabled === true,
    salesState: "non_sellable",
    display: {
      name,
      description: source?.display?.description || "",
      benefits: Array.isArray(source?.display?.benefits) ? source.display.benefits : [],
      order: asInteger(source?.display?.order) ?? 1,
      visibility: source?.display?.visibility || "public",
      recommended: source?.display?.recommended === true,
    },
  });
  return { offers: periods.map(makeOffer) };
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

const COMMERCIAL_CONFIG_FIELDS = Object.freeze({
  taxInvoice: ["approvalReference", "taxInclusive", "taxBasisPoints", "rounding", "invoiceEnabled", "invoiceTrigger"],
  externalReadiness: ["vatInvoice", "payosMerchant", "credentialWebhook", "ecommercePrivacy", "termsRefund"],
  providerProfiles: ["alias", "mode", "readiness", "credentialReference", "minAmount", "maxAmount", "checkoutTtlSeconds"],
  rollout: ["mode"],
  sellerProfile: ["legalName", "taxCode", "address", "email"],
});

function commercialConfigField(section, key, value, label, { index = null, kind = "text", options = null, hint = "" } = {}) {
  const path = section === "sellerProfile" ? `taxInvoice.sellerProfile.${key}` : `${section}.${index === null ? "" : `${index}.`}${key}`;
  const id = `admin-config-${path.replaceAll(".", "-")}`;
  const supported = value === null || value === undefined
    || (kind === "boolean" ? typeof value === "boolean"
      : ["integer", "percentage"].includes(kind) ? Number.isSafeInteger(value)
        : typeof value === "string");
  if (!supported) return `<div class="col-md-6"><div class="form-label">${escapeHtml(label)}</div><p class="text-secondary small mb-0">Giá trị hiện có được giữ nguyên trong cấu hình nâng cao.</p></div>`;
  const raw = value === null || value === undefined ? "" : kind === "percentage" ? String(value / 100) : String(value);
  const attributes = `id="${id}" data-admin-commercial-config="${path}" data-admin-config-kind="${kind}" data-admin-config-original="${escapeHtml(raw)}"`;
  const choices = options || (kind === "boolean" ? [["true", "Đã gồm VAT"], ["false", "Chưa gồm VAT"]] : null);
  const unknown = choices && raw && !choices.some(([candidate]) => candidate === raw) ? [[raw, `Giữ giá trị hiện có: ${raw}`]] : [];
  const input = choices
    ? `<select class="form-select" ${attributes}><option value=""${raw === "" ? " selected" : ""}>Chưa cấu hình</option>${[...choices, ...unknown].map(([candidate, caption]) => `<option value="${escapeHtml(candidate)}"${raw === candidate ? " selected" : ""}>${escapeHtml(caption)}</option>`).join("")}</select>`
    : `<input class="form-control" ${attributes} type="${["integer", "percentage"].includes(kind) ? "number" : "text"}" value="${escapeHtml(raw)}"${kind === "integer" ? ' min="0" step="1"' : kind === "percentage" ? ' min="0" max="100" step="0.01"' : ""}>`;
  return `<div class="col-md-6"><label class="form-label" for="${id}">${escapeHtml(label)}</label>${input}${hint ? `<small class="text-secondary d-block mt-1">${escapeHtml(hint)}</small>` : ""}</div>`;
}

function commercialSetupMarkup(documentValue) {
  const field = (section, key, label, settings = {}) => commercialConfigField(section, key, documentValue[section]?.[key], label, settings);
  const sellerField = (key, label) => commercialConfigField("sellerProfile", key, documentValue.taxInvoice?.sellerProfile?.[key], label);
  const taxFields = [
    field("taxInvoice", "approvalReference", "Tham chiếu quyết định thuế"),
    field("taxInvoice", "taxInclusive", "Giá niêm yết", { kind: "boolean" }),
    field("taxInvoice", "taxBasisPoints", "Thuế suất (%)", { kind: "percentage", hint: "Nhập mức đã được xác nhận. Để trống khi chưa có quyết định." }),
    field("taxInvoice", "rounding", "Quy tắc làm tròn", { options: [["half_up", "Đến đồng gần nhất, từ 0,5 làm tròn lên"], ["floor", "Làm tròn xuống"], ["ceil", "Làm tròn lên"]] }),
    field("taxInvoice", "invoiceEnabled", "Xuất hóa đơn", { kind: "boolean", options: [["false", "Không xuất hóa đơn"], ["true", "Có xuất hóa đơn"]], hint: "Có thể bật sau khi thành lập hộ kinh doanh / doanh nghiệp và hoàn tất thông tin hóa đơn." }),
    field("taxInvoice", "invoiceTrigger", "Thời điểm yêu cầu khi bật xuất hóa đơn", { options: [["verified_payment", "Sau khi xác minh thanh toán"], ["activation_applied", "Sau khi kích hoạt thành công"], ["manual", "Xử lý ngoài luồng tự động"]], hint: "Không bắt buộc khi chọn Không xuất hóa đơn." }),
    field("externalReadiness", "vatInvoice", documentValue.taxInvoice?.invoiceEnabled === false ? "Tham chiếu xác nhận chính sách thuế (không xuất hóa đơn)" : "Tham chiếu xác nhận thuế và hóa đơn", { hint: "Ghi tham chiếu đến quyết định hoặc hồ sơ xác nhận thực tế. Lựa chọn không xuất hóa đơn vẫn cần xác nhận chính sách thuế." }),
  ].join("");
  const sellerFields = [["legalName", "Tên pháp lý bên bán"], ["taxCode", "Mã số thuế bên bán"], ["address", "Địa chỉ bên bán"], ["email", "Email liên hệ hóa đơn"]].map(([key, label]) => sellerField(key, label)).join("");
  const profiles = Array.isArray(documentValue.providerProfiles) ? documentValue.providerProfiles : [];
  const providers = profiles.flatMap((profile, index) => {
    if (profile?.provider !== "payos") return [];
    const providerField = (key, label, settings = {}) => commercialConfigField("providerProfiles", key, profile[key], label, { index, ...settings });
    return [`<fieldset class="bf-admin-editor-group"><legend class="h5">payOS · ${text(profile.environment, "Chưa cấu hình môi trường")}</legend><div class="row g-3">${providerField("alias", "Tên cấu hình")}${providerField("credentialReference", "Tham chiếu bộ khóa", { hint: "Chỉ nhập tham chiếu. Bộ khóa được cấu hình trên máy chủ." })}${providerField("mode", "Chế độ", { options: [["shadow", "Thử nội bộ"], ["live", "Thanh toán thực tế"]] })}${providerField("readiness", "Trạng thái trong bản nháp", { options: [["blocked_external", "Chờ hoàn tất cấu hình"], ["ready", "Đã chuẩn bị cấu hình"]], hint: "Máy chủ vẫn kiểm tra bộ khóa và các xác nhận trước khi nhận thanh toán." })}${providerField("minAmount", "Số tiền tối thiểu (VND)", { kind: "integer" })}${providerField("maxAmount", "Số tiền tối đa (VND)", { kind: "integer" })}${providerField("checkoutTtlSeconds", "Thời hạn link thanh toán (giây)", { kind: "integer" })}</div></fieldset>`];
  }).join("");
  const paymentFields = [
    field("externalReadiness", "payosMerchant", "Tham chiếu xác nhận tài khoản payOS"),
    field("externalReadiness", "credentialWebhook", "Tham chiếu xác nhận bộ khóa và webhook"),
    field("externalReadiness", "ecommercePrivacy", "Tham chiếu thương mại điện tử và quyền riêng tư"),
    field("externalReadiness", "termsRefund", "Tham chiếu điều khoản và hoàn tiền"),
    field("rollout", "mode", "Phạm vi phát hành", { options: [["shadow", "Thử nội bộ"], ["pilot", "Thí điểm"], ["production", "Mở bán chính thức"]] }),
  ].join("");
  // These fields describe the candidate document. They do not assert that a
  // real merchant, webhook, credential resolver or invoice issuer is ready.
  return `<details class="bf-admin-package-policies mb-3" data-admin-tax-settings><summary>Thuế &amp; hóa đơn</summary><p class="text-secondary small mt-3">Cấu hình chung của bản nháp. Giá trước thuế, thuế và tổng tiền của từng gói vẫn được nhập riêng, phù hợp với lựa chọn đã gồm hoặc chưa gồm VAT.</p><div class="row g-3">${taxFields}</div><fieldset class="mt-4"><legend class="h5">Thông tin bên bán khi bật xuất hóa đơn</legend><div class="row g-3">${sellerFields}</div></fieldset></details><details class="bf-admin-package-policies mb-3" data-admin-payment-settings><summary>payOS &amp; điều kiện mở bán</summary><p class="text-secondary small mt-3">Các thông tin bên dưới được lưu cùng bản nháp. Mở bán cần kết quả kiểm tra máy chủ và xác nhận bộ khóa, webhook cùng các điều kiện phát hành.</p>${providers || '<p class="text-secondary">Bản nháp chưa có cấu hình payOS. Cấu hình thanh toán hiện có được giữ nguyên.</p>'}<div class="row g-3">${paymentFields}</div></details>`;
}

function serializeCommercialSetup(root, advanced) {
  for (const field of root.querySelectorAll?.("[data-admin-commercial-config]") || []) {
    const path = field.dataset.adminCommercialConfig.split(".");
    const [section, indexOrKey, providerKey] = path;
    const key = providerKey || indexOrKey;
    const seller = section === "taxInvoice" && indexOrKey === "sellerProfile";
    if (!COMMERCIAL_CONFIG_FIELDS[seller ? "sellerProfile" : section]?.includes(key)) throw new TypeError("Trường cấu hình thương mại không được hỗ trợ.");
    const raw = String(field.value ?? "");
    // A blank control must not replace missing/null policy values, nor
    // overwrite edits made in the advanced document, unless explicitly edited.
    if (raw === field.dataset.adminConfigOriginal || field.disabled) continue;
    const kind = field.dataset.adminConfigKind;
    let value = raw.trim() || null;
    if (value !== null && kind === "boolean") {
      if (!["true", "false"].includes(value)) throw new TypeError(key === "invoiceEnabled" ? "Xuất hóa đơn phải là lựa chọn Có hoặc Không." : "Giá niêm yết phải xác định đã gồm hoặc chưa gồm VAT.");
      value = value === "true";
    } else if (kind === "integer") {
      value = parseIntegerField(field, "Giá trị cấu hình thanh toán", { nullable: true });
    } else if (value !== null && kind === "percentage") {
      if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/u.test(value) || Number(value) > 100) {
        const error = new TypeError("Thuế suất phải từ 0 đến 100%, tối đa hai chữ số thập phân.");
        error.field = field;
        throw error;
      }
      const [whole, decimal = ""] = value.split(".");
      value = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
    }
    if (seller) {
      if (advanced.taxInvoice && (typeof advanced.taxInvoice !== "object" || Array.isArray(advanced.taxInvoice))) throw new TypeError("Cấu hình thuế phải là một object.");
      advanced.taxInvoice ||= {};
      if (advanced.taxInvoice.sellerProfile && (typeof advanced.taxInvoice.sellerProfile !== "object" || Array.isArray(advanced.taxInvoice.sellerProfile))) throw new TypeError("Thông tin bên bán phải là một object.");
      advanced.taxInvoice.sellerProfile ||= {};
      if (value === null) delete advanced.taxInvoice.sellerProfile[key];
      else advanced.taxInvoice.sellerProfile[key] = value;
    } else if (providerKey) {
      if (section !== "providerProfiles" || !/^\d+$/u.test(indexOrKey)
        || !Array.isArray(advanced.providerProfiles) || !advanced.providerProfiles[Number(indexOrKey)]
        || advanced.providerProfiles[Number(indexOrKey)].provider !== "payos") {
        throw new TypeError("Danh sách cấu hình payOS đã thay đổi. Hãy lưu và mở lại bản nháp.");
      }
      advanced.providerProfiles[Number(indexOrKey)][key] = value;
    } else {
      if (advanced[section] && (typeof advanced[section] !== "object" || Array.isArray(advanced[section]))) {
        throw new TypeError("Cấu hình thương mại phải là một object. Hãy rà soát cấu hình nâng cao.");
      }
      advanced[section] ||= {};
      advanced[section][key] = value;
    }
  }
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
  serializeCommercialSetup(root, advanced);
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
  if (!editors.length && root.querySelector?.("[data-admin-package-creator]")) {
    return { ...advanced, offers: cloneJson(originalOffers) };
  }
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

export function draftEditorMarkup(draft, validation = null, { selectedIndex = 0, creator = false, sourceIndex = null, creatorPeriod = "yearly", packageStep = 0 } = {}) {
  if (!draft) return "";
  const documentValue = draft.document && typeof draft.document === "object" ? draft.document : {};
  const offers = Array.isArray(documentValue.offers) ? documentValue.offers : [];
  const advanced = cloneJson(documentValue) || {};
  delete advanced.offers;
  const policies = documentValue.policies || {};
  const policyChoice = (key, label, options) => `<div class="col-md-6"><label class="form-label" for="admin-policy-${key}">${label}</label><select class="form-select" id="admin-policy-${key}" data-admin-policy-choice="${key}"><option value="">Giữ chính sách hiện có${policies[key]?.kind === "blocked_decision" ? " · Chưa chốt" : ""}</option>${options.map(([value, caption]) => `<option value="${value}"${policies[key]?.kind === value ? " selected" : ""}>${caption}</option>`).join("")}</select></div>`;
  const terms = `<details class="bf-admin-package-policies mb-3"><summary>Chính sách chung & kỳ hạn</summary><div class="row g-3 mt-1">${["fixed_days", "blocked_decision", undefined].includes(policies.baseTerm?.kind) ? `<div class="col-md-6"><label class="form-label" for="admin-annual-term-days">Số ngày hiệu lực một kỳ năm</label><input class="form-control" id="admin-annual-term-days" type="number" min="1" max="3660" value="${text(policies.baseTerm?.kind === "fixed_days" ? policies.baseTerm.days : "", "")}"></div>` : '<div class="col-12 text-secondary">Kỳ năm giữ chính sách hiện có; xem cấu hình nâng cao để rà soát.</div>'}${policyChoice("renewalAnchor", "Khi gia hạn", [["start_new_term", "Bắt đầu kỳ mới"], ["end_of_term", "Từ cuối kỳ hiện tại"]])}${policyChoice("partialBatch", "Khi lượt không đủ cho toàn bộ danh sách", [["reject_all", "Từ chối toàn bộ"], ["process_affordable_in_stable_order", "Xử lý phần đủ lượt theo thứ tự ổn định"]])}</div>${monthlyConfigurationMarkup(documentValue)}</details>`;
  const source = sourceIndex === null ? null : offers[sourceIndex];
  const active = creator || (selectedIndex !== null && Boolean(offers[selectedIndex]));
  const panes = creator
    ? `<div data-admin-package-pane="creator">${packageCreatorMarkup(source)}</div>`
    : offers.map((offer, index) => `<div data-admin-package-pane="${index}"${selectedIndex === index ? "" : " hidden"}>${offerEditorMarkup(offer, index)}</div>`).join("");
  const previewDocument = creator ? creatorPreviewDocument(source) : documentValue;
  const previewIndex = creator
    ? Math.max(0, previewDocument.offers.findIndex(offer => offer.price?.period === creatorPeriod))
    : selectedIndex;
  const editorTitle = creator ? (source ? "Nhân bản gói dịch vụ" : "Tạo gói dịch vụ") : active ? "Chỉnh sửa gói dịch vụ" : "Danh sách gói trong bản nháp";
  const preview = active ? packagePreviewMarkup(previewDocument, previewIndex, { compact: true }) : "";
  const stepLabels = ["Thông tin gói", "Giá & kỳ hạn", "Hạn mức & tính năng", "Trình bày"];
  const steps = stepLabels.map((label, step) => `<button type="button" class="btn btn-sm ${packageStep === step ? "btn-primary" : "btn-outline-primary"}" data-admin-package-step="${step}" aria-pressed="${packageStep === step}">${step + 1}. ${label}</button>`).join("");
  return `<section class="card bf-admin-editor-shell" id="admin-commercial-editor" aria-label="Các gói đăng ký" data-draft-id="${text(draft.id)}" data-admin-allow-incomplete><div class="card-header bf-admin-composer-header"><div><div class="text-secondary small mb-1">Bản nháp thương mại · Lần sửa ${text(draft.revision)}</div><h3 class="card-title mb-1">${editorTitle}</h3><p class="text-secondary small mb-0">Thông tin, giá và tính năng trong một màn hình</p></div><button class="btn btn-ghost-primary" type="button" data-admin-plan-action="close">Đóng</button></div><div class="card-body"><div id="admin-plan-validation" class="bf-admin-validation-panel">${validationMarkup(validation)}</div><div data-admin-package-list${active ? " hidden" : ""}>${packageManagerMarkup(documentValue)}<p class="text-secondary small mt-2">Khung năm hiện hành gồm 8 gói: Cá nhân/Bạc/Vàng/Kim cương × Cơ bản/Nâng cao. Giá tháng tùy chọn.</p></div><div data-admin-package-editor-zone${active ? "" : " hidden"}><div class="bf-admin-package-editor-toolbar"><button class="btn btn-ghost-primary" type="button" data-admin-package-back>← Danh sách gói</button><nav class="bf-admin-package-steps" aria-label="Các phần cấu hình gói">${steps}</nav></div><div class="bf-admin-package-editor-grid"><div class="bf-admin-package-form-column">${panes}</div><aside class="bf-admin-package-preview-panel"><div class="bf-admin-preview-eyebrow">KHÁCH HÀNG SẼ THẤY</div><h4 class="bf-admin-preview-title">Thẻ gói cập nhật trực tiếp</h4><div data-admin-package-live-preview${creator ? " data-admin-package-creator-preview" : ""}>${preview}</div><div class="bf-admin-preview-summary"><h4>Giá thanh toán</h4><div class="bf-admin-preview-summary-row"><span>Giá chưa VAT</span><strong data-admin-preview-net>—</strong></div><div class="bf-admin-preview-summary-row"><span>VAT</span><strong data-admin-preview-tax>—</strong></div><div class="bf-admin-preview-summary-row"><span>Tổng thanh toán</span><strong data-admin-preview-total>—</strong></div><p class="text-secondary small mb-0">Kỳ tháng / năm nằm ngay trong thẻ và được căn giữa.</p></div></aside></div></div><details class="bf-admin-package-settings"><summary>Chính sách, thuế, payOS &amp; thời điểm hiệu lực</summary><div class="bf-admin-package-settings-body">${terms}${commercialSetupMarkup(documentValue)}<details class="bf-admin-advanced mt-4"><summary><span><strong>Cấu hình chính sách nâng cao</strong><small>Chỉ mở khi cần chỉnh phần chưa có biểu mẫu</small></span><span aria-hidden="true">⌄</span></summary><p class="text-secondary small mt-2">Các cấu hình khác được giữ nguyên khi chỉnh từng gói.</p><label class="form-label" for="admin-plan-advanced-document">Cấu hình chính sách nâng cao (JSON)</label><textarea class="form-control font-monospace" id="admin-plan-advanced-document" rows="14" spellcheck="false">${escapeHtml(JSON.stringify(advanced, null, 2))}</textarea><div class="invalid-feedback" id="admin-plan-json-error">JSON không hợp lệ.</div></details><div class="bf-admin-effective-date"><label class="form-label" for="admin-plan-effective">Thời điểm hiệu lực</label><input class="form-control" id="admin-plan-effective" type="datetime-local"><small class="text-secondary">Để trống để áp dụng ngay sau khi xuất bản. Gói đã mua giữ điều kiện cũ.</small></div></div></details></div><div class="card-footer bf-admin-editor-actions"><span class="text-secondary small" data-admin-package-save-state>${creator ? "Gói mới chưa lưu" : `Bản nháp · Lần sửa ${text(draft.revision)}`}</span><div><button class="btn btn-outline-primary" type="button" data-admin-plan-action="save">Lưu bản nháp</button><button class="btn btn-outline-secondary" type="button" data-admin-plan-action="validate"${creator ? " disabled" : ""}>Kiểm tra</button><button class="btn btn-primary" type="button" data-admin-plan-action="publish"${validationReady(validation) && !creator ? "" : " disabled"}>Rà soát mở bán</button></div></div></section>`;
}

export function plansMarkup(payload, { editor = "", catalog = null, catalogError = null, dirty = false, validated = false, composerActive = false, activeTab = "catalog" } = {}) {
  const current = payload?.currentRelease || null;
  const scheduled = payload?.scheduledRelease || null;
  const drafts = Array.isArray(payload?.drafts) ? payload.drafts : [];
  const releaseHistory = Array.isArray(payload?.releaseHistory) ? payload.releaseHistory : [];
  const initial = !current && !scheduled;
  const seededDraft = initial ? drafts.find(item => item?.id === "commercial-draft-initial-v1" && item.status !== "archived") : null;
  const currentActions = current
    ? `<button class="btn btn-sm btn-outline-primary" type="button" data-admin-plan-action="clone" data-release-id="${text(current.id)}">Nhân bản</button> <button class="btn btn-sm btn-outline-danger" type="button" data-admin-plan-action="stop-sales" data-release-id="${text(current.id)}"${current.nonSellable ? " disabled" : ""}>Dừng bán</button>`
    : "";
  const releaseCards = current || scheduled ? `<div class="col-lg-6">${releaseCard("Bản đang hiệu lực", current, currentActions)}</div><div class="col-lg-6">${releaseCard("Bản đã lên lịch", scheduled)}</div>` : "";
  const draftList = drafts.length ? `<div class="col-12"><section class="card" aria-labelledby="commercial-drafts-title"><div class="card-header"><div><h3 class="card-title" id="commercial-drafts-title">Bản nháp thương mại</h3><p class="text-secondary small mb-0">Mở bản nháp để quản lý gói theo nhóm và kỳ thanh toán.</p></div></div>${draftTable(drafts)}</section></div>` : "";
  const releaseManagement = releaseCards || draftList ? `<div class="row row-cards">${releaseCards}${draftList}</div>` : "";
  const history = `<section class="card" aria-labelledby="commercial-release-history-title"><div class="card-header"><div><h3 class="card-title" id="commercial-release-history-title">Lịch sử phát hành thương mại</h3><p class="text-secondary small mb-0">Tối đa 20 bản gần nhất từ kho phát hành bất biến.</p></div></div>${releaseHistoryMarkup(releaseHistory)}</section>`;
  const hasCatalog = catalog && classifyPublicCommercialResponse(catalog).state !== "off";
  const catalogNotice = catalogError && catalogError.code !== "COMMERCIAL_POLICY_DECISION_REQUIRED"
    ? adminStateMarkup("error", { title: "Chưa tải được bảng giá công khai", message: catalogError.message })
    : !hasCatalog ? `<div class="alert alert-primary bf-admin-catalog-notice" role="status"><strong>Chưa có bảng giá đang mở bán</strong><div class="mt-1">Bạn vẫn có thể tạo và lưu gói nháp để chuẩn bị phát hành.</div></div>` : "";
  const templateAction = '<button class="btn btn-outline-primary" type="button" data-admin-plan-action="create-template">Tạo bộ 8 gói mẫu</button>';
  const openSeedAction = seededDraft ? `<button class="btn btn-primary" type="button" data-admin-draft-open="${text(seededDraft.id)}">Chỉnh sửa 8 gói mẫu</button>` : "";
  const emptyCatalog = packageManagerMarkup({ offers: [] }, { published: true, id: "published", emptyMarkup: `<div class="bf-admin-first-package"><h3>${seededDraft ? "Bộ gói mẫu đã được khởi tạo" : "Chưa có gói dịch vụ"}</h3><p class="text-secondary">Bắt đầu bằng một gói mới hoặc bộ mẫu Cơ bản / Nâng cao có cấu hình. Bạn có thể chỉnh sửa, kiểm tra rồi phát hành.</p><div class="d-flex justify-content-center gap-2 flex-wrap">${openSeedAction}<button class="btn ${seededDraft ? "btn-outline-primary" : "btn-primary"}" type="button" data-admin-plan-action="create-first"${initial ? ' data-admin-create-mode="empty"' : ""}>Tạo gói đầu tiên</button>${templateAction}</div></div>` });
  const tabs = [["catalog", "Danh sách gói"], ["releases", "Bản nháp & mở bán"], ["history", "Lịch sử"]]
    .map(([key, label]) => `<button class="nav-link${activeTab === key ? " active" : ""}" id="admin-plans-tab-${key}" type="button" role="tab" aria-selected="${activeTab === key}" aria-controls="admin-plans-panel-${key}" tabindex="${activeTab === key ? "0" : "-1"}" data-admin-plans-tab="${key}">${label}</button>`).join("");
  return `<div class="admin-plans-page">
    <header class="bf-admin-page-intro"><div><p class="page-pretitle mb-1">Quản trị nền tảng</p><h2 class="h1 mb-2">Gói dịch vụ</h2><p class="text-secondary mb-0">Quản lý giá tháng, giá năm và quyền lợi trước khi phát hành.</p></div>${composerActive ? "" : `<div class="d-flex gap-2 flex-wrap"><button class="btn btn-primary" type="button" data-admin-plan-action="create"${initial ? ' data-admin-create-mode="empty"' : ""}>+ Tạo gói</button>${hasCatalog ? templateAction : ""}</div>`}</header>
    <div id="admin-plan-status" aria-live="polite"></div>
    ${composerActive ? `<div class="bf-admin-page-section">${editor}</div>` : ""}
    <div data-admin-plans-content${composerActive ? " hidden" : ""}>
      <nav class="nav nav-tabs bf-admin-plan-tabs" role="tablist" aria-label="Quản lý gói dịch vụ">${tabs}</nav>
      ${catalogNotice}
      <section id="admin-plans-panel-catalog" role="tabpanel" aria-labelledby="admin-plans-tab-catalog" data-admin-plans-panel="catalog"${activeTab === "catalog" ? "" : " hidden"}>
        ${editor && !composerActive ? editor : hasCatalog ? catalogMarkup(catalog) : emptyCatalog}
      </section>
      <section id="admin-plans-panel-releases" role="tabpanel" aria-labelledby="admin-plans-tab-releases" data-admin-plans-panel="releases"${activeTab === "releases" ? "" : " hidden"}>
        ${workflowGuideMarkup({ draftOpen: Boolean(editor), dirty, validated })}
        ${releaseManagement}
        <details class="bf-admin-supported-model mt-3"><summary>Khả năng cấu hình gói hiện hành</summary>${planModelMarkup()}</details>
      </section>
      <section id="admin-plans-panel-history" role="tabpanel" aria-labelledby="admin-plans-tab-history" data-admin-plans-panel="history"${activeTab === "history" ? "" : " hidden"}>${history}</section>
    </div>
  </div>`;
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
  let creatorPeriod = "yearly";
  let activeTab = "catalog";
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
      editor: draftEditorMarkup(draft && workingDocument ? { ...draft, document: workingDocument } : draft, validation, { selectedIndex, creator: creatorOpen, sourceIndex: creationSource, creatorPeriod, packageStep }),
      catalog,
      catalogError,
      draftOpen: Boolean(draft),
      dirty,
      validated: Boolean(validationReady(validation) && !dirty),
      composerActive: Boolean(draft && (creatorOpen || (selectedIndex !== null && workingDocument?.offers?.[selectedIndex]))),
      activeTab,
    }));
    bind();
    if (dirty || creatorDirty) {
      container.querySelectorAll?.('[data-admin-plan-action="publish"], [data-admin-plan-action="validate"]').forEach(node => { node.disabled = true; });
      const saveState = container.querySelector?.("[data-admin-package-save-state]");
      if (saveState) saveState.textContent = "Bản nháp chưa lưu";
    }
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
    draftOpenController?.abort();
    draftOpenSequence += 1;
    busy = true;
    container.querySelectorAll?.("button, textarea, input, select").forEach((node) => { node.disabled = true; });
    try {
      const result = await runWithStepUp(operation, { fetchImpl, signal });
      if (signal?.aborted) return;
       if (result?.document) {
         draft = result;
         workingDocument = cloneJson(result.document);
         dirty = false;
       }
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
    const tabButtons = [...(container.querySelectorAll?.("[data-admin-plans-tab]") || [])];
    const selectPlansTab = (key, { focus = false } = {}) => {
      activeTab = key;
      tabButtons.forEach(button => {
        const selected = button.dataset.adminPlansTab === key;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
      });
      container.querySelectorAll?.("[data-admin-plans-panel]").forEach(panel => { panel.hidden = panel.dataset.adminPlansPanel !== key; });
    };
    tabButtons.forEach((button, index) => {
      button.addEventListener("click", () => selectPlansTab(button.dataset.adminPlansTab));
      button.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabButtons.length - 1
          : (index + (event.key === "ArrowLeft" ? -1 : 1) + tabButtons.length) % tabButtons.length;
        selectPlansTab(tabButtons[nextIndex].dataset.adminPlansTab, { focus: true });
      });
    });
    container.querySelector?.("[data-admin-plans-return]")?.addEventListener("click", () => selectPlansTab("catalog"));
    container.querySelectorAll?.("[data-admin-validation-target]").forEach(button => button.addEventListener("click", () => {
      const selectors = { tax: "[data-admin-tax-settings]", payment: "[data-admin-payment-settings]" };
      const selector = Object.hasOwn(selectors, button.dataset.adminValidationTarget) ? selectors[button.dataset.adminValidationTarget] : null;
      const settings = selector ? container.querySelector?.(selector) : null;
      if (!settings) return;
      for (let node = settings; node && node !== container; node = node.parentElement) {
        if (node.tagName === "DETAILS") node.open = true;
      }
      const summary = settings.querySelector("summary");
      summary?.focus({ preventScroll: true });
      summary?.scrollIntoView({ block: "center", behavior: "auto" });
    }));
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
      const documentValue = id === "published" ? catalog || { offers: [] } : workingDocument;
      if (documentValue) bindPackageManager(manager, documentValue, { ...managerStates[id], onState: state => { managerStates[id] = state; } });
    });
    const creatorField = selector => container.querySelector(selector);
    const creatorInteger = selector => {
      const raw = String(creatorField(selector)?.value ?? "").trim();
      return /^(0|[1-9]\d*)$/u.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
    };
    let creatorExportsConfigured = creationSource !== null && Boolean(workingDocument?.offers?.[creationSource]?.exportCapabilities);
    const creatorCapabilities = () => {
      if (!creatorExportsConfigured) return null;
      return Object.fromEntries([...(container.querySelectorAll?.("[data-admin-creator-field^='capability:']") || [])]
        .map(field => [field.dataset.adminCreatorField.slice("capability:".length), Boolean(field.checked)]));
    };
    const creatorPreviewSource = () => {
      const vat = String(creatorField("#admin-new-package-vat")?.value ?? "").trim();
      const prices = {};
      for (const period of ["monthly", "yearly"]) {
        const subtotal = creatorInteger(`#admin-new-package-${period === "monthly" ? "month" : "year"}-price`);
        let tax = null;
        let total = null;
        if (subtotal !== null && vat !== "") {
          try { ({ tax, total } = calculateAdminVat(String(subtotal), vat)); } catch { /* keep the live preview unpriced until valid */ }
        }
        prices[period] = { subtotal, tax, total };
      }
      const periods = [
        creatorField("#admin-new-package-month")?.checked ? "monthly" : null,
        creatorField("#admin-new-package-year")?.checked ? "yearly" : null,
      ].filter(Boolean);
      const benefits = String(creatorField("#admin-new-package-benefits")?.value ?? "")
        .split(/\r?\n/u).map(item => item.trim()).filter(Boolean);
      return {
        tier: creatorField("#admin-new-package-tier")?.value || "personal",
        variant: creatorField("#admin-new-package-variant")?.value || "internal",
        periods,
        prices,
        memberQuota: creatorInteger("#admin-new-package-member-quota"),
        includedProcurementQuota: creatorInteger("#admin-new-package-procurement-quota"),
        exportCapabilities: creatorCapabilities(),
        violationCheckEnabled: Boolean(creatorField("#admin-new-package-violation-check")?.checked),
        display: {
          name: creatorField("#admin-new-package-name")?.value || "Cá nhân",
          description: creatorField("#admin-new-package-description")?.value || "",
          benefits,
          order: creatorInteger("#admin-new-package-order"),
          visibility: creatorField("#admin-new-package-visible")?.checked ? "public" : "hidden",
          recommended: Boolean(creatorField("#admin-new-package-recommended")?.checked),
        },
      };
    };
    const applyComposerStep = () => {
      container.querySelectorAll?.("[data-admin-package-pane]").forEach(pane => {
        const isCreatorPane = pane.dataset.adminPackagePane === "creator";
        pane.hidden = creatorOpen ? !isCreatorPane : Number(pane.dataset.adminPackagePane) !== selectedIndex;
        pane.querySelectorAll(".bf-admin-editor-group").forEach((group, step) => { group.hidden = step !== packageStep; });
      });
      container.querySelectorAll?.("[data-admin-package-step]").forEach(button => {
        const pressed = Number(button.dataset.adminPackageStep) === packageStep;
        button.setAttribute("aria-pressed", String(pressed)); button.classList.toggle("btn-primary", pressed); button.classList.toggle("btn-outline-primary", !pressed);
      });
    };
    const updatePreviewSummary = (documentValue, index) => {
      const offer = documentValue?.offers?.[index];
      const values = offer?.price || {};
      const money = value => Number.isSafeInteger(value) ? formatCommercialMoney(value, values.currency || "VND") : "—";
      const net = container.querySelector?.("[data-admin-preview-net]");
      const tax = container.querySelector?.("[data-admin-preview-tax]");
      const total = container.querySelector?.("[data-admin-preview-total]");
      if (net) net.textContent = money(values.subtotal);
      if (tax) tax.textContent = money(values.tax);
      if (total) total.textContent = money(values.total);
    };
    const renderCreatorPreview = () => {
      if (!creatorOpen) return;
      const source = creatorPreviewSource();
      const previewDocument = creatorPreviewDocument(source);
      const preferredIndex = previewDocument.offers.findIndex(offer => offer.price?.period === creatorPeriod);
      const previewIndex = preferredIndex >= 0 ? preferredIndex : 0;
      if (previewDocument.offers[previewIndex]) creatorPeriod = previewDocument.offers[previewIndex].price.period;
      const preview = container.querySelector?.("[data-admin-package-live-preview]");
      if (preview) preview.innerHTML = trustedHTML(packagePreviewMarkup(previewDocument, previewIndex, { compact: true }));
      updatePreviewSummary(previewDocument, previewIndex);
    };
    const showPackage = (index) => {
      if (!creatorOpen && index !== null && !workingDocument?.offers?.[index]) return;
      selectedIndex = creatorOpen ? null : index;
      const zone = container.querySelector?.("[data-admin-package-editor-zone]");
      const list = container.querySelector?.("[data-admin-package-list]");
      if (zone) zone.hidden = creatorOpen ? false : index === null;
      if (list) list.hidden = creatorOpen || index !== null;
      applyComposerStep();
      const preview = container.querySelector?.("[data-admin-package-live-preview]");
      if (!preview) return;
      if (creatorOpen) {
        renderCreatorPreview();
      } else {
        preview.innerHTML = trustedHTML(packagePreviewMarkup(workingDocument, index, { compact: true }));
        updatePreviewSummary(workingDocument, index);
      }
    };
    const syncCreatorAudience = () => {
      const owner = creatorField("#admin-new-package-owner");
      const tier = creatorField("#admin-new-package-tier");
      const variant = creatorField("#admin-new-package-variant")?.value || "internal";
      const procurement = creatorField("#admin-new-package-procurement-quota");
      if (!owner || !tier) return;
      if (owner.value === "account") tier.value = "personal";
      else if (tier.value === "personal") tier.value = "silver";
      owner.value = tier.value === "personal" ? "account" : "organization";
      tier.disabled = owner.value === "account";
      for (const option of tier.options) {
        option.disabled = owner.value === "organization" ? option.value === "personal" : option.value !== "personal";
      }
      if (procurement) {
        if (variant === "internal") {
          procurement.value = "0";
          procurement.readOnly = true;
        } else {
          if (procurement.readOnly && procurement.value === "0") procurement.value = "";
          procurement.readOnly = false;
        }
      }
      const hint = creatorField("[data-admin-creator-procurement-hint]");
      if (hint) hint.textContent = variant === "internal" ? "Cơ bản: không lấy dữ liệu từ Mua Sắm Công." : "Nâng cao: hạn mức đi theo kỳ đã mua.";
      creatorField("#admin-new-package-month-price").disabled = !creatorField("#admin-new-package-month").checked;
      creatorField("#admin-new-package-year-price").disabled = !creatorField("#admin-new-package-year").checked;
      creatorField("#admin-new-package-month-days").disabled = !creatorField("#admin-new-package-month").checked;
      renderCreatorPreview();
    };
    creatorField("#admin-new-package-owner")?.addEventListener("change", syncCreatorAudience);
    creatorField("#admin-new-package-tier")?.addEventListener("change", syncCreatorAudience);
    creatorField("#admin-new-package-variant")?.addEventListener("change", syncCreatorAudience);
    syncCreatorAudience();
    container.querySelectorAll?.("[data-admin-package-creator] input, [data-admin-package-creator] select, [data-admin-package-creator] textarea").forEach(field => {
      const refreshCreatorPreview = () => {
        if (!creatorOpen) return;
        if (field.dataset.adminCreatorField?.startsWith("capability:")) creatorExportsConfigured = true;
        if (["admin-new-package-month", "admin-new-package-year"].includes(field.id)) syncCreatorAudience();
        renderCreatorPreview();
      };
      const eventName = field.tagName === "SELECT" || field.type === "checkbox" ? "change" : "input";
      field.addEventListener(eventName, refreshCreatorPreview);
    });
    container.querySelectorAll?.("[data-admin-package-edit]").forEach(button => button.addEventListener("click", () => {
      if (creatorDirty && globalThis.confirm?.(discardMessage) === false) return;
      const documentValue = readDocument(); if (!documentValue) return;
      workingDocument = documentValue; packageStep = 0; creatorOpen = false; creatorDirty = false; selectedIndex = Number(button.dataset.adminPackageEdit); render();
    }));
    container.querySelector?.("[data-admin-package-back]")?.addEventListener("click", () => {
      if (creatorDirty && globalThis.confirm?.(discardMessage) === false) return;
      const documentValue = readDocument(); if (!documentValue) return;
      workingDocument = documentValue; selectedIndex = null; creatorOpen = false; creatorDirty = false; creationSource = null; activeTab = "catalog"; render();
    });
    container.querySelectorAll?.("[data-admin-package-step]").forEach(button => button.addEventListener("click", () => {
      packageStep = Number(button.dataset.adminPackageStep);
      if (creatorOpen) { applyComposerStep(); return; }
      const documentValue = readDocument(); if (!documentValue) return;
      workingDocument = documentValue; showPackage(selectedIndex);
    }));
    container.querySelector?.("[data-admin-package-live-preview]")?.addEventListener("click", event => {
      const button = event.target.closest?.("[data-admin-package-period]");
      if (!button || button.disabled) return;
      if (creatorOpen) {
        const previewDocument = creatorPreviewDocument(creatorPreviewSource());
        const selectedOffer = previewDocument.offers[Number(button.dataset.adminPackagePeriod)];
        if (selectedOffer) creatorPeriod = selectedOffer.price.period;
        showPackage(null);
        return;
      }
      const documentValue = readDocument(); if (!documentValue) return;
      workingDocument = documentValue; showPackage(Number(button.dataset.adminPackagePeriod));
    });
    container.querySelectorAll?.("[data-admin-package-copy]").forEach(button => button.addEventListener("click", () => {
      if (creatorDirty && globalThis.confirm?.(discardMessage) === false) return;
      const documentValue = readDocument(); if (!documentValue) return;
       workingDocument = documentValue; creationSource = Number(button.dataset.adminPackageCopy); creatorOpen = true; creatorDirty = false; creatorPeriod = "yearly"; render();
    }));
    container.querySelectorAll?.("[data-admin-package-edit-code]").forEach(button => button.addEventListener("click", async () => {
      if (busy || ((dirty || creatorDirty) && globalThis.confirm?.(discardMessage) === false)) return;
      const code = button.dataset.adminPackageEditCode;
      creatorOpen = false; creatorDirty = false; creationSource = null;
      await execute("edit-package", () => postAdminJson("/api/commercial/drafts", { body: { baseReleaseId: catalog.releaseId }, idempotencyKey: mutationKey("edit-package"), fetchImpl, signal, retries: 0 }), "Gói đã được sao chép vào bản nháp để chỉnh sửa.", { keepDraft: true });
      if (workingDocument) { selectedIndex = workingDocument.offers.findIndex(offer => offer.code === code); render(); }
    }));
    if (draft) showPackage(creatorOpen ? null : selectedIndex);
    container.querySelectorAll?.("[data-admin-draft-open]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (busy) return;
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
           creatorOpen = false; creatorDirty = false; creationSource = null; packageStep = 0; creatorPeriod = "yearly"; activeTab = "catalog";
          render();
          container.querySelector?.("#admin-commercial-editor")?.scrollIntoView?.({ block: "start" });
        } catch (error) {
          if (!openController.signal.aborted && openSequence === draftOpenSequence) setStatus(container, error.message, "danger");
        } finally {
          signal?.removeEventListener?.("abort", cancelOpen);
        }
      });
    });
    container.querySelectorAll?.("[data-admin-draft-archive]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (busy) return;
        const draftId = button.dataset.adminDraftArchive;
        const revision = Number(button.dataset.adminDraftRevision);
        const isOpen = draft?.id === draftId;
        const message = isOpen && (dirty || creatorDirty)
          ? "Bản nháp đang mở có thay đổi chưa lưu. Bỏ bản nháp sẽ đóng và lưu trữ toàn bộ thay đổi này. Bạn có muốn tiếp tục?"
          : "Bỏ bản nháp này? Bản nháp sẽ được lưu trữ và không còn xuất hiện trong danh sách."
        if (globalThis.confirm?.(message) === false) return;
        await execute(
          "archive-draft",
          () => deleteAdminJson(`/api/commercial/drafts/${encodeURIComponent(draftId)}`, {
            body: { expectedRevision: revision },
            expectedRevision: revision,
            idempotencyKey: mutationKey("archive-draft"),
            fetchImpl,
            signal,
          }),
          "Đã bỏ bản nháp.",
        );
      });
    });
    container.querySelectorAll?.("[data-admin-plan-action]").forEach((button) => {
      const configureExports = async () => {
        const documentValue = readDocument(); if (!documentValue) return;
        const configuredDraftId = draft.id;
        const configuredCode = documentValue.offers[Number(button.dataset.offerIndex)]?.code;
        const accepted = await requestAdminValue({ title: "Cấu hình quyền xuất của gói", message: "Chọn lại quyền xuất cho gói trong bản nháp? Ban đầu các quyền sẽ chưa được chọn. Quyền của gói đã mua không thay đổi.", label: null, confirmLabel: "Cấu hình" });
        if (accepted === null || signal?.aborted || draft?.id !== configuredDraftId || workingDocument?.offers?.[Number(button.dataset.offerIndex)]?.code !== configuredCode) return;
        const currentDocument = readDocument(); if (!currentDocument) return;
        workingDocument = configureAdminExportMapping(currentDocument, Number(button.dataset.offerIndex)); dirty = true; validation = null; render();
      };
      const addPackage = () => {
        const documentValue = readDocument(); if (!documentValue) return;
        try {
          const periods = [creatorField("#admin-new-package-year")?.checked ? "yearly" : null, creatorField("#admin-new-package-month")?.checked ? "monthly" : null].filter(Boolean);
          const vat = String(creatorField("#admin-new-package-vat")?.value ?? "").trim();
          const prices = {};
          for (const period of periods) {
            const priceSelector = `#admin-new-package-${period === "monthly" ? "month" : "year"}-price`;
            const rawSubtotal = String(creatorField(priceSelector)?.value ?? "").trim();
            if (rawSubtotal === "") continue;
            if (vat === "") throw new TypeError("Nhập VAT để tính thuế và tổng tiền cho giá đã nhập.");
            const amounts = calculateAdminVat(rawSubtotal, vat);
            prices[period] = { subtotal: Number(rawSubtotal), tax: amounts.tax, total: amounts.total };
          }
          const exportCapabilities = creatorCapabilities();
          const benefits = String(creatorField("#admin-new-package-benefits")?.value ?? "")
            .split(/\r?\n/u).map(item => item.trim()).filter(Boolean);
          const monthlyTermDays = periods.includes("monthly")
            ? parseIntegerField(creatorField("#admin-new-package-month-days"), "Số ngày cho kỳ tháng", { nullable: true })
            : null;
          if (monthlyTermDays !== null && (monthlyTermDays < 1 || monthlyTermDays > 3660)) throw new TypeError("Số ngày cho kỳ tháng phải từ 1 đến 3660.");
          const visibility = creatorField("#admin-new-package-visible")?.checked ? "public" : "hidden";
          workingDocument = addAdminServicePackage(documentValue, {
            tier: creatorField("#admin-new-package-tier")?.value,
            variant: creatorField("#admin-new-package-variant")?.value,
            name: creatorField("#admin-new-package-name")?.value,
            periods,
            sourceIndex: creationSource,
            prices,
            monthlyTermDays,
            memberQuota: parseIntegerField(creatorField("#admin-new-package-member-quota"), "Số thành viên tối đa", { nullable: true }),
            includedProcurementQuota: parseIntegerField(creatorField("#admin-new-package-procurement-quota"), "Lượt Mua Sắm Công", { nullable: true }),
            exportCapabilities,
            violationCheckEnabled: Boolean(creatorField("#admin-new-package-violation-check")?.checked),
            description: creatorField("#admin-new-package-description")?.value || "",
            benefits,
            displayOrder: parseIntegerField(creatorField("#admin-new-package-order"), "Thứ tự hiển thị", { nullable: true }),
            visibility,
            recommended: Boolean(creatorField("#admin-new-package-recommended")?.checked),
          });
          selectedIndex = documentValue.offers.length; creatorOpen = false; creatorDirty = false; creationSource = null; packageStep = 0; dirty = true; validation = null; render();
           setStatus(container, "Đã thêm gói vào nội dung chưa lưu. Kiểm tra lại rồi lưu bản nháp.");
           return true;
        } catch (error) {
          error?.field?.classList?.add("is-invalid");
          setStatus(container, error.message, "danger");
          return false;
        }
      };
      button.addEventListener("click", async () => {
        const action = button.dataset.adminPlanAction;
        if (busy) return;
        if (action === "close") {
          if ((dirty || creatorDirty) && !globalThis.confirm("Thay đổi chưa lưu sẽ bị bỏ. Đóng bản nháp?")) return;
          draftOpenController?.abort(); draftOpenSequence += 1;
           draft = null; workingDocument = null; validation = null; dirty = false; creatorDirty = false; creatorOpen = false; activeTab = "catalog"; render(); return;
        }
        if (["create", "create-first", "create-template"].includes(action)) {
          if ((dirty || creatorDirty) && globalThis.confirm?.("Thay đổi chưa lưu sẽ bị bỏ. Tạo bản nháp mới?") === false) return;
          const key = mutationKey(action);
           creatorOpen = action !== "create-template";
          creatorDirty = false;
            creationSource = null; selectedIndex = null; creatorPeriod = "yearly"; packageStep = 0; activeTab = "catalog";
          const body = action === "create-template" ? { templateMode: "complete_templates" } : button.dataset.adminCreateMode === "empty" ? { templateMode: "empty" } : {};
          const message = action === "create-template" ? "Đã tạo bộ 8 gói mẫu trong bản nháp. Hãy chỉnh sửa và kiểm tra trước khi phát hành." : "Đã tạo bản nháp mới.";
          await execute(action === "create-first" ? "create" : action, () => postAdminJson("/api/commercial/drafts", { body, idempotencyKey: key, fetchImpl, signal, retries: 0 }), message, { keepDraft: true });
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
           workingDocument = documentValue; creatorOpen = action === "new-package"; creatorDirty = false; creationSource = null; selectedIndex = null; creatorPeriod = "yearly"; packageStep = 0; activeTab = "catalog"; render(); return;
        }
        if (action === "confirm-package") {
          addPackage();
          return;
        }
        if (action === "configure-exports") {
          await configureExports(); return;
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
          if (creatorOpen && !addPackage()) return;
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
          const publishedDraftId = draft.id;
          const publishedRevision = draft.revision;
          const publishedDigest = validation.validationDigest;
          const rows = workingDocument.offers.map(offer => `${offer.display?.name || offer.code} · ${offer.variant === "internal" ? "Cơ bản" : "Nâng cao"} · ${offer.price.period === "monthly" ? "tháng" : "năm"}: ${formatCommercialMoney(offer.price.total, offer.price.currency)} (${({ sellable: "đang bán", stopped: "dừng bán", non_sellable: "chưa mở bán" })[offer.salesState] || offer.salesState}).`);
          const reason = await requestPlanActionInput(action, { summary: `${rows.join(" ")} Gói đã mua giữ điều kiện cũ.` });
          if (!reason) return;
          if (dirty || creatorDirty || !validationReady(validation) || draft?.id !== publishedDraftId || draft?.revision !== publishedRevision || validation.validationDigest !== publishedDigest) return;
          const local = container.querySelector?.("#admin-plan-effective")?.value || "";
          const effectiveAt = local ? Math.floor(new Date(local).getTime() / 1000) : Math.floor(Date.now() / 1000);
          if (!Number.isFinite(effectiveAt)) { setStatus(container, "Thời điểm hiệu lực không hợp lệ.", "danger"); return; }
          const key = mutationKey(action);
          await execute(action, () => postAdminJson(`/api/commercial/drafts/${encodeURIComponent(draft.id)}/publish`, { body: { expectedRevision: draft.revision, validationDigest: validation.validationDigest, effectiveAt, reason }, idempotencyKey: key, fetchImpl, signal, retries: 0 }), "Đã xuất bản bản nháp.");
        }
      });
    });
    container.querySelectorAll?.("[data-admin-offer-field], #admin-plan-advanced-document, #admin-monthly-term-days, #admin-annual-term-days, [data-admin-policy-choice], [data-admin-commercial-config]").forEach((field) => {
      const markDirty = () => {
        dirty = true;
        validation = null;
        const validationPanel = container.querySelector?.("#admin-plan-validation");
        if (validationPanel) validationPanel.innerHTML = trustedHTML('<div class="alert alert-warning" role="status">Cấu hình đã thay đổi. Lưu bản nháp và kiểm tra lại trước khi mở bán.</div>');
        const status = container.querySelector?.("#admin-plan-status");
        if (status) status.replaceChildren();
        const saveState = container.querySelector?.("[data-admin-package-save-state]");
        if (saveState) saveState.textContent = "Bản nháp chưa lưu";
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
             container.querySelector("[data-admin-package-live-preview]").innerHTML = trustedHTML(packagePreviewMarkup(candidate, selectedIndex, { compact: true }));
             updatePreviewSummary(candidate, selectedIndex);
          }
        }
      };
      const eventName = field.tagName === "SELECT" || field.type === "checkbox" ? "change" : "input";
      field.addEventListener(eventName, markDirty);
    });
  };

  // Keep the draft guard attached to the stable route host. The editor is
  // re-rendered after opening a draft and after every action, so listeners on
  // individual fields can otherwise be lost between renders.
  const markStableEditorDirty = (event) => {
    if (event.target?.closest?.("[data-admin-package-creator]")) {
      creatorDirty = true;
      const saveState = container.querySelector?.("[data-admin-package-save-state]");
      if (saveState) saveState.textContent = "Bản nháp chưa lưu";
      container.querySelector?.("#admin-plan-status")?.replaceChildren();
      container.querySelectorAll?.('[data-admin-plan-action="publish"], [data-admin-plan-action="validate"]').forEach(node => { node.disabled = true; });
      return;
    }
    if (!event.target?.matches?.("[data-admin-offer-field], #admin-plan-advanced-document, #admin-monthly-term-days, #admin-annual-term-days, [data-admin-policy-choice], [data-admin-commercial-config]")) return;
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
