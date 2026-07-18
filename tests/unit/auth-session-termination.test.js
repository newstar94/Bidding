import assert from "node:assert/strict";
import test from "node:test";

import { getSessionTerminationNotice } from "../../frontend/auth/AuthSessionController.js";
import {
  beginExplicitLogout,
  claimSessionTermination,
  isExplicitLogoutInProgress,
  setAuthSessionActive
} from "../../frontend/auth/authRuntimeState.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

test("one invalid session can claim only one forced-logout notification", () => {
  const storage = memoryStorage();
  setAuthSessionActive(true, storage);

  assert.equal(claimSessionTermination(storage, 1_000), true);
  assert.equal(claimSessionTermination(storage, 1_001), false);
});

test("an explicit logout suppresses forced-logout notifications across tabs", () => {
  const storage = memoryStorage();
  setAuthSessionActive(true, storage);
  beginExplicitLogout(storage, 2_000);

  assert.equal(isExplicitLogoutInProgress(storage, 2_001), true);
  assert.equal(claimSessionTermination(storage, 2_001), false);

  setAuthSessionActive(true, storage);
  assert.equal(isExplicitLogoutInProgress(storage, 2_002), false);
});

test("only automatic expiry and revocation reasons produce a notice", () => {
  assert.equal(getSessionTerminationNotice("missing_auth"), null);
  assert.equal(getSessionTerminationNotice("user_not_found"), null);
  assert.match(getSessionTerminationNotice("session_revoked").title, /thiết bị khác/);
  assert.match(getSessionTerminationNotice("session_idle_expired", 4).message, /4 giờ/);
  assert.match(getSessionTerminationNotice("token_expired").title, /hết hạn/);
});
