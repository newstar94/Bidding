import assert from "node:assert/strict";
import test from "node:test";

import {
  beginPackageTableRender,
  canPackageTableRenderCommit,
  canPackageTableRenderOwnDom,
  installPackageTableInteractionOwnership,
  settlePackageTableRenderLoad,
} from "../../frontend/packages/GoiThauTable.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("an older package-table render loses DOM ownership when a newer render starts", () => {
  const tableBody = {};
  const firstRenderIsCurrent = beginPackageTableRender(tableBody);
  const secondRenderIsCurrent = beginPackageTableRender(tableBody);
  const committed = [];

  if (firstRenderIsCurrent()) committed.push("stale");
  if (secondRenderIsCurrent()) committed.push("latest");

  assert.deepEqual(committed, ["latest"]);
});

test("a pointer interaction invalidates an in-flight render and queues its replacement", async () => {
  let pointerdown;
  let click;
  let pointerup;
  let frameCallback;
  let listenerCount = 0;
  let replacementCount = 0;
  let actionCount = 0;
  const tableBody = {
    ownerDocument: {
      defaultView: {
        requestAnimationFrame(callback) {
          frameCallback = callback;
        },
      },
      addEventListener(type, listener, options) {
        assert.deepEqual(options, { capture: true });
        if (type === "click") click = listener;
        if (type === "pointerup") pointerup = listener;
      },
    },
    addEventListener(type, listener, options) {
      assert.equal(type, "pointerdown");
      assert.deepEqual(options, { capture: true });
      pointerdown = listener;
      listenerCount += 1;
    },
  };
  installPackageTableInteractionOwnership(tableBody, () => {
    replacementCount += 1;
  });
  installPackageTableInteractionOwnership(tableBody, () => {
    replacementCount += 1;
  });
  const renderIsCurrent = beginPackageTableRender(tableBody);

  pointerdown({ button: 0 });
  pointerup();
  click();
  actionCount += 1;
  frameCallback();
  await Promise.resolve();

  assert.equal(listenerCount, 1);
  assert.equal(renderIsCurrent(), false);
  assert.equal(actionCount, 1);
  assert.equal(replacementCount, 1);
});

test("a primary drag without click still queues one replacement render", async () => {
  let pointerdown;
  let pointerup;
  let frameCallback;
  let replacementCount = 0;
  const tableBody = {
    ownerDocument: {
      defaultView: {
        requestAnimationFrame(callback) {
          frameCallback = callback;
        },
      },
      addEventListener(type, listener) {
        if (type === "pointerup") pointerup = listener;
      },
    },
    addEventListener(type, listener) {
      if (type === "pointerdown") pointerdown = listener;
    },
  };
  installPackageTableInteractionOwnership(tableBody, () => {
    replacementCount += 1;
  });
  const renderIsCurrent = beginPackageTableRender(tableBody);

  pointerdown({ button: 0 });
  pointerup();
  frameCallback();
  await Promise.resolve();

  assert.equal(renderIsCurrent(), false);
  assert.equal(replacementCount, 1);
});

test("a non-primary pointer does not invalidate package-table ownership", () => {
  let pointerdown;
  const tableBody = {
    ownerDocument: {
      defaultView: { requestAnimationFrame() {} },
      addEventListener() {},
    },
    addEventListener(type, listener) {
      if (type === "pointerdown") pointerdown = listener;
    },
  };
  installPackageTableInteractionOwnership(tableBody);
  const renderIsCurrent = beginPackageTableRender(tableBody);

  pointerdown({ button: 2 });

  assert.equal(renderIsCurrent(), true);
});

test("a background package-table render waits for an open combobox to close", async () => {
  let observerCallback;
  let disconnected = false;
  let comboboxOpen = true;
  const tableBody = {
    ownerDocument: {
      defaultView: {
        MutationObserver: class {
          constructor(callback) {
            observerCallback = callback;
          }

          observe() {}

          disconnect() {
            disconnected = true;
          }
        },
      },
    },
    querySelector(selector) {
      assert.equal(selector, ".bf-combobox.open");
      return comboboxOpen ? {} : null;
    },
  };
  const renderIsCurrent = beginPackageTableRender(tableBody);
  let settled = false;
  const ownership = canPackageTableRenderOwnDom(tableBody, renderIsCurrent)
    .then((result) => {
      settled = true;
      return result;
    });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);

  comboboxOpen = false;
  observerCallback();

  assert.equal(await ownership, true);
  assert.equal(disconnected, true);
});

test("a selection-triggered render may proceed after the combobox closes", async () => {
  let comboboxOpen = true;
  const tableBody = {
    querySelector(selector) {
      assert.equal(selector, ".bf-combobox.open");
      return comboboxOpen ? {} : null;
    },
  };
  const renderIsCurrent = beginPackageTableRender(tableBody);
  const ownership = canPackageTableRenderOwnDom(tableBody, renderIsCurrent);

  comboboxOpen = false;

  assert.equal(await ownership, true);
});

test("a stale package-table generation cannot own DOM after the interaction yield", async () => {
  let comboboxOpen = true;
  const tableBody = {
    querySelector(selector) {
      assert.equal(selector, ".bf-combobox.open");
      return comboboxOpen ? {} : null;
    },
  };
  const renderIsCurrent = beginPackageTableRender(tableBody);
  const ownership = canPackageTableRenderOwnDom(tableBody, renderIsCurrent);

  comboboxOpen = false;
  beginPackageTableRender(tableBody);

  assert.equal(await ownership, false);
});

test("DOM commit rechecks generation after an async ownership decision", async () => {
  const tableBody = {
    querySelector(selector) {
      assert.equal(selector, ".bf-combobox.open");
      return null;
    },
  };
  const renderIsCurrent = beginPackageTableRender(tableBody);
  const ownershipAllowed = await canPackageTableRenderOwnDom(tableBody, renderIsCurrent);

  beginPackageTableRender(tableBody);

  assert.equal(
    canPackageTableRenderCommit(ownershipAllowed, renderIsCurrent),
    false,
  );
});

test("an older package-table success cannot commit after a newer render starts", async () => {
  const tableBody = {};
  const older = deferred();
  const newer = deferred();
  const committed = [];
  const olderResult = settlePackageTableRenderLoad(
    beginPackageTableRender(tableBody),
    () => older.promise,
  );
  const newerResult = settlePackageTableRenderLoad(
    beginPackageTableRender(tableBody),
    () => newer.promise,
  );

  newer.resolve({ items: ["latest"], totalItems: 1 });
  const current = await newerResult;
  if (current.current) committed.push(...current.data.items);
  older.resolve({ items: ["stale"], totalItems: 1 });
  const stale = await olderResult;
  if (stale.current) committed.push(...stale.data.items);

  assert.deepEqual(committed, ["latest"]);
  assert.equal(stale.current, false);
});

test("an older package-table rejection cannot render an error after a newer render starts", async () => {
  const tableBody = {};
  const older = deferred();
  const errors = [];
  const olderResult = settlePackageTableRenderLoad(
    beginPackageTableRender(tableBody),
    () => older.promise,
    (error) => errors.push(error.message),
  );
  beginPackageTableRender(tableBody);

  older.reject(new Error("stale failure"));
  const stale = await olderResult;

  assert.equal(stale.current, false);
  assert.deepEqual(errors, []);
});

test("a current package-table rejection commits its error in the ownership-check turn", async () => {
  const tableBody = {};
  const load = deferred();
  const events = [];
  const resultPromise = settlePackageTableRenderLoad(
    beginPackageTableRender(tableBody),
    () => load.promise,
    (error) => events.push(`error:${error.message}`),
  );

  load.reject(new Error("current failure"));
  queueMicrotask(() => {
    beginPackageTableRender(tableBody);
    events.push("new-render");
  });
  const result = await resultPromise;

  assert.equal(result.current, true);
  assert.equal(result.error.message, "current failure");
  assert.deepEqual(events, ["error:current failure", "new-render"]);
});
