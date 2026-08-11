import { MSC_USER_AGENT } from "./session_provider.mjs";
import { MSC_PROFILE_ID, resolveEndpoint } from "./endpoint_catalog.mjs";


function buildHeaders(cookie = "") {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    cookie: cookie || "COOKIE_SUPPORT=true; GUEST_LANGUAGE_ID=vi_VN",
    referer: "https://muasamcong.mpi.gov.vn/web/guest/contractor-selection",
    "user-agent": MSC_USER_AGENT,
  };
}


const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));


function requestKey(profileId, operation, payload, forceRefresh) {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalize(value[key])]),
    );
  };
  return JSON.stringify([
    profileId,
    String(operation || "").toUpperCase(),
    Boolean(forceRefresh),
    normalize(payload ?? null),
  ]);
}


export class MscApiClient {
  constructor({
    sessionProvider,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
    maxResponseBytes = 4_194_304,
    retries = 1,
    profileId = MSC_PROFILE_ID,
    circuitMs = 30_000,
    circuitFailureThreshold = 3,
    maxConcurrency = 6,
    queueTimeoutMs = 5_000,
    clock = () => performance.now(),
  }) {
    this.sessionProvider = sessionProvider;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1_000, Math.min(Number(timeoutMs) || 15_000, 60_000));
    this.maxResponseBytes = Math.max(
      65_536,
      Math.min(Number(maxResponseBytes) || 4_194_304, 8_388_608),
    );
    this.retries = Math.max(0, Math.min(Number(retries) || 0, 2));
    this.profileId = String(profileId || MSC_PROFILE_ID);
    this.circuitMs = Math.max(1_000, Math.min(Number(circuitMs) || 30_000, 300_000));
    this.circuitFailureThreshold = Math.max(
      1,
      Math.min(Number(circuitFailureThreshold) || 3, 10),
    );
    this.maxConcurrency = Math.max(1, Math.min(Number(maxConcurrency) || 6, 16));
    this.queueTimeoutMs = Math.max(
      100,
      Math.min(Number(queueTimeoutMs) || 5_000, 30_000),
    );
    this.clock = clock;
    this.lastFailure = null;
    this.consecutiveFailures = 0;
    this.openedUntil = 0;
    this.activeRequests = 0;
    this.waiters = [];
    this.inFlight = new Map();
  }

  async request(operation, payload, { forceRefresh = false } = {}) {
    const key = requestKey(this.profileId, operation, payload, forceRefresh);
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const pending = this._requestWithPolicy(operation, payload, { forceRefresh });
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }
  }

  async _requestWithPolicy(operation, payload, { forceRefresh = false } = {}) {
    if (this.clock() < this.openedUntil) {
      this.lastFailure = "PROCUREMENT_UPSTREAM_UNAVAILABLE";
      throw new Error(this.lastFailure);
    }
    await this._acquireSlot();
    try {
      const result = await this._request(operation, payload, { forceRefresh });
      this.lastFailure = null;
      this.consecutiveFailures = 0;
      this.openedUntil = 0;
      return result;
    } catch (error) {
      this.lastFailure = String(error?.message || "PROCUREMENT_UPSTREAM_UNAVAILABLE");
      if ([
        "PROCUREMENT_SESSION_FAILED",
        "PROCUREMENT_UPSTREAM_UNAVAILABLE",
        "PROCUREMENT_TIMEOUT",
      ].includes(this.lastFailure)) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.circuitFailureThreshold) {
          this.openedUntil = this.clock() + this.circuitMs;
        }
      } else {
        this.consecutiveFailures = 0;
      }
      throw error;
    } finally {
      this._releaseSlot();
    }
  }

  _acquireSlot() {
    if (this.activeRequests < this.maxConcurrency) {
      this.activeRequests += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = { active: true, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        waiter.active = false;
        reject(new Error("PROCUREMENT_LOOKUP_BUSY"));
      }, this.queueTimeoutMs);
      this.waiters.push(waiter);
    });
  }

  _releaseSlot() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    while (this.waiters.length) {
      const waiter = this.waiters.shift();
      if (!waiter.active) continue;
      waiter.active = false;
      clearTimeout(waiter.timer);
      this.activeRequests += 1;
      waiter.resolve();
      break;
    }
  }

  health() {
    const statuses = {
      PROCUREMENT_SESSION_FAILED: "SESSION_DEGRADED",
      PROCUREMENT_ENDPOINT_CHANGED: "API_CHANGED",
      PROCUREMENT_SCHEMA_CHANGED: "SCHEMA_CHANGED",
      PROCUREMENT_UPSTREAM_UNAVAILABLE: "DOWN",
      PROCUREMENT_TIMEOUT: "DOWN",
    };
    return {
      status: statuses[this.lastFailure] || (this.lastFailure ? "PARTIAL" : "UP"),
      lastFailure: this.lastFailure,
      circuitOpen: this.clock() < this.openedUntil,
      activeRequests: this.activeRequests,
      queuedRequests: this.waiters.filter((waiter) => waiter.active).length,
      maxConcurrency: this.maxConcurrency,
    };
  }

  async _request(operation, payload, { forceRefresh = false } = {}) {
    const endpoint = resolveEndpoint(operation, this.profileId);
    const started = this.clock();
    const sessionStarted = this.clock();
    let refreshCount = 0;
    let retryCount = 0;
    let session = null;
    if (endpoint.protected) {
      session = await this.sessionProvider.acquire({ forceRefresh });
    }
    const sessionAcquireMs = Math.max(0, this.clock() - sessionStarted);
    const networkStarted = this.clock();

    for (let attempt = 0; attempt <= this.retries + 1; attempt += 1) {
      const url = new URL(endpoint.url);
      if (endpoint.protected) url.searchParams.set("token", session.token);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: buildHeaders(session?.cookie || ""),
          body: JSON.stringify(payload ?? {}),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeoutId);
        if (error?.name === "AbortError") throw new Error("PROCUREMENT_TIMEOUT");
        if (retryCount < this.retries) {
          retryCount += 1;
          await delay(150 * (2 ** (retryCount - 1)));
          continue;
        }
        throw new Error("PROCUREMENT_UPSTREAM_UNAVAILABLE");
      }
      clearTimeout(timeoutId);

      if (
        endpoint.protected
        && [400, 401, 403].includes(response.status)
        && refreshCount === 0
      ) {
        this.sessionProvider.invalidate();
        session = await this.sessionProvider.refresh();
        refreshCount += 1;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && retryCount < this.retries) {
        retryCount += 1;
        await response.body?.cancel?.().catch(() => null);
        await delay(150 * (2 ** (retryCount - 1)));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => null);
        throw new Error(
          [400, 401, 403].includes(response.status)
            ? "PROCUREMENT_SESSION_FAILED"
            : "PROCUREMENT_UPSTREAM_UNAVAILABLE",
        );
      }
      const declaredLength = Number(response.headers?.get?.("content-length") || 0);
      if (declaredLength > this.maxResponseBytes) {
        await response.body?.cancel?.().catch(() => null);
        throw new Error("PROCUREMENT_SCHEMA_CHANGED");
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > this.maxResponseBytes) {
        throw new Error("PROCUREMENT_SCHEMA_CHANGED");
      }
      let data = null;
      try {
        data = text.trim() ? JSON.parse(text) : null;
      } catch {
        throw new Error("PROCUREMENT_SCHEMA_CHANGED");
      }
      return {
        data,
        metadata: {
          profile: this.profileId,
          operation,
          protected: endpoint.protected,
          retries: retryCount,
          sessionRefreshCount: refreshCount,
          browserStartupMs: Number(
            this.sessionProvider.health?.().browserStartupMs || 0
          ),
          sessionAcquireMs,
          networkWaitMs: Math.max(0, this.clock() - networkStarted),
          totalMs: Math.max(0, this.clock() - started),
        },
      };
    }
    throw new Error("PROCUREMENT_UPSTREAM_UNAVAILABLE");
  }
}

