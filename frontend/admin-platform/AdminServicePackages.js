import { escapeHtml } from "../shared/view_helpers.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { formatCommercialMoney, presentCommercialOffer } from "../commercial-policy/PublicCommercialCatalog.js";

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

export function packagePreviewMarkup(documentValue, index, { published = false } = {}) {
  const offer = documentValue?.offers?.[index];
  if (!offer) return '<p class="text-secondary">Chọn gói để xem trước.</p>';
  const presented = presentCommercialOffer(offer);
  const group = groupAdminPackages(documentValue.offers).find(item => item.offers.some(entry => entry.index === index));
  const periods = ["monthly", "yearly"].map(period => {
    const entry = group.offers.find(item => item.offer.price?.period === period);
    const label = period === "monthly" ? "Hàng tháng" : "Hàng năm";
    return `<button type="button" class="btn btn-sm ${entry?.index === index ? "btn-primary" : "btn-outline-secondary"}" data-admin-package-period="${entry?.index ?? ""}" aria-pressed="${entry?.index === index}"${entry ? "" : " disabled"}>${label}</button>`;
  }).join("");
  const rights = Object.entries(EXPORT_NAMES).map(([key, label]) => `<li>${label}: <strong>${offer.exportCapabilities === null ? "Chưa cấu hình" : offer.exportCapabilities?.[key] === true ? "Có" : "Không"}</strong></li>`).join("");
  const integer = value => Number.isSafeInteger(value) ? escapeHtml(value.toLocaleString("vi-VN")) : "Chưa cấu hình";
  return `<article class="card bf-admin-package-preview${presented.recommended ? " is-recommended" : ""}"><div class="card-body"><div class="d-flex justify-content-between gap-2"><span class="text-secondary small">${offer.ownerKind === "account" ? "CÁ NHÂN" : "TỔ CHỨC"}</span><span class="badge bg-secondary-lt">${published ? "Đã phát hành" : "Bản nháp"}</span></div><h4 class="h2 mt-2 mb-1">${escapeHtml(presented.name)}</h4><p class="text-secondary small">${escapeHtml(presented.variantLabel || GROUP_NAMES[offer.variant] || offer.variant || "")} · ${escapeHtml(offer.code || "")}</p>${presented.recommended ? '<span class="badge bg-primary-lt">Gói đề xuất</span>' : ""}<div class="bf-admin-package-period" aria-label="Kỳ thanh toán">${periods}</div><div class="bf-admin-plan-price text-center">${priceText(offer)}</div><p class="text-secondary small text-center">Tổng thanh toán ${escapeHtml(presented.periodLabel)}</p>${presented.description ? `<p class="text-secondary">${escapeHtml(presented.description)}</p>` : ""}<ul class="bf-admin-plan-benefits"><li>Hạn mức thành viên: <strong>${integer(offer.memberQuota)}</strong></li><li>Lượt Mua Sắm Công kèm theo: <strong>${integer(offer.includedProcurementQuota)}</strong></li><li>Kiểm tra vi phạm nhà thầu: <strong>${offer.violationCheckEnabled === true ? "Có" : "Không"}</strong></li>${rights}${(offer.display?.benefits || []).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul><div class="text-secondary small border-top pt-2">${({ sellable: "Đang bán", stopped: "Đã dừng bán", non_sellable: "Chưa mở bán" })[offer.salesState] || "Chưa cấu hình"} · ${offer.display?.visibility === "hidden" ? "Không hiện trên bảng giá" : "Hiển thị trên bảng giá"}</div></div></article>`;
}

export function packageManagerMarkup(documentValue, { published = false, id = "draft" } = {}) {
  const offers = documentValue?.offers || [];
  const groups = groupAdminPackages(offers);
  const rows = groups.map(group => {
    const year = group.offers.find(item => item.offer.price?.period === "yearly");
    const month = group.offers.find(item => item.offer.price?.period === "monthly");
    const chosen = year || month || group.offers[0];
    const offer = chosen.offer;
    const owner = offer.ownerKind === "account" ? "Cá nhân" : offer.ownerKind === "organization" ? "Tổ chức" : offer.ownerKind;
    const edit = published ? `data-admin-package-edit-code="${escapeHtml(offer.code)}"` : `data-admin-package-edit="${chosen.index}"`;
    return `<tr data-admin-package-variant="${escapeHtml(group.variant)}"><td><strong>${escapeHtml(offer.display?.name || offer.code)}</strong><div class="text-secondary small">${escapeHtml(owner)} · ${escapeHtml(PACKAGE_TIERS[offer.tier] || offer.tier)}</div></td><td>${month ? priceText(month.offer) : "Chưa cấu hình"}</td><td>${year ? priceText(year.offer) : "Chưa cấu hình"}</td><td>${Number.isSafeInteger(offer.memberQuota) ? escapeHtml(offer.memberQuota) : "—"}</td><td><span class="badge ${published ? "bg-success-lt" : "bg-secondary-lt"}">${published ? "Đã phát hành" : "Bản nháp"}</span></td><td class="text-end"><button class="btn btn-sm btn-outline-primary" type="button" ${edit}>${published ? "Chỉnh sửa" : "Sửa"}</button>${published ? "" : ` <button class="btn btn-sm btn-ghost-secondary" type="button" data-admin-package-copy="${chosen.index}">Nhân bản</button>`}</td></tr>`;
  }).join("");
  const cards = groups.map(group => {
    const chosen = group.offers.find(item => item.offer.price?.period === "yearly") || group.offers[0];
    return `<div class="bf-admin-package-tile" data-admin-package-variant="${escapeHtml(group.variant)}" data-admin-package-card="${chosen.index}">${packagePreviewMarkup(documentValue, chosen.index, { published })}${published ? `<button class="btn btn-outline-primary mt-2" type="button" data-admin-package-edit-code="${escapeHtml(chosen.offer.code)}">Chỉnh sửa</button>` : `<button class="btn btn-outline-primary mt-2" type="button" data-admin-package-edit="${chosen.index}">Chỉnh sửa</button>`}</div>`;
  }).join("");
  return `<section class="bf-admin-package-manager" data-admin-package-manager="${id}" data-published="${published}"><div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3"><div class="btn-group" aria-label="Nhóm gói"><button type="button" class="btn btn-primary" data-admin-package-group="internal" aria-pressed="true">Cơ bản</button><button type="button" class="btn btn-outline-primary" data-admin-package-group="connected" aria-pressed="false">Nâng cao</button>${groups.some(group => !GROUP_NAMES[group.variant]) ? '<button type="button" class="btn btn-outline-primary" data-admin-package-group="other" aria-pressed="false">Gói khác</button>' : ""}</div><div class="btn-group" aria-label="Cách xem gói"><button type="button" class="btn btn-sm btn-primary" data-admin-package-layout="table" aria-pressed="true">Bảng quản lý</button><button type="button" class="btn btn-sm btn-outline-primary" data-admin-package-layout="cards" aria-pressed="false">Thẻ trực quan</button></div></div><div data-admin-package-table class="card table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Gói dịch vụ</th><th>Giá tháng</th><th>Giá năm</th><th>Thành viên</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows}</tbody></table></div><div data-admin-package-cards class="bf-admin-package-grid" hidden>${cards}</div><div class="empty bf-admin-package-empty" data-admin-package-empty hidden><p class="empty-title">Chưa có gói trong nhóm này</p><p class="empty-subtitle text-secondary">${published ? "Chưa công bố gói dịch vụ." : "Tạo gói mới hoặc dùng bộ 8 gói mẫu để điền cấu hình."}</p>${published ? "" : '<button class="btn btn-primary" type="button" data-admin-plan-action="new-package">Tạo gói</button>'}</div></section>`;
}

export function packageCreatorMarkup(source = null) {
  const options = Object.entries(PACKAGE_TIERS).map(([value, label]) => `<option value="${value}"${source?.tier === value ? " selected" : ""}>${label}${value === "personal" ? "" : " · Tổ chức"}</option>`).join("");
  return `<section class="card card-body my-3" data-admin-package-creator><div class="d-flex justify-content-between align-items-center mb-3"><h4 class="card-title mb-0">${source ? "Nhân bản sang gói mới" : "Tạo gói dịch vụ"}</h4><button type="button" class="btn btn-ghost-secondary btn-sm" data-admin-plan-action="cancel-package">Hủy</button></div><div class="row g-3"><div class="col-md-4"><label class="form-label" for="admin-new-package-name">Tên hiển thị</label><input class="form-control" id="admin-new-package-name" maxlength="120" value="${escapeHtml(source?.display?.name || "")}" placeholder="Nhập tên gói"></div><div class="col-md-4"><label class="form-label" for="admin-new-package-variant">Nhóm</label><select class="form-select" id="admin-new-package-variant"><option value="internal"${source?.variant === "internal" ? " selected" : ""}>Cơ bản</option><option value="connected"${source?.variant === "connected" ? " selected" : ""}>Nâng cao</option></select></div><div class="col-md-4"><label class="form-label" for="admin-new-package-tier">Đối tượng / mức gói</label><select class="form-select" id="admin-new-package-tier">${options}</select></div><div class="col-12 d-flex gap-4 flex-wrap"><label class="form-check"><input class="form-check-input" id="admin-new-package-year" type="checkbox" checked><span class="form-check-label">Hàng năm</span></label><label class="form-check"><input class="form-check-input" id="admin-new-package-month" type="checkbox"><span class="form-check-label">Hàng tháng</span></label></div></div><p class="text-secondary small mt-3">Giá và thuế để trống để bạn nhập. Gói mới chưa mở bán. Mỗi mức trong một nhóm có tối đa một giá tháng và một giá năm.</p><div><button type="button" class="btn btn-primary" data-admin-plan-action="confirm-package">Thêm vào bản nháp</button></div></section>`;
}

export function addAdminServicePackage(documentValue, { tier, variant, name, periods = ["yearly"], sourceIndex = null }) {
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
    offer.price = { ...offer.price, currency: "VND", period, subtotal: null, tax: null, total: null };
    offer.memberQuota = tier === "personal" ? 1 : source?.memberQuota ?? null;
    offer.includedProcurementQuota = variant === "internal" ? 0 : null;
    offer.display = { ...offer.display, name: name.trim(), recommended: false };
    delete offer.display.periodLabel;
    next.offers.push(offer);
  }
  if (periods.includes("monthly")) {
    next.policies ||= {};
    next.policies.monthlyBaseTerm ||= { kind: "blocked_decision", reason: "Chưa cấu hình số ngày hiệu lực gói tháng." };
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
  const apply = () => {
    const matches = variant => group === "other" ? !Object.hasOwn(GROUP_NAMES, variant) : variant === group;
    manager.querySelectorAll("[data-admin-package-variant]").forEach(node => { node.hidden = !matches(node.dataset.adminPackageVariant); });
    manager.querySelector("[data-admin-package-table]").hidden = layout !== "table";
    manager.querySelector("[data-admin-package-cards]").hidden = layout !== "cards";
    manager.querySelector("[data-admin-package-empty]").hidden = documentValue.offers.some(offer => matches(offer.variant));
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
