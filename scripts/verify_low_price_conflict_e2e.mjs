import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const runId = `lp25-${Date.now()}`;
const organizationId = `${runId}-org`;
const password = `Aa!9${randomBytes(12).toString("hex")}`;
const accounts = ["first", "second"].map((key) => ({
  id: `${runId}-${key}-id`,
  username: `${runId}-${key}`,
  email: `${runId}-${key}@example.test`,
  name: `LP-25 ${key}`,
}));
const fixturePayload = { runId, organizationId, password, accounts };

function fixture(action, extra = {}) {
  const execution = spawnSync(
    process.env.PYTHON || "python",
    ["scripts/low_price_conflict_fixture.py", action],
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

async function login(context, account) {
  const response = await context.request.post(`${baseURL}/api/auth/login`, {
    headers: { "X-Active-Org": encodeURIComponent(organizationId) },
    data: { username: account.username, password, remember: false },
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok(), `Login failed for ${account.username}: ${response.status()} ${JSON.stringify(body)}`);
}

async function csrfHeaders(context) {
  let token = (await context.cookies(baseURL)).find((cookie) => cookie.name === "csrf_token")?.value;
  if (!token) {
    await context.request.post(`${baseURL}/api/auth/check-session`, { data: {} });
    token = (await context.cookies(baseURL)).find((cookie) => cookie.name === "csrf_token")?.value;
  }
  assert(token, "Missing CSRF token");
  return {
    "X-CSRF-Token": token,
    "X-Active-Org": encodeURIComponent(organizationId),
  };
}

async function loadOpening(context, openingId) {
  const response = await context.request.get(`${baseURL}/api/get-all-data?since=0`, {
    headers: { "X-Active-Org": encodeURIComponent(organizationId) },
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok(), `get-all-data failed: ${response.status()} ${JSON.stringify(body)}`);
  const opening = (body.thongtinmothau || []).find((item) => item.id === openingId);
  assert(opening, `Opening ${openingId} was not returned`);
  assert(Number.isInteger(opening.rowVersion), `Opening rowVersion is invalid: ${opening.rowVersion}`);
  return { opening, syncVersion: Number(body.syncVersion || 0) };
}

async function saveDecision(context, staleSnapshot, decision, mutationId) {
  const item = {
    ...staleSnapshot.opening,
    expectedVersion: staleSnapshot.opening.rowVersion,
    chapThuanGiaDeNghiTrungThauDuoi50: decision,
  };
  delete item.rowVersion;
  return context.request.post(`${baseURL}/api/sync`, {
    headers: await csrfHeaders(context),
    data: {
      thongtinmothau: [item],
      baseSyncVersion: staleSnapshot.syncVersion,
      clientMutationId: mutationId,
    },
  });
}

let browser;
let fixtureCreated = false;
try {
  const seeded = fixture("setup");
  fixtureCreated = true;
  browser = await chromium.launch({ headless: true });
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  await login(firstContext, accounts[0]);
  await login(secondContext, accounts[1]);

  const firstSnapshot = await loadOpening(firstContext, seeded.openingId);
  const secondSnapshot = await loadOpening(secondContext, seeded.openingId);
  assert(
    firstSnapshot.opening.rowVersion === secondSnapshot.opening.rowVersion,
    "The two users did not start from the same row version",
  );

  const firstResponse = await saveDecision(firstContext, firstSnapshot, true, `${runId}-first`);
  const firstBody = await firstResponse.json().catch(() => ({}));
  assert(firstResponse.ok(), `First decision failed: ${firstResponse.status()} ${JSON.stringify(firstBody)}`);

  const secondResponse = await saveDecision(secondContext, secondSnapshot, false, `${runId}-second`);
  const secondBody = await secondResponse.json().catch(() => ({}));
  assert(secondResponse.status() === 409, `Stale decision returned ${secondResponse.status()}: ${JSON.stringify(secondBody)}`);
  const validationErrors = secondBody.validationErrors || secondBody.errors || [];
  assert(
    validationErrors.some((error) => error?.code === "ROW_VERSION_CONFLICT"),
    `Conflict response omitted ROW_VERSION_CONFLICT: ${JSON.stringify(secondBody)}`,
  );

  const refreshed = await loadOpening(secondContext, seeded.openingId);
  assert(
    refreshed.opening.chapThuanGiaDeNghiTrungThauDuoi50 === true,
    `Server decision was overwritten by stale client: ${JSON.stringify(refreshed.opening)}`,
  );
  const database = fixture("verify", { openingId: seeded.openingId });
  assert(database.decision === true, `Database decision is not true: ${JSON.stringify(database)}`);
  assert(database.rowVersion > firstSnapshot.opening.rowVersion, "Database rowVersion did not advance");

  process.stdout.write(`${JSON.stringify({
    runId,
    staleStatus: secondResponse.status(),
    conflictCode: "ROW_VERSION_CONFLICT",
    initialRowVersion: firstSnapshot.opening.rowVersion,
    finalRowVersion: database.rowVersion,
    finalDecision: database.decision,
  }, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
  if (fixtureCreated) {
    const cleanup = fixture("cleanup");
    process.stdout.write(`[LP-25] fixture-removed ${JSON.stringify(cleanup)}\n`);
  }
}
