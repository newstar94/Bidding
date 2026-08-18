import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { createE2ETestClock } from "./e2e_test_clock.mjs";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const testClock = createE2ETestClock();
const runId = `multi-assignee-${Date.now()}`;
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
  const packageId = `${runId}-package-v2`;
  const payload = {
    goithau: [{
      id: packageId,
      rootId: `${runId}-package`,
      phienBan: 2,
      isLatest: true,
      maGoiThau: data.packageCode,
      tenGoiThau: `Gói nhiều người phiên bản 2 ${runId}`,
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
      thoiGianBatDauToChuc: testClock.quarter(100),
      trangThai: "Chuẩn bị",
    }],
    assignments: assigneeIds.map((employeeId) => ({
      id: `${runId}-package-v2-assignment-${employeeId}`,
      empId: employeeId,
      targetId: packageId,
      type: "goithau",
    })),
  };
  const clientMutationId = `${runId}-package-version`;
  await syncMutation(page, payload, { clientMutationId });
  await syncMutation(page, payload, { clientMutationId });
  return packageId;
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

async function activityStatus(browser, user, targetType, targetId) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, user);
    const organizationId = user.id === data.outsider.id
      ? data.outsiderOrganizationId
      : data.organizationId;
    return await page.evaluate(async ({ targetType, targetId, organizationId }) => {
      const response = await fetch(`/api/activities/${targetType}/${targetId}`, {
        headers: { "X-Active-Org": organizationId },
      });
      return response.status;
    }, { targetType, targetId, organizationId });
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

  await editPackageAssignees(page, state, [employeeB.id, employeeC.id]);
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
  if (await activityStatus(browser, employeeC, "goithau", packageVersionId) !== 403) {
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
  await managerContext.close();
} finally {
  await browser.close();
  if (fixtureCreated) process.stdout.write(`${JSON.stringify(fixture("cleanup"))}\n`);
}
