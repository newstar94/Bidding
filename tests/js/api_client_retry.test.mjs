import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, apiFetch, requestJson } from "../../frontend/shared/apiClient.js";


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
