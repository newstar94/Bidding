import { expect, test } from "./fixtures.js";


const EMPLOYEE_ID = "permission-e2e-employee";
const MODULES = [
  "kehoach",
  "goithau",
  "chudautu",
  "nhathau",
  "chuyengia",
  "hopdong",
  "thongtinmothau"
];

const VISIBLE_MODULES = [
  { moduleName: "kehoach", tabName: "kehoach", nav: "#btn-tab-kehoach", add: "#btn-add-kehoach" },
  { moduleName: "goithau", tabName: "goithau", nav: "#btn-tab-goithau", add: "#btn-add-goithau" },
  { moduleName: "chudautu", tabName: "chudautu", nav: "#btn-tab-chudautu", add: "#btn-add-chudautu" },
  { moduleName: "nhathau", tabName: "nhathau", nav: "#btn-tab-nhathau", add: "#btn-add-nhathau" },
  { moduleName: "chuyengia", tabName: "chuyengia", nav: "#btn-tab-chuyengia", add: "#btn-add-chuyengia" },
  { moduleName: "hopdong", tabName: "hopdong", nav: "#btn-tab-hopdong", add: "#btn-add-hopdong" }
];

async function login(page, credentials) {
  await page.goto("/dang-nhap", { waitUntil: "domcontentloaded" });
  await page.locator("#login-username").fill(credentials.username);
  await page.locator("#login-password").fill(credentials.password);
  await page.locator('#form-auth-login button[type="submit"]').click();
  await expect(page.locator("#auth-overlay")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#system-init-loader")).toBeHidden({ timeout: 30_000 });
}

async function setPermissionModes(page, modes) {
  await page.evaluate(async ({ employeeId, moduleNames, permissionModes }) => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const controller = getAppController();
    if (!controller) throw new Error("Bidding controller is not ready");
    controller.model.state.activerole = "employee";
    controller.model.state.activeuser = {
      ...controller.model.state.activeuser,
      id: employeeId,
      role: "employee",
      platformRole: "user",
      dbRoles: ["employee"]
    };
    controller.model.state.permissionmatrix = [{
      empId: employeeId,
      ...Object.fromEntries(moduleNames.map((moduleName) => [
        moduleName,
        permissionModes[moduleName] || ""
      ]))
    }];
    controller.synchronizeModuleAccess();
  }, { employeeId: EMPLOYEE_ID, moduleNames: MODULES, permissionModes: modes });
}

async function stabilizePermissionHarness(page) {
  await page.evaluate(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const controller = getAppController();
    if (!controller) throw new Error("Bidding controller is not ready");
    if (controller._backgroundSyncTimer) {
      clearTimeout(controller._backgroundSyncTimer);
      controller._backgroundSyncTimer = null;
    }
    controller._backgroundSyncQueued = false;
    controller.scheduleBackgroundSync = () => {};
    const deadline = performance.now() + 10_000;
    while (controller._backgroundSyncRunning && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (controller._backgroundSyncRunning) {
      throw new Error("Background sync did not settle before permission test");
    }
    await Promise.all([
      controller.view.ensureViewModules("mothau"),
      controller.ensureWorkflowModules("mothau"),
      controller.ensureLazyTab("mothau")
    ]);
  });
}

async function switchTab(page, tabName, action = null) {
  return page.evaluate(async ({ nextTab, nextAction }) => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const controller = getAppController();
    await controller.switchTab(nextTab, nextAction);
    return {
      activeTab: controller.model.state.activetab,
      activeUserId: controller.model.state.activeuser?.id,
      activeRole: controller.model.state.activerole,
      permission: controller.model.state.permissionmatrix?.find(
        (entry) => entry.empId === controller.model.state.activeuser?.id
      )?.[controller.moduleForTab(nextTab)] || ""
    };
  }, { nextTab: tabName, nextAction: action });
}

test("employee UI enforces none, view and edit for every business module", async ({
  page,
  credentials
}) => {
  await login(page, credentials);
  await stabilizePermissionHarness(page);

  await setPermissionModes(page, {});
  for (const item of VISIBLE_MODULES) {
    await expect(page.locator(item.nav)).toBeHidden();
  }

  for (const item of VISIBLE_MODULES) {
    await setPermissionModes(page, { [item.moduleName]: "view" });
    await expect(page.locator(item.nav)).toBeVisible();
    const viewResult = await switchTab(page, item.tabName);
    expect(viewResult).toMatchObject({
      activeTab: item.tabName,
      activeUserId: EMPLOYEE_ID,
      activeRole: "employee",
      permission: "view"
    });
    await expect(page.locator(`#tab-${item.tabName}`)).toHaveClass(/active/);
    await expect(page.locator(item.add)).toBeHidden();

    await setPermissionModes(page, { [item.moduleName]: "edit" });
    await expect(page.locator(item.add)).toBeVisible();

    await setPermissionModes(page, {});
    await switchTab(page, item.tabName);
    expect(await page.evaluate(async () => {
      const { getAppController } = await import("/frontend/app/controllerRef.js");
      return getAppController().model.state.activetab;
    })).toBe("dashboard");
  }

  await setPermissionModes(page, {});
  await switchTab(page, "mothau");
  expect(await page.evaluate(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    return getAppController().model.state.activetab;
  })).toBe("dashboard");

  await setPermissionModes(page, { thongtinmothau: "view" });
  await switchTab(page, "mothau");
  expect(await page.evaluate(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    return getAppController().model.state.activetab;
  })).toBe("mothau");

  await setPermissionModes(page, { kehoach: "view" });
  await switchTab(page, "kehoach", "taomoi");
  expect(await page.evaluate(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    return getAppController().model.state.activetab;
  })).toBe("dashboard");
  await expect(page.locator("#modal-kehoach.active")).toHaveCount(0);
});
