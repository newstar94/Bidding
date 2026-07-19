import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "release", "evidence", "npm-sbom.cdx.json");
const npmCliCandidates = [
  process.env.npm_execpath,
  resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  resolve(
    dirname(process.execPath),
    "..",
    "lib",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  ),
].filter(Boolean);
const npmCli = npmCliCandidates.find((candidate) => existsSync(candidate));
if (!npmCli) {
  throw new Error("Cannot locate the npm CLI installed with Node.js");
}
const result = spawnSync(
  process.execPath,
  [npmCli, "sbom", "--package-lock-only", "--sbom-format", "cyclonedx"],
  {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.stderr.write(result.stderr || "npm sbom failed\n");
  process.exit(result.status ?? 1);
}

const document = JSON.parse(result.stdout);
if (
  document.bomFormat !== "CycloneDX"
  || typeof document.specVersion !== "string"
  || !Array.isArray(document.components)
) {
  throw new Error("npm returned an invalid CycloneDX SBOM");
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(
  `npm CycloneDX SBOM written (${document.components.length} components).\n`,
);
