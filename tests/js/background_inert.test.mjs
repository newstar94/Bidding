import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireBackgroundInert, releaseBackgroundInert } from '../../frontend/shared/backgroundInert.js';

for (const original of [false, true]) {
  for (const order of [['modal', 'loading'], ['loading', 'modal']]) {
    test(`background locks preserve original=${original}, closing ${order.join(' then ')}`, () => {
      const attributes = new Set(original ? ['inert'] : []);
      const element = {
        hasAttribute: name => attributes.has(name),
        setAttribute: name => attributes.add(name),
        removeAttribute: name => attributes.delete(name),
      };
      acquireBackgroundInert(element, 'modal');
      acquireBackgroundInert(element, 'loading');
      acquireBackgroundInert(element, 'loading');
      releaseBackgroundInert(element, order[0]);
      releaseBackgroundInert(element, order[0]);
      assert.equal(attributes.has('inert'), true);
      releaseBackgroundInert(element, order[1]);
      assert.equal(attributes.has('inert'), original);
    });
  }
}
