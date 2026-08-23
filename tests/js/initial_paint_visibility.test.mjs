import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

const htmlFilesUnder = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = `${directory}/${entry.name}`;
  return entry.isDirectory() ? htmlFilesUnder(path) : entry.name.endsWith(".html") ? [path] : [];
});

test("the application shell stays hidden until render-blocking styles are ready", () => {
  const index = read("views/index.html");
  const routeShell = read("views/vendor/route-shell.js");
  const landingPage = read("frontend/landing/LandingPage.js");
  const legalPage = read("frontend/legal/LegalPage.js");

  assert.match(index, /<body\b[^>]*\bhidden\b[^>]*>/u);
  assert.match(routeShell, /DOMContentLoaded/u);
  assert.match(routeShell, /document\.body\?\.removeAttribute\("hidden"\)/u);
  assert.match(routeShell, /__BF_BOOTSTRAP_FATAL__/u);
  assert.match(routeShell, /setTimeout\(showBootstrapFailure/u);
  assert.match(routeShell, /shell\s*===\s*"workspace"/u);
  assert.match(landingPage, /await loadStyleOnce\(LANDING_STYLESHEET_URL\)[\s\S]*document\.body\.removeAttribute\("hidden"\)/u);
  assert.match(legalPage, /await loadStyleOnce\(LEGAL_STYLESHEET_URL\)[\s\S]*document\.body\.removeAttribute\("hidden"\)/u);
});

test("brand images have safe fallback dimensions before CSS is applied", () => {
  const brandImages = htmlFilesUnder("views").flatMap((path) => {
    const html = read(path);
    return [...html.matchAll(/<img\b(?=[^>]*\bapp-brand-image\b)[^>]*>/gu)].map((match) => ({ path, tag: match[0] }));
  });

  assert.ok(brandImages.length > 0);
  for (const { path, tag } of brandImages) {
    const width = Number(tag.match(/\bwidth="(\d+)"/u)?.[1]);
    const height = Number(tag.match(/\bheight="(\d+)"/u)?.[1]);
    assert.ok(width > 0 && width <= 96, `${path} has unsafe brand image width: ${tag}`);
    assert.ok(height > 0 && height <= 96, `${path} has unsafe brand image height: ${tag}`);
  }
});

test("shared brand image CSS cannot expand an unstyled parent to the viewport", () => {
  const components = read("views/css/components.css");
  const brandRule = components.match(/\.app-brand-image\s*\{(?<declarations>[^}]*)\}/u)?.groups?.declarations || "";

  assert.match(brandRule, /\bwidth:\s*48px/u);
  assert.match(brandRule, /\bheight:\s*48px/u);
  assert.match(brandRule, /\bmax-width:\s*100%/u);
  assert.match(brandRule, /\bmax-height:\s*100%/u);
  assert.doesNotMatch(brandRule, /(?<!max-)\bwidth:\s*100%/u);
  assert.doesNotMatch(brandRule, /(?<!max-)\bheight:\s*100%/u);
});
