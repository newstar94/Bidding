const installedModules = new WeakMap();

/** @internal Diagnostic/test projection; never installed as a controller command. */
export function getPrototypeModuleInventory(TargetClass) {
  return Object.freeze(Object.fromEntries(
    [...(installedModules.get(TargetClass) || new Map()).entries()]
      .sort(([left], [right]) => left.localeCompare(right)),
  ));
}

export function installPrototypeModules(TargetClass, modules, { allowOverride = false } = {}) {
  if (!TargetClass?.prototype) throw new TypeError("TargetClass must expose a prototype");
  if (TargetClass === Object || TargetClass.prototype === Object.prototype) {
    throw new TypeError("Controller modules cannot be installed on Object.prototype");
  }
  const installed = installedModules.get(TargetClass) || new Map();

  modules.forEach(({ name, module }) => {
    if (!name || !module) throw new TypeError("Each module needs a name and exports object");
    Object.entries(module).forEach(([key, value]) => {
      if (key === "default" || typeof value !== "function") return;
      const existingDescriptor = Object.getOwnPropertyDescriptor(TargetClass.prototype, key);
      const previousOwner = installed.get(key)
        || (existingDescriptor
          ? `${TargetClass.name || "TargetClass"}.prototype`
          : "");
      const sameImplementation = existingDescriptor?.value === value;
      if (previousOwner && previousOwner !== name && !allowOverride && !sameImplementation) {
        throw new Error(`Prototype command ${key} is already provided by ${previousOwner}`);
      }
      if (sameImplementation) return;
      Object.defineProperty(TargetClass.prototype, key, {
        configurable: true,
        writable: true,
        value,
      });
      installed.set(key, name);
    });
  });

  installedModules.set(TargetClass, installed);
  return TargetClass;
}
