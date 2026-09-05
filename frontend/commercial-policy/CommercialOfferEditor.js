import { presentCommercialOffer } from './PublicCommercialCatalog.js';

export const escapeCommercial = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const esc = escapeCommercial;
const number = value => Number(value || 0).toLocaleString('vi-VN');

export function describeOfferChanges(before, after) {
  const fields = {
    'display.name': 'Tên hiển thị', 'display.description': 'Mô tả', 'display.benefits': 'Lợi ích',
    'display.visibility': 'Hiển thị', 'display.order': 'Thứ tự', 'display.recommended': 'Đề xuất',
    'display.badge': 'Nhãn', 'display.variantLabel': 'Nhãn phương án', 'display.periodLabel': 'Nhãn chu kỳ',
    'price.total': 'Giá gói', memberQuota: 'Số thành viên', includedProcurementQuota: 'Lượt kèm theo', salesState: 'Trạng thái bán',
  };
  const read = (offer, path) => path.split('.').reduce((value, part) => value?.[part], offer);
  const label = value => ({ public: 'Công khai', hidden: 'Ẩn khỏi catalog', sellable: 'Đang bán', stopped: 'Đã dừng bán', non_sellable: 'Không bán', true: 'Có', false: 'Không' }[String(value)] || (Array.isArray(value) ? value.join('; ') : String(value ?? 'Chưa đặt')));
  const changes = [];
  for (const offer of after.offers || []) {
    const original = (before.offers || []).find(item => item.code === offer.code);
    if (!original) continue;
    for (const [path, title] of Object.entries(fields)) {
      const oldValue = read(original, path), newValue = read(offer, path);
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) changes.push(`${offer.display?.name || offer.code} · ${title}: ${label(oldValue)} → ${label(newValue)}`);
    }
  }
  for (const key of ['creditPacks', 'policies']) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes.push(`${key === 'policies' ? 'Chính sách' : 'Gói lượt mua thêm'} đã thay đổi; mở tab tương ứng để kiểm tra toàn bộ giá trị.`);
  }
  return changes;
}

export function offerPreview(offer, { publicCatalog = false } = {}) {
  const shown = presentCommercialOffer(offer);
  const visible = offer.salesState === 'sellable' && offer.display?.visibility !== 'hidden';
  return `<p class="commercial-preview-caption">${publicCatalog ? 'Catalog công khai · lần làm mới gần nhất' : 'Xem trước bản nháp · chưa công khai'}</p>
    <article class="commercial-preview-card"><small>${esc(shown.variantLabel)}</small>
    <h3>${esc(shown.name)}</h3>${shown.badge ? `<span class="commercial-badge">${esc(shown.badge)}</span>` : ''}
    <p>${esc(shown.description)}</p><strong class="commercial-preview-price">${esc(shown.priceLabel)}</strong> <span>${esc(shown.periodLabel)}</span>
    <ul>${shown.benefits.map(text => `<li>${esc(text)}</li>`).join('')}</ul>
    <p>${shown.recommended ? 'Gói được đề xuất trong cấu hình.' : ''}</p></article>
    <p class="commercial-callout">${publicCatalog ? 'Có trong phản hồi catalog tại lần làm mới gần nhất. Checkout có điều kiện riêng.' : visible ? 'Dự kiến có trong catalog sau khi xuất bản và đủ điều kiện runtime.' : offer.salesState !== 'sellable' ? 'Không xuất hiện: gói không ở trạng thái Đang bán.' : 'Không xuất hiện: đang ẩn khỏi catalog công khai.'}</p>`;
}

export function offerEditor(offer, index, errors = []) {
  const code = esc(offer.code);
  const errorFor = field => errors.find(error => error.path === `offers[${index}].${field}`);
  const field = (name, label, value, type = 'text', options = []) => {
    const error = errorFor(name);
    const id = `commercial-field-${index}-${name.replaceAll('.', '-')}`;
    const attrs = `id="${id}" data-offer-code="${code}" data-field="${name}" class="form-control" ${error ? `aria-invalid="true" aria-describedby="${id}-error"` : ''}`;
    const input = type === 'select'
      ? `<select ${attrs} data-no-custom="true">${options.map(([key, text]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${text}</option>`).join('')}</select>`
      : type === 'textarea'
        ? `<textarea ${attrs} rows="3">${esc(value)}</textarea>`
        : `<input ${attrs} type="${type === 'integer' ? 'text' : type}" ${type === 'integer' ? 'inputmode="numeric"' : ''} value="${esc(type === 'integer' ? number(value) : value)}">`;
    return `<label>${label}${input}${error ? `<small id="${id}-error" class="commercial-field-error">${esc(error.message)}</small>` : ''}</label>`;
  };
  const display = offer.display || {};
  return `<div class="commercial-editor-layout"><div class="commercial-editor-fields">
    <fieldset><legend>Hiển thị trong catalog công khai</legend><p>Áp dụng cho landing và nơi sử dụng catalog công khai. Chỉ có hiệu lực sau xuất bản; ẩn không đồng nghĩa dừng bán.</p><div class="commercial-offer-presentation-grid">
    ${field('display.visibility','Hiển thị',display.visibility || 'public','select',[['public','Công khai'],['hidden','Ẩn khỏi catalog']])}
    ${field('display.order','Thứ tự',display.order ?? index,'integer')}
    </div></fieldset>
    <fieldset><legend>Giá & quyền lợi</legend><div class="commercial-offer-presentation-grid">
    ${field('price.total', 'Giá gói (₫)', offer.price.total, 'integer')}
    ${field('memberQuota', 'Số thành viên', offer.memberQuota, 'integer')}
    ${field('includedProcurementQuota', 'Lượt lấy hồ sơ Mua Sắm Công kèm theo', offer.includedProcurementQuota, 'integer')}
    ${field('salesState', 'Trạng thái bán', offer.salesState, 'select', [['sellable','Đang bán'],['stopped','Đã dừng bán'],['non_sellable','Không bán']])}
    </div></fieldset>
    <fieldset><legend>Nội dung công khai</legend><div class="commercial-offer-presentation-grid">
    ${field('display.name','Tên hiển thị',display.name)}
    ${field('display.variantLabel','Nhãn phương án',display.variantLabel)}
    ${field('display.periodLabel','Nhãn chu kỳ',display.periodLabel)}
    ${field('display.badge','Nhãn tùy chọn',display.badge)}
    ${field('display.description','Mô tả',display.description,'textarea')}
    ${field('display.benefits','Lợi ích, mỗi dòng một mục',(display.benefits || []).join('\n'),'textarea')}
    <label class="commercial-check"><input type="checkbox" data-offer-code="${code}" data-field="display.recommended" ${display.recommended ? 'checked' : ''}> Đánh dấu đề xuất</label>
    </div></fieldset>
    <details class="commercial-technical"><summary>Thông tin kỹ thuật</summary><dl><dt>Mã gói</dt><dd>${code}</dd><dt>Đối tượng sở hữu</dt><dd>${esc(offer.ownerKind)}</dd><dt>Biến thể</dt><dd>${esc(offer.variant)}</dd></dl></details>
    </div><aside data-commercial-preview="${code}" aria-label="Xem trước gói">${offerPreview(offer)}</aside></div>`;
}
