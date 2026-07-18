import { expect, test } from "./fixtures.js";

test("A → B → A stays isolated across offline state and two tabs", async ({ context, page }) => {
  const secondPage = await context.newPage();
  await Promise.all([page.goto("/"), secondPage.goto("/")]);

  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    const module = await import("/frontend/app/workspaceState.js");
    sessionStorage.setItem("bf_user_id", "e2e-user");
    module.setActiveOrganizationId("org-a");
    const store = module.getWorkspaceStorage();
    store.writeJson("bf_mutation_queue", { upserts: { goithau: { a: { id: "a" } } } });
    store.writeJson("bf_local_deletions", [{ table: "goithau", id: "deleted-a" }]);
    store.setItem("bf_last_sync_version", "4");
  });

  await secondPage.evaluate(async () => {
    sessionStorage.clear();
    const module = await import("/frontend/app/workspaceState.js");
    sessionStorage.setItem("bf_user_id", "e2e-user");
    module.setActiveOrganizationId("org-b");
    const store = module.getWorkspaceStorage();
    store.writeJson("bf_mutation_queue", { upserts: { goithau: { b: { id: "b" } } } });
    store.setItem("bf_last_sync_version", "12");
  });

  await context.setOffline(true);
  const tabAState = await page.evaluate(async () => {
    const module = await import("/frontend/app/workspaceState.js");
    return {
      organizationId: module.getActiveOrganizationId(),
      queue: module.getWorkspaceStorage().readJson("bf_mutation_queue", null),
      deletions: module.getWorkspaceStorage().readJson("bf_local_deletions", []),
      version: module.getWorkspaceStorage().getItem("bf_last_sync_version")
    };
  });
  const tabBState = await secondPage.evaluate(async () => {
    const module = await import("/frontend/app/workspaceState.js");
    return {
      organizationId: module.getActiveOrganizationId(),
      queue: module.getWorkspaceStorage().readJson("bf_mutation_queue", null),
      deletions: module.getWorkspaceStorage().readJson("bf_local_deletions", []),
      version: module.getWorkspaceStorage().getItem("bf_last_sync_version")
    };
  });
  await context.setOffline(false);

  const reconnectedState = await page.evaluate(async () => {
    const module = await import("/frontend/app/workspaceState.js");
    return {
      organizationId: module.getActiveOrganizationId(),
      queue: module.getWorkspaceStorage().readJson("bf_mutation_queue", null),
      deletions: module.getWorkspaceStorage().readJson("bf_local_deletions", []),
      version: module.getWorkspaceStorage().getItem("bf_last_sync_version")
    };
  });

  expect(tabAState.organizationId).toBe("org-a");
  expect(tabAState.queue.upserts.goithau.a.id).toBe("a");
  expect(tabAState.deletions).toEqual([{ table: "goithau", id: "deleted-a" }]);
  expect(tabAState.version).toBe("4");
  expect(tabBState.organizationId).toBe("org-b");
  expect(tabBState.queue.upserts.goithau.b.id).toBe("b");
  expect(tabBState.deletions).toEqual([]);
  expect(tabBState.version).toBe("12");
  expect(reconnectedState).toEqual(tabAState);
});
