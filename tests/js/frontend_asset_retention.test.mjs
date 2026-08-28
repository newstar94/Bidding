import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  createFrontendAssetRetentionPlugin,
  retainPreviousFrontendAssets,
  snapshotPreviousFrontendAssets,
} from "../../scripts/frontend_asset_retention.mjs";


const sha256 = value => createHash("sha256").update(value).digest("hex");

test("secure Vite builds install frontend asset retention before output cleanup", () => {
  const config = readFileSync("vite.config.js", "utf8");
  assert.match(
    config,
    /import\s*\{\s*createFrontendAssetRetentionPlugin\s*\}\s*from\s*["']\.\/scripts\/frontend_asset_retention\.mjs["']/u,
  );
  assert.match(
    config,
    /mode\s*===\s*["']secure["'][\s\S]{0,160}createFrontendAssetRetentionPlugin\(\)[\s\S]{0,160}secureObfuscatorPlugin\(releaseId\)/u,
  );
});

function productionMarker({ releaseId, assets, manifest }) {
  const manifestJavaScript = [...new Set(
    Object.values(manifest).flatMap(entry => [
      entry.file,
      ...(entry.css ?? []),
      ...(entry.assets ?? []),
    ]).filter(assetPath => assetPath?.endsWith(".js")),
  )].sort();
  return {
    version: 6,
    releaseId,
    obfuscation: true,
    deadCodeInjection: true,
    transformedFiles: manifestJavaScript.map(assetPath => ({
      file: assetPath,
      outputBytes: Buffer.byteLength(assets[assetPath]),
      outputSha256: sha256(assets[assetPath]),
    })),
  };
}

async function writeRelease(
  distRoot,
  { releaseId, assets, manifest, marker = productionMarker({ releaseId, assets, manifest }) },
) {
  await mkdir(path.join(distRoot, ".vite"), { recursive: true });
  await mkdir(path.join(distRoot, "assets"), { recursive: true });
  for (const [assetPath, content] of Object.entries(assets)) {
    const target = path.join(distRoot, ...assetPath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await writeFile(
    path.join(distRoot, ".vite", "manifest.json"),
    JSON.stringify(manifest),
  );
  await writeFile(
    path.join(distRoot, "secure-build.json"),
    JSON.stringify(marker),
  );
}

async function writeCompatibilityJournal(
  distRoot,
  { currentReleaseId, previousReleaseId, assets },
) {
  const [manifestBytes, markerBytes] = await Promise.all([
    readFile(path.join(distRoot, ".vite", "manifest.json")),
    readFile(path.join(distRoot, "secure-build.json")),
  ]);
  await writeFile(
    path.join(distRoot, "frontend-compat-assets.json"),
    JSON.stringify({
      version: 1,
      currentReleaseId,
      previousReleaseId,
      currentManifestSha256: sha256(manifestBytes),
      currentSecureMarkerSha256: sha256(markerBytes),
      previousManifestSha256: "c".repeat(64),
      previousSecureMarkerSha256: "d".repeat(64),
      assets: Object.entries(assets).map(([assetPath, content]) => ({
        path: assetPath,
        sha256: sha256(content),
        size: Buffer.byteLength(content),
      })),
    }),
  );
}


test("secure build retains exactly N-1 manifest assets and prunes N-2", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bf-asset-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const distRoot = path.join(root, "dist");
  const oldAssets = {
    "assets/app-OLDHASH1.js": "old app",
    "assets/feature-OLDHASH2.js": "old lazy feature",
    "assets/app-OLDHASH3.css": "old css",
  };
  await writeRelease(distRoot, {
    releaseId: "a".repeat(40),
    assets: {
      ...oldAssets,
      "assets/feature-N2HASH00.js": "must be pruned",
    },
    manifest: {
      "frontend/app/app.js": {
        file: "assets/app-OLDHASH1.js",
        css: ["assets/app-OLDHASH3.css"],
        dynamicImports: ["frontend/feature.js"],
      },
      "frontend/feature.js": { file: "assets/feature-OLDHASH2.js" },
    },
  });
  await writeCompatibilityJournal(distRoot, {
    currentReleaseId: "a".repeat(40),
    previousReleaseId: "0".repeat(40),
    assets: { "assets/feature-N2HASH00.js": "must be pruned" },
  });

  const snapshot = await snapshotPreviousFrontendAssets({ distRoot });
  assert.equal(snapshot.releaseId, "a".repeat(40));
  assert.deepEqual(snapshot.assets.map(asset => asset.path), Object.keys(oldAssets).sort());

  await rm(path.join(distRoot, ".vite"), { recursive: true, force: true });
  await writeRelease(distRoot, {
    releaseId: "b".repeat(40),
    assets: {
      "assets/app-NEWHASH1.js": "new app",
      "assets/feature-N2HASH00.js": "stale file left by a non-empty build",
    },
    manifest: {
      "frontend/app/app.js": { file: "assets/app-NEWHASH1.js" },
    },
  });

  const result = await retainPreviousFrontendAssets({ distRoot, snapshot });

  assert.deepEqual(result, {
    currentReleaseId: "b".repeat(40),
    previousReleaseId: "a".repeat(40),
    retainedAssetCount: 3,
    prunedAssetCount: 1,
  });
  for (const [assetPath, content] of Object.entries(oldAssets)) {
    assert.equal(await readFile(path.join(distRoot, ...assetPath.split("/")), "utf8"), content);
  }
  await assert.rejects(
    readFile(path.join(distRoot, "assets", "feature-N2HASH00.js")),
    error => error?.code === "ENOENT",
  );
  const journalBytes = await readFile(
    path.join(distRoot, "frontend-compat-assets.json"),
    "utf8",
  );
  const journal = JSON.parse(journalBytes);
  assert.equal(journal.version, 1);
  assert.equal(journal.currentReleaseId, "b".repeat(40));
  assert.equal(journal.previousReleaseId, "a".repeat(40));
  assert.equal(journal.previousManifestSha256, snapshot.manifestSha256);
  assert.equal(journal.previousSecureMarkerSha256, snapshot.secureMarkerSha256);
  assert.deepEqual(
    journal.assets,
    Object.entries(oldAssets).sort(([left], [right]) => left.localeCompare(right)).map(
      ([assetPath, content]) => ({
        path: assetPath,
        sha256: sha256(content),
        size: Buffer.byteLength(content),
      }),
    ),
  );
});


test("no-op rebuild with the same release ID preserves existing N-1 assets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bf-asset-noop-rebuild-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const distRoot = path.join(root, "dist");
  const currentReleaseId = "b".repeat(40);
  const previousReleaseId = "a".repeat(40);
  const currentAssets = { "assets/app-CURRENTA.js": "current app" };
  const retainedAssets = { "assets/lazy-PREVIOUS.js": "retained N-1 lazy chunk" };
  const currentManifest = {
    "frontend/app/app.js": { file: "assets/app-CURRENTA.js" },
  };
  await writeRelease(distRoot, {
    releaseId: currentReleaseId,
    assets: { ...currentAssets, ...retainedAssets },
    manifest: currentManifest,
  });
  await writeCompatibilityJournal(distRoot, {
    currentReleaseId,
    previousReleaseId,
    assets: retainedAssets,
  });

  const snapshot = await snapshotPreviousFrontendAssets({ distRoot });
  await rm(distRoot, { recursive: true, force: true });
  await writeRelease(distRoot, {
    releaseId: currentReleaseId,
    assets: currentAssets,
    manifest: currentManifest,
  });

  const result = await retainPreviousFrontendAssets({ distRoot, snapshot });

  assert.deepEqual(result, {
    currentReleaseId,
    previousReleaseId,
    retainedAssetCount: 1,
    prunedAssetCount: 0,
  });
  assert.equal(
    await readFile(path.join(distRoot, "assets", "lazy-PREVIOUS.js"), "utf8"),
    "retained N-1 lazy chunk",
  );
  const journal = JSON.parse(
    await readFile(path.join(distRoot, "frontend-compat-assets.json"), "utf8"),
  );
  assert.equal(journal.currentReleaseId, currentReleaseId);
  assert.equal(journal.previousReleaseId, previousReleaseId);
  assert.notEqual(journal.previousReleaseId, journal.currentReleaseId);
  assert.deepEqual(journal.assets, [{
    path: "assets/lazy-PREVIOUS.js",
    sha256: sha256("retained N-1 lazy chunk"),
    size: Buffer.byteLength("retained N-1 lazy chunk"),
  }]);
});


test("snapshot rejects malformed secure marker versions, flags, and inventory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bf-asset-marker-validation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const distRoot = path.join(root, "dist");
  const releaseId = "b".repeat(40);
  const assets = { "assets/app-CURRENTA.js": "current app" };
  const manifest = { app: { file: "assets/app-CURRENTA.js" } };
  await writeRelease(distRoot, { releaseId, assets, manifest });
  const validMarker = productionMarker({ releaseId, assets, manifest });
  const invalidMarkers = [
    { ...validMarker, version: undefined },
    { ...validMarker, version: "6" },
    { ...validMarker, version: 6.5 },
    { ...validMarker, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...validMarker, obfuscation: false },
    { ...validMarker, deadCodeInjection: false },
    { ...validMarker, transformedFiles: [] },
    {
      ...validMarker,
      transformedFiles: [{
        file: "assets/app-CURRENTA.js",
        outputBytes: Buffer.byteLength("current app"),
        outputSha256: "not-a-sha256",
      }],
    },
  ];

  for (const marker of invalidMarkers) {
    await writeFile(
      path.join(distRoot, "secure-build.json"),
      JSON.stringify(marker),
    );
    await assert.rejects(
      snapshotPreviousFrontendAssets({ distRoot }),
      /secure build marker/u,
    );
  }
});


test("same release ID rejects changed manifest or secure marker identity", async (t) => {
  for (const changedIdentity of ["manifest", "marker"]) {
    const root = await mkdtemp(path.join(os.tmpdir(), `bf-asset-reused-id-${changedIdentity}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const distRoot = path.join(root, "dist");
    const releaseId = "b".repeat(40);
    const initialAssets = { "assets/app-CURRENTA.js": "current app" };
    const initialManifest = { app: { file: "assets/app-CURRENTA.js" } };
    await writeRelease(distRoot, {
      releaseId,
      assets: initialAssets,
      manifest: initialManifest,
    });
    const snapshot = await snapshotPreviousFrontendAssets({ distRoot });
    await rm(distRoot, { recursive: true, force: true });

    if (changedIdentity === "manifest") {
      await writeRelease(distRoot, {
        releaseId,
        assets: { "assets/app-CHANGED1.js": "changed app" },
        manifest: { app: { file: "assets/app-CHANGED1.js" } },
      });
    } else {
      const marker = productionMarker({
        releaseId,
        assets: initialAssets,
        manifest: initialManifest,
      });
      await writeRelease(distRoot, {
        releaseId,
        assets: initialAssets,
        manifest: initialManifest,
        marker: { ...marker, transformer: "changed-marker-identity" },
      });
    }

    await assert.rejects(
      retainPreviousFrontendAssets({ distRoot, snapshot }),
      /immutable release ID was reused with changed build identity/u,
    );
  }
});


test("same release ID rejects changed CSS or worker asset bytes", async (t) => {
  for (const changedPath of [
    "assets/app-STYLED01.css",
    "assets/excelParseWorker-WORKER01.js",
  ]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "bf-asset-reused-nonbundle-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const distRoot = path.join(root, "dist");
    const releaseId = "b".repeat(40);
    const initialAssets = {
      "assets/app-CURRENTA.js": "current app",
      "assets/app-STYLED01.css": "original css",
      "assets/excelParseWorker-WORKER01.js": "original worker",
    };
    const manifest = {
      "frontend/app/app.js": {
        file: "assets/app-CURRENTA.js",
        css: ["assets/app-STYLED01.css"],
        assets: ["assets/excelParseWorker-WORKER01.js"],
      },
    };
    const marker = productionMarker({
      releaseId,
      assets: initialAssets,
      manifest: { "frontend/app/app.js": { file: "assets/app-CURRENTA.js" } },
    });
    await writeRelease(distRoot, {
      releaseId,
      assets: initialAssets,
      manifest,
      marker,
    });
    const snapshot = await snapshotPreviousFrontendAssets({ distRoot });
    await rm(distRoot, { recursive: true, force: true });
    const changedAssets = {
      ...initialAssets,
      [changedPath]: "changed bytes",
    };
    await writeRelease(distRoot, {
      releaseId,
      assets: changedAssets,
      manifest,
      marker,
    });

    await assert.rejects(
      retainPreviousFrontendAssets({ distRoot, snapshot }),
      new RegExp(`changed frontend asset: ${changedPath.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`),
    );
  }
});


test("retention rejects partial snapshots and content-hash collisions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bf-asset-collision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const distRoot = path.join(root, "dist");
  await mkdir(path.join(distRoot, ".vite"), { recursive: true });
  await writeFile(path.join(distRoot, ".vite", "manifest.json"), "{}");
  await assert.rejects(
    snapshotPreviousFrontendAssets({ distRoot }),
    /manifest and secure marker must both exist/u,
  );

  await rm(distRoot, { recursive: true, force: true });
  await writeRelease(distRoot, {
    releaseId: "a".repeat(40),
    assets: { "assets/app-SAMEHASH.js": "old bytes" },
    manifest: { app: { file: "assets/app-SAMEHASH.js" } },
  });
  const snapshot = await snapshotPreviousFrontendAssets({ distRoot });
  await rm(distRoot, { recursive: true, force: true });
  await writeRelease(distRoot, {
    releaseId: "b".repeat(40),
    assets: { "assets/app-SAMEHASH.js": "different new bytes" },
    manifest: { app: { file: "assets/app-SAMEHASH.js" } },
  });

  await assert.rejects(
    retainPreviousFrontendAssets({ distRoot, snapshot }),
    /content-hashed asset collision/u,
  );
});


test("Vite plugin snapshots before cleanup and restores after a successful build", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bf-asset-plugin-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const distRoot = path.join(root, "dist");
  await writeRelease(distRoot, {
    releaseId: "a".repeat(40),
    assets: { "assets/lazy-OLDHASH1.js": "old lazy" },
    manifest: { lazy: { file: "assets/lazy-OLDHASH1.js" } },
  });
  const plugin = createFrontendAssetRetentionPlugin();
  await plugin.configResolved({ root, build: { outDir: "dist" } });

  await rm(distRoot, { recursive: true, force: true });
  await writeRelease(distRoot, {
    releaseId: "b".repeat(40),
    assets: { "assets/app-NEWHASH1.js": "new app" },
    manifest: { app: { file: "assets/app-NEWHASH1.js" } },
  });
  plugin.buildEnd(null);
  await plugin.closeBundle();

  assert.equal(
    await readFile(path.join(distRoot, "assets", "lazy-OLDHASH1.js"), "utf8"),
    "old lazy",
  );
});
