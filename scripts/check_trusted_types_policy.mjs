import {
  assertSafeHTML,
  assertSafeScriptURL,
  assertSafeStyleURL
} from "../frontend/shared/trustedTypes.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const trustedTypesSource = readFileSync(
  fileURLToPath(new URL("../frontend/shared/trustedTypes.js", import.meta.url)),
  "utf8"
);
const viteConfigSource = readFileSync(
  fileURLToPath(new URL("../vite.config.js", import.meta.url)),
  "utf8"
);
const appEntrySource = readFileSync(
  fileURLToPath(new URL("../frontend/app/app.js", import.meta.url)),
  "utf8"
);
if (!/modulePreload\s*:\s*false/.test(viteConfigSource)) {
  throw new Error(
    "Vite runtime modulepreload injection must stay disabled under Trusted Types enforcement"
  );
}
if (!/serviceWorker\.register\(\s*trustedScriptURL\(/.test(appEntrySource)) {
  throw new Error("Service worker registration must receive a TrustedScriptURL");
}
if (!/createPolicy\?\.\("biddingflow-dompurify"/.test(trustedTypesSource)) {
  throw new Error(
    "DOMPurify must use the CSP-approved first-party parser policy"
  );
}
if (!/TRUSTED_TYPES_POLICY\s*:\s*domPurifyTrustedTypesPolicy/.test(trustedTypesSource)) {
  throw new Error("DOMPurify must receive TrustedHTML for its inert parsing document");
}
for (const requiredContext of ["tbody", "tr", "table", "select"]) {
  if (!trustedTypesSource.includes(`unwrapTag: "${requiredContext}"`)) {
    throw new Error(`Trusted HTML sanitizer is missing the ${requiredContext} fragment context`);
  }
}

const maliciousHtml = [
  ["username", '<img src=x onerror="alert(1)">'],
  ["organization", '<svg onload="alert(1)"></svg>'],
  ["package", '<a href="javascript:alert(1)">Mở</a>'],
  ["excel-import", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ["upstream", "<script>alert(1)</script>"],
  ["encoded-scheme", '<a href="  JaVaScRiPt:alert(1)">Mở</a>'],
  ["data-html", '<img src="data:text/html,<script>alert(1)</script>">']
];

for (const [source, payload] of maliciousHtml) {
  let rejected = false;
  try {
    assertSafeHTML(payload);
  } catch (error) {
    rejected = error instanceof TypeError;
  }
  if (!rejected) {
    throw new Error(`Trusted Types prefilter accepted malicious ${source} payload`);
  }
}

const safeHtml = [
  "<strong>Nội dung hợp lệ</strong>",
  '<button type="button" data-command="open">Mở</button>',
  '<input id="employee-name" name="employee_name" value="">'
];
for (const payload of safeHtml) {
  if (assertSafeHTML(payload) !== payload) {
    throw new Error("Trusted Types prefilter changed safe HTML");
  }
}

for (const url of [
  "/frontend/app.js",
  "/vendor/flatpickr/flatpickr.min.js?v=1.0",
  "/dist/assets/excelParseWorker-C3f9_a1.js",
  "/service-worker.js?build=app-12345678.js",
  "https://accounts.google.com/gsi/client"
]) {
  if (assertSafeScriptURL(url) !== url) {
    throw new Error(`Approved script URL was changed: ${url}`);
  }
}

for (const url of [
  "javascript:alert(1)",
  "data:text/javascript,alert(1)",
  "https://example.com/runtime.js",
  "//example.com/runtime.js"
]) {
  let rejected = false;
  try {
    assertSafeScriptURL(url);
  } catch (error) {
    rejected = error instanceof TypeError;
  }
  if (!rejected) {
    throw new Error(`Trusted Types policy accepted unapproved script URL: ${url}`);
  }
}

if (
  assertSafeStyleURL("/vendor/flatpickr/flatpickr.min.css?v=4")
  !== "/vendor/flatpickr/flatpickr.min.css?v=4"
) {
  throw new Error("Approved stylesheet URL was changed");
}
for (const url of [
  "https://example.com/theme.css",
  "javascript:alert(1)",
  "/vendor/theme.js"
]) {
  let rejected = false;
  try {
    assertSafeStyleURL(url);
  } catch (error) {
    rejected = error instanceof TypeError;
  }
  if (!rejected) {
    throw new Error(`Stylesheet policy accepted unapproved URL: ${url}`);
  }
}

console.log("Trusted Types policy payload checks passed.");
