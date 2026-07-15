import fs from "node:fs";

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
console.log("Accessibility audit passed (WCAG AA status colors and textual state components). ");
