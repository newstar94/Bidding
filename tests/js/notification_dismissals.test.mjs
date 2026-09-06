import test from "node:test";
import assert from "node:assert/strict";
import { workNotificationId, dismissWorkNotification, readDismissedWorkNotifications } from "../../frontend/app/notificationDismissals.js";

test("deleted work alerts survive reload and remain scoped to user and workspace", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const model = { state: { activeuser: { id: "user-a" } }, workspaceScope: { organizationId: "org-a" } };
  const alert = { targetType: "package", id: "package-a", alertKey: "overdue", deadline: "2026-09-03" };
  const id = workNotificationId(alert);
  dismissWorkNotification(model, id, storage);
  assert.equal(readDismissedWorkNotifications(structuredClone(model), storage).has(id), true);
  assert.notEqual(workNotificationId({ ...alert, deadline: "2026-10-03" }), id);
  model.state.activeuser.id = "user-b";
  assert.equal(readDismissedWorkNotifications(model, storage).size, 0);
  model.state.activeuser.id = "user-a";
  model.workspaceScope.organizationId = "org-b";
  assert.equal(readDismissedWorkNotifications(model, storage).size, 0);
});

test("storage failures do not falsely report a successful deletion", () => {
  const model = { state: { activeuser: { id: "a" } }, workspaceScope: { organizationId: "org" } };
  const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.throws(() => dismissWorkNotification(model, "work:a", storage), /quota/);
});
