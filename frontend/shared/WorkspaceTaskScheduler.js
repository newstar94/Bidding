const PRIORITY = Object.freeze({
  intent: 0,
  local: 1,
  reconcile: 2,
  warm: 3,
  preload: 4,
  maintenance: 5,
});

/** Bounded, cancellable scheduler for workspace background work. */
export class WorkspaceTaskScheduler {
  constructor({
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
    requestIdleCallbackFn = globalThis.requestIdleCallback?.bind(globalThis),
    cancelIdleCallbackFn = globalThis.cancelIdleCallback?.bind(globalThis),
    networkConcurrency = 2,
    cpuConcurrency = 1,
  } = {}) {
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.requestIdleCallbackFn = requestIdleCallbackFn;
    this.cancelIdleCallbackFn = cancelIdleCallbackFn;
    this.limits = { network: networkConcurrency, cpu: cpuConcurrency, foreground: 1 };
    this.active = { network: 0, cpu: 0, foreground: 0 };
    this.pending = [];
    this.tasks = new Map();
    this.sequence = 0;
    this.disposed = false;
  }

  schedule(task, {
    key,
    priority = "maintenance",
    lane = "network",
    delay = 0,
    idleTimeout = 1500,
  } = {}) {
    if (typeof task !== "function") throw new TypeError("Scheduled task must be a function.");
    if (this.disposed) return Promise.reject(Object.assign(new Error("Scheduler disposed"), { name: "AbortError" }));
    const taskKey = String(key || `anonymous:${this.sequence + 1}`);
    const existing = this.tasks.get(taskKey);
    if (existing) return existing.promise;

    const controller = new AbortController();
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const entry = {
      controller,
      delayTimer: null,
      idleHandle: null,
      key: taskKey,
      lane: this.limits[lane] ? lane : "network",
      order: this.sequence += 1,
      priority: PRIORITY[priority] ?? PRIORITY.maintenance,
      promise,
      reject: rejectPromise,
      resolve: resolvePromise,
      task,
    };
    this.tasks.set(taskKey, entry);
    const ready = () => {
      entry.delayTimer = null;
      if (entry.controller.signal.aborted) return;
      const enqueue = () => {
        entry.idleHandle = null;
        if (entry.controller.signal.aborted) return;
        this.pending.push(entry);
        this.pending.sort((left, right) => left.priority - right.priority || left.order - right.order);
        this.#drain();
      };
      if (entry.priority >= PRIORITY.warm && this.requestIdleCallbackFn) {
        entry.idleHandle = this.requestIdleCallbackFn(enqueue, { timeout: idleTimeout });
      } else {
        enqueue();
      }
    };
    // Delay is honored before both requestIdleCallback and timer fallback.
    const normalizedDelay = Math.max(0, Number(delay) || 0);
    if (normalizedDelay > 0) entry.delayTimer = this.setTimeoutFn(ready, normalizedDelay);
    else ready();
    return promise;
  }

  cancel(key, reason = "Task superseded") {
    const entry = this.tasks.get(String(key));
    if (!entry) return false;
    entry.controller.abort(reason);
    if (entry.delayTimer != null) this.clearTimeoutFn?.(entry.delayTimer);
    if (entry.idleHandle != null) this.cancelIdleCallbackFn?.(entry.idleHandle);
    this.pending = this.pending.filter((candidate) => candidate !== entry);
    this.tasks.delete(entry.key);
    entry.reject(Object.assign(new Error(reason), { name: "AbortError" }));
    return true;
  }

  cancelScope(prefix) {
    for (const key of [...this.tasks.keys()]) {
      if (String(key).startsWith(String(prefix))) this.cancel(key, "Workspace changed");
    }
  }

  dispose() {
    this.disposed = true;
    for (const key of [...this.tasks.keys()]) this.cancel(key, "Scheduler disposed");
  }

  #drain() {
    for (let index = 0; index < this.pending.length;) {
      const entry = this.pending[index];
      if (this.active[entry.lane] >= this.limits[entry.lane]) {
        index += 1;
        continue;
      }
      this.pending.splice(index, 1);
      this.active[entry.lane] += 1;
      Promise.resolve()
        .then(() => entry.task({ signal: entry.controller.signal }))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.active[entry.lane] -= 1;
          if (this.tasks.get(entry.key) === entry) this.tasks.delete(entry.key);
          this.#drain();
        });
    }
  }
}

export function workspaceTaskScheduler(controller) {
  if (!controller._workspaceTaskScheduler) {
    controller._workspaceTaskScheduler = new WorkspaceTaskScheduler();
  }
  return controller._workspaceTaskScheduler;
}
