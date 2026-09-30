import test from "node:test";
import assert from "node:assert/strict";
import { assertSecurityHeaders, loadConfig } from "../../scripts/verify_deployed_browser_smoke.mjs";

const releaseId = "a".repeat(64);

function validEnv(overrides = {}) {
  return {
    BROWSER_SMOKE_BASE_URL: "https://staging.example.test",
    BROWSER_SMOKE_EXPECTED_RELEASE_ID: releaseId,
    BROWSER_SMOKE_USERNAME: "smoke-user",
    BROWSER_SMOKE_PASSWORD: "secret-do-not-print",
    BROWSER_SMOKE_READ_PATH: "/api/records/fixture",
    ...overrides,
  };
}

test("browser smoke configuration is fail-closed for release identity and read path", () => {
  const config = loadConfig(validEnv());
  assert.equal(config.expectedReleaseId, releaseId);
  assert.equal(config.readPath, "/api/records/fixture");
  assert.throws(() => loadConfig(validEnv({ BROWSER_SMOKE_EXPECTED_RELEASE_ID: "latest" })), /immutable hexadecimal/);
  assert.throws(() => loadConfig(validEnv({ BROWSER_SMOKE_READ_PATH: "https://other.example/read" })), /origin-relative/);
});

test("browser smoke rejects remote HTTP but permits loopback fixture HTTP", () => {
  assert.throws(() => loadConfig(validEnv({ BROWSER_SMOKE_BASE_URL: "http://production.example" })), /requires HTTPS/);
  const local = loadConfig(validEnv({ BROWSER_SMOKE_BASE_URL: "http://127.0.0.1:8000" }));
  assert.equal(local.requireHsts, false);
});

test("browser smoke checks the required response security headers", () => {
  assertSecurityHeaders({
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  }, true);
  assert.throws(() => assertSecurityHeaders({
    "content-security-policy": "default-src 'self'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin",
  }, true), /Strict-Transport-Security/);
});
