import assert from "node:assert/strict";
import test from "node:test";

import { derivePackagePrice } from "../../frontend/packages/packagePricing.js";

test("a lotted package price is the sum of all lot values", () => {
  assert.equal(derivePackagePrice({
    phanLo: "Có",
    giaGoiThau: 999,
    phanLoList: [
      { giaTriPhanLo: "1.200.000.000" },
      { giaTriPhanLo: 800_000_000 },
    ],
  }), 2_000_000_000);
});

test("a package without lots keeps its manually entered price", () => {
  assert.equal(derivePackagePrice({
    phanLo: "Không",
    giaGoiThau: "750.000.000",
    phanLoList: [{ giaTriPhanLo: 123 }],
  }), 750_000_000);
});
