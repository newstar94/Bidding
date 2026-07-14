import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "views", "vendor", "vendor-manifest.json"), "utf8"),
);
const components = manifest.assets.flatMap((asset) => Object.entries(asset.files).map(
  ([file, hash]) => ({
    type: "file",
    name: file,
    group: asset.name,
    version: asset.version,
    licenses: [{ license: { id: asset.license } }],
    hashes: [{ alg: "SHA-256", content: hash }],
    externalReferences: [
      { type: "distribution", url: asset.source },
      ...(asset.updateSource ? [{ type: "documentation", url: asset.updateSource }] : []),
    ],
  }),
));
const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: {
    component: { type: "application", name: "BiddingFlow vendored browser assets", version: "1.0.0" },
  },
  components,
};
const outputDirectory = path.join(ROOT, "sbom");
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(
  path.join(outputDirectory, "vendor.cdx.json"),
  `${JSON.stringify(bom, null, 2)}\n`,
  "utf8",
);
console.log(`Vendor SBOM generated (${components.length} components).`);
