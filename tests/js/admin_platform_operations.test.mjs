import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import {
  environmentMarkup,
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
    database: { status: "available", schemaVersion: 90, connectionUrl: "private-db" },
    operations: {
      documentWorker: { active: 1, waiting: 2, completed: 3, failed: 0, rejected: 0 },
      websocket: { activeConnections: 4, pendingEvents: 5, oldestPendingSeconds: 6.5 },
      backgroundJobs: [{ queue: "document", status: "pending", count: 2, oldestSeconds: 8 }],
    },
    rawError: "do-not-render",
  });

  assert.match(markup, /Sẵn sàng/u);
  assert.match(markup, /3[.]5 ms/u);
  assert.match(markup, />90</u);
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
      DATABASE_URL: { configured: true, value: "postgresql://secret" },
      OTP_HMAC_KEY: { configured: false, value: "otp-secret" },
      UNKNOWN_SECRET: { configured: true, value: "unknown-secret" },
    },
    environmentDump: "raw-environment-dump",
  });

  assert.match(markup, /production/u);
  assert.match(markup, /data-admin-secret-status="DATABASE_URL">Đã cấu hình/u);
  assert.match(markup, /data-admin-secret-status="OTP_HMAC_KEY">Thiếu cấu hình/u);
  assert.equal(markup.includes("postgresql://secret"), false);
  assert.doesNotMatch(markup, /otp-secret|unknown-secret/u);
  assert.equal(markup.includes("D:/private/build"), false);
  assert.doesNotMatch(markup, /raw-environment-dump|UNKNOWN_SECRET/u);
  assert.match(environmentMarkup({}), /data-admin-state="empty"/u);
});

test("version view renders release contract and ignores unrecognized fields", () => {
  const markup = versionMarkup({
    generatedAt: "2026-09-10T00:00:00Z",
    applicationVersion: "2.0.0",
    releaseId: "abc123",
    frontendBundleVersion: "abc123",
    schemaVersion: 90,
    expectedSchemaVersion: 90,
    schemaStatus: "available",
    buildPath: "D:/private/dist",
  });

  assert.match(markup, /2[.]0[.]0/u);
  assert.match(markup, /abc123/u);
  assert.match(markup, /Khả dụng/u);
  assert.equal(markup.includes("D:/private/dist"), false);
  assert.match(versionMarkup(null), /data-admin-state="empty"/u);
});

test("settings view shows deployment-managed feature states without secret data", () => {
  const markup = settingsMarkup({
    features: { aiEnabled: true, legalVersioningEnabled: false },
    secretStatus: { DATABASE_URL: { configured: true, value: "private" } },
  });
  assert.match(markup, /Trợ lý AI/u);
  assert.match(markup, />Bật</u);
  assert.match(markup, /môi trường triển khai quản lý/u);
  assert.doesNotMatch(markup, /DATABASE_URL|private/u);
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
