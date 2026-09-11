import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import {
  confirmSecretReplacement,
  environmentMarkup,
  executeEnvironmentUpdate,
  healthMarkup,
  renderAdminEnvironment,
  renderAdminHealth,
  renderAdminSettings,
  renderAdminSystemVersion,
  settingsMarkup,
  versionMarkup,
} from "../../frontend/admin-platform/AdminOperations.js";

DOMPurify.isSupported = true;
DOMPurify.sanitize = (value) => String(value);

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function container() {
  return {
    attributes: {},
    innerHTML: "",
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector() { return null; },
  };
}

test("health view renders only allowlisted operational fields", () => {
  const markup = healthMarkup({
    generatedAt: "2026-09-10T00:00:00Z",
    status: "ready",
    application: { startupComplete: true, ready: true, eventLoopLagMs: 3.5 },
    database: { status: "available", schemaVersion: 90, latencyMs: 1.4, connectionUrl: "private-db" },
    operations: {
      documentWorker: { active: 1, waiting: 2, completed: 3, failed: 0, rejected: 0 },
      websocket: { activeConnections: 4, pendingEvents: 5, oldestPendingSeconds: 6.5 },
      backgroundJobs: [{ queue: "document", status: "pending", count: 2, oldestSeconds: 8 }],
      databasePool: { pool_size: 5, pool_available: 3, requests_waiting: 1 },
    },
    rawError: "do-not-render",
  });

  assert.match(markup, /Sẵn sàng/u);
  assert.match(markup, /3[.]5 ms/u);
  assert.match(markup, />90</u);
  assert.match(markup, /1[.]4 ms/u);
  assert.match(markup, /Kết nối pool đang dùng[\s\S]*>2</u);
  assert.match(markup, /Worker tài liệu/u);
  assert.match(markup, /Kết nối WebSocket/u);
  assert.match(markup, /document · pending: 2/u);
  assert.doesNotMatch(markup, /private-db|do-not-render/u);
  assert.match(healthMarkup(null), /data-admin-state="empty"/u);
});

test("environment view shows configured or missing without raw secret values and paths", () => {
  const markup = environmentMarkup({
    generatedAt: "2026-09-10T00:00:00Z",
    runtime: {
      environment: "production",
      frontendAssetMode: "bundle",
      debugEnabled: false,
      secureCookies: true,
      privatePath: "D:/private/build",
    },
    features: { aiEnabled: true },
    secretStatus: {
      DATABASE_URL: { configured: true, writable: true, value: "postgresql://secret" },
      OTP_HMAC_KEY: { configured: false, writable: true, value: "otp-secret" },
      UNKNOWN_SECRET: { configured: true, value: "unknown-secret" },
    },
    configuration: { writable: true, restartRequired: true, source: "local_env" },
    environmentDump: "raw-environment-dump",
  });

  assert.match(markup, /production/u);
  assert.match(markup, /data-admin-secret-status="DATABASE_URL">Đã cấu hình/u);
  assert.match(markup, /data-admin-secret-status="OTP_HMAC_KEY">Thiếu cấu hình/u);
  assert.equal(markup.includes("postgresql://secret"), false);
  assert.doesNotMatch(markup, /otp-secret|unknown-secret/u);
  assert.equal(markup.includes("D:/private/build"), false);
  assert.doesNotMatch(markup, /raw-environment-dump|UNKNOWN_SECRET/u);
  assert.match(markup, /data-admin-secret-replace="DATABASE_URL">Thay thế/u);
  assert.match(markup, /data-admin-secret-replace="OTP_HMAC_KEY">Cấu hình/u);
  assert.match(environmentMarkup({}), /data-admin-state="empty"/u);
});

test("version view renders release contract and ignores unrecognized fields", () => {
  const markup = versionMarkup({
    generatedAt: "2026-09-10T00:00:00Z",
    applicationVersion: "2.0.0",
    releaseId: "abc123",
    buildSha: "abcdef1234567",
    buildTime: "2026-09-11T01:02:03Z",
    environment: "production",
    frontendBundleVersion: "abc123",
    schemaVersion: 90,
    expectedSchemaVersion: 90,
    schemaStatus: "available",
    buildPath: "D:/private/dist",
  });

  assert.match(markup, /2[.]0[.]0/u);
  assert.match(markup, /abc123/u);
  assert.match(markup, /abcdef1234567/u);
  assert.match(markup, /2026-09-11T01:02:03Z/u);
  assert.match(markup, /production/u);
  assert.match(markup, /Khả dụng/u);
  assert.equal(markup.includes("D:/private/dist"), false);
  assert.match(versionMarkup(null), /data-admin-state="empty"/u);
});

test("settings view renders writable feature controls without secret data", () => {
  const markup = settingsMarkup({
    features: { aiEnabled: true, legalVersioningEnabled: false },
    secretStatus: { DATABASE_URL: { configured: true, value: "private" } },
    configuration: { writable: true },
  });
  assert.match(markup, /Trợ lý AI/u);
  assert.match(markup, /Registration/u);
  assert.match(markup, /Localization/u);
  assert.match(markup, /Notifications/u);
  assert.match(markup, /data-admin-feature="aiEnabled" checked/u);
  assert.match(markup, /data-admin-settings-save>Lưu cấu hình/u);
  assert.doesNotMatch(markup, /DATABASE_URL|private/u);
});

test("settings view remains explicitly read-only for deployment-managed environments", () => {
  const markup = settingsMarkup({
    features: { aiEnabled: false },
    configuration: { writable: false },
  });
  assert.match(markup, /data-admin-feature="aiEnabled" disabled/u);
  assert.match(markup, /data-admin-settings-save disabled/u);
  assert.match(markup, /Chỉ đọc/u);
});

test("environment update reauthenticates and retries once without retaining secret data", async () => {
  const requests = [];
  const secret = "new-secret-value-that-must-not-be-retained";
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (requests.length === 1) {
      return jsonResponse({ message: "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm." }, 403);
    }
    if (url === "/api/auth/privileged-reauth") return jsonResponse({ success: true });
    return jsonResponse({ success: true, restartRequired: true });
  };

  const result = await executeEnvironmentUpdate(
    { secrets: { OTP_HMAC_KEY: secret } },
    { fetchImpl, requestPassword: async () => "admin-password" },
  );

  assert.equal(result.restartRequired, true);
  assert.deepEqual(requests.map(({ url }) => url), [
    "/api/admin/environment",
    "/api/auth/privileged-reauth",
    "/api/admin/environment",
  ]);
  assert.deepEqual(requests[1].body, { password: "admin-password" });
});

test("secret replacement requires the exact key as explicit confirmation", async () => {
  assert.equal(await confirmSecretReplacement("OTP_HMAC_KEY", {
    requestConfirmation: async () => "OTP_HMAC_KEY",
  }), true);
  assert.equal(await confirmSecretReplacement("OTP_HMAC_KEY", {
    requestConfirmation: async () => "wrong-key",
  }), false);
  assert.equal(await confirmSecretReplacement("OTP_HMAC_KEY", {
    requestConfirmation: async () => null,
  }), false);
});

test("operation pages call their dedicated same-origin admin APIs", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.endsWith("/health")) {
      return jsonResponse({ status: "ready", application: {}, database: {} });
    }
    if (url.endsWith("/environment")) {
      return jsonResponse({ runtime: {}, features: {}, secretStatus: {} });
    }
    return jsonResponse({ applicationVersion: "2.0.0" });
  };

  await renderAdminHealth(container(), { fetchImpl });
  await renderAdminEnvironment(container(), { fetchImpl });
  await renderAdminSettings(container(), { fetchImpl });
  await renderAdminSystemVersion(container(), { fetchImpl });

  assert.deepEqual(requested, [
    "/api/admin/health",
    "/api/admin/environment",
    "/api/admin/environment",
    "/api/admin/system/version",
  ]);
});

test("operation pages keep permission denial distinct from retryable errors", async () => {
  const permissionContainer = container();
  await renderAdminHealth(permissionContainer, {
    fetchImpl: async () => jsonResponse({ code: "SUPER_ADMIN_REQUIRED" }, 403),
  });
  assert.match(String(permissionContainer.innerHTML), /data-admin-state="permission"/u);
  assert.doesNotMatch(String(permissionContainer.innerHTML), /data-admin-retry/u);

  const errorContainer = container();
  await renderAdminEnvironment(errorContainer, {
    fetchImpl: async () => jsonResponse({ code: "ADMIN_OVERVIEW_FAILED" }, 500),
  });
  assert.match(String(errorContainer.innerHTML), /data-admin-state="error"/u);
  assert.match(String(errorContainer.innerHTML), /data-admin-retry/u);
});
