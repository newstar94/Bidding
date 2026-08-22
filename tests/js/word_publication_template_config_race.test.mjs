import assert from "node:assert/strict";
import test from "node:test";

import {
  loadWordPublicationTemplateConfig,
} from "../../frontend/documents/WordPublicationTemplateConfig.js";


function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}


test("stale Word config failure from workspace A cannot overwrite workspace B state", async () => {
  const originalFetch = globalThis.fetch;
  const pending = deferred();
  globalThis.fetch = async () => pending.promise;
  let token = "org-a@1";
  const model = {
    db: { workspace: "a" },
    state: { workspace: "a" },
    getWorkspaceToken: () => token,
  };
  const controller = {
    model,
    _wordPublicationTemplateConfig: { revision: 3, workspace: "a" },
    _wordPublicationTemplateConfigError: "",
  };

  try {
    const loading = loadWordPublicationTemplateConfig(controller);
    token = "org-b@1";
    model.db = { workspace: "b" };
    model.state = { workspace: "b" };
    controller._wordPublicationTemplateConfig = { revision: 9, workspace: "b" };
    controller._wordPublicationTemplateConfigError = "workspace-b-error";
    pending.resolve(new Response(JSON.stringify({ error: "workspace-a-failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }));

    await assert.rejects(loading, (error) => error?.code === "WORKSPACE_CHANGED");
    assert.deepEqual(controller._wordPublicationTemplateConfig, {
      revision: 9,
      workspace: "b",
    });
    assert.equal(controller._wordPublicationTemplateConfigError, "workspace-b-error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("stale Word config request cannot render workspace A error into workspace B", async () => {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const OriginalURL = globalThis.URL;
  const pending = deferred();
  const fetchStarted = deferred();
  let renders = 0;
  const root = {
    setAttribute() {},
    replaceChildren() { renders += 1; },
    appendChild() {},
    closest() { return null; },
  };
  const saveButton = { hidden: false, disabled: false };
  const liveStatus = { textContent: "" };
  globalThis.document = {
    querySelector: () => ({ dataset: { assetState: "loaded" } }),
    getElementById(id) {
      return {
        "word-template-assignment-list": root,
        "word-template-assignment-save": saveButton,
        "word-template-assignment-status": liveStatus,
      }[id] || null;
    },
    createElement() {
      return {
        className: "",
        textContent: "",
        dataset: {},
        setAttribute() {},
        appendChild() {},
      };
    },
  };
  globalThis.fetch = async () => {
    fetchStarted.resolve();
    return pending.promise;
  };
  globalThis.URL = class TestURL extends OriginalURL {
    get pathname() {
      const pathname = super.pathname;
      return pathname.endsWith("/frontend/documents/WordTemplateAssignments.css")
        ? "/frontend/documents/WordTemplateAssignments.css"
        : pathname;
    }
  };
  let token = "org-a@1";
  const model = {
    db: { workspace: "a" },
    state: {
      workspace: "a",
      activerole: "employee",
      activeuser: {},
    },
    getWorkspaceToken: () => token,
  };
  const controller = { model, view: {} };

  try {
    const { loadAndRenderWordTemplateAssignments } = await import(
      `../../frontend/documents/WordTemplateAssignments.js?race=${Date.now()}`
    );
    const loading = loadAndRenderWordTemplateAssignments(controller, []);
    await fetchStarted.promise;
    token = "org-b@1";
    model.db = { workspace: "b" };
    model.state = {
      workspace: "b",
      activerole: "employee",
      activeuser: {},
    };
    const workspaceBState = { workspace: "b" };
    controller._wordTemplateAssignmentState = workspaceBState;
    pending.resolve(new Response(JSON.stringify({ error: "workspace-a-failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }));

    assert.equal(await loading, null);
    assert.equal(renders, 1);
    assert.equal(controller._wordTemplateAssignmentState, workspaceBState);
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.URL = OriginalURL;
  }
});
