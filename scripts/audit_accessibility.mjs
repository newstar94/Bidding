import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync("views/css/variables.css", "utf8");
const variables = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(match => [match[1], match[2]]));

function luminance(hex) {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const pairs = [
  ["primary", "primary-soft"],
  ["success", "success-soft"],
  ["warning", "warning-soft"],
  ["danger", "danger-soft"],
  ["text-muted", "neutral-soft"],
];
const failures = pairs.filter(([foreground, background]) => contrast(variables[foreground], variables[background]) < 4.5);
if (failures.length) {
  throw new Error(`WCAG AA contrast failed: ${failures.map(pair => pair.join("/" )).join(", ")}`);
}

const applicationSource = fs.readdirSync("frontend", { recursive: true })
  .filter(name => String(name).endsWith(".js"))
  .map(name => fs.readFileSync(`frontend/${name}`, "utf8"))
  .join("\n");
if (!applicationSource.includes("status-pill") || !applicationSource.includes("badge")) {
  throw new Error("Status text components are missing; state must not be communicated by color alone.");
}

function templateFiles(root) {
  return fs.readdirSync(root, { recursive: true })
    .filter(name => String(name).endsWith(".html"))
    .map(name => path.join(root, String(name)));
}

const iconButtonFailures = [];
const frontendTemplates = fs.readdirSync("frontend", { recursive: true })
  .filter(name => String(name).endsWith(".js"))
  .map(name => path.join("frontend", String(name)));
for (const filename of [...["views/components", "views/tabs", "views/modals"].flatMap(templateFiles), ...frontendTemplates]) {
  const source = fs.readFileSync(filename, "utf8");
  for (const match of source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const attributes = match[1];
    const visibleText = match[2].replace(/<[^>]+>/g, " ").replace(/\$\{[^}]*\}/g, "dynamic").replace(/\s+/g, " ").trim();
    const hasAccessibleName = /\b(?:aria-label|aria-labelledby|title)\s*=/i.test(attributes);
    if (visibleText || hasAccessibleName) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    iconButtonFailures.push(`${filename}:${line}`);
  }
}
if (iconButtonFailures.length) {
  throw new Error(`Icon-only buttons are missing accessible names: ${iconButtonFailures.join(", ")}`);
}

const header = fs.readFileSync("views/components/header.html", "utf8");
const sidebar = fs.readFileSync("views/components/sidebar.html", "utf8");
const index = fs.readFileSync("views/index.html", "utf8");
const shellAccessibility = fs.readFileSync("frontend/app/shellAccessibility.js", "utf8");
const semanticAccessibility = fs.readFileSync("frontend/shared/semanticAccessibility.js", "utf8");
const biddingView = fs.readFileSync("frontend/app/BiddingView.js", "utf8");
const baseStyles = fs.readFileSync("views/css/base.css", "utf8");
const applicationStyles = [...index.matchAll(/<link\b[^>]*href="\/css\/([^"]+\.css)(?:\?[^\"]*)?"/gi)]
  .map(match => fs.readFileSync(path.join("views/css", match[1]), "utf8"))
  .join("\n");

if (!/<button\b[^>]*id="header-profile-trigger"[^>]*aria-expanded="false"[^>]*aria-controls="profile-dropdown-menu"/s.test(header)) {
  throw new Error("Header profile trigger must be a semantic disclosure button.");
}
if (!/id="sidebar-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="sidebar"/s.test(header)
    || !/id="btn-sidebar-collapse"[^>]*aria-expanded="true"[^>]*aria-controls="sidebar"/s.test(sidebar)) {
  throw new Error("Sidebar controls must expose aria-expanded and aria-controls.");
}
if (!shellAccessibility.includes('setToggleAttribute(sidebar, "inert"')
    || !shellAccessibility.includes('event.key === "Escape"')) {
  throw new Error("Sidebar/menu inert and keyboard focus management are missing.");
}
if (!index.includes('class="skip-link workspace-skip-link"') || !index.includes('id="main-content"')) {
  throw new Error("The application shell must provide a skip link and main landmark target.");
}
if (!semanticAccessibility.includes('setAttribute("aria-invalid"')
    || !semanticAccessibility.includes('setAttribute("aria-describedby"')
    || !semanticAccessibility.includes('setAttribute("role", "alert"')) {
  throw new Error("Form validation must expose invalid, described-by, and live error semantics.");
}
if (!biddingView.includes('setAttribute("aria-sort"') || !biddingView.includes('event.key !== "Enter"')) {
  throw new Error("Sortable table headers must expose state and keyboard activation.");
}
if (!css.includes("--touch-target-min: 44px")
    || !baseStyles.includes("min-height: var(--touch-target-min)")
    || !applicationStyles.includes("@media (prefers-reduced-motion: reduce)")) {
  throw new Error("Touch target and reduced-motion accessibility tokens are missing.");
}

console.log("Accessibility audit passed (contrast, shell semantics, forms, icon names, touch targets, and reduced motion). ");
