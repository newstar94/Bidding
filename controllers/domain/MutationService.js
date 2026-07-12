export async function persistAndSync(controller, tableKeys, { afterPersist } = {}) {
  const keys = [...new Set((Array.isArray(tableKeys) ? tableKeys : [tableKeys]).filter(Boolean))];
  for (const key of keys) {
    await controller.model.persistData(key);
  }
  if (typeof afterPersist === "function") {
    await afterPersist();
  }
  return typeof controller.autoSync === "function" ? controller.autoSync() : { ok: true };
}
