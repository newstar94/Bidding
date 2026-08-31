import assert from "node:assert/strict";
import test from "node:test";

import { canMutateDisplayedContractVersion } from "../../frontend/contracts/HopDongComponent.js";

test("latest local contract version keeps actions during canonical pagination refresh", () => {
  assert.equal(canMutateDisplayedContractVersion(
    { id: "contract-v01", rootId: "contract-root", isLatest: 1 },
    { id: "contract-v00", rootId: "contract-root", isLatest: 1 },
  ), true);
});

test("historical contract version remains read-only", () => {
  assert.equal(canMutateDisplayedContractVersion(
    { id: "contract-v00", rootId: "contract-root", isLatest: 0 },
    { id: "contract-v01", rootId: "contract-root", isLatest: 1 },
  ), false);
});

test("legacy records without latest flag use authoritative identity", () => {
  assert.equal(canMutateDisplayedContractVersion(
    { id: "contract-v00" },
    { id: "contract-v00" },
  ), true);
  assert.equal(canMutateDisplayedContractVersion(
    { id: "contract-v00" },
    { id: "contract-v01" },
  ), false);
});
