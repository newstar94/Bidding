import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";


function canonicalCycle(cycle) {
  const nodes = cycle.slice(0, -1);
  const rotations = nodes.map((_, index) => [
    ...nodes.slice(index),
    ...nodes.slice(0, index),
  ]);
  rotations.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
  return [...rotations[0], rotations[0][0]];
}

export function findImportCycles(graph) {
  const cycles = new Map();
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const visit = (moduleName) => {
    if (active.has(moduleName)) {
      const start = stack.indexOf(moduleName);
      const cycle = canonicalCycle([...stack.slice(start), moduleName]);
      cycles.set(cycle.join("\0"), cycle);
      return;
    }
    if (visited.has(moduleName)) return;
    visited.add(moduleName);
    active.add(moduleName);
    stack.push(moduleName);
    for (const dependency of graph.get(moduleName) || []) visit(dependency);
    stack.pop();
    active.delete(moduleName);
  };
  [...graph.keys()].sort().forEach(visit);
  return [...cycles.values()].sort(
    (left, right) => left.join("\0").localeCompare(right.join("\0"))
  );
}

async function listModules(root) {
  const modules = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) modules.push(absolute);
    }
  };
  await walk(root);
  return modules.sort();
}

function resolveRelativeImport(sourceFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const candidate = path.resolve(path.dirname(sourceFile), specifier);
  for (const resolved of [candidate, `${candidate}.js`, `${candidate}.mjs`, path.join(candidate, "index.js")]) {
    if (existsSync(resolved)) return resolved;
  }
  return null;
}

export async function buildStaticImportGraph(frontendRoot) {
  const files = await listModules(frontendRoot);
  const known = new Set(files.map((file) => path.resolve(file)));
  const graph = new Map();
  const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const dependencies = [];
    for (const match of source.matchAll(importPattern)) {
      const resolved = resolveRelativeImport(file, match[1]);
      if (resolved && known.has(resolved)) dependencies.push(resolved);
    }
    graph.set(path.resolve(file), [...new Set(dependencies)].sort());
  }
  return graph;
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const frontendRoot = path.join(projectRoot, "frontend");
  const graph = await buildStaticImportGraph(frontendRoot);
  const cycles = findImportCycles(graph);
  if (cycles.length) {
    for (const cycle of cycles) {
      const relative = cycle.map((file) => path.relative(projectRoot, file).replaceAll("\\", "/"));
      console.error(`FRONTEND_IMPORT_CYCLE: ${relative.join(" -> ")}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Frontend module graph: ${graph.size} modules, 0 static import cycles`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await main();
}
