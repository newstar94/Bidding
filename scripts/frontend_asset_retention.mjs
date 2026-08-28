import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";


const IMMUTABLE_RELEASE_ID = /^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$/u;
const HASHED_ASSET_PATH = /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u;
const SHA256_DIGEST = /^[0-9a-f]{64}$/u;
const JOURNAL_NAME = "frontend-compat-assets.json";


const sha256 = value => createHash("sha256").update(value).digest("hex");

async function fileState(candidate) {
  try {
    const state = await lstat(candidate);
    if (state.isSymbolicLink()) return "other";
    if (state.isFile()) return "file";
    if (state.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

function parseObject(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function manifestAssetPaths(manifest) {
  const assets = new Set();
  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Vite manifest entry is invalid: ${key}`);
    }
    const values = [entry.file];
    for (const field of ["css", "assets"]) {
      const fieldValues = entry[field] ?? [];
      if (!Array.isArray(fieldValues)) {
        throw new Error(`Vite manifest entry has invalid ${field}: ${key}`);
      }
      values.push(...fieldValues);
    }
    for (const value of values) {
      if (value === undefined || value === null) continue;
      if (typeof value !== "string" || !HASHED_ASSET_PATH.test(value)) {
        throw new Error(`Vite manifest contains an unsafe frontend asset: ${String(value)}`);
      }
      assets.add(value);
    }
  }
  if (!assets.size) throw new Error("Vite manifest contains no hashed frontend assets");
  return [...assets].sort((left, right) => left.localeCompare(right));
}

function secureMarkerInventory(secureMarker) {
  if (!Number.isSafeInteger(secureMarker.version) || secureMarker.version < 6) {
    throw new Error("secure build marker version must be a safe integer of at least 6");
  }
  if (secureMarker.obfuscation !== true || secureMarker.deadCodeInjection !== true) {
    throw new Error("secure build marker is missing the required transformation flags");
  }
  if (
    !Array.isArray(secureMarker.transformedFiles)
    || secureMarker.transformedFiles.length === 0
  ) {
    throw new Error("secure build marker has no transformed-file inventory");
  }

  const inventory = new Map();
  for (const record of secureMarker.transformedFiles) {
    const assetPath = record?.file;
    if (
      !record
      || typeof record !== "object"
      || Array.isArray(record)
      || typeof assetPath !== "string"
      || !HASHED_ASSET_PATH.test(assetPath)
      || !assetPath.endsWith(".js")
      || inventory.has(assetPath)
      || !Number.isSafeInteger(record.outputBytes)
      || record.outputBytes <= 0
      || typeof record.outputSha256 !== "string"
      || !SHA256_DIGEST.test(record.outputSha256)
    ) {
      throw new Error("secure build marker has an invalid transformed-file record");
    }
    inventory.set(assetPath, {
      outputBytes: record.outputBytes,
      outputSha256: record.outputSha256,
    });
  }
  return inventory;
}

function assetFile(distRoot, assetPath) {
  if (!HASHED_ASSET_PATH.test(assetPath)) {
    throw new Error(`Unsafe frontend asset path: ${String(assetPath)}`);
  }
  const root = path.resolve(distRoot);
  const candidate = path.resolve(root, ...assetPath.split("/"));
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Frontend asset escapes dist root: ${assetPath}`);
  }
  return candidate;
}

async function readReleaseSnapshot(distRoot) {
  const root = path.resolve(distRoot);
  const manifestPath = path.join(root, ".vite", "manifest.json");
  const secureMarkerPath = path.join(root, "secure-build.json");
  const [manifestState, markerState] = await Promise.all([
    fileState(manifestPath),
    fileState(secureMarkerPath),
  ]);
  if (manifestState === "missing" && markerState === "missing") return null;
  if (manifestState !== "file" || markerState !== "file") {
    throw new Error("Previous Vite manifest and secure marker must both exist as regular files");
  }

  const [manifestBytes, secureMarkerBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(secureMarkerPath),
  ]);
  const manifest = parseObject(manifestBytes, "Vite manifest");
  const secureMarker = parseObject(secureMarkerBytes, "secure build marker");
  const transformedInventory = secureMarkerInventory(secureMarker);
  const releaseId = secureMarker.releaseId;
  if (typeof releaseId !== "string" || !IMMUTABLE_RELEASE_ID.test(releaseId)) {
    throw new Error("secure build marker has no immutable release ID");
  }

  const assets = [];
  for (const assetPath of manifestAssetPaths(manifest)) {
    const source = assetFile(root, assetPath);
    if (await fileState(source) !== "file") {
      throw new Error(`Vite manifest references a missing or unsafe asset: ${assetPath}`);
    }
    const content = await readFile(source);
    assets.push({
      path: assetPath,
      sha256: sha256(content),
      size: content.byteLength,
      content,
    });
  }
  const assetsByPath = new Map(assets.map(asset => [asset.path, asset]));
  for (const [assetPath, transformed] of transformedInventory) {
    const asset = assetsByPath.get(assetPath);
    if (
      !asset
      || asset.size !== transformed.outputBytes
      || asset.sha256 !== transformed.outputSha256
    ) {
      throw new Error(
        `secure build marker transformed-file inventory does not match the Vite asset: ${assetPath}`,
      );
    }
  }
  return {
    releaseId,
    manifestSha256: sha256(manifestBytes),
    secureMarkerSha256: sha256(secureMarkerBytes),
    assets,
  };
}

async function readCompatibilitySnapshot(distRoot, releaseSnapshot) {
  const journalPath = path.join(path.resolve(distRoot), JOURNAL_NAME);
  const state = await fileState(journalPath);
  if (state === "missing") return null;
  if (state !== "file") {
    throw new Error("Frontend compatibility journal must be a regular file");
  }

  const journal = parseObject(
    await readFile(journalPath),
    "frontend compatibility journal",
  );
  const previousReleaseId = journal.previousReleaseId;
  const hasPreviousRelease = previousReleaseId !== null;
  const validPreviousRelease = hasPreviousRelease
    && typeof previousReleaseId === "string"
    && IMMUTABLE_RELEASE_ID.test(previousReleaseId)
    && previousReleaseId !== releaseSnapshot.releaseId;
  if (
    journal.version !== 1
    || journal.currentReleaseId !== releaseSnapshot.releaseId
    || journal.currentManifestSha256 !== releaseSnapshot.manifestSha256
    || journal.currentSecureMarkerSha256 !== releaseSnapshot.secureMarkerSha256
    || hasPreviousRelease !== validPreviousRelease
    || hasPreviousRelease && (
      !SHA256_DIGEST.test(journal.previousManifestSha256)
      || !SHA256_DIGEST.test(journal.previousSecureMarkerSha256)
    )
    || !hasPreviousRelease && (
      journal.previousManifestSha256 !== null
      || journal.previousSecureMarkerSha256 !== null
    )
    || !Array.isArray(journal.assets)
    || !hasPreviousRelease && journal.assets.length > 0
  ) {
    throw new Error("Frontend compatibility journal does not match the current release");
  }

  const currentPaths = new Set(releaseSnapshot.assets.map(asset => asset.path));
  const seen = new Set();
  const assets = [];
  for (const record of journal.assets) {
    const assetPath = record?.path;
    if (
      !record
      || typeof record !== "object"
      || Array.isArray(record)
      || typeof assetPath !== "string"
      || !HASHED_ASSET_PATH.test(assetPath)
      || currentPaths.has(assetPath)
      || seen.has(assetPath)
      || !Number.isSafeInteger(record.size)
      || record.size < 0
      || typeof record.sha256 !== "string"
      || !SHA256_DIGEST.test(record.sha256)
    ) {
      throw new Error("Frontend compatibility journal has an invalid asset record");
    }
    const source = assetFile(distRoot, assetPath);
    if (await fileState(source) !== "file") {
      throw new Error(`Frontend compatibility asset is missing or unsafe: ${assetPath}`);
    }
    const content = await readFile(source);
    if (content.byteLength !== record.size || sha256(content) !== record.sha256) {
      throw new Error(`Frontend compatibility asset integrity mismatch: ${assetPath}`);
    }
    seen.add(assetPath);
    assets.push({
      path: assetPath,
      sha256: record.sha256,
      size: record.size,
      content,
    });
  }
  assets.sort((left, right) => left.path.localeCompare(right.path));
  return {
    previousReleaseId,
    previousManifestSha256: journal.previousManifestSha256,
    previousSecureMarkerSha256: journal.previousSecureMarkerSha256,
    assets,
  };
}


function assertSameReleaseAssetInventory(previousSnapshot, currentSnapshot) {
  const previousByPath = new Map(
    previousSnapshot.assets.map(asset => [asset.path, asset]),
  );
  const currentByPath = new Map(
    currentSnapshot.assets.map(asset => [asset.path, asset]),
  );
  if (previousByPath.size !== currentByPath.size) {
    throw new Error("immutable release ID was reused with changed frontend asset inventory");
  }
  for (const [assetPath, previousAsset] of previousByPath) {
    const currentAsset = currentByPath.get(assetPath);
    if (
      !currentAsset
      || currentAsset.size !== previousAsset.size
      || currentAsset.sha256 !== previousAsset.sha256
    ) {
      throw new Error(
        `immutable release ID was reused with changed frontend asset: ${assetPath}`,
      );
    }
  }
}

async function atomicWrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o644 });
    try {
      await rename(temporary, target);
    } catch (error) {
      if (!new Set(["EEXIST", "EPERM"]).has(error?.code)) throw error;
      await rm(target, { force: true });
      await rename(temporary, target);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function restoreAsset(distRoot, asset) {
  const target = assetFile(distRoot, asset.path);
  const state = await fileState(target);
  if (state === "file") {
    const existing = await readFile(target);
    if (sha256(existing) === asset.sha256 && existing.byteLength === asset.size) return;
    throw new Error(`Frontend content-hashed asset collision: ${asset.path}`);
  }
  if (state !== "missing") {
    throw new Error(`Frontend compatibility target is not a regular file: ${asset.path}`);
  }
  await atomicWrite(target, asset.content);
}

async function pruneAssetDirectory(directory, distRoot, allowedPaths) {
  const state = await fileState(directory);
  if (state === "missing") return 0;
  if (state !== "directory") {
    throw new Error(`Frontend asset directory is not a regular directory: ${directory}`);
  }
  let pruned = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      pruned += await pruneAssetDirectory(candidate, distRoot, allowedPaths);
      try {
        await rm(candidate);
      } catch (error) {
        if (!new Set(["ENOTEMPTY", "ENOENT"]).has(error?.code)) throw error;
      }
      continue;
    }
    const relative = path.relative(path.resolve(distRoot), candidate).split(path.sep).join("/");
    if (allowedPaths.has(relative)) continue;
    await rm(candidate, { force: true });
    pruned += 1;
  }
  return pruned;
}


export async function snapshotPreviousFrontendAssets({ distRoot = "dist" } = {}) {
  const snapshot = await readReleaseSnapshot(distRoot);
  if (!snapshot) return null;
  return {
    ...snapshot,
    compatibility: await readCompatibilitySnapshot(distRoot, snapshot),
  };
}


export async function retainPreviousFrontendAssets({ distRoot = "dist", snapshot } = {}) {
  if (snapshot === undefined) {
    throw new TypeError("A previous frontend asset snapshot (or null for first build) is required");
  }
  const root = path.resolve(distRoot);
  const current = await readReleaseSnapshot(root);
  if (!current) throw new Error("Completed secure build has no Vite manifest or secure marker");

  const isSameReleaseRebuild = Boolean(
    snapshot && current.releaseId === snapshot.releaseId,
  );
  if (
    isSameReleaseRebuild
    && (
      current.manifestSha256 !== snapshot.manifestSha256
      || current.secureMarkerSha256 !== snapshot.secureMarkerSha256
    )
  ) {
    throw new Error("immutable release ID was reused with changed build identity");
  }
  if (isSameReleaseRebuild) {
    // The secure marker inventories transformed JavaScript only. Compare the
    // complete Vite manifest inventory here so CSS, workers, fonts, and any
    // other manifest-referenced asset cannot silently change under an
    // immutable release ID.
    assertSameReleaseAssetInventory(snapshot, current);
  }
  const sourceAssets = isSameReleaseRebuild
    ? snapshot.compatibility?.assets ?? []
    : snapshot?.assets ?? [];
  const previousReleaseId = isSameReleaseRebuild
    ? snapshot.compatibility?.previousReleaseId ?? null
    : snapshot?.releaseId ?? null;
  const previousManifestSha256 = isSameReleaseRebuild
    ? snapshot.compatibility?.previousManifestSha256 ?? null
    : snapshot?.manifestSha256 ?? null;
  const previousSecureMarkerSha256 = isSameReleaseRebuild
    ? snapshot.compatibility?.previousSecureMarkerSha256 ?? null
    : snapshot?.secureMarkerSha256 ?? null;
  const currentByPath = new Map(current.assets.map(asset => [asset.path, asset]));
  const retained = [];
  for (const asset of sourceAssets) {
    const currentAsset = currentByPath.get(asset.path);
    if (currentAsset) {
      if (currentAsset.sha256 !== asset.sha256 || currentAsset.size !== asset.size) {
        throw new Error(`Frontend content-hashed asset collision: ${asset.path}`);
      }
      continue;
    }
    await restoreAsset(root, asset);
    retained.push({ path: asset.path, sha256: asset.sha256, size: asset.size });
  }
  retained.sort((left, right) => left.path.localeCompare(right.path));

  const allowedPaths = new Set([
    ...current.assets.map(asset => asset.path),
    ...retained.map(asset => asset.path),
  ]);
  const prunedAssetCount = await pruneAssetDirectory(
    path.join(root, "assets"),
    root,
    allowedPaths,
  );
  const journal = {
    version: 1,
    currentReleaseId: current.releaseId,
    previousReleaseId,
    currentManifestSha256: current.manifestSha256,
    currentSecureMarkerSha256: current.secureMarkerSha256,
    previousManifestSha256,
    previousSecureMarkerSha256,
    assets: retained,
  };
  await atomicWrite(
    path.join(root, JOURNAL_NAME),
    `${JSON.stringify(journal, null, 2)}\n`,
  );
  return {
    currentReleaseId: current.releaseId,
    previousReleaseId,
    retainedAssetCount: retained.length,
    prunedAssetCount,
  };
}


export function createFrontendAssetRetentionPlugin() {
  let distRoot = null;
  let snapshotPromise = null;
  let buildFailed = false;
  return {
    name: "biddingflow-frontend-asset-retention",
    apply: "build",
    enforce: "pre",
    async configResolved(config) {
      const root = path.resolve(config.root || process.cwd());
      distRoot = path.resolve(root, config.build?.outDir || "dist");
      snapshotPromise = snapshotPreviousFrontendAssets({ distRoot });
      await snapshotPromise;
    },
    buildEnd(error) {
      buildFailed = Boolean(error);
    },
    async closeBundle() {
      if (buildFailed) return null;
      if (!distRoot || !snapshotPromise) {
        throw new Error("Frontend asset retention plugin was not configured");
      }
      return retainPreviousFrontendAssets({
        distRoot,
        snapshot: await snapshotPromise,
      });
    },
  };
}
