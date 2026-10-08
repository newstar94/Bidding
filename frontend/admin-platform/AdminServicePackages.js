import { escapeHtml } from "../shared/view_helpers.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { formatCommercialMoney, presentCommercialOffer } from "../commercial-policy/PublicCommercialCatalog.js";
import { adminIconMarkup } from "./AdminIcons.js";

export const PACKAGE_TIERS = Object.freeze({ personal: "Cá nhân", silver: "Bạc", gold: "Vàng", diamond: "Kim cương" });
const GROUP_NAMES = Object.freeze({ internal: "Cơ bản", connected: "Nâng cao" });
const EXPORT_NAMES = Object.freeze({
  "document.export.word": "Xuất Word",
  "document.export.excel": "Xuất Excel",
  "document.export.award_result_excel": "Xuất kết quả lựa chọn nhà thầu",
});
const clone = value => JSON.parse(JSON.stringify(value));
const priceText = offer => Number.isSafeInteger(offer?.price?.total)
  ? escapeHtml(formatCommercialMoney(offer.price.total, offer.price.currency)) : "Chưa cấu hình";

export function calculateAdminVat(subtotalText, percentText) {
  if (!/^(0|[1-9]\d*)$/u.test(subtotalText) || !/^\d{1,3}(?:[.,]\d{1,2})?$/u.test(percentText)) throw new TypeError("Nhập giá nguyên VND và VAT từ 0 đến 100%, tối đa 2 chữ số thập phân.");
  const [whole, fraction = ""] = percentText.replace(",", ".").split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (basisPoints > 10000) throw new TypeError("VAT phải từ 0 đến 100%.");
  const subtotal = BigInt(subtotalText);
  const tax = (subtotal * BigInt(basisPoints) + 5000n) / 10000n;
  const total = subtotal + tax;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError("Tổng tiền vượt giới hạn số nguyên an toàn.");
  return { tax: Number(tax), total: Number(total) };
}

export function groupAdminPackages(offers = []) {
  const groups = new Map();
  offers.forEach((offer, index) => {
    const key = `${offer.variant}:${offer.tier}:${offer.ownerKind}`;
    if (!groups.has(key)) groups.set(key, { key, variant: offer.variant, offers: [] });
    groups.get(key).offers.push({ offer, index });
  });
  return [...groups.values()];
}

export function packagePreviewMarkup(documentValue, index, { published = false, compact = false } = {}) {
  const offer = documentValue?.offers?.[index];
  if (!offer) return '<p class="text-secondary">Chọn gói để xem trước.</p>';
  const presented = presentCommercialOffer(offer);
  const group = groupAdminPackages(documentValue.offers).find(item => item.offers.some(entry => entry.index === index));
  const periods = ["monthly", "yearly"].map(period => {
    const entry = group.offers.find(item => item.offer.price?.period === period);
    const label = period === "monthly" ? "Hàng tháng" : "Hàng năm";
    return `<button type="button" class="btn btn-sm ${entry?.index === index ? "btn-primary" : "btn-outline-secondary"}" data-admin-package-period="${entry?.index ?? ""}" aria-pressed="${entry?.index === index}"${entry ? "" : " disabled"}>${label}</button>`;
  }).join("");
  const integer = value => Number.isSafeInteger(value) ? escapeHtml(value.toLocaleString("vi-VN")) : "Chưa cấu hình";
  const procurement = offer.variant === "internal"
    ? "Không lấy dữ liệu Mua Sắm Công"
    : `Lượt Mua Sắm Công kèm theo: <strong>${integer(offer.includedProcurementQuota)}</strong>`;
  const rights = Object.entries(EXPORT_NAMES).map(([key, label]) => `<li>${label}: <strong>${offer.exportCapabilities === null ? "Chưa cấu hình" : offer.exportCapabilities?.[key] === true ? "Có" : "Không"}</strong></li>`).join("");
  const grantedRights = Object.entries(EXPORT_NAMES).filter(([key]) => offer.exportCapabilities?.[key] === true)
    .map(([, label]) => `<li>${adminIconMarkup("plans", "bf-admin-package-benefit-icon")}<span>${label}</span></li>`).join("");
  const compactBenefits = (offer.display?.benefits || []).map(item => `<li><span class="bf-admin-package-benefit-check" aria-hidden="true">✓</span><span>${escapeHtml(item)}</span></li>`).join("");
  const featureList = compact
    ? `<ul class="bf-admin-package-customer-benefits"><li>${adminIconMarkup("users", "bf-admin-package-benefit-icon")}<span>${integer(offer.memberQuota)} thành viên</span></li><li>${adminIconMarkup("integration", "bf-admin-package-benefit-icon")}<span>${procurement}</span></li>${grantedRights}${offer.violationCheckEnabled === true ? `<li>${adminIconMarkup("plans", "bf-admin-package-benefit-icon")}<span>Kiểm tra vi phạm nhà thầu</span></li>` : ""}${compactBenefits}</ul><details class="bf-admin-package-rights-details"><summary>Chi tiết quyền lợi</summary><ul><li>Hạn mức thành viên: <strong>${integer(offer.memberQuota)}</strong></li><li>${procurement}</li><li>Kiểm tra vi phạm nhà thầu: <strong>${offer.violationCheckEnabled === true ? "Có" : "Không"}</strong></li>${rights}</ul></details><button class="btn btn-outline-secondary w-100 mt-3" type="button" disabled>Đăng ký gói</button>`
    : `<ul class="bf-admin-plan-benefits">${presented.details.map(item => `<li>${escapeHtml(item.label)}${item.value === undefined ? "" : `: <strong>${escapeHtml(item.value)}</strong>`}</li>`).join("")}</ul>`;
  return `<article class="card bf-admin-package-preview${presented.recommended ? " is-recommended" : ""}" data-admin-offer-code="${escapeHtml(offer.code || "")}"><div class="card-body"><div class="d-flex justify-content-between gap-2"><span class="text-secondary small">${offer.ownerKind === "account" ? "CÁ NHÂN" : "TỔ CHỨC"}</span><span class="bf-admin-package-status"><span aria-hidden="true"></span>${published ? "Đã phát hành" : "Bản nháp"}</span></div><h4 class="h2 mt-2 mb-1">${escapeHtml(presented.name)}</h4><p class="text-secondary small">${compact ? "Gói " : ""}${escapeHtml(presented.variantLabel || GROUP_NAMES[offer.variant] || offer.variant || "")}${compact ? "" : ` · ${escapeHtml(offer.code || "")}`}</p>${presented.recommended ? '<span class="badge bg-primary-lt">Gói đề xuất</span>' : ""}<div class="bf-admin-package-period" aria-label="Kỳ thanh toán">${periods}</div><div class="bf-admin-plan-price text-center">${priceText(offer)}</div><p class="text-secondary small text-center">Giá bán sau VAT ${escapeHtml(presented.periodLabel)}</p>${presented.description ? `<p class="text-secondary">${escapeHtml(presented.description)}</p>` : ""}${featureList}<div class="text-secondary small border-top pt-2 mt-3">${({ sellable: "Đang bán", stopped: "Đã dừng bán", non_sellable: "Chưa mở bán" })[offer.salesState] || "Chưa cấu hình"} · ${offer.display?.visibility === "hidden" ? "Không hiện trên bảng giá" : "Hiển thị trên bảng giá"}</div></div></article>`;
}

export function packageManagerMarkup(documentValue, { published = false, id = "draft", emptyMarkup = "" } = {}) {
  const offers = documentValue?.offers || [];
  const groups = groupAdminPackages(offers);
  const defaultGroupCount = groups.filter(group => group.variant === "internal").length;
  const rows = groups.map(group => {
    const year = group.offers.find(item => item.offer.price?.period === "yearly");
    const month = group.offers.find(item => item.offer.price?.period === "monthly");
    const chosen = year || month || group.offers[0];
    const offer = chosen.offer;
    const owner = offer.ownerKind === "account" ? "Cá nhân" : offer.ownerKind === "organization" ? "Tổ chức" : offer.ownerKind;
    const edit = published ? `data-admin-package-edit-code="${escapeHtml(offer.code)}"` : `data-admin-package-edit="${chosen.index}"`;
    const status = published ? "Đã phát hành" : "Bản nháp";
    return `<tr data-admin-package-variant="${escapeHtml(group.variant)}"><td><strong class="bf-admin-package-name">${escapeHtml(offer.display?.name || offer.code)}</strong><div class="text-secondary small">${escapeHtml(owner)} · ${escapeHtml(PACKAGE_TIERS[offer.tier] || offer.tier)}</div></td><td class="bf-admin-package-money">${month ? priceText(month.offer) : "Chưa mở bán"}</td><td class="bf-admin-package-money">${year ? priceText(year.offer) : "Chưa cấu hình"}</td><td>${Number.isSafeInteger(offer.memberQuota) ? escapeHtml(offer.memberQuota) : "—"}</td><td><span class="bf-admin-package-status"><span aria-hidden="true"></span>${status}</span></td><td class="text-end"><button class="btn btn-sm btn-ghost-primary" type="button" ${edit}>${published ? "Chỉnh sửa" : "Sửa"}</button>${published ? "" : ` <button class="btn btn-sm btn-ghost-primary" type="button" data-admin-package-copy="${chosen.index}">Nhân bản</button>`}</td></tr>`;
  }).join("");
  const cards = groups.map(group => {
    const chosen = group.offers.find(item => item.offer.price?.period === "yearly") || group.offers[0];
    return `<div class="bf-admin-package-tile" data-admin-package-variant="${escapeHtml(group.variant)}" data-admin-package-card="${chosen.index}">${packagePreviewMarkup(documentValue, chosen.index, { published })}${published ? `<button class="btn btn-outline-primary mt-2" type="button" data-admin-package-edit-code="${escapeHtml(chosen.offer.code)}">Chỉnh sửa</button>` : `<button class="btn btn-outline-primary mt-2" type="button" data-admin-package-edit="${chosen.index}">Chỉnh sửa</button>`}</div>`;
  }).join("");
  const emptyContent = emptyMarkup || `<p class="empty-title">Chưa có gói trong nhóm này</p><p class="empty-subtitle text-secondary">${published ? "Chưa công bố gói dịch vụ." : "Tạo gói mới hoặc dùng bộ 8 gói mẫu để điền cấu hình."}</p>${published ? "" : '<button class="btn btn-primary" type="button" data-admin-plan-action="new-package">Tạo gói</button>'}`;
  return `<section class="bf-admin-package-manager" data-admin-package-manager="${id}" data-published="${published}"><div class="bf-admin-package-toolbar"><div class="btn-group bf-admin-package-segment" aria-label="Nhóm gói"><button type="button" class="btn btn-primary" data-admin-package-group="internal" aria-pressed="true">Cơ bản</button><button type="button" class="btn btn-outline-primary" data-admin-package-group="connected" aria-pressed="false">Nâng cao</button>${groups.some(group => !GROUP_NAMES[group.variant]) ? '<button type="button" class="btn btn-outline-primary" data-admin-package-group="other" aria-pressed="false">Gói khác</button>' : ""}</div><span class="bf-admin-package-count text-secondary small" data-admin-package-count>${defaultGroupCount} gói · Giá hiển thị sau VAT</span><div class="btn-group bf-admin-package-layout-toggle" aria-label="Cách xem gói"><button type="button" class="btn btn-sm btn-primary" data-admin-package-layout="table" aria-pressed="true">Bảng quản lý</button><button type="button" class="btn btn-sm btn-outline-primary" data-admin-package-layout="cards" aria-pressed="false">Thẻ trực quan</button></div></div><div data-admin-package-table class="card table-responsive bf-admin-package-table-panel"><table class="table table-vcenter card-table"><thead><tr><th>Gói dịch vụ</th><th>Giá tháng</th><th>Giá năm</th><th>Thành viên</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows}</tbody></table></div><div data-admin-package-cards class="bf-admin-package-grid" hidden>${cards}</div><div class="empty bf-admin-package-empty" data-admin-package-empty hidden>${emptyContent}</div></section>`;
}

export function packageCreatorMarkup(source = null, taxPolicy = {}) {
  const options = Object.entries(PACKAGE_TIERS).map(([value, label]) => `<option value="${value}"${source?.tier === value ? " selected" : ""}>${label}${value === "personal" ? "" : " · Tổ chức"}</option>`).join("");
  const sourceTier = source?.tier || "personal";
  const ownerKind = sourceTier === "personal" ? "account" : "organization";
  const variant = source?.variant || "internal";
  const tierDisabled = ownerKind === "account" ? " disabled" : "";
  const sourceCapabilities = source?.exportCapabilities && typeof source.exportCapabilities === "object" ? source.exportCapabilities : {};
  const capability = key => sourceCapabilities[key] === true ? " checked" : "";
  const memberQuota = source?.memberQuota ?? (sourceTier === "personal" ? 1 : "");
  const procurementQuota = variant === "internal" ? 0 : (source?.includedProcurementQuota ?? "");
  const visibility = source?.display?.visibility !== "hidden";
  const order = Number.isSafeInteger(source?.display?.order) ? source.display.order : 1;
  const benefits = Array.isArray(source?.display?.benefits) ? source.display.benefits.join("\n") : "";
  return `<div class="bf-admin-package-creator" data-admin-package-creator><section class="bf-admin-editor-group" aria-labelledby="admin-creator-identity-title"><h5 id="admin-creator-identity-title">1. Thông tin gói</h5><div class="row g-3"><div class="col-md-6"><label class="form-label" for="admin-new-package-name">Tên hiển thị <span class="text-danger" aria-hidden="true">*</span></label><input class="form-control" id="admin-new-package-name" maxlength="120" value="${escapeHtml(source?.display?.name || "")}" placeholder="Nhập tên gói"></div><div class="col-md-6"><label class="form-label" for="admin-new-package-variant">Nhóm gói <span class="text-danger" aria-hidden="true">*</span></label><select class="form-select" id="admin-new-package-variant"><option value="internal"${variant === "internal" ? " selected" : ""}>Cơ bản</option><option value="connected"${variant === "connected" ? " selected" : ""}>Nâng cao</option></select></div><div class="col-md-6"><label class="form-label" for="admin-new-package-owner">Đối tượng <span class="text-danger" aria-hidden="true">*</span></label><select class="form-select" id="admin-new-package-owner"><option value="account"${ownerKind === "account" ? " selected" : ""}>Cá nhân</option><option value="organization"${ownerKind === "organization" ? " selected" : ""}>Tổ chức</option></select></div><div class="col-md-6"><label class="form-label" for="admin-new-package-tier">Mức gói</label><select class="form-select" id="admin-new-package-tier"${tierDisabled}>${options}</select></div><div class="col-12"><label class="form-label" for="admin-new-package-description">Mô tả ngắn</label><input class="form-control" id="admin-new-package-description" maxlength="240" value="${escapeHtml(source?.display?.description || "")}" placeholder="Ví dụ: Dành cho nhóm triển khai hồ sơ"></div></div></section><section class="bf-admin-editor-group" aria-labelledby="admin-creator-period-title"><h5 id="admin-creator-period-title">2. Giá &amp; kỳ hạn</h5><div class="row g-3"><div class="col-md-6"><div class="bf-admin-period-input"><label class="form-check mb-2" for="admin-new-package-month"><input class="form-check-input" id="admin-new-package-month" type="checkbox"><span class="form-check-label">Hàng tháng</span></label><label class="form-label" for="admin-new-package-month-price">${taxPolicy?.taxInclusive === true ? "Giá đã gồm VAT (VND)" : "Giá chưa VAT (VND)"}</label><input class="form-control" id="admin-new-package-month-price" type="number" min="0" placeholder="Nhập giá tháng"></div></div><div class="col-md-6"><div class="bf-admin-period-input"><label class="form-check mb-2" for="admin-new-package-year"><input class="form-check-input" id="admin-new-package-year" type="checkbox" checked><span class="form-check-label">Hàng năm</span></label><label class="form-label" for="admin-new-package-year-price">${taxPolicy?.taxInclusive === true ? "Giá đã gồm VAT (VND)" : "Giá chưa VAT (VND)"}</label><input class="form-control" id="admin-new-package-year-price" type="number" min="0" readonly placeholder="Giá tháng × 10"></div></div><div class="col-md-6"><label class="form-label" for="admin-new-package-vat">Thuế VAT (%) <span class="text-danger" aria-hidden="true">*</span></label><input class="form-control" id="admin-new-package-vat" value="${Number.isInteger(taxPolicy?.taxBasisPoints) ? taxPolicy.taxBasisPoints / 100 : ""}" type="number" min="0" max="100" step="0.01" placeholder="Nhập mức thuế"></div><div class="col-md-6"><label class="form-label" for="admin-new-package-month-days">Số ngày cho kỳ tháng</label><input class="form-control" id="admin-new-package-month-days" type="number" min="1" max="3660" placeholder="Theo chính sách kỳ hạn"></div></div><p class="text-secondary small mt-2 mb-0">Nhập giá gốc tháng. Giá năm = giá tháng × 10. Chỉ bật Hàng tháng khi đã cấu hình kỳ hạn và muốn mở bán kỳ tháng.</p></section><section class="bf-admin-editor-group" aria-labelledby="admin-creator-limits-title"><h5 id="admin-creator-limits-title">3. Hạn mức &amp; tính năng</h5><div class="row g-3"><div class="col-md-6"><label class="form-label" for="admin-new-package-member-quota">Số thành viên tối đa <span class="text-danger" aria-hidden="true">*</span></label><input class="form-control" id="admin-new-package-member-quota" type="number" min="1" value="${escapeHtml(memberQuota)}" placeholder="Nhập hạn mức"></div><div class="col-md-6"><label class="form-label" for="admin-new-package-procurement-quota">Lượt Mua Sắm Công trong kỳ</label><input class="form-control" id="admin-new-package-procurement-quota" type="number" min="0" value="${escapeHtml(procurementQuota)}" placeholder="Nhập hạn mức"${variant === "internal" ? " readonly" : ""}></div></div><p class="bf-admin-editor-hint" data-admin-creator-procurement-hint>${variant === "internal" ? "Cơ bản: không lấy dữ liệu từ Mua Sắm Công." : "Nâng cao: hạn mức đi theo kỳ đã mua."}</p><div class="bf-admin-feature-choices"><div class="bf-admin-check-grid"><label class="form-check"><input class="form-check-input" type="checkbox" data-admin-creator-field="capability:document.export.word"${capability("document.export.word")}><span class="form-check-label">Xuất tài liệu Word</span></label><label class="form-check"><input class="form-check-input" type="checkbox" data-admin-creator-field="capability:document.export.excel"${capability("document.export.excel")}><span class="form-check-label">Xuất Excel</span></label><label class="form-check"><input class="form-check-input" type="checkbox" data-admin-creator-field="capability:document.export.award_result_excel"${capability("document.export.award_result_excel")}><span class="form-check-label">Xuất kết quả lựa chọn nhà thầu</span></label></div><div class="bf-admin-check-grid"><label class="form-check"><input class="form-check-input" id="admin-new-package-violation-check" type="checkbox"${source?.violationCheckEnabled === true ? " checked" : ""}><span class="form-check-label">Kiểm tra vi phạm nhà thầu</span></label></div></div><p class="text-secondary small mt-2 mb-0">Quyền xuất chỉ áp dụng cho thao tác tạo tài liệu.</p></section><section class="bf-admin-editor-group" aria-labelledby="admin-creator-presentation-title"><h5 id="admin-creator-presentation-title">4. Trình bày</h5><div class="row g-3"><div class="col-12"><label class="form-label" for="admin-new-package-benefits">Lợi ích hiển thị · mỗi dòng một mục</label><textarea class="form-control" id="admin-new-package-benefits" rows="3" placeholder="Nhập nội dung giới thiệu gói">${escapeHtml(benefits)}</textarea></div><div class="col-md-6"><label class="form-label" for="admin-new-package-order">Thứ tự hiển thị</label><input class="form-control" id="admin-new-package-order" type="number" min="0" value="${escapeHtml(order)}"></div><div class="col-12"><label class="form-check" for="admin-new-package-visible"><input class="form-check-input" id="admin-new-package-visible" type="checkbox"${visibility ? " checked" : ""}><span class="form-check-label">Hiển thị trên bảng giá</span></label><label class="form-check mt-2" for="admin-new-package-recommended"><input class="form-check-input" id="admin-new-package-recommended" type="checkbox"${source?.display?.recommended === true ? " checked" : ""}><span class="form-check-label">Đánh dấu gói đề xuất</span></label></div></div><p class="text-secondary small mt-2 mb-0">Bản nháp mới chưa mở bán cho đến khi được lưu, kiểm tra và xuất bản.</p></section></div>`;
}

export function addAdminServicePackage(documentValue, {
  tier, variant, name, periods = ["yearly"], sourceIndex = null, prices = {}, monthlyTermDays = null,
  memberQuota = undefined, includedProcurementQuota = undefined, exportCapabilities = undefined,
  violationCheckEnabled = undefined, description = undefined, benefits = undefined, displayOrder = undefined,
  visibility = undefined, recommended = undefined,
}) {
  if (!Object.hasOwn(PACKAGE_TIERS, tier) || !Object.hasOwn(GROUP_NAMES, variant)) throw new TypeError("Chọn nhóm và mức gói hợp lệ.");
  if (!name?.trim()) throw new TypeError("Nhập tên hiển thị của gói.");
  if (!periods.length || new Set(periods).size !== periods.length || periods.some(period => !["yearly", "monthly"].includes(period))) throw new TypeError("Chọn ít nhất một kỳ tháng hoặc năm.");
  const next = clone(documentValue);
  next.offers ||= [];
  if (next.offers.length + periods.length > 16) throw new TypeError("Danh mục hỗ trợ tối đa 16 giá theo kỳ.");
  const source = sourceIndex === null ? null : next.offers[sourceIndex];
  if (sourceIndex !== null && !source) throw new TypeError("Không tìm thấy gói nguồn.");
  for (const period of periods) {
    const code = `${tier}.${variant}.${period}`;
    if (next.offers.some(offer => offer.code === code || (offer.tier === tier && offer.variant === variant && offer.price?.period === period))) throw new TypeError(`Gói ${PACKAGE_TIERS[tier]} · ${GROUP_NAMES[variant]} đã có giá ${period === "yearly" ? "năm" : "tháng"}. Hãy chỉnh sửa gói hiện có.`);
    const offer = source ? clone(source) : { exportCapabilities: null, violationCheckEnabled: false, display: {} };
    Object.assign(offer, { code, tier, variant, ownerKind: tier === "personal" ? "account" : "organization", salesState: "non_sellable" });
    const configuredPrice = prices?.[period] && typeof prices[period] === "object" ? prices[period] : {};
    offer.price = {
      ...offer.price, currency: "VND", period,
      subtotal: configuredPrice.subtotal ?? null,
      tax: configuredPrice.tax ?? null,
      total: configuredPrice.total ?? null,
      ...(configuredPrice.monthlyBaseAmount !== undefined ? { monthlyBaseAmount: configuredPrice.monthlyBaseAmount } : {}),
    };
    if (!Object.hasOwn(configuredPrice, "monthlyBaseAmount")) delete offer.price.monthlyBaseAmount;
    offer.memberQuota = memberQuota !== undefined ? memberQuota : tier === "personal" ? 1 : source?.memberQuota ?? null;
    offer.includedProcurementQuota = variant === "internal" ? 0 : includedProcurementQuota !== undefined ? includedProcurementQuota : null;
    if (exportCapabilities !== undefined) offer.exportCapabilities = exportCapabilities === null ? null : clone(exportCapabilities);
    if (violationCheckEnabled !== undefined) offer.violationCheckEnabled = Boolean(violationCheckEnabled);
    offer.display = { ...offer.display, name: name.trim(), recommended: recommended !== undefined ? Boolean(recommended) : false };
    if (description !== undefined) {
      if (description === "") delete offer.display.description;
      else offer.display.description = String(description).trim();
    }
    if (benefits !== undefined) offer.display.benefits = Array.isArray(benefits) ? benefits.map(item => String(item).trim()).filter(Boolean) : [];
    if (displayOrder !== undefined && displayOrder !== null) offer.display.order = displayOrder;
    else if (displayOrder === null) delete offer.display.order;
    if (visibility !== undefined) {
      if (visibility === null || visibility === "") delete offer.display.visibility;
      else offer.display.visibility = visibility;
    }
    delete offer.display.periodLabel;
    next.offers.push(offer);
  }
  if (periods.includes("monthly")) {
    next.policies ||= {};
    if (monthlyTermDays !== null && monthlyTermDays !== undefined && monthlyTermDays !== "") {
      next.policies.monthlyBaseTerm = { ...next.policies.monthlyBaseTerm, kind: "fixed_days", days: monthlyTermDays };
      delete next.policies.monthlyBaseTerm.reason;
    } else {
      next.policies.monthlyBaseTerm ||= { kind: "blocked_decision", reason: "Chưa cấu hình số ngày hiệu lực gói tháng." };
    }
  }
  return next;
}

export function configureAdminExportMapping(documentValue, index) {
  const next = clone(documentValue);
  const offer = next.offers?.[index];
  if (!offer || offer.exportCapabilities !== null) throw new TypeError("Gói không có ánh xạ quyền xuất đang chờ cấu hình.");
  offer.exportCapabilities = Object.fromEntries(Object.keys(EXPORT_NAMES).map(key => [key, false]));
  return next;
}

export function bindPackageManager(manager, documentValue, { group = "internal", layout = "table", onState = () => {} } = {}) {
  const groups = groupAdminPackages(documentValue?.offers || []);
  const apply = () => {
    const matches = variant => group === "other" ? !Object.hasOwn(GROUP_NAMES, variant) : variant === group;
    const visibleGroupCount = groups.filter(item => matches(item.variant)).length;
    manager.querySelectorAll("[data-admin-package-variant]").forEach(node => { node.hidden = !matches(node.dataset.adminPackageVariant); });
    manager.querySelector("[data-admin-package-table]").hidden = layout !== "table" || visibleGroupCount === 0;
    manager.querySelector("[data-admin-package-cards]").hidden = layout !== "cards" || visibleGroupCount === 0;
    manager.querySelector("[data-admin-package-empty]").hidden = documentValue.offers.some(offer => matches(offer.variant));
    const count = manager.querySelector("[data-admin-package-count]");
    if (count) count.textContent = `${visibleGroupCount} gói · Giá hiển thị sau VAT`;
    const layoutToggle = manager.querySelector(".bf-admin-package-layout-toggle");
    if (layoutToggle) layoutToggle.hidden = visibleGroupCount === 0;
    for (const [attr, value] of [["group", group], ["layout", layout]]) manager.querySelectorAll(`[data-admin-package-${attr}]`).forEach(button => {
      const pressed = button.dataset[attr === "group" ? "adminPackageGroup" : "adminPackageLayout"] === value;
      button.setAttribute("aria-pressed", String(pressed)); button.classList.toggle("btn-primary", pressed); button.classList.toggle("btn-outline-primary", !pressed);
    });
  };
  manager.querySelectorAll("[data-admin-package-group], [data-admin-package-layout]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.adminPackageGroup) group = button.dataset.adminPackageGroup;
    else layout = button.dataset.adminPackageLayout;
    apply(); onState({ group, layout });
  }));
  manager.addEventListener("click", event => {
    const button = event.target.closest?.("[data-admin-package-period]");
    if (!button) return;
    const tile = button.closest("[data-admin-package-card]");
    if (!tile || button.disabled) return;
    const index = Number(button.dataset.adminPackagePeriod);
    tile.querySelector(".bf-admin-package-preview").outerHTML = trustedHTML(packagePreviewMarkup(documentValue, index, { published: manager.dataset.published === "true" }));
  });
  apply();
}
