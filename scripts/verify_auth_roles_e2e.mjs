import process from "node:process";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const runId = String(Date.now());
const password = `Aa!9${randomBytes(12).toString("hex")}`;
const changedPassword = `Bb!8${randomBytes(12).toString("hex")}`;
const resetPassword = `Cc!7${randomBytes(12).toString("hex")}`;
const TURNSTILE_ALWAYS_PASS_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_ALWAYS_PASS_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const organizationId = `auth-e2e-${runId}-org`;
const otherOrganizationId = `auth-e2e-${runId}-other-org`;
const suspendedOrganizationId = `auth-e2e-${runId}-suspended-org`;
const registeredUsername = `auth${runId.slice(-12)}`;

const account = (key, overrides = {}) => ({
  id: `auth-e2e-${runId}-${key}-id`,
  username: `auth-e2e-${runId}-${key}`,
  email: `auth-e2e-${runId}-${key}@example.test`,
  verified: true,
  platformRole: "user",
  ...overrides,
});
const accounts = {
  superadmin: account("superadmin", {
    platformRole: "super_admin",
    membership: { role: "manager", organizationId },
  }),
  manager: account("manager", { membership: { role: "manager", organizationId } }),
  employee: account("employee", { membership: { role: "employee", organizationId } }),
  left: account("left", { membership: { role: "employee", organizationId, status: "left" } }),
  suspended: account("suspended", {
    membership: { role: "manager", organizationId: suspendedOrganizationId },
  }),
  unverified: account("unverified", { verified: false }),
};
const fixturePayload = {
  runId,
  password,
  organizationId,
  otherOrganizationId,
  suspendedOrganizationId,
  registeredUsername,
  accounts,
};
const result = { runId, steps: [] };
const mark = (step, details = {}) => {
  result.steps.push({ step, ...details });
  process.stdout.write(`[AUTH-E2E] ${step}\n`);
};

function fixture(action, extra = {}) {
  const execution = spawnSync(
    process.env.PYTHON || "python",
    ["scripts/auth_roles_e2e_fixture.py", action],
    {
      cwd: process.cwd(),
      env: process.env,
      input: JSON.stringify({ ...fixturePayload, ...extra }),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (execution.status !== 0) {
    throw new Error(`Fixture ${action} failed: ${execution.stderr || execution.stdout}`);
  }
  return JSON.parse(execution.stdout || "{}");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function versionedMutation(item, changes = {}) {
  const { allVersions: _allVersions, rowVersion, ...record } = item || {};
  return { ...record, ...changes, expectedVersion: rowVersion };
}

async function json(response) {
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function localRegistrationChallenge(context) {
  const response = await context.request.get(`${baseURL}/dang-nhap`);
  assert(response.ok(), `Could not read local Turnstile configuration: ${response.status()}`);
  const html = await response.text();
  const enabled = /<meta\s+name="bf-turnstile-enabled"\s+content="true"\s*\/?>/u.test(html);
  if (!enabled) return {};
  const siteKey = html.match(
    /<meta\s+name="bf-turnstile-site-key"\s+content="([A-Za-z0-9_-]+)"\s*\/?>/u,
  )?.[1] || "";
  assert(
    siteKey === TURNSTILE_ALWAYS_PASS_SITE_KEY,
    "Auth/roles E2E requires Cloudflare's published always-pass local test key when Turnstile is enabled",
  );
  return { turnstileToken: TURNSTILE_ALWAYS_PASS_TOKEN };
}

async function apiLogin(context, accountData, loginPassword = password, activeOrg = "") {
  const response = await context.request.post(`${baseURL}/api/auth/login`, {
    headers: activeOrg ? { "X-Active-Org": encodeURIComponent(activeOrg) } : {},
    data: {
      username: accountData.username,
      password: loginPassword,
      remember: false,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function csrfHeaders(context, extra = {}) {
  let token = (await context.cookies(baseURL)).find((cookie) => cookie.name === "csrf_token")?.value;
  if (!token) {
    await context.request.post(`${baseURL}/api/auth/check-session`, { data: {} });
    token = (await context.cookies(baseURL)).find((cookie) => cookie.name === "csrf_token")?.value;
  }
  assert(token, "Server did not issue a CSRF token");
  return {
    Origin: new URL(baseURL).origin,
    ...extra,
    "X-CSRF-Token": token,
  };
}

async function loadAll(context, activeOrg = organizationId) {
  const response = await context.request.get(`${baseURL}/api/get-all-data?since=0`, {
    headers: { "X-Active-Org": encodeURIComponent(activeOrg) },
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok(), `get-all-data returned ${response.status()}: ${JSON.stringify(body)}`);
  return body;
}

async function loadPaginatedRecord(context, table, recordId, activeOrg = organizationId) {
  const response = await context.request.get(
    `${baseURL}/api/paginate?table=${encodeURIComponent(table)}&page=1&pageSize=200`,
    { headers: { "X-Active-Org": encodeURIComponent(activeOrg) } },
  );
  const body = await response.json().catch(() => ({}));
  assert(response.ok(), `paginate ${table} returned ${response.status()}: ${JSON.stringify(body)}`);
  return (body.items || []).find((item) => item.id === recordId) || null;
}

async function syncMutation(context, data, activeOrg = organizationId) {
  const response = await context.request.post(`${baseURL}/api/sync`, {
    headers: await csrfHeaders(context, { "X-Active-Org": encodeURIComponent(activeOrg) }),
    data,
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}

async function uiLogin(browser, accountData, expectedRole, contextOptions = {}) {
  // Authentication and authorization are the subject of this suite. Keep the
  // service-worker lifecycle in its dedicated smoke tests so a worker install
  // or cache shutdown cannot retain a multi-tab auth context indefinitely.
  const context = await browser.newContext({ locale: "vi-VN", ...contextOptions });
  const page = await context.newPage();
  await page.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#login-username").fill(accountData.username);
  await page.locator("#login-password").fill(password);
  const loginResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/auth/login",
    { timeout: 10_000 },
  );
  await page.locator("#form-auth-login button[type='submit']").click();
  const loginResponse = await loginResponsePromise;
  try {
    await page.waitForFunction(() => {
      const overlay = document.getElementById("auth-overlay");
      return overlay && getComputedStyle(overlay).display === "none";
    }, null, { timeout: 20_000 });
  } catch (error) {
    const body = await loginResponse.json().catch(() => ({}));
    throw new Error(
      `Authenticated overlay did not close after login HTTP ${loginResponse.status()}: ${JSON.stringify(body)}`,
      { cause: error },
    );
  }
  await page.waitForFunction((role) => {
    const profile = document.getElementById("header-profile-role")?.textContent || "";
    return role === "employee" ? /Chuyên viên/i.test(profile) : role === "manager" ? /Quản lý/i.test(profile) : /Super Admin/i.test(profile);
  }, expectedRole, { timeout: 10_000 });
  return { context, page };
}

let browser;
let fixtureCreated = false;
try {
  fixture("setup");
  fixtureCreated = true;
  browser = await chromium.launch({ headless: true });

  const unauthenticated = await browser.newContext();
  const protectedResponse = await unauthenticated.request.get(`${baseURL}/api/get-all-data?since=0`);
  assert([401, 403].includes(protectedResponse.status()), `Protected API returned ${protectedResponse.status()} without a session`);
  const protectedPage = await unauthenticated.newPage();
  await protectedPage.goto(`${baseURL}/goi-thau`, { waitUntil: "domcontentloaded" });
  await waitForApp(protectedPage);
  assert(await protectedPage.locator("#auth-overlay").isVisible(), "Protected route did not show the auth overlay");
  await unauthenticated.close();
  mark("protected-route-and-api-denied");

  const invalidContext = await browser.newContext();
  let auth = await apiLogin(invalidContext, accounts.manager, "Wrong!Password9");
  assert(auth.response.status() === 400, `Wrong password returned ${auth.response.status()}`);
  auth = await apiLogin(invalidContext, { username: `auth-e2e-${runId}-missing` }, password);
  assert(auth.response.status() === 400, `Unknown account returned ${auth.response.status()}`);
  auth = await apiLogin(invalidContext, accounts.unverified);
  assert(auth.response.status() === 400 && auth.body.unverified === true, "Unverified account was not rejected");
  await invalidContext.close();
  mark("invalid-logins-rejected");
  fixture("clear-rate-limits");

  const roleExpectations = [
    ["superadmin", "super_admin", "btn-tab-superadmin", true, "btn-tab-managernhanvien", false],
    ["manager", "manager", "btn-tab-managernhanvien", true, "btn-tab-superadmin", false],
    ["employee", "employee", "btn-tab-managernhanvien", false, "btn-tab-superadmin", false],
  ];
  for (const [key, role, allowedId, allowedVisible, deniedId, deniedVisible] of roleExpectations) {
    const { context, page } = await uiLogin(browser, accounts[key], role);
    await page.waitForFunction(({ allowed, shouldAllow, denied, shouldDeny }) => {
      const visible = (id) => {
        const item = document.getElementById(id);
        if (!item) return false;
        const style = getComputedStyle(item);
        return style.display !== "none" && style.visibility !== "hidden" && item.getClientRects().length > 0;
      };
      return visible(allowed) === shouldAllow && visible(denied) === shouldDeny;
    }, {
      allowed: allowedId,
      shouldAllow: allowedVisible,
      denied: deniedId,
      shouldDeny: deniedVisible,
    }, { timeout: 10_000 });
    assert(await page.locator(`#${allowedId}`).isVisible() === allowedVisible, `${role}: wrong allowed-menu visibility`);
    assert(await page.locator(`#${deniedId}`).isVisible() === deniedVisible, `${role}: wrong denied-menu visibility`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.locator("#auth-overlay").waitFor({ state: "hidden" });
    const secondTab = await context.newPage();
    await secondTab.goto(`${baseURL}/goi-thau`, { waitUntil: "domcontentloaded" });
    await waitForApp(secondTab);
    assert(!await secondTab.locator("#auth-overlay").isVisible(), `${role}: session did not work in a second tab`);
    await secondTab.goto(`${baseURL}/hop-dong`, { waitUntil: "domcontentloaded" });
    await secondTab.goBack({ waitUntil: "domcontentloaded" });
    assert(new URL(secondTab.url()).pathname === "/goi-thau", `${role}: Back did not restore route`);
    await secondTab.goForward({ waitUntil: "domcontentloaded" });
    assert(new URL(secondTab.url()).pathname === "/hop-dong", `${role}: Forward did not restore route`);
    if (key === "superadmin") {
      let releaseRoleSync;
      let observeRoleSync;
      const roleSyncRelease = new Promise((resolve) => { releaseRoleSync = resolve; });
      const roleSyncObserved = new Promise((resolve) => { observeRoleSync = resolve; });
      let delayedRoleSync = false;
      await page.route("**/api/get-all-data**", async (route) => {
        if (!delayedRoleSync) {
          delayedRoleSync = true;
          observeRoleSync();
          await roleSyncRelease;
        }
        await route.continue();
      });
      await page.evaluate(() => {
        window.__bfRoleSwitchDocumentProbe = "same-document";
      });
      await page.locator("#header-profile-trigger").click();
      await page.locator("#profile-dropdown-menu").waitFor({ state: "visible", timeout: 10_000 });
      await page.locator('.dropdown-role-btn[data-switch-role="employee"]').click();
      try {
        await Promise.race([
          roleSyncObserved,
          new Promise((_, reject) => setTimeout(() => reject(new Error("Role sync request was not observed")), 10_000)),
        ]);
        await page.waitForFunction(() => window.location.pathname === "/tong-quan", null, { timeout: 2_000 });
        const immediateTransitionState = await page.evaluate(() => ({
          documentProbe: window.__bfRoleSwitchDocumentProbe,
          initLoaderHidden: getComputedStyle(document.getElementById("system-init-loader")).visibility === "hidden",
          topBarLoading: document.getElementById("top-bar-loader")?.classList.contains("loading") === true,
        }));
        assert(immediateTransitionState.documentProbe === "same-document", "Active-role switch reloaded the document");
        assert(immediateTransitionState.initLoaderHidden, "Active-role switch showed the init loader");
        assert(!immediateTransitionState.topBarLoading, "Active-role switch showed the top-bar loader");
      } finally {
        releaseRoleSync();
      }
      await page.waitForFunction(() => (
        window.location.pathname === "/tong-quan"
        && /Chuyên viên/i.test(document.getElementById("header-profile-role")?.textContent || "")
      ), null, { timeout: 20_000 });
      const transitionState = await page.evaluate(() => ({
        documentProbe: window.__bfRoleSwitchDocumentProbe,
        initLoaderHidden: getComputedStyle(document.getElementById("system-init-loader")).visibility === "hidden",
        topBarLoading: document.getElementById("top-bar-loader")?.classList.contains("loading") === true,
      }));
      assert(transitionState.documentProbe === "same-document", "Active-role switch reloaded the document");
      assert(transitionState.initLoaderHidden, "Active-role switch showed the init loader");
      assert(!transitionState.topBarLoading, "Active-role switch showed the top-bar loader");
      await page.unroute("**/api/get-all-data**");
    }
    await context.close();
  }
  mark("role-menus-reload-back-forward-multitab");

  const adminUi = await uiLogin(browser, accounts.manager, "manager");
  await adminUi.page.goto(`${baseURL}/nhan-su`, { waitUntil: "domcontentloaded" });
  await waitForApp(adminUi.page);
  await adminUi.page.locator("#manager-employees-tbody tr").filter({ hasText: accounts.employee.email })
    .waitFor({ state: "visible", timeout: 20_000 });
  let managedEmployeeRow = adminUi.page.locator("#manager-employees-tbody tr").filter({ hasText: accounts.left.email });
  await managedEmployeeRow.waitFor({ state: "visible", timeout: 20_000 });
  assert((await managedEmployeeRow.innerText()).includes("Đã rời"), "Former employee was not rendered with the correct state");
  await managedEmployeeRow.getByRole("button", { name: /Thêm lại nhân viên/ }).click();
  await adminUi.page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 10_000 });
  await adminUi.page.locator("#btn-dialog-ok").click();
  await adminUi.page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 20_000 });
  managedEmployeeRow = adminUi.page.locator("#manager-employees-tbody tr").filter({ hasText: accounts.left.email });
  await managedEmployeeRow.waitFor({ state: "visible", timeout: 20_000 });
  await managedEmployeeRow.getByRole("button", { name: /Sửa nhân viên/ }).waitFor({ state: "visible", timeout: 20_000 });
  await managedEmployeeRow.getByRole("button", { name: /Sửa nhân viên/ }).click();
  await adminUi.page.locator("#modal-manager-employee.active").waitFor({ state: "visible", timeout: 10_000 });
  await adminUi.page.locator("#emp-phone").fill("0987654321");
  await adminUi.page.locator("#form-manager-employee button[type='submit']").click();
  await adminUi.page.locator("#modal-manager-employee.active").waitFor({ state: "hidden", timeout: 20_000 });
  managedEmployeeRow = adminUi.page.locator("#manager-employees-tbody tr").filter({ hasText: accounts.left.email });
  assert((await managedEmployeeRow.innerText()).includes("0987654321"), "Employee update UI did not persist the phone number");
  await managedEmployeeRow.getByRole("button", { name: /Cho nhân viên .* rời tổ chức/ }).click();
  await adminUi.page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 10_000 });
  await adminUi.page.locator("#btn-dialog-ok").click();
  await adminUi.page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 20_000 });
  const removalAlertVisible = await adminUi.page.locator("#modal-custom-dialog.active")
    .waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  if (removalAlertVisible) {
    const removalMessage = await adminUi.page.locator("#modal-custom-dialog").innerText();
    assert(removalMessage.includes("Đã cho nhân sự rời tổ chức"), `Employee removal failed: ${removalMessage}`);
    await adminUi.page.locator("#btn-dialog-ok").click();
    await adminUi.page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  }
  managedEmployeeRow = adminUi.page.locator("#manager-employees-tbody tr").filter({ hasText: accounts.left.email });
  await managedEmployeeRow.waitFor({ state: "visible", timeout: 20_000 });
  assert((await managedEmployeeRow.innerText()).includes("Đã rời"), "Removed employee did not move to former-member state");
  assert(await managedEmployeeRow.getByRole("button", { name: /Sửa nhân viên/ }).count() === 0, "Removed employee still had an edit action");
  const activeEmployeesResponse = await adminUi.context.request.get(`${baseURL}/api/auth/users`, {
    headers: { "X-Active-Org": encodeURIComponent(organizationId) },
  });
  const activeEmployees = await activeEmployeesResponse.json();
  assert(!activeEmployees.some((item) => item.id === accounts.left.id), "Removed employee remained active in the organization API");
  const formerEmployeesResponse = await adminUi.context.request.get(`${baseURL}/api/organizations/former-members`, {
    headers: { "X-Active-Org": encodeURIComponent(organizationId) },
  });
  const formerEmployees = await formerEmployeesResponse.json();
  assert(formerEmployees.some((item) => item.id === accounts.left.id), "Removed employee was not retained in organization history");
  await adminUi.context.close();
  mark("manager-employee-ui-create-update-remove");

  const workspaceUi = await uiLogin(browser, accounts.manager, "manager", {
    serviceWorkers: "block",
  });
  let releasePrimaryPull;
  let signalPrimaryPull;
  const primaryPullRelease = new Promise((resolve) => {
    releasePrimaryPull = resolve;
  });
  const primaryPullStarted = new Promise((resolve) => {
    signalPrimaryPull = resolve;
  });
  const holdPrimaryPull = async (route) => {
    const requestOrg = decodeURIComponent(route.request().headers()["x-active-org"] || "");
    if (requestOrg !== organizationId) {
      await route.continue();
      return;
    }
    signalPrimaryPull();
    await primaryPullRelease;
    await route.continue();
  };
  await workspaceUi.page.route("**/api/get-all-data?**", holdPrimaryPull);
  await workspaceUi.page.route("**/api/sync/delta?**", holdPrimaryPull);
  const latePrimaryResponse = workspaceUi.page.waitForResponse((candidate) => {
    const pathname = new URL(candidate.url()).pathname;
    const requestOrg = decodeURIComponent(candidate.request().headers()["x-active-org"] || "");
    return ["/api/get-all-data", "/api/sync/delta"].includes(pathname)
      && requestOrg === organizationId;
  }, { timeout: 20_000 });
  await workspaceUi.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await primaryPullStarted;
  await workspaceUi.page.waitForFunction(() => document.__bfProfileDropdownEventsBound === true, null, { timeout: 20_000 });
  await workspaceUi.page.locator("#header-profile-trigger").click();
  await workspaceUi.page.locator("#profile-dropdown-menu").waitFor({ state: "visible", timeout: 10_000 });
  const workspaceChoices = workspaceUi.page.locator("#org-switch-list .dropdown-org-btn");
  assert(await workspaceChoices.count() >= 2, "Manager workspace switcher did not show multiple authorized workspaces");
  assert(await workspaceUi.page.locator(`#org-switch-list [data-org="${organizationId}"]`).count() === 1, "Primary organization was missing or duplicated in workspace switcher");
  assert(await workspaceUi.page.locator(`#org-switch-list [data-org="${otherOrganizationId}"]`).count() === 1, "Secondary organization was missing from workspace switcher");
  await workspaceChoices.filter({ hasText: `Auth E2E other ${runId}` }).click();
  await workspaceUi.page.waitForFunction((expected) => (
    sessionStorage.getItem("bf_active_org") === expected
      || localStorage.getItem("bf_active_org") === expected
      || document.getElementById("header-active-org-name")?.textContent?.includes("other")
  ), otherOrganizationId, { timeout: 20_000 });
  releasePrimaryPull();
  await latePrimaryResponse;
  await workspaceUi.page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const postRaceWorkspace = await workspaceUi.page.evaluate(() => ({
    activeOrganizationId: sessionStorage.getItem("bf_active_org")
      || localStorage.getItem("bf_active_org"),
    headerOrganization: document.getElementById("header-active-org-name")?.textContent || "",
  }));
  assert(
    postRaceWorkspace.activeOrganizationId === otherOrganizationId,
    `Late primary-workspace reconciliation changed the active workspace: ${JSON.stringify(postRaceWorkspace)}`,
  );
  const switchDialogVisible = await workspaceUi.page.locator("#modal-custom-dialog.active")
    .waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  if (switchDialogVisible) {
    const workspaceSwitchMessage = await workspaceUi.page.locator("#modal-custom-dialog").innerText();
    assert(workspaceSwitchMessage.includes("Chuyển đổi thành công"), `Workspace switch failed: ${workspaceSwitchMessage}`);
    await workspaceUi.page.locator("#btn-dialog-ok").click();
    await workspaceUi.page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  }
  let workspaceSession = await json(await workspaceUi.context.request.post(`${baseURL}/api/auth/check-session`, {
    headers: { "X-Active-Org": encodeURIComponent(otherOrganizationId) },
    data: {},
  }));
  assert(workspaceSession.body.user?.active_org_id === otherOrganizationId, "Server did not authorize the selected workspace");
  const workspaceRefreshRequest = workspaceUi.page.waitForResponse((candidate) => (
    candidate.request().method() === "POST"
      && new URL(candidate.url()).pathname === "/api/auth/check-session"
  ), { timeout: 10_000 }).then(async (candidate) => ({
    status: candidate.status(),
    requestHeaders: candidate.request().headers(),
    body: await candidate.json().catch(() => ({})),
  })).catch(() => null);
  await workspaceUi.page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(workspaceUi.page);
  await workspaceUi.page.locator("#auth-overlay").waitFor({ state: "hidden" });
  const workspaceRefreshEvidence = await workspaceRefreshRequest;
  const workspaceClientState = await workspaceUi.page.evaluate(() => ({
    session: sessionStorage.getItem("bf_active_org"),
    local: localStorage.getItem("bf_active_org"),
  }));
  assert(workspaceClientState.session === otherOrganizationId, `Workspace selection was lost after reload: ${JSON.stringify({ workspaceClientState, workspaceRefreshEvidence })}`);
  workspaceSession = await json(await workspaceUi.context.request.post(`${baseURL}/api/auth/check-session`, {
    headers: { "X-Active-Org": encodeURIComponent(otherOrganizationId) },
    data: {},
  }));
  assert(workspaceSession.body.user?.active_org_id === otherOrganizationId, "Workspace selection was lost after reload");
  await workspaceUi.context.close();
  mark("workspace-switch-race-ui-reload-and-server-session");

  const managerContext = await browser.newContext();
  auth = await apiLogin(managerContext, accounts.manager, password, organizationId);
  assert(auth.response.ok(), `Manager login failed: ${auth.response.status()}`);
  assert(auth.body.platform_role === "user", "Manager was promoted to platform role");
  assert(auth.body.membership_role === "manager", "Manager membership role missing");
  assert(auth.body.effective_roles?.includes("manager"), "Manager effective role missing");
  let response = await managerContext.request.post(`${baseURL}/api/auth/active-role`, {
    headers: await csrfHeaders(managerContext),
    data: { active_role: "super_admin" },
  });
  assert(response.status() === 403, "Manager elevated to super_admin");
  response = await managerContext.request.get(`${baseURL}/api/get-all-data?since=0`, {
    headers: { "X-Active-Org": encodeURIComponent(suspendedOrganizationId) },
  });
  assert(response.status() === 403, `Cross-workspace request returned ${response.status()}`);
  response = await managerContext.request.post(`${baseURL}/api/auth/update-profile`, {
    headers: await csrfHeaders(managerContext),
    data: {
      name: "Auth E2E manager updated",
      email: accounts.manager.email,
      avatar: "",
    },
  });
  const profileBody = await response.text();
  assert(response.ok(), `Profile update returned ${response.status()}: ${profileBody}`);
  mark("manager-role-profile-and-cross-workspace");

  response = await managerContext.request.post(`${baseURL}/api/sync`, {
    headers: {
      "X-Active-Org": encodeURIComponent(organizationId),
      Origin: new URL(baseURL).origin,
    },
    data: {},
  });
  let securityBody = await response.json().catch(() => ({}));
  assert(response.status() === 403 && securityBody.code === "CSRF_TOKEN_INVALID", "Sync without CSRF token was accepted");
  response = await managerContext.request.post(`${baseURL}/api/sync`, {
    headers: {
      "X-Active-Org": encodeURIComponent(organizationId),
      "X-CSRF-Token": "invalid-token",
      Origin: new URL(baseURL).origin,
    },
    data: {},
  });
  securityBody = await response.json().catch(() => ({}));
  assert(response.status() === 403 && securityBody.code === "CSRF_TOKEN_INVALID", "Sync with the wrong CSRF token was accepted");
  response = await managerContext.request.post(`${baseURL}/api/sync`, {
    headers: await csrfHeaders(managerContext, {
      "X-Active-Org": encodeURIComponent(organizationId),
      Origin: "https://attacker.invalid",
    }),
    data: {},
  });
  assert(response.status() === 403, "Cross-origin sync with a valid token was accepted");

  response = await managerContext.request.post(`${baseURL}/api/auth/update-profile`, {
    headers: await csrfHeaders(managerContext),
    data: {
      name: "Auth E2E manager updated",
      email: accounts.manager.email,
      avatar: "",
      platform_role: "super_admin",
      effective_roles: ["super_admin"],
    },
  });
  assert([200, 400, 422].includes(response.status()), `Mass-assignment probe returned unexpected ${response.status()}`);
  const massAssignmentCheck = await json(await managerContext.request.post(`${baseURL}/api/auth/check-session`, { data: {} }));
  assert(massAssignmentCheck.body.valid === true, "Mass-assignment probe invalidated the manager session");
  assert(massAssignmentCheck.body.user?.platform_role !== "super_admin", "Profile payload elevated the manager platform role");
  assert(!(massAssignmentCheck.body.user?.effective_roles || []).includes("super_admin"), "Profile payload elevated effective roles");
  mark("csrf-origin-and-mass-assignment-denied");

  const xssId = `auth-e2e-${runId}-xss-expert`;
  const xssMarker = `<img src=x onerror="window.__bfXssExecuted=1"> XSS ${runId}`;
  const xssTimestamp = new Date().toISOString();
  let xssData = await loadAll(managerContext);
  const xssSyncResult = await syncMutation(managerContext, {
    chuyengia: [{
      id: xssId,
      rootId: xssId,
      phienBan: 0,
      isLatest: 1,
      createdAt: xssTimestamp,
      updatedAt: xssTimestamp,
      hoTen: xssMarker,
      soChungChi: `XSS-CC-${runId}`,
      soCCCD: `078${runId.slice(-9)}`,
    }],
    baseSyncVersion: Number(xssData.syncVersion || 0),
    clientMutationId: `auth-${runId}-xss-create`,
  });
  assert(xssSyncResult.response.ok(), `XSS fixture could not be saved safely: ${JSON.stringify(xssSyncResult.body)}`);
  const storedXssExpert = await loadPaginatedRecord(managerContext, "chuyengia", xssId);
  assert(storedXssExpert?.hoTen === xssMarker, `PostgreSQL-backed XSS fixture changed unexpectedly: ${JSON.stringify(storedXssExpert)}`);
  const xssPage = await managerContext.newPage();
  const xssPageErrors = [];
  const xssConsoleErrors = [];
  xssPage.on("pageerror", (error) => xssPageErrors.push(error.stack || error.message));
  xssPage.on("console", (message) => {
    if (message.type() === "error") xssConsoleErrors.push(message.text());
  });
  const initialExpertPage = xssPage.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname === "/api/paginate" && url.searchParams.get("table") === "chuyengia" && candidate.ok();
  }, { timeout: 20_000 });
  await xssPage.goto(`${baseURL}/chuyen-gia`, { waitUntil: "domcontentloaded" });
  await waitForApp(xssPage);
  await xssPage.locator("#auth-overlay").waitFor({ state: "hidden", timeout: 20_000 });
  await initialExpertPage;
  const searchedExpertPage = xssPage.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname === "/api/paginate"
      && url.searchParams.get("table") === "chuyengia"
      && url.searchParams.get("search")?.includes(`xss ${runId}`)
      && candidate.ok();
  }, { timeout: 20_000 });
  await xssPage.locator("#search-chuyengia").fill(`XSS ${runId}`);
  const searchedExpertResponse = await searchedExpertPage;
  const searchedExpertPayload = await searchedExpertResponse.json();
  const xssRow = xssPage.locator("#chuyengia-table tbody tr").filter({ hasText: `XSS ${runId}` });
  const xssVisible = await xssRow.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
  if (!xssVisible) {
    const diagnostics = await xssPage.evaluate(() => ({
      route: location.pathname,
      overlay: document.getElementById("auth-overlay")
        ? getComputedStyle(document.getElementById("auth-overlay")).display
        : "detached",
      search: document.getElementById("search-chuyengia")?.value || "",
      tableText: document.getElementById("chuyengia-table")?.innerText || "",
      bodyText: document.body.innerText.slice(-1500),
    }));
    throw new Error(`Stored XSS row was not rendered in the UI: ${JSON.stringify({ diagnostics, storedXssExpert, searchedExpertPayload, xssPageErrors, xssConsoleErrors })}`);
  }
  const xssText = await xssRow.innerText();
  assert(xssText.includes("<img src=x"), `XSS text was not rendered literally: ${xssText}`);
  assert(await xssRow.locator("img").count() === 0, "XSS payload created an executable image element");
  assert(await xssPage.evaluate(() => globalThis.__bfXssExecuted !== 1), "XSS event handler executed");
  await xssPage.close();
  mark("stored-xss-rendered-as-text");

  const permissionEmployeeContext = await browser.newContext();
  auth = await apiLogin(permissionEmployeeContext, accounts.employee, password, organizationId);
  assert(auth.response.ok(), "Employee permission-test login failed");
  const expertId = `auth-e2e-${runId}-permission-expert`;
  let employeeData = await loadAll(permissionEmployeeContext);
  let syncResult = await syncMutation(permissionEmployeeContext, {
    chuyengia: [{
      id: expertId,
      rootId: expertId,
      hoTen: `Chuyên gia quyền ${runId}`,
      soChungChi: `CC-${runId}`,
      soCCCD: `079${runId.slice(-9)}`,
    }],
    baseSyncVersion: Number(employeeData.syncVersion || 0),
    clientMutationId: `auth-${runId}-employee-create`,
  });
  assert(syncResult.response.ok(), `Employee edit permission could not create: ${JSON.stringify(syncResult.body)}`);
  employeeData = await loadAll(permissionEmployeeContext);
  let expert = await loadPaginatedRecord(permissionEmployeeContext, "chuyengia", expertId);
  assert(
    expert && Number.isInteger(expert.rowVersion),
    `Employee-created expert was not persisted: sync=${JSON.stringify(syncResult.body)}`,
  );
  syncResult = await syncMutation(permissionEmployeeContext, {
    chuyengia: [versionedMutation(expert, { hoTen: `Chuyên gia quyền cập nhật ${runId}` })],
    baseSyncVersion: Number(employeeData.syncVersion || 0),
    clientMutationId: `auth-${runId}-employee-update`,
  });
  assert(syncResult.response.ok(), `Employee could not update owned expert: ${JSON.stringify(syncResult.body)}`);
  employeeData = await loadAll(permissionEmployeeContext);
  expert = await loadPaginatedRecord(permissionEmployeeContext, "chuyengia", expertId);
  syncResult = await syncMutation(permissionEmployeeContext, {
    deletions: [{ table: "chuyengia", id: expertId, expectedVersion: expert.rowVersion }],
    baseSyncVersion: Number(employeeData.syncVersion || 0),
    clientMutationId: `auth-${runId}-employee-delete-denied`,
  });
  assert(!syncResult.response.ok(), "Employee unexpectedly deleted an organization record");
  assert(
    (syncResult.body.errors || []).some((error) => error?.code === "DELETE_ROLE_PROTECTED"),
    `Employee delete response omitted DELETE_ROLE_PROTECTED: ${JSON.stringify(syncResult.body)}`,
  );

  let managerData = await loadAll(managerContext);
  const permissionId = `auth-e2e-${runId}-employee-permissions`;
  const permission = (managerData.permissionmatrix || []).find((item) => item.id === permissionId);
  assert(permission && Number.isInteger(permission.rowVersion), "Employee permission matrix was not returned to manager");
  syncResult = await syncMutation(managerContext, {
    permissionmatrix: [versionedMutation(permission, { chuyengia: "view" })],
    baseSyncVersion: Number(managerData.syncVersion || 0),
    clientMutationId: `auth-${runId}-permission-revoke`,
  });
  assert(syncResult.response.ok(), `Manager could not revoke edit permission: ${JSON.stringify(syncResult.body)}`);

  employeeData = await loadAll(permissionEmployeeContext);
  expert = await loadPaginatedRecord(permissionEmployeeContext, "chuyengia", expertId);
  syncResult = await syncMutation(permissionEmployeeContext, {
    chuyengia: [versionedMutation(expert, { hoTen: `Bị chặn ${runId}` })],
    baseSyncVersion: Number(employeeData.syncVersion || 0),
    clientMutationId: `auth-${runId}-employee-update-denied`,
  });
  assert(!syncResult.response.ok(), "Revoked employee still edited the expert");
  assert(
    (syncResult.body.errors || []).some((error) => error?.code === "RECORD_ACCESS_DENIED")
      && !("serverRecord" in syncResult.body)
      && !("currentVersion" in syncResult.body),
    `Revoked edit response was not the bounded record-level deny contract: ${JSON.stringify(syncResult.body)}`,
  );

  managerData = await loadAll(managerContext);
  expert = await loadPaginatedRecord(managerContext, "chuyengia", expertId);
  syncResult = await syncMutation(managerContext, {
    chuyengia: [versionedMutation(expert, { hoTen: `Quản lý cập nhật ${runId}` })],
    baseSyncVersion: Number(managerData.syncVersion || 0),
    clientMutationId: `auth-${runId}-manager-update`,
  });
  assert(syncResult.response.ok(), `Manager could not update expert: ${JSON.stringify(syncResult.body)}`);
  managerData = await loadAll(managerContext);
  expert = await loadPaginatedRecord(managerContext, "chuyengia", expertId);
  syncResult = await syncMutation(managerContext, {
    deletions: [{ table: "chuyengia", id: expertId, expectedVersion: expert.rowVersion }],
    baseSyncVersion: Number(managerData.syncVersion || 0),
    clientMutationId: `auth-${runId}-manager-delete`,
  });
  assert(syncResult.response.ok(), `Manager could not delete expert: ${JSON.stringify(syncResult.body)}`);
  await permissionEmployeeContext.close();
  mark("employee-crud-permission-revocation-and-manager-delete");

  const leftContext = await browser.newContext();
  auth = await apiLogin(leftContext, accounts.left);
  assert(auth.response.ok(), "Former member account could not authenticate");
  assert(!(auth.body.organizations || []).some((item) => item.id === organizationId), "Former membership remained active");
  await leftContext.close();
  const suspendedContext = await browser.newContext();
  auth = await apiLogin(suspendedContext, accounts.suspended, password, suspendedOrganizationId);
  assert(auth.response.ok(), "Suspended-workspace member could not authenticate to account");
  const suspendedWorkspaces = auth.body.organizations || [];
  assert(
    !suspendedWorkspaces.some((item) => item.id === suspendedOrganizationId),
    `Suspended workspace remained in the active workspace list: ${JSON.stringify(suspendedWorkspaces)}`,
  );
  const personalWorkspaceId = `personal:${accounts.suspended.id}`;
  const personalWorkspace = suspendedWorkspaces.find((item) => item.id === personalWorkspaceId);
  assert(
    auth.body.active_org_id === personalWorkspaceId && personalWorkspace?.status === "active",
    `Login did not fall back to the active personal workspace: ${JSON.stringify(auth.body)}`,
  );
  assert(
    personalWorkspace?.entitlements?.word_export === false,
    "Personal fallback unexpectedly inherited the suspended organization's Word entitlement",
  );
  response = await suspendedContext.request.get(`${baseURL}/api/get-all-data?since=0`, {
    headers: { "X-Active-Org": encodeURIComponent(suspendedOrganizationId) },
  });
  assert(
    response.status() === 403,
    `Suspended organization accepted a data request: ${response.status()}`,
  );
  await suspendedContext.close();
  mark("membership-left-and-workspace-suspended");

  const employeeContext = await browser.newContext();
  auth = await apiLogin(employeeContext, accounts.employee);
  assert(auth.response.ok(), "Employee login failed");
  const competingContext = await browser.newContext();
  const competingLogin = await apiLogin(competingContext, accounts.employee);
  assert(competingLogin.response.ok(), "Second employee login failed");
  let check = await json(await employeeContext.request.post(`${baseURL}/api/auth/check-session`, { data: {} }));
  assert(check.body.valid === false, "Old session remained valid after replacement login");
  check = await json(await competingContext.request.post(`${baseURL}/api/auth/check-session`, { data: {} }));
  assert(check.body.valid === true, "Newest session was not valid");
  response = await competingContext.request.post(`${baseURL}/api/auth/change-password`, {
    headers: await csrfHeaders(competingContext),
    data: { old_password: password, new_password: changedPassword },
  });
  assert(response.ok(), `Change password returned ${response.status()}`);
  auth = await apiLogin(employeeContext, accounts.employee, password);
  assert(auth.response.status() === 400, "Old password still worked after change");
  auth = await apiLogin(employeeContext, accounts.employee, changedPassword);
  assert(auth.response.ok(), "New password did not work after change");
  await employeeContext.close();
  await competingContext.close();
  mark("session-replacement-and-password-change");

  const expiryContext = await browser.newContext();
  auth = await apiLogin(expiryContext, accounts.suspended);
  assert(auth.response.ok(), "Expiry fixture login failed");
  fixture("expire", { username: accounts.suspended.username });
  check = await json(await expiryContext.request.post(`${baseURL}/api/auth/check-session`, { data: {} }));
  assert(check.body.valid === false, "Expired session remained valid");
  await expiryContext.close();
  const revokeContext = await browser.newContext();
  auth = await apiLogin(revokeContext, accounts.left);
  assert(auth.response.ok(), "Revoke fixture login failed");
  fixture("revoke", { username: accounts.left.username });
  check = await json(await revokeContext.request.post(`${baseURL}/api/auth/check-session`, { data: {} }));
  assert(check.body.valid === false, "Revoked session remained valid");
  await revokeContext.close();
  mark("session-expiry-and-revocation");

  const resetToken = randomBytes(32).toString("base64url");
  fixture("seed-reset", { username: accounts.manager.username, token: resetToken });
  response = await managerContext.request.post(`${baseURL}/api/auth/reset-password`, {
    headers: await csrfHeaders(managerContext),
    data: { token: resetToken, new_password: resetPassword },
  });
  assert(response.ok(), `Password reset returned ${response.status()}`);
  response = await managerContext.request.post(`${baseURL}/api/auth/reset-password`, {
    headers: await csrfHeaders(managerContext),
    data: { token: resetToken, new_password: password },
  });
  assert(response.status() === 400, "Reset token was reusable");
  auth = await apiLogin(managerContext, accounts.manager, password);
  assert(auth.response.status() === 400, "Old password worked after reset");
  auth = await apiLogin(managerContext, accounts.manager, resetPassword);
  assert(auth.response.ok(), "Reset password did not work");
  response = await managerContext.request.post(`${baseURL}/api/auth/logout`, {
    headers: await csrfHeaders(managerContext),
    data: {},
  });
  assert(response.ok(), "Logout failed");
  check = await json(await managerContext.request.post(`${baseURL}/api/auth/check-session`, { data: {} }));
  assert(check.body.valid === false, "Session remained valid after logout");
  await managerContext.close();
  mark("password-reset-one-time-and-logout");

  fixture("clear-rate-limits");
  const publicContext = await browser.newContext();
  const registerUsername = registeredUsername;
  const registerEmail = `${registerUsername}@example.test`;
  const registrationChallenge = await localRegistrationChallenge(publicContext);
  response = await publicContext.request.post(`${baseURL}/api/auth/register`, {
    data: {
      username: registerUsername,
      password,
      name: "Registered E2E",
      email: registerEmail,
      ...registrationChallenge,
    },
  });
  const registrationBody = await response.text();
  assert(response.ok(), `Registration returned ${response.status()}: ${registrationBody}`);
  auth = await apiLogin(publicContext, { username: registerUsername }, password);
  assert(auth.response.status() === 400 && auth.body.unverified === true, "New unverified registration could log in");
  const forgotKnown = await json(await publicContext.request.post(`${baseURL}/api/auth/forgot-password`, {
    data: { username: registerUsername, email: registerEmail, ...registrationChallenge },
  }));
  const forgotUnknown = await json(await publicContext.request.post(`${baseURL}/api/auth/forgot-password`, {
    data: {
      username: `auth-e2e-${runId}-unknown`,
      email: `auth-e2e-${runId}-unknown@example.test`,
      ...registrationChallenge,
    },
  }));
  assert(forgotKnown.response.ok() && forgotUnknown.response.ok(), "Forgot-password response failed");
  assert(forgotKnown.body.message === forgotUnknown.body.message, "Forgot password leaked account existence");
  const registerPage = await publicContext.newPage();
  await registerPage.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
  await waitForApp(registerPage);
  await registerPage.locator("#btn-auth-brand-register").click();
  assert(await registerPage.locator("#form-auth-register .auth-legal-consent").isVisible(), "Registration did not show legal consent");
  await publicContext.close();
  mark("registration-legal-consent-and-forgot-password-privacy");

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
  if (fixtureCreated) {
    const cleanup = fixture("cleanup");
    mark("fixture-removed", cleanup);
  }
}
