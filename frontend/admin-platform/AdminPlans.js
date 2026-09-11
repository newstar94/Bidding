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
    return `<section class="card h-100" aria-label="${escapeHtml(title)}"><div class="card-body">${adminStateMarkup("empty", { title, message: "Chưa có bản phát hành ở trạng thái này." })}</div></section>`;
  }
  const sellable = release.nonSellable === true ? "Không bán" : (release.nonSellable === false ? "Có thể bán" : "N/A");
  return `<section class="card h-100" aria-label="${escapeHtml(title)}"><div class="card-header"><h3 class="card-title">${escapeHtml(title)}</h3>${actions ? `<div class="card-actions">${actions}</div>` : ""}</div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody><tr><th scope="row">Phiên bản</th><td><strong>${text(release.versionLabel)}</strong></td></tr><tr><th scope="row">Chế độ</th><td>${text(release.mode)}</td></tr><tr><th scope="row">Phạm vi</th><td>${text(release.scopeKey)}</td></tr><tr><th scope="row">Tình trạng bán</th><td>${sellable}</td></tr><tr><th scope="row">Hiệu lực</th><td>${formatDate(release.effectiveFrom)}</td></tr></tbody></table></div></section>`;
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
  return `<section class="card mt-3" aria-labelledby="admin-plan-model-title"><div class="card-header"><div><h3 class="card-title" id="admin-plan-model-title">Khả năng cấu hình gói hiện hành</h3><p class="text-secondary small mb-0">Chỉ những trường được commercial policy hiện tại xác thực mới có thể chỉnh sửa.</p></div></div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody><tr><th scope="row">Giá theo năm</th><td><span class="badge bg-success-lt">Được hỗ trợ</span></td></tr><tr><th scope="row">Giá theo tháng</th><td>N/A · policy hiện tại chỉ hỗ trợ chu kỳ năm</td></tr><tr><th scope="row">Số ngày dùng thử</th><td>N/A · chưa có hợp đồng thương mại</td></tr><tr><th scope="row">Hạn mức lưu trữ</th><td>N/A · chưa có nguồn dữ liệu có thẩm quyền</td></tr><tr><th scope="row">Hạn mức tài liệu</th><td>N/A · hiện chỉ có quyền xuất tài liệu, không có quota</td></tr></tbody></table></div></section>`;
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
  const packs = Array.isArray(catalog?.creditPacks) ? catalog.creditPacks : [];
  const offerContent = offers.length
    ? `<div class="row row-cards">${offers.map(offerCard).join("")}</div>`
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

function offerField(index, name, value, { type = "text", readonly = false, min = null } = {}) {
  const minAttribute = min === null ? "" : ` min="${escapeHtml(min)}"`;
  return `<input class="form-control" type="${escapeHtml(type)}" data-admin-offer-field="${escapeHtml(name)}" value="${escapeHtml(value ?? "")}"${readonly ? " readonly" : ""}${minAttribute} data-offer-index="${index}">`;
}

function offerSelect(index, name, value, options) {
  return `<select class="form-select" data-admin-offer-field="${escapeHtml(name)}" data-offer-index="${index}">${options.map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}"${value === optionValue ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function offerCheckbox(index, name, checked, label) {
  return `<label class="form-check"><input class="form-check-input" type="checkbox" data-admin-offer-field="${escapeHtml(name)}" data-offer-index="${index}"${checked ? " checked" : ""}><span class="form-check-label">${escapeHtml(label)}</span></label>`;
}

function offerEditorMarkup(offer, index) {
  const display = offer?.display && typeof offer.display === "object" ? offer.display : {};
  const price = offer?.price && typeof offer.price === "object" ? offer.price : {};
  const capabilities = offer?.exportCapabilities;
  const capabilityFields = capabilities === null
    ? '<div class="alert alert-warning mb-0" role="status">Quyền xuất của gói này đang ở trạng thái ánh xạ cũ chưa xác định và sẽ được giữ nguyên.</div>'
    : Object.entries(CAPABILITY_LABELS).map(([key, label]) => offerCheckbox(index, `capability:${key}`, capabilities?.[key] === true, label)).join("");
  return `<article class="card mb-3" data-admin-offer-editor data-offer-index="${index}"><div class="card-header"><div><h4 class="card-title">${text(display.name, offer?.code)}</h4><div class="text-secondary small">${text(offer?.code)}</div></div></div><div class="card-body"><div class="row g-3"><div class="col-md-4"><label class="form-label">Mã gói</label>${offerField(index, "code", offer?.code, { readonly: true })}</div><div class="col-md-4"><label class="form-label">Tên hiển thị</label>${offerField(index, "display.name", display.name)}</div><div class="col-md-4"><label class="form-label">Thứ tự hiển thị</label>${offerField(index, "display.order", display.order, { type: "number", min: 0 })}</div><div class="col-md-3"><label class="form-label">Hạng gói</label>${offerField(index, "tier", offer?.tier, { readonly: true })}</div><div class="col-md-3"><label class="form-label">Biến thể</label>${offerField(index, "variant", offer?.variant, { readonly: true })}</div><div class="col-md-3"><label class="form-label">Chủ thể</label>${offerField(index, "ownerKind", offer?.ownerKind, { readonly: true })}</div><div class="col-md-3"><label class="form-label">Chu kỳ</label>${offerField(index, "price.period", price.period, { readonly: true })}</div><div class="col-12"><label class="form-label">Mô tả</label><textarea class="form-control" rows="2" data-admin-offer-field="display.description" data-offer-index="${index}">${escapeHtml(display.description ?? "")}</textarea></div><div class="col-md-3"><label class="form-label">Giá trước thuế</label>${offerField(index, "price.subtotal", price.subtotal, { type: "number", min: 0 })}</div><div class="col-md-3"><label class="form-label">Thuế</label>${offerField(index, "price.tax", price.tax, { type: "number", min: 0 })}</div><div class="col-md-3"><label class="form-label">Tổng tiền</label>${offerField(index, "price.total", price.total, { type: "number", min: 0 })}</div><div class="col-md-3"><label class="form-label">Tiền tệ</label>${offerField(index, "price.currency", price.currency, { readonly: true })}</div><div class="col-md-3"><label class="form-label">Hạn mức thành viên</label>${offerField(index, "memberQuota", offer?.memberQuota, { type: "number", min: 1 })}</div><div class="col-md-3"><label class="form-label">Lượt Mua Sắm Công</label>${offerField(index, "includedProcurementQuota", offer?.includedProcurementQuota, { type: "number", min: 0 })}</div><div class="col-md-3"><label class="form-label">Trạng thái bán</label>${offerSelect(index, "salesState", offer?.salesState, [["sellable", "Đang bán"], ["stopped", "Đã dừng bán"], ["non_sellable", "Không bán"]])}</div><div class="col-md-3"><label class="form-label">Phạm vi hiển thị</label>${offerSelect(index, "display.visibility", display.visibility ?? "", [["", "Theo cấu hình hiện có"], ["public", "Công khai"], ["hidden", "Ẩn"]])}</div><div class="col-md-6"><label class="form-label d-block">Quyền xuất</label>${capabilityFields}</div><div class="col-md-6"><label class="form-label d-block">Tùy chọn</label>${offerCheckbox(index, "violationCheckEnabled", offer?.violationCheckEnabled === true, "Kiểm tra vi phạm nhà thầu")}${offerCheckbox(index, "display.recommended", display.recommended === true, "Gói được đề xuất")}</div><div class="col-12"><label class="form-label">Quyền lợi (mỗi dòng một nội dung)</label><textarea class="form-control" rows="4" data-admin-offer-field="display.benefits" data-offer-index="${index}">${escapeHtml(Array.isArray(display.benefits) ? display.benefits.join("\n") : "")}</textarea></div></div></div></article>`;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseIntegerField(field, label, { optional = false } = {}) {
  const raw = String(field?.value ?? "").trim();
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
    price.subtotal = parseIntegerField(field("price.subtotal"), "Giá trước thuế");
    price.tax = parseIntegerField(field("price.tax"), "Thuế");
    price.total = parseIntegerField(field("price.total"), "Tổng tiền");
    offer.memberQuota = parseIntegerField(field("memberQuota"), "Hạn mức thành viên");
    offer.includedProcurementQuota = parseIntegerField(field("includedProcurementQuota"), "Lượt Mua Sắm Công");
    offer.violationCheckEnabled = Boolean(field("violationCheckEnabled")?.checked);
    offer.salesState = String(field("salesState")?.value ?? "");
    if (offer.exportCapabilities !== null) {
      for (const key of Object.keys(CAPABILITY_LABELS)) {
        offer.exportCapabilities[key] = Boolean(field(`capability:${key}`)?.checked);
      }
    }
    return offer;
  });
  return { ...advanced, offers };
}

export function draftEditorMarkup(draft, validation = null) {
  if (!draft) return "";
  const documentValue = draft.document && typeof draft.document === "object" ? draft.document : {};
  const offers = Array.isArray(documentValue.offers) ? documentValue.offers : [];
  const advanced = cloneJson(documentValue) || {};
  delete advanced.offers;
  return `<section class="card" id="admin-commercial-editor" data-draft-id="${text(draft.id)}"><div class="card-header"><div><h3 class="card-title">Chỉnh sửa ${text(draft.id)}</h3><p class="text-secondary small mb-0">Revision ${text(draft.revision)} · thay đổi chỉ có hiệu lực sau khi lưu, kiểm tra và xuất bản.</p></div></div><div class="card-body"><div id="admin-plan-validation">${validationMarkup(validation)}</div><h4 class="mb-3">Các gói đăng ký</h4>${offers.map(offerEditorMarkup).join("")}<details class="mt-4"><summary class="fw-bold">Cấu hình chính sách nâng cao</summary><p class="text-secondary small mt-2">Chỉ dành cho các phần chưa có biểu mẫu an toàn. Danh sách gói được quản lý ở phía trên.</p><textarea class="form-control font-monospace" id="admin-plan-advanced-document" rows="14" spellcheck="false">${escapeHtml(JSON.stringify(advanced, null, 2))}</textarea><div class="invalid-feedback" id="admin-plan-json-error">JSON không hợp lệ.</div></details><div class="row g-3 mt-1"><div class="col-md-6"><label class="form-label" for="admin-plan-effective">Thời điểm hiệu lực (để trống = ngay)</label><input class="form-control" id="admin-plan-effective" type="datetime-local"></div></div></div><div class="card-footer d-flex flex-wrap gap-2"><button class="btn btn-primary" type="button" data-admin-plan-action="save">Lưu bản nháp</button><button class="btn btn-outline-primary" type="button" data-admin-plan-action="validate">Kiểm tra</button><button class="btn btn-primary" type="button" data-admin-plan-action="publish"${validationReady(validation) ? "" : " disabled"}>Xuất bản</button><button class="btn btn-ghost-secondary ms-auto" type="button" data-admin-plan-action="close">Đóng</button></div></section>`;
}

export function plansMarkup(payload, { editor = "", catalog = null } = {}) {
  const current = payload?.currentRelease || null;
  const scheduled = payload?.scheduledRelease || null;
  const drafts = Array.isArray(payload?.drafts) ? payload.drafts : [];
  const releaseHistory = Array.isArray(payload?.releaseHistory) ? payload.releaseHistory : [];
  const empty = !current && !scheduled && drafts.length === 0;
  const currentActions = current
    ? `<button class="btn btn-sm btn-outline-primary" type="button" data-admin-plan-action="clone" data-release-id="${text(current.id)}">Nhân bản</button> <button class="btn btn-sm btn-outline-danger" type="button" data-admin-plan-action="stop-sales" data-release-id="${text(current.id)}"${current.nonSellable ? " disabled" : ""}>Dừng bán</button>`
    : "";
  const releaseManagement = empty ? adminStateMarkup("empty", { message: "Chưa có phiên bản gói dịch vụ hoặc bản nháp thương mại." }) : `<div class="row row-cards"><div class="col-lg-6">${releaseCard("Bản đang hiệu lực", current, currentActions)}</div><div class="col-lg-6">${releaseCard("Bản đã lên lịch", scheduled)}</div><div class="col-12"><section class="card" aria-labelledby="commercial-drafts-title"><div class="card-header"><div><h3 class="card-title" id="commercial-drafts-title">Bản nháp thương mại</h3><p class="text-secondary small mb-0">Mọi thay đổi dùng quy trình versioned policy hiện hành.</p></div></div>${draftTable(drafts)}</section></div>${editor ? `<div class="col-12">${editor}</div>` : ""}</div>`;
  const history = `<section class="card mt-3" aria-labelledby="commercial-release-history-title"><div class="card-header"><div><h3 class="card-title" id="commercial-release-history-title">Lịch sử phát hành thương mại</h3><p class="text-secondary small mb-0">Tối đa 20 bản gần nhất từ kho phát hành bất biến.</p></div></div>${releaseHistoryMarkup(releaseHistory)}</section>`;
  return `<div class="d-flex justify-content-end mb-3"><button class="btn btn-primary" type="button" data-admin-plan-action="create">Tạo bản nháp</button></div>${catalog ? `${catalogMarkup(catalog)}<hr class="my-4"><h3 class="h2 mb-3">Quản lý phiên bản</h3>` : ""}${releaseManagement}${planModelMarkup()}${history}<div class="mt-3" id="admin-plan-status" aria-live="polite"></div>`;
}

function mutationKey(action) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return `admin-plan-${action}-${suffix}`;
}

export async function requestPlanActionInput(action, { requestValue = requestAdminValue } = {}) {
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
      message: "Xuất bản toàn bộ bản nháp này?",
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
  let draft = null;
  let validation = null;
  let busy = false;

  const render = () => {
    renderAdminMarkup(container, plansMarkup(overview, {
      editor: draftEditorMarkup(draft, validation),
      catalog,
    }));
    bind();
  };
  const refresh = async ({ keepDraft = false } = {}) => {
    [overview, catalog] = await Promise.all([
      getAdminJson("/api/commercial/admin/overview", { fetchImpl, signal }),
      getAdminJson("/api/public/commercial/offers", { fetchImpl, signal }),
    ]);
    if (!keepDraft) { draft = null; validation = null; }
    render();
  };
  const execute = async (action, operation, success, { keepDraft = false } = {}) => {
    if (busy) return;
    busy = true;
    container.querySelectorAll?.("button, textarea, input, select").forEach((node) => { node.disabled = true; });
    try {
      const result = await runWithStepUp(operation, { fetchImpl, signal });
      if (result?.document) draft = result;
      await refresh({ keepDraft: keepDraft || Boolean(result?.document) });
      setStatus(container, success);
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
      const documentValue = serializeDraftDocument(container, draft?.document);
      container.querySelectorAll?.(".is-invalid").forEach((field) => field.classList.remove("is-invalid"));
      return documentValue;
    } catch (error) {
      error?.field?.classList?.add("is-invalid");
      setStatus(container, error?.message || "Dữ liệu bản nháp không hợp lệ.", "danger");
      return null;
    }
  };
  const bind = () => {
    container.querySelectorAll?.("[data-admin-draft-open]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          draft = await getAdminJson(`/api/commercial/drafts/${encodeURIComponent(button.dataset.adminDraftOpen)}`, { fetchImpl, signal });
          validation = draft.validation ? { ...draft.validation, validationDigest: draft.validationDigest, readinessExpiresAt: draft.readinessExpiresAt } : null;
          render();
          container.querySelector?.("#admin-commercial-editor")?.scrollIntoView?.({ block: "start" });
        } catch (error) { setStatus(container, error.message, "danger"); }
      });
    });
    container.querySelectorAll?.("[data-admin-plan-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.adminPlanAction;
        if (action === "close") { draft = null; validation = null; render(); return; }
        if (action === "create") {
          const key = mutationKey(action);
          await execute(action, () => postAdminJson("/api/commercial/drafts", { body: {}, idempotencyKey: key, fetchImpl, signal, retries: 0 }), "Đã tạo bản nháp mới.", { keepDraft: true });
          return;
        }
        if (action === "clone") {
          if (!await requestPlanActionInput(action)) return;
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
        if (action === "save") {
          const documentValue = readDocument();
          if (!documentValue) return;
          const revision = draft.revision;
          const key = mutationKey(action);
          validation = null;
          await execute(action, () => patchAdminJson(`/api/commercial/drafts/${encodeURIComponent(draft.id)}`, { body: { expectedRevision: revision, document: documentValue }, expectedRevision: revision, idempotencyKey: key, fetchImpl, signal }), "Đã lưu bản nháp.", { keepDraft: true });
          return;
        }
        if (action === "validate") {
          const key = mutationKey(action);
          try {
            validation = await runWithStepUp(() => postAdminJson(`/api/commercial/drafts/${encodeURIComponent(draft.id)}/validate`, { body: { expectedRevision: draft.revision }, idempotencyKey: key, fetchImpl, signal, retries: 0 }), { fetchImpl, signal });
            render();
            setStatus(container, validation.errors?.length ? "Kiểm tra còn lỗi cần xử lý." : "Kiểm tra đạt.", validation.errors?.length ? "danger" : "success");
          } catch (error) { setStatus(container, error.message, "danger"); }
          return;
        }
        if (action === "publish") {
          if (!validationReady(validation)) return;
          const reason = await requestPlanActionInput(action);
          if (!reason) return;
          const local = container.querySelector?.("#admin-plan-effective")?.value || "";
          const effectiveAt = local ? Math.floor(new Date(local).getTime() / 1000) : Math.floor(Date.now() / 1000);
          if (!Number.isFinite(effectiveAt)) { setStatus(container, "Thời điểm hiệu lực không hợp lệ.", "danger"); return; }
          const key = mutationKey(action);
          await execute(action, () => postAdminJson(`/api/commercial/drafts/${encodeURIComponent(draft.id)}/publish`, { body: { expectedRevision: draft.revision, validationDigest: validation.validationDigest, effectiveAt, reason }, idempotencyKey: key, fetchImpl, signal, retries: 0 }), "Đã xuất bản bản nháp.");
        }
      });
    });
  };

  renderAdminMarkup(container, adminLoadingMarkup("Đang tải phiên bản gói dịch vụ…"), { busy: true });
  try { await refresh(); }
  catch (error) {
    if (signal?.aborted) return;
    renderAdminFailure(container, error, () => renderAdminPlans(container, { fetchImpl, signal }));
  }
}
