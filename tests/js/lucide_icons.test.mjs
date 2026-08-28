import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { renderLucideIcons } from "../../frontend/shared/lucideIcons.js";

function iconRoot() {
  const icon = { dataset: { lucide: "circle-check" } };
  return {
    querySelector: (selector) => selector.includes("data-lucide") ? icon : null,
    querySelectorAll: () => [icon],
  };
}

test("Lucide rendering always receives the exact bounded root", () => {
  const root = iconRoot();
  const calls = [];
  const rendered = renderLucideIcons(root, {
    createIcons(options) {
      calls.push(options);
    },
  });

  assert.equal(rendered, true);
  assert.deepEqual(calls, [{ root }]);
});

test("a scoped Lucide failure never retries against the global document", () => {
  const previousDocument = globalThis.document;
  const previousWarn = console.warn;
  const documentRoot = {
    nodeType: 9,
    body: {},
    documentElement: {},
    querySelector: () => ({ dataset: { lucide: "shield-check" } }),
    querySelectorAll: () => [],
  };
  const root = iconRoot();
  const calls = [];
  globalThis.document = documentRoot;
  console.warn = () => {};

  try {
    const rendered = renderLucideIcons(root, {
      createIcons(options) {
        calls.push(options);
        throw new Error("scoped render failed");
      },
    });

    assert.equal(rendered, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].root, root);
    assert.equal(renderLucideIcons(documentRoot, { createIcons() { calls.push("global"); } }), false);
    assert.equal(renderLucideIcons(documentRoot.body, { createIcons() { calls.push("body"); } }), false);
    assert.equal(renderLucideIcons(documentRoot.documentElement, { createIcons() { calls.push("html"); } }), false);
    assert.equal(calls.length, 1, "the document must never become a Lucide scan root");
  } finally {
    console.warn = previousWarn;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("startup and shared dialogs contain no zero-root Lucide calls", () => {
  const appSource = fs.readFileSync("frontend/app/app.js", "utf8");
  const viewSource = fs.readFileSync("frontend/app/BiddingView.js", "utf8");
  const zeroRootCall = /\.createIcons(?:\?\.)?\(\s*\)/u;

  assert.doesNotMatch(appSource, zeroRootCall);
  assert.doesNotMatch(viewSource, zeroRootCall);
  assert.doesNotMatch(viewSource, /createIconsScoped\(root\s*=\s*document\)/u);
});
