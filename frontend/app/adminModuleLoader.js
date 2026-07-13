import { installPrototypeModules } from "./moduleRegistry.js";

let adminModulePromise;

export async function installAdminModule(TargetClass) {
  if (!adminModulePromise) {
    adminModulePromise = import("../admin/AdminUserController.js");
  }
  const adminModule = await adminModulePromise;
  installPrototypeModules(TargetClass, [{ name: "admin", module: adminModule }]);
  return adminModule;
}
