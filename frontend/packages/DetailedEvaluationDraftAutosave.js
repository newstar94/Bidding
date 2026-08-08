const STORAGE_KEY = "bf_detailed_evaluation_drafts_v1";


export class DraftAutosaveStore {
  constructor(storage, {
    delay = 800,
    now = () => Date.now(),
    schedule = (callback, timeout) => setTimeout(callback, timeout),
    cancel = (timer) => clearTimeout(timer),
  } = {}) {
    this.storage = storage;
    this.delay = delay;
    this.now = now;
    this.scheduleTimer = schedule;
    this.cancelTimer = cancel;
    this.pending = new Map();
    this.sequence = 0;
  }

  readAll() {
    try {
      const parsed = JSON.parse(this.storage?.getItem?.(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  schedule(key, capture) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || typeof capture !== "function") return null;
    const previous = this.pending.get(normalizedKey);
    if (previous) this.cancelTimer(previous.timer);
    const token = ++this.sequence;
    const timer = this.scheduleTimer(() => {
      const pending = this.pending.get(normalizedKey);
      if (!pending || pending.token !== token) return;
      this.pending.delete(normalizedKey);
      const report = capture();
      if (!report || report.trangThai === "completed") return;
      const drafts = this.readAll();
      drafts[normalizedKey] = {
        report: structuredClone(report),
        savedAt: this.now(),
        pendingServerSync: true,
      };
      this.storage?.setItem?.(STORAGE_KEY, JSON.stringify(drafts));
    }, this.delay);
    this.pending.set(normalizedKey, { timer, token });
    return token;
  }

  restore(key) {
    const draft = this.readAll()[String(key || "")];
    if (!draft?.report || draft.report.trangThai === "completed") return null;
    return structuredClone(draft);
  }

  clear(key) {
    const normalizedKey = String(key || "");
    const pending = this.pending.get(normalizedKey);
    if (pending) this.cancelTimer(pending.timer);
    this.pending.delete(normalizedKey);
    const drafts = this.readAll();
    if (!Object.prototype.hasOwnProperty.call(drafts, normalizedKey)) return;
    delete drafts[normalizedKey];
    this.storage?.setItem?.(STORAGE_KEY, JSON.stringify(drafts));
  }
}

export function detailedEvaluationAutosaveFor(controller) {
  const storage = controller?.model?.workspaceStorage || globalThis.localStorage;
  if (!controller._detailedEvaluationAutosave
    || controller._detailedEvaluationAutosave.storage !== storage) {
    controller._detailedEvaluationAutosave = new DraftAutosaveStore(storage);
  }
  return controller._detailedEvaluationAutosave;
}
