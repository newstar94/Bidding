import assert from "node:assert/strict";
import test from "node:test";
import { safeImageSrc } from "../../frontend/shared/view_helpers.js";

test("managed image source supports server tenant paths without widening URL scope", () => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: "https://bidding.test" } };
  try {
    const path = "/images/nha_thau/t-0123456789abcdef01234567/stamp.png";
    assert.equal(safeImageSrc(path), path);
    const signed = `${path}?expires=1788816000&org=test-org&sig=${"a".repeat(64)}`;
    assert.equal(safeImageSrc(signed), signed);
    assert.equal(safeImageSrc("/images/nha_thau/stamp.png"), "/images/nha_thau/stamp.png");
    assert.equal(safeImageSrc("/images/nha_thau/t-invalid/stamp.png"), "");
    assert.equal(safeImageSrc(`${path}?sig=invalid`), "");
    assert.equal(safeImageSrc("/images/nha_thau/other/stamp.png"), "");
    assert.equal(safeImageSrc(`${signed}&extra=1`), "");
    assert.equal(safeImageSrc(`${signed}&sig=${"b".repeat(64)}`), "");
    assert.equal(safeImageSrc("/images/nha_thau/t-0123456789abcdef01234567/%2e%2e/%2e%2e/private.png"), "");
    assert.equal(safeImageSrc(`https://other.test${path}`), "");
    assert.equal(safeImageSrc("/images/nha_thau/t-0123456789abcdef01234567/stamp.svg"), "");
  } finally { globalThis.window = previous; }
});
