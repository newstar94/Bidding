export function workNotificationId(item) {
  return `work:${JSON.stringify([item.targetType || "", item.id || "", item.alertKey || "", item.deadline || ""])}`;
}

function storageKey(model) {
  const user = model?.state?.activeuser?.id;
  const org = model?.workspaceScope?.organizationId;
  if (!user || !org) throw new Error("Missing notification workspace identity");
  return `bf-notification-dismissals:${encodeURIComponent(user)}:${encodeURIComponent(org)}`;
}

export function readDismissedWorkNotifications(model, storage = globalThis.localStorage) {
  try { return new Set(JSON.parse(storage.getItem(storageKey(model)) || "[]")); }
  catch { return new Set(); }
}

export function dismissWorkNotification(model, id, storage = globalThis.localStorage) {
  const dismissed = readDismissedWorkNotifications(model, storage);
  dismissed.add(id);
  storage.setItem(storageKey(model), JSON.stringify([...dismissed]));
}
