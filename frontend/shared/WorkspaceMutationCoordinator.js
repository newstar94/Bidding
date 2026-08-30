const coordinatorByController = new WeakMap();

/**
 * Owns the two user-visible phases after a workspace mutation is durable.
 * Persistence/outbox ordering remains in MutationService; this seam ensures a
 * slow renderer or canonical revalidation never extends the local-save path.
 */
export class WorkspaceMutationCoordinator {
  constructor(controller) {
    this.controller = controller;
    this.canonicalFlights = new Map();
  }

  afterLocalDurable(callback) {
    if (typeof callback !== "function") return null;
    let result;
    try {
      // Invoke now so closing a modal/painting dirty state happens in the same
      // turn. Delayed pagination/render work is deliberately not awaited.
      result = callback();
    } catch (error) {
      this.#reportPhaseFailure("local", error);
      return Promise.resolve({ ok: false, error });
    }
    const completion = Promise.resolve(result);
    void completion.catch((error) => this.#reportPhaseFailure("local", error));
    return completion;
  }

  afterCanonicalSync(key, callback) {
    if (typeof callback !== "function") return Promise.resolve();
    const normalizedKey = String(key || "workspace");
    const activeFlight = this.canonicalFlights.get(normalizedKey);
    if (activeFlight) {
      // A callback reads the current canonical projection, so only the latest
      // pending callback is needed. It must still run after the active paint;
      // dropping it can leave a server-paginated table stale indefinitely.
      activeFlight.pending = callback;
      return activeFlight.completion;
    }
    const flight = { pending: callback, completion: null };
    flight.completion = (async () => {
      while (flight.pending) {
        const next = flight.pending;
        flight.pending = null;
        try {
          await Promise.resolve().then(next);
        } catch (error) {
          this.#reportPhaseFailure("canonical", error);
        }
      }
    })()
      .finally(() => {
        if (this.canonicalFlights.get(normalizedKey) === flight) {
          this.canonicalFlights.delete(normalizedKey);
        }
      });
    this.canonicalFlights.set(normalizedKey, flight);
    return flight.completion;
  }

  #reportPhaseFailure(phase, error) {
    console.error(`Workspace mutation ${phase} phase failed:`, error);
    if (phase === "canonical") {
      this.controller?.view?.showToast?.(
        "Chưa làm mới được dữ liệu",
        "Dữ liệu đã lưu; vui lòng thử làm mới lại.",
        "warning",
      );
    }
  }
}

export function workspaceMutationCoordinator(controller) {
  if (!controller || (typeof controller !== "object" && typeof controller !== "function")) {
    throw new TypeError("WorkspaceMutationCoordinator requires a controller.");
  }
  let coordinator = coordinatorByController.get(controller);
  if (!coordinator) {
    coordinator = new WorkspaceMutationCoordinator(controller);
    coordinatorByController.set(controller, coordinator);
  }
  return coordinator;
}
