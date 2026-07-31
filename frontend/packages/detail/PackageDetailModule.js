import { bindPackageDetailChrome } from "./PackageDetailCoordinator.js";

/** Owns the package-detail chrome lifecycle while legacy panels migrate inward. */
export class PackageDetailModule {
  constructor({ view, renderChrome = bindPackageDetailChrome } = {}) {
    if (!view) throw new TypeError("PackageDetailModule requires a view adapter");
    this.view = view;
    this.renderChrome = renderChrome;
    this.cleanup = null;
    this.context = null;
    this.saving = false;
  }

  mount(root, { route, store, lifecyclePolicy, detail, onNavigate, onSave } = {}) {
    if (!root || !detail || !route || !store || !lifecyclePolicy) {
      throw new TypeError("PackageDetailModule.mount requires root, route, store, lifecyclePolicy and detail");
    }
    this.dispose();
    this.context = { root, route, store, lifecyclePolicy, detail, onNavigate, onSave };
    this.cleanup = this.renderChrome(this.view, detail) || null;
    return this;
  }

  navigate(route) {
    if (!this.context) throw new Error("PackageDetailModule is not mounted");
    return this.context.onNavigate?.(route);
  }

  async save(command) {
    if (!this.context) throw new Error("PackageDetailModule is not mounted");
    if (this.saving) return { status: "rejected", code: "SAVE_IN_PROGRESS" };
    this.saving = true;
    try {
      return await this.context.onSave?.(command);
    } finally {
      this.saving = false;
    }
  }

  dispose() {
    this.cleanup?.();
    this.cleanup = null;
    this.context = null;
  }
}
