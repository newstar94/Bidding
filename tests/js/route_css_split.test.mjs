import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("landing and legal styles are owned by their dynamic route modules", () => {
  const app = read("frontend/app/app.js");
  const appCss = read("views/css/app.css");
  const landing = read("frontend/landing/LandingPage.js");
  const legal = read("frontend/legal/LegalPage.js");
  const notFound = read("frontend/errors/NotFoundPage.js");
  const components = read("views/css/components.css");
  const assistantLoader = read("frontend/assistant/AssistantLoader.js");

  assert.doesNotMatch(appCss, /landing\.css|legal\.css|not-found\.css/u);
  assert.match(app, /await import\("\.\.\/landing\/LandingPage\.js"\)/u);
  assert.match(app, /await import\("\.\.\/legal\/LegalPage\.js"\)/u);
  assert.match(app, /await import\("\.\.\/errors\/NotFoundPage\.js"\)/u);
  assert.match(landing, /loadStyleOnce\(LANDING_STYLESHEET_URL\)/u);
  assert.match(landing, /new URL\("\.\.\/\.\.\/views\/css\/landing\.css", import\.meta\.url\)/u);
  assert.match(legal, /loadStyleOnce\(LEGAL_STYLESHEET_URL\)/u);
  assert.match(legal, /new URL\("\.\.\/\.\.\/views\/css\/legal\.css", import\.meta\.url\)/u);
  assert.match(notFound, /loadStyleOnce\(NOT_FOUND_STYLESHEET_URL\)/u);
  assert.match(notFound, /new URL\("\.\.\/\.\.\/views\/css\/not-found\.css", import\.meta\.url\)/u);
  assert.doesNotMatch(components, /assistant\.css/u);
  assert.match(assistantLoader, /loadStyleOnce\(ASSISTANT_STYLESHEET_URL\)/u);
  assert.match(assistantLoader, /new URL\("\.\/assistant\.css", import\.meta\.url\)/u);
});

test("secure build enforces hashed route CSS and its main-bundle budget", () => {
  const packageJson = JSON.parse(read("package.json"));
  const trustedTypes = read("frontend/shared/trustedTypes.js");
  const checker = read("scripts/check_route_css_split.mjs");

  assert.equal(packageJson.scripts["check:route-css"], "node scripts/check_route_css_split.mjs");
  assert.equal(packageJson.scripts["test:route-css-visual"], "node scripts/verify_route_css_visual.mjs");
  assert.match(packageJson.scripts["build:secure"], /check:route-css/u);
  assert.equal(
    trustedTypes.includes("if (/^\\/dist\\/assets\\/[A-Za-z0-9_.-]+\\.css"),
    true,
  );
  assert.match(checker, /MAX_MAIN_CSS_BYTES\s*=\s*335_000/u);
  assert.match(checker, /frontend\/landing\/LandingPage\.js/u);
  assert.match(checker, /frontend\/legal\/LegalPage\.js/u);
  assert.match(checker, /frontend\/errors\/NotFoundPage\.js/u);
});

test("secure main stylesheet preserves the shared debug cascade", () => {
  const index = read("views/index.html");
  const appCss = read("views/css/app.css");
  const debugOrder = [...index.matchAll(/href="\/css\/([^?"]+)\.css[^"]*"/gu)]
    .map((match) => `${match[1]}.css`)
    .filter((name) => !["landing.css", "legal.css", "not-found.css"].includes(name));
  const secureOrder = [...appCss.matchAll(/@import\s+"\.\/([^"]+)"[^;]*;/gu)]
    .map((match) => match[1]);

  assert.deepEqual(secureOrder, debugOrder);
  assert.doesNotMatch(appCss, /@layer|\blayer\s*\(/u);
});

test("mobile stacked filters clear desktop fixed flex bases", () => {
  const redesignCss = read("views/css/ui-redesign.css");
  const mobileStart = redesignCss.indexOf("@media (max-width: 768px)");
  const nextMedia = redesignCss.indexOf("@media", mobileStart + 1);
  const mobileCss = redesignCss.slice(mobileStart, nextMedia);

  assert.notEqual(mobileStart, -1);
  assert.match(
    mobileCss,
    /\.select-wrapper\s*\{[^}]*flex:\s*0\s+0\s+auto;[^}]*\}/u,
  );
});
