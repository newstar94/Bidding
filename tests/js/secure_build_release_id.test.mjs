import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { localSecureReleaseId } from "../../scripts/secure_release_id.mjs";

test("local secure build derives an immutable content release id", () => {
  const releaseId = localSecureReleaseId();

  assert.match(releaseId, /^[0-9a-f]{64}$/);
  assert.equal(releaseId, localSecureReleaseId());
});

test("secure config selects content hash only when CI has no release id", () => {
  const source = fs.readFileSync(new URL("../../vite.config.js", import.meta.url), "utf8");

  assert.match(
    source,
    /configuredReleaseId\s*\|\|\s*\(mode\s*===\s*['"]secure['"]\s*\?\s*localSecureReleaseId\(\)\s*:\s*['"]development['"]\)/,
  );
});
