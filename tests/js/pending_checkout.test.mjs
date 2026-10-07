import assert from "node:assert/strict";
import test from "node:test";

import {
  captureCheckoutIntentFromLocation,
  checkoutIntentFromLocation,
  clearPendingCheckoutIntent,
  clearCheckoutIntentFromLocation,
  readPendingCheckoutIntent,
  savePendingCheckoutIntent,
} from "../../frontend/commercial-policy/pendingCheckout.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("pending checkout intent keeps only a valid SKU and payment period", () => {
  const storage = memoryStorage();
  assert.equal(savePendingCheckoutIntent({ sku: "personal.internal.yearly", period: "yearly" }, storage), true);
  assert.deepEqual(readPendingCheckoutIntent(storage), { sku: "personal.internal.yearly", period: "yearly" });
  assert.equal(savePendingCheckoutIntent({ sku: "javascript:alert(1)" }, storage), false);
  assert.deepEqual(readPendingCheckoutIntent(storage), { sku: "personal.internal.yearly", period: "yearly" });
  clearPendingCheckoutIntent(storage);
  assert.equal(readPendingCheckoutIntent(storage), null);
});

test("landing checkout query can be captured before the authentication redirect", () => {
  const storage = memoryStorage();
  const location = { search: "?checkout=personal.connected.monthly&period=monthly" };
  assert.deepEqual(checkoutIntentFromLocation(location), { sku: "personal.connected.monthly", period: "monthly" });
  assert.equal(captureCheckoutIntentFromLocation(location, storage), true);
  assert.deepEqual(readPendingCheckoutIntent(storage), { sku: "personal.connected.monthly", period: "monthly" });
});

test("consuming checkout URL removes the intent while preserving other navigation state", () => {
  let replacement;
  const history = { state: { navigation: "kept" }, replaceState(...args) { replacement = args; } };
  assert.equal(clearCheckoutIntentFromLocation({ href: "https://example.test/app?checkout=personal.internal.yearly&period=yearly&keep=yes#billing" }, history), true);
  assert.deepEqual(replacement, [{ navigation: "kept" }, "", "/app?keep=yes#billing"]);
  assert.equal(clearCheckoutIntentFromLocation({ href: "https://example.test/app?keep=yes" }, history), false);
});

