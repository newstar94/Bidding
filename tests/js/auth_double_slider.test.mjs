import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { setAuthOverlayView } from "../../frontend/auth/AuthUi.js";

function createAuthDocument() {
  const messages = ["login", "register", "support"].map((name) => ({
    name,
    attributes: new Map(),
    classList: { contains: (className) => className === `auth-brand-message-${name}` },
    setAttribute(attribute, value) {
      this.attributes.set(attribute, value);
    },
  }));
  const card = {
    dataset: {},
    querySelectorAll(selector) {
      return selector === ".auth-brand-message" ? messages : [];
    },
  };
  const overlay = {
    attributes: new Map(),
    querySelector(selector) {
      return selector === ".auth-card" ? card : null;
    },
    setAttribute(attribute, value) {
      this.attributes.set(attribute, value);
    },
  };
  return {
    card,
    messages,
    overlay,
    documentRef: {
      getElementById(id) {
        return id === "auth-overlay" ? overlay : null;
      },
    },
  };
}

test("auth view state drives the register slider and accessible title", () => {
  const fixture = createAuthDocument();

  assert.equal(setAuthOverlayView("register", fixture.documentRef), "register");
  assert.equal(fixture.card.dataset.authView, "register");
  assert.equal(fixture.card.dataset.authForm, "register");
  assert.equal(fixture.overlay.attributes.get("aria-labelledby"), "auth-register-title");
  assert.equal(fixture.messages[0].attributes.get("aria-hidden"), "true");
  assert.equal(fixture.messages[1].attributes.get("aria-hidden"), "false");
  assert.equal(fixture.messages[2].attributes.get("aria-hidden"), "true");
});

test("recovery views keep the support panel and their own accessible title", () => {
  const fixture = createAuthDocument();

  assert.equal(setAuthOverlayView("forgot", fixture.documentRef), "forgot");
  assert.equal(fixture.card.dataset.authView, "support");
  assert.equal(fixture.overlay.attributes.get("aria-labelledby"), "auth-forgot-title");
  assert.equal(fixture.messages[2].attributes.get("aria-hidden"), "false");
});

test("double slider markup and responsive motion contracts are present", () => {
  const markup = fs.readFileSync("views/components/auth_overlay.html", "utf8");
  const styles = fs.readFileSync("views/css/views.css", "utf8");
  const shell = fs.readFileSync("views/index.html", "utf8");
  const visual = fs.readFileSync("views/assets/auth-procurement-visual-v2.webp");

  assert.match(markup, /class="auth-card" data-auth-view="login"/u);
  assert.match(markup, /class="auth-brand"[\s\S]*class="auth-form-stage"/u);
  assert.match(markup, /id="btn-auth-brand-register"/u);
  assert.match(markup, /id="btn-auth-brand-login"/u);
  assert.match(markup, /class="auth-brand-visual"[^>]*auth-procurement-visual-v2\.webp/u);
  assert.match(styles, /\.auth-card\[data-auth-view="register"\] \.auth-brand\s*\{[^}]*translateX\(100%\)/su);
  assert.match(styles, /\.auth-card\[data-auth-view="register"\] \.auth-form-stage\s*\{[^}]*translateX\(-100%\)/su);
  assert.match(styles, /\.auth-brand-action\s*\{[^}]*background:\s*#f8fafc[^}]*color:\s*var\(--primary-hover\)[^}]*box-shadow:/su);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*transform: none !important;/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(shell, /views\.css[^"\n]*auth-panel-cta-v7-20260802/u);
  assert.equal(visual.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(visual.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(visual.byteLength < 100_000, "auth visual must stay lightweight");
  assert.doesNotMatch(markup, /[—–]/u);
});
