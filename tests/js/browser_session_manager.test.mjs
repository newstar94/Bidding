import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserSessionManager } from "../../scripts/lib/browserSessionManager.mjs";

function fakeSessionHarness({ failContextClose = false, failSessionCapture = false } = {}) {
  const events = [];
  const contextArguments = [];
  const initScriptArguments = [];
  let sequence = 0;
  const makeResource = (name, extra = {}) => ({
    ...extra,
    async close() {
      events.push(`${name}:close`);
      if (name.startsWith("context") && failContextClose) throw new Error("context close failed");
    },
  });
  const launchServer = async () => {
    const id = ++sequence;
    return makeResource(`server${id}`, { wsEndpoint: () => `ws://${id}` });
  };
  const connect = async (server) => {
    const id = server.wsEndpoint().slice(-1);
    return makeResource(`browser${id}`, {
      async newContext(options) {
        contextArguments.push(options);
        return makeResource(`context${id}`, {
          async storageState() {
            return { cookies: [{ name: "session", value: id }], origins: [] };
          },
          async addInitScript(_script, argument) {
            initScriptArguments.push(argument);
          },
          async newPage() {
            return {
              isClosed: () => false,
              async evaluate() {
                if (failSessionCapture) throw new Error("session capture failed");
                return { origin: "http://test", entries: [["bf_user_id", "user-1"]] };
              },
            };
          },
        });
      },
    });
  };
  return { events, contextArguments, initScriptArguments, launchServer, connect };
}

test("browser session restart closes the old resources and preserves storage", async () => {
  const harness = fakeSessionHarness();
  const manager = createBrowserSessionManager({
    ...harness,
    contextOptions: { serviceWorkers: "block" },
  });
  const first = await manager.open();
  assert.equal(first.server.wsEndpoint(), "ws://1");
  const second = await manager.restartPreservingStorage();
  assert.equal(second.server.wsEndpoint(), "ws://2");
  assert.deepEqual(harness.events.slice(0, 2), ["context1:close", "server1:close"]);
  assert.deepEqual(harness.contextArguments[0], {
    serviceWorkers: "block",
    storageState: undefined,
  });
  assert.deepEqual(harness.contextArguments[1].storageState, {
    cookies: [{ name: "session", value: "1" }],
    origins: [],
  });
  assert.deepEqual(harness.initScriptArguments[0], {
    origin: "http://test",
    entries: [["bf_user_id", "user-1"]],
  });
  assert.equal(manager.snapshot().page !== null, true);
  await manager.close();
});

test("browser session rejects double-open and cleanup remains idempotent", async () => {
  const harness = fakeSessionHarness();
  const manager = createBrowserSessionManager(harness);
  await manager.open();
  await assert.rejects(manager.open(), /already open/);
  await manager.close();
  await manager.close();
  assert.equal(manager.snapshot().server, null);
});

test("browser session preserves the original close error while releasing references", async () => {
  const harness = fakeSessionHarness({ failContextClose: true });
  const manager = createBrowserSessionManager(harness);
  await manager.open();
  await assert.rejects(manager.close(), /context close failed/);
  assert.equal(manager.snapshot().context, null);
  assert.ok(harness.events.includes("server1:close"));
});

test("browser session cleans partial resources without masking an open failure", async () => {
  const harness = fakeSessionHarness();
  const manager = createBrowserSessionManager({
    ...harness,
    configurePage: async () => {
      throw new Error("page configuration failed");
    },
  });

  await assert.rejects(manager.open(), /page configuration failed/);
  assert.deepEqual(harness.events, ["context1:close", "server1:close"]);
  assert.deepEqual(manager.snapshot(), {
    server: null,
    browser: null,
    context: null,
    page: null,
  });
});

test("browser session releases the old resources when storage capture fails", async () => {
  const harness = fakeSessionHarness({ failSessionCapture: true });
  const manager = createBrowserSessionManager(harness);
  await manager.open();

  await assert.rejects(manager.restartPreservingStorage(), /session capture failed/);
  assert.deepEqual(harness.events, ["context1:close", "server1:close"]);
  assert.deepEqual(manager.snapshot(), {
    server: null,
    browser: null,
    context: null,
    page: null,
  });
});
