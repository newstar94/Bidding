import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";


const MODULE_EXTENSION_PATTERN = /\.(?:js|mjs)$/u;
const PRODUCTION_ENTRYPOINTS = Object.freeze([
  "frontend/app/app.js",
]);

async function listModules(root) {
  const modules = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && MODULE_EXTENSION_PATTERN.test(entry.name)) {
        modules.push(path.resolve(absolute));
      }
    }
  };
  await walk(root);
  return modules.sort();
}

function stripQueryAndHash(specifier) {
  return specifier.split(/[?#]/u, 1)[0];
}

function resolveLocalModule(sourceFile, specifier) {
  const cleanSpecifier = stripQueryAndHash(specifier);
  if (!cleanSpecifier.startsWith(".")) return null;
  const candidate = path.resolve(path.dirname(sourceFile), cleanSpecifier);
  for (const resolved of [
    candidate,
    `${candidate}.js`,
    `${candidate}.mjs`,
    path.join(candidate, "index.js"),
  ]) {
    if (existsSync(resolved)) return path.resolve(resolved);
  }
  return null;
}

export function extractLiteralModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (MODULE_EXTENSION_PATTERN.test(stripQueryAndHash(specifier))) {
        specifiers.add(specifier);
      }
    }
  }
  return [...specifiers].sort();
}

export async function buildProductionModuleGraph(frontendRoot) {
  const modules = await listModules(frontendRoot);
  const knownModules = new Set(modules);
  const graph = new Map();
  const unresolved = [];
  for (const moduleFile of modules) {
    const source = await readFile(moduleFile, "utf8");
    const dependencies = [];
    for (const specifier of extractLiteralModuleSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveLocalModule(moduleFile, specifier);
      if (resolved && !knownModules.has(resolved)) continue;
      if (!resolved) {
        unresolved.push({ source: moduleFile, specifier });
        continue;
      }
      dependencies.push(resolved);
    }
    graph.set(moduleFile, [...new Set(dependencies)].sort());
  }
  return { graph, unresolved };
}

export function reachableModules(graph, entrypoints) {
  const reachable = new Set();
  const pending = [...entrypoints];
  while (pending.length) {
    const moduleFile = pending.pop();
    if (reachable.has(moduleFile)) continue;
    reachable.add(moduleFile);
    for (const dependency of graph.get(moduleFile) || []) pending.push(dependency);
  }
  return reachable;
}

function projectRelative(projectRoot, file) {
  return path.relative(projectRoot, file).replaceAll("\\", "/");
}

export async function auditFrontendReachability(projectRoot) {
  const frontendRoot = path.join(projectRoot, "frontend");
  const { graph, unresolved } = await buildProductionModuleGraph(frontendRoot);
  const entrypoints = PRODUCTION_ENTRYPOINTS.map((entrypoint) => path.join(projectRoot, entrypoint));
  const missingEntrypoints = entrypoints.filter((entrypoint) => !graph.has(entrypoint));
  const reachable = reachableModules(graph, entrypoints.filter((entrypoint) => graph.has(entrypoint)));
  const orphanModules = [...graph.keys()].filter((moduleFile) => !reachable.has(moduleFile));
  return {
    moduleCount: graph.size,
    reachableCount: reachable.size,
    entrypoints: entrypoints.map((file) => projectRelative(projectRoot, file)),
    missingEntrypoints: missingEntrypoints.map((file) => projectRelative(projectRoot, file)),
    unresolved: unresolved.map(({ source, specifier }) => ({
      source: projectRelative(projectRoot, source),
      specifier,
    })),
    orphanModules: orphanModules.map((file) => projectRelative(projectRoot, file)),
  };
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const report = await auditFrontendReachability(projectRoot);
  console.log(JSON.stringify(report, null, 2));
  if (report.missingEntrypoints.length || report.unresolved.length || report.orphanModules.length) {
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await main();
}
