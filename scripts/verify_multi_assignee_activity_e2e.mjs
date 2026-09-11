import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { createE2ETestClock } from "./e2e_test_clock.mjs";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const testClock = createE2ETestClock();
const runId = `multi-assignee-${Date.now()}`;
const pollingRevocation = process.env.E2E_REVOCATION_TRANSPORT === "polling";
const password = `Aa!9${randomBytes(12).toString("hex")}`;
const account = (key, name) => ({
  id: `${runId}-${key}-id`,
  username: `${runId}-${key}`,
  email: `${runId}-${key}@example.test`,
  name,
});
const data = {
  runId,
  organizationId: `${runId}-org`,
  outsiderOrganizationId: `${runId}-outsider-org`,
  password,
  manager: account("manager", `Manager ${runId}`),
  employees: [
    account("a", `Nhân viên A ${runId}`),
    account("b", `Nhân viên B ${runId}`),
    account("c", `Nhân viên C ${runId}`),
  ],
  outsider: account("outsider", `Người ngoài ${runId}`),
  packageCode: `${runId}-GT`,
  contractNo: `${runId}/HD`,
};

function fixture(action) {
  const execution = spawnSync(
    process.env.PYTHON || "python",
    ["scripts/multi_assignee_activity_fixture.py", action],
    {
      cwd: process.cwd(),
      env: process.env,
      input: JSON.stringify(data),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (execution.status !== 0) throw new Error(execution.stderr || execution.stdout);
  return JSON.parse(execution.stdout || "{}");
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}

async function login(page, user) {
  await page.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
  await page.locator("#login-username").fill(user.username);
  await page.locator("#login-password").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/dang-nhap", { timeout: 20_000 }),
    page.locator("#form-auth-login button[type='submit']").click(),
  ]);
  await waitForApp(page);
}

async function gotoRoute(page, route) {
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`${route} returned ${response?.status()}`);
  await waitForApp(page);
}

const select = (page, selector, option) => page.locator(selector).selectOption(option, { force: true });

async function submitModal(page, formSelector, modalSelector) {
  await page.locator(`${formSelector} button[type="submit"]`).click();
  const modal = page.locator(`${modalSelector}.active`);
  const outcome = await Promise.race([
    modal.waitFor({ state: "hidden", timeout: 20_000 }).then(() => "closed").catch(() => null),
    page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 20_000 }).then(() => "dialog").catch(() => null),
  ]);
  if (outcome === "dialog") {
    const dialogText = await page.locator("#modal-custom-dialog.active").innerText();
    await page.locator("#btn-dialog-ok").click();
    await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
    await modal.waitFor({ state: "hidden", timeout: 3_000 }).catch(async () => {
      const invalid = await page.evaluate((selector) => [...document.querySelectorAll(`${selector} :invalid`)].map((element) => ({ id: element.id, message: element.validationMessage })), formSelector);
      throw new Error(`${formSelector} stayed open after dialog ${JSON.stringify(dialogText)}; invalid=${JSON.stringify(invalid)}`);
    });
  }
  if (outcome !== "closed" && outcome !== "dialog") {
    throw new Error(`${formSelector} did not close`);
  }
}

async function syncMutation(page, payload, { clientMutationId } = {}) {
  const result = await page.evaluate(async (body) => {
    const csrfToken = document.cookie.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("csrf_token="))
      ?.slice("csrf_token=".length) || "";
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": decodeURIComponent(csrfToken),
        "X-Active-Org": body.__organizationId,
      },
      body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "__organizationId"))),
    });
    return { status: response.status, body: await response.json() };
  }, {
    ...payload,
    __organizationId: data.organizationId,
    clientMutationId: clientMutationId || randomBytes(16).toString("hex"),
  });
  if (
    result.status !== 200
    || (result.body?.status && result.body.status !== "success")
    || (Array.isArray(result.body?.errors) && result.body.errors.length)
  ) {
    throw new Error(`Sync failed: ${JSON.stringify(result)}`);
  }
  return result.body;
}

async function removeOrganizationMember(page, userId) {
  return page.evaluate(async ({ userId, organizationId }) => {
    const csrfToken = document.cookie.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("csrf_token="))
      ?.slice("csrf_token=".length) || "";
    const response = await fetch("/api/auth/users/remove-from-org", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": decodeURIComponent(csrfToken),
        "X-Active-Org": organizationId,
      },
      body: JSON.stringify({ user_id: userId }),
    });
    return { status: response.status, body: await response.json() };
  }, { userId, organizationId: data.organizationId });
}

function minimalPdfBytes() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  const chunks = [Buffer.from("%PDF-1.4\n%âãÏÓ\n", "latin1")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "ascii");
    chunks.push(chunk);
    length += chunk.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  chunks.push(Buffer.from(xref, "ascii"));
  return Array.from(Buffer.concat(chunks));
}

async function uploadDocumentTwice(browser, user, packageId) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, user);
    return await page.evaluate(async ({ packageId, organizationId, bytes, mutationKey }) => {
      const send = async () => {
        const csrfToken = document.cookie.split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) || "";
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "multi-assignee-proof.pdf");
        const response = await fetch(`/api/packages/${packageId}/documents/HSMT`, {
          method: "PUT",
          headers: {
            "X-CSRF-Token": decodeURIComponent(csrfToken),
            "X-Active-Org": organizationId,
            "Idempotency-Key": mutationKey,
          },
          body: form,
        });
        return { status: response.status, body: await response.json() };
      };
      return [await send(), await send()];
    }, {
      packageId,
      organizationId: data.organizationId,
      bytes: minimalPdfBytes(),
      mutationKey: `${runId}-document-upload`,
    });
  } finally {
    await context.close();
  }
}

async function deleteDocumentTwice(page, packageId) {
  return page.evaluate(async ({ packageId, organizationId, mutationKey }) => {
    const send = async () => {
      const csrfToken = document.cookie.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("csrf_token="))
        ?.slice("csrf_token=".length) || "";
      const response = await fetch(`/api/packages/${packageId}/documents/HSMT`, {
        method: "DELETE",
        headers: {
          "X-CSRF-Token": decodeURIComponent(csrfToken),
          "X-Active-Org": organizationId,
          "Idempotency-Key": mutationKey,
        },
      });
      return { status: response.status, body: await response.json() };
    };
    return [await send(), await send()];
  }, {
    packageId,
    organizationId: data.organizationId,
    mutationKey: `${runId}-document-delete`,
  });
}

async function createPackage(page, employeeIds) {
  const packageId = `${runId}-package`;
  await syncMutation(page, {
    goithau: [{
      id: packageId,
      rootId: packageId,
      maGoiThau: data.packageCode,
      tenGoiThau: `Gói nhiều người ${runId}`,
      keHoachId: `${runId}-plan`,
      giaGoiThau: 500000000,
      linhVuc: "Hàng hóa",
      hinhThucLuaChon: "Đấu thầu rộng rãi",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      phuongPhapDanhGia: "Giá thấp nhất",
      phanLo: "Không",
      thoiGianThucHien: "90 ngày",
      nguonVon: "Ngân sách nhà nước",
      thoiGianToChuc: "45 ngày",
      thoiGianBatDauToChuc: testClock.quarter(),
      trangThai: "Chuẩn bị",
    }],
    assignments: employeeIds.map((employeeId) => ({
      id: `${runId}-package-assignment-${employeeId}`,
      empId: employeeId,
      targetId: packageId,
      type: "goithau",
    })),
  });
}

async function updatePackageAs(browser, user, state) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const updatedName = `Gói do A cập nhật ${runId}`;
  try {
    await login(page, user);
    await syncMutation(page, {
      goithau: [{
        id: state.packageId,
        rootId: state.packageId,
        expectedVersion: state.packageRowVersion,
        maGoiThau: data.packageCode,
        tenGoiThau: updatedName,
        keHoachId: `${runId}-plan`,
        giaGoiThau: 500000000,
        linhVuc: "Hàng hóa",
        hinhThucLuaChon: "Đấu thầu rộng rãi",
        phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
        phuongPhapDanhGia: "Giá thấp nhất",
        phanLo: "Không",
        thoiGianThucHien: "90 ngày",
        nguonVon: "Ngân sách nhà nước",
        thoiGianToChuc: "45 ngày",
        thoiGianBatDauToChuc: testClock.quarter(),
        trangThai: "Chuẩn bị",
      }],
    });
  } finally {
    await context.close();
  }
  return updatedName;
}

async function createPackageVersion(page, assigneeIds) {
  const result = await page.evaluate(async ({ sourceId, organizationId, mutationId }) => {
    const csrf = decodeURIComponent(document.cookie.split(";").map(x => x.trim())
      .find(x => x.startsWith("csrf_token="))?.slice(11) || "");
    const headers = { "Content-Type": "application/json", "X-CSRF-Token": csrf,
      "X-Active-Org": organizationId };
    const read = await fetch(`/api/paginate?table=goithau&page=1&pageSize=100`, { headers });
    if (!read.ok) throw new Error(`Source read failed: ${read.status}`);
    const source = (await read.json()).items.find(row => row.id === sourceId);
    if (!source) throw new Error("Version source missing from authoritative page");
    const command = { kind: "package", sourceId, expectedRowVersion: source.rowVersion,
      clientMutationId: mutationId, changes: {} };
    const response = await fetch("/api/versioning/aggregate", { method: "POST",
      headers: { ...headers, "Idempotency-Key": mutationId }, body: JSON.stringify(command) });
    const body = await response.json();
    if (!response.ok) throw new Error(`Aggregate version failed: ${JSON.stringify(body)}`);
    const version = (body.rowVersions || []).find(row => row.table === "goithau" && row.id !== sourceId);
    if (!version) throw new Error("Aggregate response omitted new package acknowledgment");
    // An intentional replay checks idempotency, not a retry of a failed request.
    const replay = await fetch("/api/versioning/aggregate", { method: "POST",
      headers: { ...headers, "Idempotency-Key": mutationId }, body: JSON.stringify(command) });
    const replayBody = await replay.json();
    if (!replay.ok || !(replayBody.rowVersions || []).some(row => row.table === "goithau" && row.id === version.id)) {
      throw new Error("Aggregate replay did not acknowledge the same package version");
    }
    return version.id;
  }, { sourceId: `${runId}-package`, organizationId: data.organizationId,
    mutationId: `${runId}-official-package-version` });
  data.packageVersionId = result;
  const inherited = fixture("verify").versionAssignments.map(row => row.userId).sort();
  if (inherited.join(",") !== [...assigneeIds].sort().join(",")) {
    throw new Error("Server aggregate did not inherit the exact assignee set");
  }
  return result;
}

async function editPackageAssignees(page, previousState, employeeIds) {
  const currentIds = new Set(previousState.packageAssignments.map((item) => item.userId));
  const selectedIds = new Set(employeeIds);
  const removed = previousState.packageAssignments.filter((item) => !selectedIds.has(item.userId));
  const added = employeeIds.filter((employeeId) => !currentIds.has(employeeId));
  await syncMutation(page, {
    assignments: added.map((employeeId) => ({
      id: `${runId}-package-assignment-${employeeId}`,
      empId: employeeId,
      targetId: previousState.packageId,
      type: "goithau",
    })),
    deletions: removed.map((item) => ({
      table: "assignments",
      id: item.id,
      expectedVersion: item.rowVersion,
    })),
  });
}

async function createContract(page, employeeIds) {
  const contractId = `${runId}-contract`;
  await syncMutation(page, {
    hopdong: [{
      id: contractId,
      rootId: contractId,
      tenHopDong: `Hợp đồng nhiều người ${runId}`,
      soHopDong: data.contractNo,
      ngayKy: testClock.isoDate(-37),
      chuDauTuId: `${runId}-owner`,
      nhaThauId: `${runId}-contractor`,
      keHoachId: `${runId}-plan`,
      giaTri: 450000000,
      loaiHopDong: "Trọn gói",
      phanLoai: "Khác",
      soNgayThucHien: "90 ngày",
      trangThaiHopDong: "Đang thực hiện",
      goiThauIds: [`${runId}-package`],
    }],
    assignments: employeeIds.map((employeeId) => ({
      id: `${runId}-contract-assignment-${employeeId}`,
      empId: employeeId,
      targetId: contractId,
      type: "hopdong",
    })),
  });
}

async function updateContract(page, state) {
  const updatedName = `Hợp đồng đã cập nhật ${runId}`;
  await syncMutation(page, {
    hopdong: [{
      id: state.contractId,
      rootId: state.contractId,
      expectedVersion: state.contractRowVersion,
      tenHopDong: updatedName,
      soHopDong: data.contractNo,
      ngayKy: testClock.isoDate(-37),
      chuDauTuId: `${runId}-owner`,
      nhaThauId: `${runId}-contractor`,
      keHoachId: `${runId}-plan`,
      giaTri: 450000000,
      loaiHopDong: "Trọn gói",
      phanLoai: "Khác",
      soNgayThucHien: "90 ngày",
      trangThaiHopDong: "Đang thực hiện",
      goiThauIds: [`${runId}-package`],
    }],
  });
  return updatedName;
}

async function activityStatus(browser, user, targetType, targetId, { membershipRemoved = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, user);
    const organizationId = user.id === data.outsider.id
      ? data.outsiderOrganizationId
      : data.organizationId;
    return await page.evaluate(async ({ targetType, targetId, organizationId, membershipRemoved }) => {
      const response = await fetch(`/api/activities/${targetType}/${targetId}`, {
        headers: { "X-Active-Org": organizationId },
      });
      if (targetType === "goithau" && response.status === 403) {
        const headers = { "X-Active-Org": organizationId };
        const list = await fetch("/api/paginate?table=goithau&page=1&pageSize=100", { headers });
        if (membershipRemoved ? list.status !== 403 : !list.ok) {
          throw new Error(`Revoked pagination returned unexpected status: ${list.status}`);
        }
        if (list.ok && (await list.json()).items.some(row => row.id === targetId)) {
          throw new Error("Revoked package remains in pagination");
        }
        const record = await fetch(`/api/record?table=goithau&id=${encodeURIComponent(targetId)}`, { headers });
        if (![403, 404].includes(record.status)) {
          throw new Error(`Revoked direct record unexpectedly returned ${record.status}`);
        }
      }
      return response.status;
    }, { targetType, targetId, organizationId, membershipRemoved });
  } finally {
    await context.close();
  }
}

let fixtureCreated = false;
const browser = await chromium.launch({ headless: true });
try {
  fixture("setup");
  fixtureCreated = true;
  const managerContext = await browser.newContext();
  const page = await managerContext.newPage();
  await login(page, data.manager);
  const [employeeA, employeeB, employeeC] = data.employees;

  await createPackage(page, [employeeA.id, employeeB.id]);
  let state = fixture("verify");
  if (state.packageAssignments.map((item) => item.userId).join(",") !== [employeeA.id, employeeB.id].sort().join(",")) {
    throw new Error(`Initial package assignments are incorrect: ${JSON.stringify(state.packageAssignments)}`);
  }
  const retainedB = state.packageAssignments.find((item) => item.userId === employeeB.id);
  if (await activityStatus(browser, employeeA, "goithau", state.packageId) !== 200) throw new Error("A cannot read assigned package");
  if (await activityStatus(browser, employeeB, "goithau", state.packageId) !== 200) throw new Error("B cannot read assigned package");
  if (await activityStatus(browser, employeeC, "goithau", state.packageId) !== 403) throw new Error("C unexpectedly reads unassigned package");

  const updatedPackageName = await updatePackageAs(browser, employeeA, state);
  state = fixture("verify");
  if (state.packageName !== updatedPackageName) {
    throw new Error(`A's package update was not persisted: ${JSON.stringify(state)}`);
  }
  if (!state.activityEvents.some((item) => item.action === "goithau.updated" && item.actorUserId === employeeA.id)) {
    throw new Error("Package update activity did not preserve employee A as actor");
  }

  const uploadAttempts = await uploadDocumentTwice(browser, employeeB, state.packageId);
  if (uploadAttempts.some((attempt) => attempt.status !== 201)) {
    throw new Error(`Idempotent document upload failed: ${JSON.stringify(uploadAttempts)}`);
  }
  if (uploadAttempts[0].body?.document?.id !== uploadAttempts[1].body?.document?.id) {
    throw new Error(`Document upload retry created a different record: ${JSON.stringify(uploadAttempts)}`);
  }
  const deleteAttempts = await deleteDocumentTwice(page, state.packageId);
  if (deleteAttempts.some((attempt) => attempt.status !== 200)) {
    throw new Error(`Idempotent document delete failed: ${JSON.stringify(deleteAttempts)}`);
  }

  const revokedContext = await browser.newContext();
  let droppedRevocationHints = 0;
  if (pollingRevocation) {
    await revokedContext.routeWebSocket("**/ws/sync", pageSocket => {
      const serverSocket = pageSocket.connectToServer();
      pageSocket.onMessage(message => serverSocket.send(message));
      serverSocket.onMessage(message => {
        let event;
        try { event = JSON.parse(String(message)); } catch { /* Forward opaque frames. */ }
        if (event?.event === "db_changed") { droppedRevocationHints += 1; return; }
        pageSocket.send(message);
      });
    });
  }
  const revocationTraffic = [];
  const revocationSockets = [];
  const revocationPageIds = new WeakMap();
  const revocationSocketReady = new WeakMap();
  let nextRevocationPageId = 0;
  let transferStartedAt = null;
  let transferCompletedAt = null;
  revokedContext.on("page", observedPage => {
    revocationPageIds.set(observedPage, ++nextRevocationPageId);
    let resolveReady;
    revocationSocketReady.set(observedPage, new Promise(resolve => { resolveReady = resolve; }));
    observedPage.on("websocket", socket => {
      socket.on("framereceived", frame => {
        try {
          const message = JSON.parse(String(frame.payload));
          if (message.type === "ready" && message.organizationId === data.organizationId) resolveReady();
          revocationSockets.push({ time: Date.now(), pageId: revocationPageIds.get(observedPage), path: observedPage.url().split("?")[0],
            event: message.event || message.type || "unknown" });
          if (revocationSockets.length > 30) revocationSockets.shift();
        } catch { /* Ignore non-JSON protocol frames in diagnostics. */ }
      });
    });
  });
  revokedContext.on("response", async response => {
    const pathname = new URL(response.url()).pathname;
    if (!["/api/sync/delta", "/api/get-all-data"].includes(pathname)) return;
    const receivedAt = Date.now();
    try {
      const body = await response.json();
      revocationTraffic.push({ time: receivedAt, pageId: revocationPageIds.get(response.frame().page()), path: response.frame().url().split("?")[0], endpoint: pathname,
        status: response.status(), code: body.code, syncVersion: body.syncVersion,
        hasVisibilityToken: Boolean(body.visibilityToken), partial: body.partial,
        packageIds: (body.goithau || []).map(row => row.id) });
      if (revocationTraffic.length > 30) revocationTraffic.shift();
    } catch { /* Failure diagnostics must not affect browser execution. */ }
  });
  try {
    const revokedPage = await revokedContext.newPage();
    await login(revokedPage, employeeA);
    await gotoRoute(revokedPage, "/goi-thau");
    await revokedPage.waitForFunction(() => document.getElementById("btn-force-sync")?.dataset.startupReconciliationPhase === "RECONCILED");
    await revokedPage.locator("#search-goithau").fill(data.packageCode);
    await revokedPage.locator("#goithau-table tbody tr").filter({ hasText: data.packageCode })
      .locator('[data-bf-action="edit-package"]').click();
    await revokedPage.locator("#modal-goithau.active").waitFor({ state: "visible" });
    await revokedPage.locator("#gt-ten").fill(`Unsaved revoked edit ${runId}`);
    const breakdownPage = await revokedContext.newPage();
    await gotoRoute(breakdownPage, "/ke-hoach");
    await breakdownPage.waitForFunction(() => document.getElementById("btn-force-sync")?.dataset.startupReconciliationPhase === "RECONCILED");
    await breakdownPage.locator("#search-kehoach").fill(runId);
    await breakdownPage.locator("#kehoach-table tbody tr").filter({ hasText: runId })
      .locator('[data-bf-action="edit-plan"]').click();
    await breakdownPage.locator("#modal-kehoach.active").waitFor({ state: "visible" });
    await breakdownPage.locator("#kh-ten").fill(`Unsaved revoked plan ${runId}`);
    await select(breakdownPage, "#kh-loaihinh", { label: "Dự toán mua sắm" });
    await select(breakdownPage, "#kh-pheduyet", { value: "Dự toán và kế hoạch" });
    await breakdownPage.locator("#kh-sototrinhdutoankehoach").fill(`${runId}/TTR-DRAFT`);
    await breakdownPage.locator("#kh-ngaytrinhkehoach").fill(testClock.date(-30));
    await breakdownPage.locator("#kh-ngaypheduyet").fill(testClock.date(-29));
    await breakdownPage.locator("#form-kehoach button[type='submit']").click();
    await breakdownPage.locator("#modal-plan-breakdown.active").waitFor({ state: "visible" }).catch(async (error) => {
      const diagnostic = await breakdownPage.evaluate(() => ({
        invalid: [...document.querySelectorAll("#form-kehoach :invalid")].map((field) => ({
          id: field.id, value: field.value, message: field.validationMessage,
        })),
        dialog: document.getElementById("modal-custom-dialog")?.innerText,
        toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.innerText),
      }));
      throw new Error(`Plan breakdown did not open: ${JSON.stringify(diagnostic)}`, { cause: error });
    });
    // This case checks hint-driven revocation. Polling without a delivered hint
    // is exercised separately; do not transfer before either socket authenticates.
    let readinessTimer;
    try {
      await Promise.race([
        Promise.all([revocationSocketReady.get(revokedPage), revocationSocketReady.get(breakdownPage)]),
        new Promise((_, reject) => { readinessTimer = setTimeout(() => reject(new Error("Revocation sockets did not authenticate")), 20000); }),
      ]);
    } finally { clearTimeout(readinessTimer); }
    transferStartedAt = Date.now();
    droppedRevocationHints = 0;
    await editPackageAssignees(page, state, [employeeB.id, employeeC.id]);
    transferCompletedAt = Date.now();
    await revokedPage.locator("#modal-goithau.active").waitFor({ state: "hidden", timeout: pollingRevocation ? 50_000 : 20_000 }).catch(async (error) => {
      const readState = (target) => target.evaluate(() => ({
        path: location.pathname, visibility: document.visibilityState,
        sync: { ...document.getElementById("btn-force-sync")?.dataset },
        toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.innerText),
        activeModals: [...document.querySelectorAll(".modal-overlay.active")].map((item) => item.id),
      }));
      throw new Error(`Revoked editors remain visible: ${JSON.stringify({
        transferStartedAt, transferCompletedAt,
        packageTab: await readState(revokedPage), planTab: await readState(breakdownPage), revocationTraffic, revocationSockets,
      })}`, { cause: error });
    });
    await revokedPage.waitForFunction((code) => !document.querySelector("#goithau-table")?.textContent.includes(code), data.packageCode);
    process.stdout.write("[E2E] revoked-open-package-editor-closed\n");
    await breakdownPage.locator("#modal-plan-breakdown.active").waitFor({ state: "hidden", timeout: pollingRevocation ? 50_000 : 20_000 }).catch(async (error) => {
      const diagnostic = await breakdownPage.evaluate(() => ({
        path: location.pathname,
        visibility: document.visibilityState,
        sync: { ...document.getElementById("btn-force-sync")?.dataset },
        breakdownPlanId: document.getElementById("breakdown-plan-id")?.value || "",
        planFormId: document.getElementById("form-kehoach-id")?.value || "",
        activeModals: [...document.querySelectorAll(".modal-overlay.active")].map((item) => item.id),
        toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.innerText),
      }));
      throw new Error(`Revoked plan breakdown remains visible: ${JSON.stringify({
        transferStartedAt, transferCompletedAt, diagnostic, revocationTraffic, revocationSockets,
      })}`, { cause: error });
    });
    await breakdownPage.waitForFunction((id) => !document.querySelector("#kehoach-table")?.textContent.includes(id), runId);
    process.stdout.write("[E2E] revoked-dirty-plan-breakdown-closed\n");
    if (pollingRevocation) {
      if (!droppedRevocationHints) throw new Error("Polling revocation did not drop any hints");
      for (const target of [revokedPage, breakdownPage]) {
        const pageId = revocationPageIds.get(target);
        if (!revocationTraffic.some(entry => entry.pageId === pageId && entry.time >= transferStartedAt
          && entry.endpoint === "/api/get-all-data" && entry.status === 200 && entry.partial === false)) {
          throw new Error("Polling revocation lacks an authoritative full reset for each tab");
        }
      }
    }
    process.stdout.write(`[E2E] revocation-observation ${JSON.stringify({ transport: pollingRevocation ? "polling" : "websocket",
      droppedRevocationHints, transferStartedAt, transferCompletedAt,
      traffic: revocationTraffic.filter(entry => entry.time >= transferStartedAt),
      sockets: revocationSockets.filter(entry => entry.time >= transferStartedAt) })}\n`);
  } finally {
    await revokedContext.close();
  }
  await createContract(page, [employeeA.id, employeeC.id]);
  state = fixture("verify");
  const newB = state.packageAssignments.find((item) => item.userId === employeeB.id);
  if (!newB || newB.id !== retainedB.id || newB.rowVersion !== retainedB.rowVersion) {
    throw new Error("Unchanged B assignment row identity/version was not preserved");
  }
  if (state.packageAssignments.map((item) => item.userId).join(",") !== [employeeB.id, employeeC.id].sort().join(",")) {
    throw new Error("Package delta B+C was not persisted");
  }
  if (state.contractAssignments.map((item) => item.userId).join(",") !== [employeeA.id, employeeC.id].sort().join(",")) {
    throw new Error("Contract A+C assignments were not persisted");
  }
  if (await activityStatus(browser, employeeA, "goithau", state.packageId) !== 403) throw new Error("A retained package access after removal");
  if (await activityStatus(browser, employeeB, "goithau", state.packageId) !== 200) throw new Error("B lost package access");
  if (await activityStatus(browser, employeeC, "goithau", state.packageId) !== 200) throw new Error("C did not gain package access");
  if (await activityStatus(browser, data.outsider, "goithau", state.packageId) !== 404) throw new Error("Cross-tenant activity did not return 404");

  const updatedContractName = await updateContract(page, state);
  state = fixture("verify");
  if (state.contractName !== updatedContractName) {
    throw new Error(`Contract update was not persisted: ${JSON.stringify(state)}`);
  }
  if (!state.activityEvents.some((item) => item.action === "hopdong.updated" && item.actorUserId === data.manager.id)) {
    throw new Error("Contract update activity did not preserve manager as actor");
  }

  const actionSet = new Set(state.activityActions);
  for (const action of [
    "goithau.created", "hopdong.created", "assignment.added", "assignment.removed",
    "package_document.uploaded", "package_document.deleted",
  ]) {
    if (!actionSet.has(action)) throw new Error(`Missing activity ${action}`);
  }
  const documentEvents = state.activityEvents.filter((item) => item.action.startsWith("package_document."));
  if (documentEvents.length !== 2) {
    throw new Error(`Document retries created duplicate activity: ${JSON.stringify(documentEvents)}`);
  }
  if (
    documentEvents.find((item) => item.action === "package_document.uploaded")?.actorUserId !== employeeB.id
    || documentEvents.find((item) => item.action === "package_document.deleted")?.actorUserId !== data.manager.id
    || documentEvents.some((item) => item.metadata?.documentName !== "multi-assignee-proof.pdf")
  ) {
    throw new Error(`Document activity actor or filename is incorrect: ${JSON.stringify(documentEvents)}`);
  }
  if (state.documentCount !== 0) throw new Error("Deleted document remained in PostgreSQL");
  const notifications = state.notificationKinds.map(([userId, kind]) => `${userId}:${kind}`);
  for (const expected of [
    `${employeeA.id}:assignment_added`,
    `${employeeA.id}:assignment_removed`,
    `${employeeB.id}:assignment_added`,
    `${employeeC.id}:assignment_added`,
  ]) {
    if (!notifications.includes(expected)) throw new Error(`Missing notification ${expected}`);
  }
  const notificationCount = (value) => notifications.filter((item) => item === value).length;
  if (
    notificationCount(`${employeeB.id}:assignment_added`) !== 1
    || notificationCount(`${employeeC.id}:assignment_added`) !== 2
    || notificationCount(`${employeeA.id}:assignment_removed`) !== 1
  ) {
    throw new Error(`Assignment delta emitted duplicate or missing notifications: ${JSON.stringify(notifications)}`);
  }

  const sharedRemoval = await removeOrganizationMember(page, employeeA.id);
  if (sharedRemoval.status !== 200) {
    throw new Error(`Removing an assignee with a remaining coworker required a successor: ${JSON.stringify(sharedRemoval)}`);
  }
  state = fixture("verify");
  if (state.contractAssignments.map((item) => item.userId).join(",") !== employeeC.id) {
    throw new Error(`Shared contract assignment removal changed the wrong memberships: ${JSON.stringify(state.contractAssignments)}`);
  }
  if (state.employeeStatuses[employeeA.id] !== "left") {
    throw new Error(`Removed employee did not leave the organization: ${JSON.stringify(state.employeeStatuses)}`);
  }
  const employeeAContractHistory = state.removalHistory.find((item) => (
    item.userId === employeeA.id
    && item.targetId === state.contractId
    && item.targetType === "hopdong"
  ));
  if (!employeeAContractHistory || employeeAContractHistory.successorUserId !== null) {
    throw new Error(`Shared assignment history incorrectly required a successor: ${JSON.stringify(state.removalHistory)}`);
  }

  const assignmentNotificationCountBeforeVersion = new Map();
  for (const [userId, kind] of state.notificationKinds) {
    if (kind !== "assignment_added") continue;
    assignmentNotificationCountBeforeVersion.set(
      userId,
      (assignmentNotificationCountBeforeVersion.get(userId) || 0) + 1,
    );
  }
  const packageVersionId = await createPackageVersion(
    page,
    state.packageAssignments.map((item) => item.userId),
  );
  state = fixture("verify");
  if (state.versionAssignments.map((item) => item.userId).join(",") !== [employeeB.id, employeeC.id].sort().join(",")) {
    throw new Error(`New package version did not inherit all assignees: ${JSON.stringify(state.versionAssignments)}`);
  }
  for (const employee of [employeeB, employeeC]) {
    const afterCount = state.notificationKinds.filter(([userId, kind]) => (
      userId === employee.id && kind === "assignment_added"
    )).length;
    const beforeCount = assignmentNotificationCountBeforeVersion.get(employee.id) || 0;
    if (afterCount !== beforeCount) {
      throw new Error(`Inherited package version emitted a duplicate assignment notification for ${employee.id}`);
    }
  }
  if (await activityStatus(browser, employeeB, "goithau", packageVersionId) !== 200) {
    throw new Error("B cannot read the inherited package version");
  }
  if (await activityStatus(browser, employeeC, "goithau", packageVersionId) !== 200) {
    throw new Error("C cannot read the inherited package version");
  }

  // Transfer only the latest physical snapshot away from C. C intentionally
  // remains assigned to V00, proving historical lineage evidence cannot grant
  // access to the successor after its latest assignment is revoked.
  const transferredLatestAssignment = state.versionAssignments.find(
    (item) => item.userId === employeeC.id,
  );
  await syncMutation(page, {
    deletions: [{
      table: "assignments",
      id: transferredLatestAssignment.id,
      expectedVersion: transferredLatestAssignment.rowVersion,
    }],
  });
  state = fixture("verify");
  if (await activityStatus(browser, employeeC, "goithau", packageVersionId) !== 403) {
    throw new Error("C retained latest-version access through the historical assignment");
  }
  if (await activityStatus(browser, employeeC, "goithau", state.packageId) !== 200) {
    throw new Error("Transferring the successor incorrectly removed C's explicit historical access");
  }
  await syncMutation(page, {
    assignments: [{
      id: `${runId}-package-v2-assignment-restored-${employeeC.id}`,
      empId: employeeC.id,
      targetId: packageVersionId,
      type: "goithau",
    }],
  });
  state = fixture("verify");
  if (await activityStatus(browser, employeeC, "goithau", packageVersionId) !== 200) {
    throw new Error("C did not regain successor access after an explicit assignment");
  }

  const inheritedVersionAssignments = state.versionAssignments;
  const lastAssigneeRemoval = await removeOrganizationMember(page, employeeC.id);
  if (lastAssigneeRemoval.status !== 200 || !lastAssigneeRemoval.body?.success) {
    throw new Error(`Removing the final optional assignee failed: ${JSON.stringify(lastAssigneeRemoval)}`);
  }
  state = fixture("verify");
  if (state.employeeStatuses[employeeC.id] !== "left") {
    throw new Error("Final optional assignee removal did not update organization membership");
  }
  if (state.contractAssignments.length !== 0) {
    throw new Error(`Final contract assignment was retained after removal: ${JSON.stringify(state.contractAssignments)}`);
  }
  if (state.packageAssignments.map((item) => item.userId).join(",") !== employeeB.id) {
    throw new Error(`Remaining package assignments are incorrect: ${JSON.stringify(state.packageAssignments)}`);
  }
  if (state.versionAssignments.map((item) => item.userId).join(",") !== employeeB.id) {
    throw new Error(`Remaining version assignments are incorrect: ${JSON.stringify(state.versionAssignments)}`);
  }
  const employeeCContractHistory = state.removalHistory.find((item) => (
    item.userId === employeeC.id
    && item.targetId === state.contractId
    && item.targetType === "hopdong"
  ));
  if (!employeeCContractHistory || employeeCContractHistory.successorUserId !== null) {
    throw new Error(`Final optional assignment unexpectedly used a successor: ${JSON.stringify(state.removalHistory)}`);
  }
  if (await activityStatus(browser, employeeC, "goithau", packageVersionId, { membershipRemoved: true }) !== 403) {
    throw new Error("Removed C retained access to the inherited package version");
  }

  await gotoRoute(page, "/goi-thau");
  await page.locator("#search-goithau").fill(data.packageCode);
  await page.locator("#goithau-table tbody tr").filter({ hasText: data.packageCode })
    .locator('[data-bf-action="show-package"]').first().click();
  await page.locator('[data-workflow-tab="activity"]').click();
  await page.locator("[data-activity-timeline]").getByText(data.manager.name).first().waitFor({ state: "visible" });

  process.stdout.write(`${JSON.stringify({
    packageAssignments: state.packageAssignments,
    contractAssignments: state.contractAssignments,
    activityActions: state.activityActions,
    notificationKinds: state.notificationKinds,
    organizationRemoval: {
      sharedAssigneeWithoutSuccessor: 200,
      finalOptionalAssigneeWithoutSuccessor: 200,
    },
    inheritedVersionAssignments,
    documentActivity: state.activityEvents.filter((item) => item.action.startsWith("package_document.")),
    access: { removedA: 403, retainedB: 200, addedC: 200, outsider: 404 },
  }, null, 2)}\n`);
  const planVersion = await page.evaluate(async ({ organizationId, sourceId, mutationId }) => {
    const csrf = decodeURIComponent(document.cookie.split(";").map(value => value.trim())
      .find(value => value.startsWith("csrf_token="))?.slice(11) || "");
    const headers = { "Content-Type": "application/json", "X-CSRF-Token": csrf, "X-Active-Org": organizationId };
    const lookup = await fetch("/api/paginate?table=kehoach&page=1&pageSize=100", { headers });
    if (!lookup.ok) throw new Error(`Plan lookup failed: ${lookup.status}`);
    const source = (await lookup.json()).items.find(row => row.id === sourceId);
    if (!source) throw new Error("Authoritative plan source missing");
    const response = await fetch("/api/versioning/aggregate", { method: "POST",
      headers: { ...headers, "Idempotency-Key": mutationId },
      body: JSON.stringify({ kind: "plan", sourceId, expectedRowVersion: source.rowVersion,
        clientMutationId: mutationId, changes: {} }) });
    const body = await response.json();
    if (!response.ok) throw new Error(`Plan aggregate failed: ${JSON.stringify(body)}`);
    const version = (body.rowVersions || []).find(row => row.table === "kehoach" && row.id !== sourceId);
    if (!version) throw new Error("Plan version acknowledgment missing");
    return version.id;
  }, { organizationId: data.organizationId, sourceId: `${runId}-plan`, mutationId: `${runId}-plan-version` });
  data.planVersionId = planVersion;
  const verifiedPlan = fixture("verify").planVersionAssignments;
  if (!verifiedPlan.some(row => row.userId === data.manager.id)) {
    throw new Error("Server plan version failed to inherit its explicit manager assignment");
  }
  process.stdout.write("[E2E] official-plan-version-assignment-inherited\n");
  await managerContext.close();
} finally {
  await browser.close();
  if (fixtureCreated) process.stdout.write(`${JSON.stringify(fixture("cleanup"))}\n`);
}
