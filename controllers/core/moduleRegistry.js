const installedModules = new WeakMap();

export function installPrototypeModules(TargetClass, modules, { allowOverride = true } = {}) {
  if (!TargetClass?.prototype) throw new TypeError("TargetClass must expose a prototype");
  const installed = installedModules.get(TargetClass) || new Map();

  modules.forEach(({ name, module }) => {
    if (!name || !module) throw new TypeError("Each module needs a name and exports object");
    Object.entries(module).forEach(([key, value]) => {
      if (key === "default" || typeof value !== "function") return;
      const previousOwner = installed.get(key);
      if (previousOwner && previousOwner !== name && !allowOverride) {
        throw new Error(`Prototype command ${key} is already provided by ${previousOwner}`);
      }
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


export function getInstalledPrototypeModules(TargetClass) {
  return new Map(installedModules.get(TargetClass) || []);
}

