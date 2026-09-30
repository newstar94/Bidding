#!/usr/bin/env node

/**
 * Read-only browser smoke for a deployed BiddingFlow release.
 *
 * This intentionally exercises the origin users receive (HTML, security
 * headers, static assets, login and one already-authorized read).  It never
 * creates records or starts an export.  Credentials are read from the
 * environment and are never included in diagnostics.
 */

import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const RELEASE_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const RELEASE_IDENTITY_PATH = "/api/admin/system/version";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "testserver"]);

function envFirst(env, names) {
  for (const name of names) {
    const value = String(env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function validatePath(value, name) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new Error(`${name} must be an origin-relative path`);
  }
  return value;
}

export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  const baseRaw = argv[0] || envFirst(env, [
    "BROWSER_SMOKE_BASE_URL",
    "DEPLOY_SMOKE_BASE_URL",
    "SMOKE_BASE_URL",
    "E2E_BASE_URL",
  ]);
  if (!baseRaw) throw new Error("BROWSER_SMOKE_BASE_URL is required");
  let base;
  try {
    base = new URL(baseRaw);
  } catch {
    throw new Error("Browser smoke base URL is invalid");
  }
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error("Browser smoke base URL must be a credential-free HTTP(S) origin");
  }
  const host = (base.hostname || "").toLowerCase().replace(/\.$/, "");
  const local = LOCAL_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".test");
  if (base.protocol !== "https:" && !local) {
    throw new Error("Browser smoke requires HTTPS outside local/test hosts");
  }
  base.pathname = base.pathname.replace(/\/+$/, "");
  const expectedReleaseId = envFirst(env, [
    "BROWSER_SMOKE_EXPECTED_RELEASE_ID",
    "SMOKE_EXPECTED_RELEASE_ID",
  ]);
  if (!RELEASE_ID_RE.test(expectedReleaseId)) {
    throw new Error("BROWSER_SMOKE_EXPECTED_RELEASE_ID must be a full immutable hexadecimal release ID");
  }
  const username = envFirst(env, ["BROWSER_SMOKE_USERNAME", "SMOKE_USERNAME", "E2E_USERNAME"]);
  const password = env.BROWSER_SMOKE_PASSWORD ?? env.SMOKE_PASSWORD ?? env.E2E_PASSWORD ?? "";
  if (!username || !String(password)) {
    throw new Error("BROWSER_SMOKE_USERNAME and BROWSER_SMOKE_PASSWORD are required");
  }
  return {
    baseURL: base.toString().replace(/\/$/, ""),
    expectedReleaseId,
    username,
    password: String(password),
    loginPath: validatePath(envFirst(env, ["BROWSER_SMOKE_LOGIN_PATH"]) || "/dang-nhap", "login path"),
    releasePath: RELEASE_IDENTITY_PATH,
    readPath: validatePath(envFirst(env, ["BROWSER_SMOKE_READ_PATH", "SMOKE_READ_PATH"]), "read path"),
    requireHsts: base.protocol === "https:",
  };
}

export function assertSecurityHeaders(headers, requireHsts) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  if (!lower["content-security-policy"]) throw new Error("Missing Content-Security-Policy header");
  if (requireHsts && !lower["strict-transport-security"]) throw new Error("Missing Strict-Transport-Security header");
  if (lower["x-content-type-options"]?.toLowerCase() !== "nosniff") {
    throw new Error("Missing X-Content-Type-Options: nosniff header");
  }
  if (!lower["referrer-policy"]) throw new Error("Missing Referrer-Policy header");
  const csp = lower["content-security-policy"] || "";
  if (!lower["x-frame-options"] && !/frame-ancestors\s+[^;]+/i.test(csp)) {
    throw new Error("Missing clickjacking protection (X-Frame-Options or CSP frame-ancestors)");
  }
}

async function assertResponse(response, label) {
  if (!response || !response.ok()) {
    throw new Error(`${label} failed with HTTP ${response?.status() || "unknown"}`);
  }
}

export async function runBrowserSmoke(config, { browserType = chromium } = {}) {
  const browser = await browserType.launch({ headless: true });
  const page = await browser.newPage({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const consoleErrors = [];
  const pageErrors = [];
  const failedAssets = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 240));
  });
  page.on("pageerror", (error) => pageErrors.push(String(error.message).slice(0, 240)));
  page.on("requestfailed", (request) => {
    if (["script", "stylesheet", "font"].includes(request.resourceType())) {
      failedAssets.push(request.url().split("?")[0]);
    }
  });
  page.on("response", (assetResponse) => {
    const request = assetResponse.request();
    if (["script", "stylesheet", "font"].includes(request.resourceType()) && assetResponse.status() >= 400) {
      failedAssets.push(request.url().split("?")[0]);
    }
  });
  try {
    const response = await page.goto(`${config.baseURL}${config.loginPath}`, { waitUntil: "domcontentloaded" });
    await assertResponse(response, "Login shell");
    assertSecurityHeaders(await response.headers(), config.requireHsts);
    const usernameField = page.locator("#login-username, input[name='username'], input[type='email']").first();
    const passwordField = page.locator("#login-password, input[name='password'], input[type='password']").first();
    await usernameField.fill(config.username);
    await passwordField.fill(config.password);
    const submit = page.locator("#form-auth-login button[type='submit'], form button[type='submit']").first();
    const loginResponsePromise = page.waitForResponse(
      (candidate) => {
        try {
          return new URL(candidate.url()).pathname === "/api/auth/login";
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    );
    await submit.click();
    const loginResponse = await loginResponsePromise.catch(() => null);
    if (!loginResponse || !loginResponse.ok()) {
      throw new Error(`Login request failed with HTTP ${loginResponse?.status() || "unknown"}`);
    }
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    const releaseResponse = await page.request.get(`${config.baseURL}${config.releasePath}`, { failOnStatusCode: false });
    await assertResponse(releaseResponse, "Release identity");
    if (!String(releaseResponse.headers()["content-type"] || "").toLowerCase().startsWith("application/json")) {
      throw new Error("Release identity endpoint did not return JSON");
    }
    const releasePayload = await releaseResponse.json().catch(() => null);
    if (!releasePayload || releasePayload.releaseId !== config.expectedReleaseId) {
      throw new Error("Running release identity does not match the expected artifact");
    }
    const readResponse = await page.request.get(`${config.baseURL}${config.readPath}`, { failOnStatusCode: false });
    await assertResponse(readResponse, "Authorized read");
    if (failedAssets.length) throw new Error(`Static asset request failed (${failedAssets.length})`);
    if (consoleErrors.length || pageErrors.length) throw new Error("Browser console/page errors detected");
    return { releaseId: config.expectedReleaseId, securityHeaders: true, assets: true, authorizedRead: true };
  } finally {
    await browser.close();
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const config = loadConfig(env, argv);
    const result = await runBrowserSmoke(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Browser smoke failed: ${String(error?.message || "unknown error").slice(0, 240)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}

