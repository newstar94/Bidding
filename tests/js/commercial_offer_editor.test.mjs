import assert from 'node:assert/strict';
import test from 'node:test';
import { describeOfferChanges, offerEditor, offerPreview } from '../../frontend/commercial-policy/CommercialOfferEditor.js';

const offer = {
  code: 'opaque-offer', ownerKind: 'account', salesState: 'sellable', memberQuota: 1,
  price: { total: 1000000, currency: 'VND', period: 'yearly' },
  display: { name: 'Cá nhân', visibility: 'public', benefits: ['Quyền lợi'] },
};
test('preview distinguishes hidden from stopped without mutating the offer', () => {
  const hidden = { ...offer, display: { ...offer.display, visibility: 'hidden' } };
  const before = JSON.stringify(hidden);
  assert.match(offerPreview(hidden), /đang ẩn khỏi catalog/);
  assert.match(offerPreview({ ...offer, salesState: 'stopped' }), /không ở trạng thái Đang bán/);
  assert.equal(JSON.stringify(hidden), before);
  assert.match(offerPreview(offer, { publicCatalog: true }), /lần làm mới gần nhất/);
  assert.doesNotMatch(offerPreview(offer, { publicCatalog: true }), /Dự kiến có/);
});
test('editor escapes untrusted metadata and associates validation with the field', () => {
  const source = { ...offer, display: { ...offer.display, name: '<img src=x onerror=alert(1)>' } };
  const markup = offerEditor(source, 0, [{ path: 'offers[0].display.name', message: '<invalid>' }]);
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /&lt;img/);
  assert.match(markup, /aria-describedby="commercial-field-0-display-name-error"/);
});
test('change summary compares offer identity rather than array position', () => {
  const other = { ...offer, code: 'second' };
  const before = { offers: [offer, other] };
  const after = { offers: [other, { ...offer, display: { ...offer.display, visibility: 'hidden' } }] };
  assert.deepEqual(describeOfferChanges(before, after), ['Cá nhân · Hiển thị: Công khai → Ẩn khỏi catalog']);
});
