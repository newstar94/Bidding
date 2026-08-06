import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Google sign-in area is prominent while its icon remains constrained", () => {
  const markup = fs.readFileSync("views/components/auth_overlay.html", "utf8");
  const css = fs.readFileSync("views/css/views.css", "utf8");
  const controller = fs.readFileSync("frontend/auth/GoogleAuthController.js", "utf8");
  assert.match(markup, /id="google-signin-btn-container"[^>]*class="google-signin-container"/u);
  assert.match(markup, /id="google-signin-launch"[^>]*class="google-signin-launch"/u);
  assert.doesNotMatch(markup, /class="google-signin-loading"/u);
  assert.doesNotMatch(markup, /google-signin-panel|google-signin-copy|google-signin-title/u);
  assert.doesNotMatch(css, /\.google-signin-panel|\.google-signin-copy/u);
  assert.match(css, /\.google-signin-container iframe\s*\{[^}]*border:\s*0\s*!important[^}]*box-shadow:\s*none/s);
  assert.doesNotMatch(css, /\.google-signin-container iframe:(?:hover|focus-visible)/u);
  assert.match(css, /\.google-signin-container \[role="button"\][^{]*\{[^}]*width:\s*100%\s*!important[^}]*height:\s*46px/s);
  assert.match(css, /\.google-signin-container \[role="button"\] svg[^{]*\{[^}]*width:\s*20px[^}]*height:\s*20px/s);
  assert.match(css, /\.google-signin-container \[role="button"\] > div:last-child[^{]*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.google-signin-container #button-label[^{]*\{[^}]*position:\s*absolute/s);
  assert.match(controller, /const googleButtonWidth = Math\.max\(200, Math\.min\(400, measuredWidth\)\)/u);
  assert.match(controller, /renderButton\(container,[\s\S]*width:\s*googleButtonWidth,/u);
});

test("Google sign-in keeps its launch button visible while the identity client preloads", () => {
  const controller = fs.readFileSync("frontend/auth/AuthFlowController.js", "utf8");
  const css = fs.readFileSync("views/css/views.css", "utf8");
  assert.match(controller, /setGoogleSignInAction\(loadGoogleIdentity\)/u);
  assert.match(controller, /scheduleGoogleIdentityLoad\(\);/u);
  assert.match(controller, /showGoogleSignInState\("", "idle"\)/u);
  assert.match(controller, /google\.accounts\.id\.prompt|google\?\.accounts\?\.id\?\.prompt/u);
  assert.match(css, /\.google-signin-launch\s*\{/u);
});
