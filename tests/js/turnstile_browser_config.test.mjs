import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

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


test("Turnstile uses a responsive interaction-only widget and compact status shell", () => {
  const controller = fs.readFileSync(
    new URL("../../frontend/auth/TurnstileController.js", import.meta.url),
    "utf8",
  );
  const styles = fs.readFileSync(
    new URL("../../views/css/views.css", import.meta.url),
    "utf8",
  );

  assert.match(controller, /size:\s*preferredWidgetSize\(\)/u);
  assert.match(controller, /appearance:\s*"interaction-only"/u);
  assert.match(controller, /theme:\s*"auto"/u);
  assert.match(controller, /max-width:\s*359px/u);
  assert.match(
    controller,
    /shell\.hidden\s*=\s*state\s*!==\s*"interactive"\s*&&\s*state\s*!==\s*"error"/u,
  );
  assert.match(controller, /"before-interactive-callback"\(\)/u);
  assert.match(
    controller,
    /if \(shell\.dataset\.state === "loading"\)\s*\{\s*updateStatus\(action, "ready"/u,
  );
  assert.match(
    styles,
    /\.auth-turnstile\s*\{[^}]*display:\s*grid;[^}]*justify-items:\s*center;/su,
  );
  assert.match(styles, /\.auth-turnstile-widget iframe\s*\{[^}]*border-radius:/su);
  assert.match(
    styles,
    /\.auth-turnstile\[data-state="verified"\] \.auth-turnstile-status/su,
  );
  assert.doesNotMatch(
    styles,
    /\.auth-turnstile\[data-state="verified"\]\s*\{[^}]*background:/su,
  );
});
