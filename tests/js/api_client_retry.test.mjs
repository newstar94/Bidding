import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  apiFetch,
  configureApiClient,
  requestJson,
} from "../../frontend/shared/apiClient.js";


class CountingSignal {
  constructor() {
    this.aborted = false;
    this.reason = undefined;
    this.listeners = new Set();
  }

  addEventListener(type, listener) {
    if (type === "abort") this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "abort") this.listeners.delete(listener);
  }
}


test("storage access failure omits the active organization header safely", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("storage blocked", "SecurityError");
    },
  });
  configureApiClient({ activeOrganization: null });
  try {
    const response = await apiFetch("/api/probe", {
      csrf: false,
      timeoutMs: 0,
    }, async (_url, options) => {
      assert.equal(options.headers.has("X-Active-Org"), false);
      return new Response("ok", { status: 200 });
    });
    assert.equal(response.status, 200);
  } finally {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else delete globalThis.sessionStorage;
  }
});


test("workspace recovery retry rebuilds the active organization header", async () => {
  let activeOrganization = "org-old";
  const seenOrganizations = [];
  configureApiClient({
    activeOrganization: () => activeOrganization,
    onHttpError: async () => {
      activeOrganization = "org-new";
      return { retry: true };
    },
  });
  try {
    const response = await apiFetch("/api/probe", {
      csrf: false,
      retries: 0,
    }, async (_url, options) => {
      seenOrganizations.push(options.headers.get("X-Active-Org"));
      return seenOrganizations.length === 1
        ? new Response(JSON.stringify({ code: "ORG_ACCESS_DENIED" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
        : new Response("ok", { status: 200 });
    });
    assert.equal(response.status, 200);
    assert.deepEqual(seenOrganizations, ["org-old", "org-new"]);
  } finally {
    configureApiClient({ activeOrganization: null, onHttpError: null });
  }
});


test("retry wait removes its abort listener after the timer resolves", async () => {
  const signal = new CountingSignal();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? new Response("busy", { status: 503, headers: { "Retry-After": "0" } })
      : new Response("ok", { status: 200 });
  };

  const response = await apiFetch("/health", {
    retries: 1,
    signal,
    timeoutMs: 0,
  }, fetchImpl);

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(signal.listeners.size, 0);
});


test("long Retry-After seconds are surfaced without an early automatic retry", async () => {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 20);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ code: "RATE_LIMITED", message: "wait" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "120" },
    });
  };

  try {
    await assert.rejects(
      requestJson("/health", {
        retries: 1,
        signal: controller.signal,
        timeoutMs: 0,
      }, fetchImpl),
      (error) => error instanceof ApiError && error.status === 429 && error.retryAfter === 120_000,
    );
  } finally {
    clearTimeout(abortTimer);
  }
  assert.equal(calls, 1);
});


test("long Retry-After HTTP-date is surfaced without retrying", async () => {
  const retryAt = new Date(Date.now() + 120_000).toUTCString();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response("busy", { status: 429, headers: { "Retry-After": retryAt } });
  };

  await assert.rejects(
    requestJson("/health", { retries: 1, timeoutMs: 0 }, fetchImpl),
    (error) => error instanceof ApiError
      && error.status === 429
      && error.retryAfter >= 118_000
      && error.retryAfter <= 120_000,
  );
  assert.equal(calls, 1);
});


test("malformed Retry-After uses bounded exponential backoff", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalRandom = Math.random;
  const delays = [];
  let calls = 0;
  globalThis.setTimeout = (callback, delay) => {
    delays.push(delay);
    queueMicrotask(callback);
    return delays.length;
  };
  globalThis.clearTimeout = () => {};
  Math.random = () => 0.5;
  try {
    const response = await apiFetch("/health", { retries: 1, timeoutMs: 0 }, async () => {
      calls += 1;
      return calls === 1
        ? new Response("busy", { status: 503, headers: { "Retry-After": "not-a-date" } })
        : new Response("ok", { status: 200 });
    });
    assert.equal(response.status, 200);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Math.random = originalRandom;
  }
  assert.deepEqual(delays, [300]);
});


test("aborting during Retry-After wait rejects immediately", async () => {
  const controller = new AbortController();
  const promise = apiFetch("/health", {
    retries: 1,
    signal: controller.signal,
    timeoutMs: 0,
  }, async () => new Response("busy", { status: 503, headers: { "Retry-After": "10" } }));

  setTimeout(() => controller.abort(new DOMException("cancelled", "AbortError")), 5);
  await assert.rejects(promise, (error) => error?.name === "AbortError");
});


test("non-idempotent mutation without an idempotency key is never retried", async () => {
  let calls = 0;
  await assert.rejects(
    apiFetch("/api/mutate", {
      method: "POST",
      csrf: false,
      retries: 2,
      timeoutMs: 0,
    }, async () => {
      calls += 1;
      throw new Error("network down");
    }),
    ApiError,
  );
  assert.equal(calls, 1);
});


test("HTML gateway errors are never exposed as the API error message", async () => {
  const html = "<!DOCTYPE html><html><head><title>502 Bad gateway</title></head>"
    + `<body>${"upstream failure ".repeat(500)}</body></html>`;

  await assert.rejects(
    requestJson("/api/procurement/imports/plan/prepare", {
      method: "POST",
      csrf: false,
      retries: 0,
      timeoutMs: 0,
    }, async () => new Response(html, {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    })),
    (error) => (
      error instanceof ApiError
      && error.status === 502
      && error.message === "502 Bad Gateway"
      && error.data === null
      && !error.message.includes("DOCTYPE")
    ),
  );
});
