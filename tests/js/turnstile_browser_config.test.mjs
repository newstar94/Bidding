import test from "node:test";
import assert from "node:assert/strict";

import {
  isTurnstileEnabled,
  readTurnstileBrowserConfig,
} from "../../frontend/auth/TurnstileController.js";


function fakeDocument(values = {}) {
  return {
    querySelector(selector) {
      const name = /meta\[name="([^"]+)"\]/u.exec(selector)?.[1];
      return name && Object.hasOwn(values, name) ? { content: values[name] } : null;
    },
  };
}


test("Turnstile browser configuration is disabled without exposing a key", () => {
  const documentRef = fakeDocument({
    "bf-turnstile-enabled": "false",
    "bf-turnstile-site-key": "must-not-be-used",
  });

  assert.deepEqual(readTurnstileBrowserConfig(documentRef), {
    enabled: false,
    siteKey: "",
  });
  assert.equal(isTurnstileEnabled(documentRef), false);
});


test("Turnstile browser configuration enables only with a site key", () => {
  const documentRef = fakeDocument({
    "bf-turnstile-enabled": "true",
    "bf-turnstile-site-key": "public-site-key",
  });

  assert.deepEqual(readTurnstileBrowserConfig(documentRef), {
    enabled: true,
    siteKey: "public-site-key",
  });
  assert.equal(isTurnstileEnabled(documentRef), true);
  assert.equal(
    isTurnstileEnabled(fakeDocument({ "bf-turnstile-enabled": "true" })),
    false,
  );
});
