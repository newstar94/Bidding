import fs from "node:fs";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

const DIST_ROOT = path.resolve("dist");
const MANIFEST_PATH = path.join(DIST_ROOT, ".vite", "manifest.json");
const MAX_MAIN_CSS_BYTES = 335_000;
const BASELINE = Object.freeze({
  raw: 379_859,
  gzip: 66_541,
  brotli: 52_725,
});
const ROUTES = Object.freeze([
  [
    "frontend/app/DashboardView.js",
    ".dashboard-visually-hidden",
    "frontend/app/BiddingView.js",
  ],
  ["frontend/landing/LandingPage.js", ".landing-eyebrow-dot", "frontend/app/app.js"],
  ["frontend/legal/LegalPage.js", ".legal-document-note", "frontend/app/app.js"],
  ["frontend/errors/NotFoundPage.js", ".bf-not-found", "frontend/app/app.js"],
  ["frontend/assistant/AssistantLoader.js", ".bf-assistant-panel", "frontend/app/workspaceBootstrap.js"],
  [
    "frontend/documents/WordPublication.js",
    ".word-publication-page",
    "frontend/app/IntegrationWorkflowBridges.js",
  ],
  [
    "frontend/admin/UsageAnalyticsView.js",
    ".usage-analytics__metrics",
    "frontend/app/BiddingControllerUI.js",
  ],
  [
    "frontend/documents/WordTemplateAssignments.js",
    ".word-template-assignment-card",
    "frontend/documents/WordIntegration.js",
  ],
]);

const fail = (message) => {
  throw new Error("Route CSS split check failed: " + message);
};

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const appEntry = manifest["frontend/app/app.js"];
if (!appEntry) fail("application manifest entry is missing");
const appCssFiles = (appEntry.css || []).filter((file) => file.endsWith(".css"));
if (appCssFiles.length !== 1) fail("application entry must own exactly one main stylesheet");

const readAsset = (relativePath) => {
  if (!/^assets\/[A-Za-z0-9_.-]+$/.test(relativePath)) {
    fail("unsafe manifest asset path: " + relativePath);
  }
  const absolutePath = path.resolve(DIST_ROOT, relativePath);
  if (path.dirname(absolutePath) !== path.resolve(DIST_ROOT, "assets")) {
    fail("asset escaped dist/assets: " + relativePath);
  }
  return fs.readFileSync(absolutePath);
};

const mainCssPath = appCssFiles[0];
const mainCss = readAsset(mainCssPath);
if (mainCss.byteLength > MAX_MAIN_CSS_BYTES) {
  fail("main stylesheet is " + mainCss.byteLength + " bytes; budget is " + MAX_MAIN_CSS_BYTES);
}
const mainText = mainCss.toString("utf8");
const routeResults = [];

for (const [manifestKey, marker, ownerKey] of ROUTES) {
  const routeEntry = manifest[manifestKey];
  if (!routeEntry?.isDynamicEntry) fail(manifestKey + " is not a dynamic entry");
  const ownerEntry = manifest[ownerKey];
  if (!(ownerEntry?.dynamicImports || []).includes(manifestKey)) {
    fail(manifestKey + " is not owned by " + ownerKey);
  }
  const cssAssets = [...(routeEntry.css || []), ...(routeEntry.assets || [])]
    .filter((file) => file.endsWith(".css"));
  if (cssAssets.length !== 1) fail(manifestKey + " must own exactly one CSS asset");
  const cssPath = cssAssets[0];
  if (!/^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.css$/.test(cssPath)) {
    fail(manifestKey + " CSS is not content hashed: " + cssPath);
  }
  const css = readAsset(cssPath);
  if (!css.toString("utf8").includes(marker)) fail(cssPath + " lacks " + marker);
  if (mainText.includes(marker)) fail(marker + " leaked back into the main stylesheet");
  routeResults.push({
    route: manifestKey,
    file: cssPath,
    raw: css.byteLength,
    gzip: gzipSync(css, { level: 9 }).byteLength,
    brotli: brotliCompressSync(css).byteLength,
  });
}

const after = {
  raw: mainCss.byteLength,
  gzip: gzipSync(mainCss, { level: 9 }).byteLength,
  brotli: brotliCompressSync(mainCss).byteLength,
};
const delta = Object.fromEntries(
  Object.keys(BASELINE).map((key) => [key, after[key] - BASELINE[key]]),
);
console.log(JSON.stringify({ baseline: BASELINE, main: { file: mainCssPath, ...after }, delta, routes: routeResults }));
