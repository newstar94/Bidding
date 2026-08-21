import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";


function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function listFiles(root, extensions) {
  const files = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
        files.push(path.resolve(absolute));
      }
    }
  };
  await walk(root);
  return files.sort();
}

async function readSources(files) {
  return new Map(await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")])));
}

function relative(projectRoot, file) {
  return path.relative(projectRoot, file).replaceAll("\\", "/");
}

function filesMatching(sources, pattern, excluded = new Set()) {
  const matches = [];
  for (const [file, source] of sources) {
    pattern.lastIndex = 0;
    if (!excluded.has(file) && pattern.test(source)) matches.push(file);
  }
  return matches;
}

function declarationFiles(sources, symbol) {
  const escaped = escapeRegExp(symbol);
  const pattern = new RegExp(
    `\\b(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${escaped}\\b`,
    "u",
  );
  return filesMatching(sources, pattern);
}

function runtimeReferenceFiles(sources, symbol, declarations, aggregatorFile) {
  const escaped = escapeRegExp(symbol);
  const identifierPattern = new RegExp(`\\b${escaped}\\b`, "gu");
  const declarationPattern = new RegExp(
    `\\b(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${escaped}\\b`,
    "gu",
  );
  const references = [];
  for (const [file, source] of sources) {
    if (file === aggregatorFile) continue;
    const identifierCount = [...source.matchAll(identifierPattern)].length;
    if (!identifierCount) continue;
    const declarationCount = declarations.includes(file)
      ? [...source.matchAll(declarationPattern)].length
      : 0;
    if (identifierCount > declarationCount) references.push(file);
  }
  return references;
}

export async function buildControllerCommandInventory(projectRoot) {
  const frontendRoot = path.join(projectRoot, "frontend");
  const viewsRoot = path.join(projectRoot, "views");
  const testsRoot = path.join(projectRoot, "tests");
  const aggregatorFile = path.join(frontendRoot, "packages", "BiddingWorkflows.js");
  const [runtimeFiles, viewFiles, testFiles] = await Promise.all([
    listFiles(frontendRoot, [".js", ".mjs"]),
    listFiles(viewsRoot, [".html", ".js", ".mjs"]),
    listFiles(testsRoot, [".js", ".mjs"]),
  ]);
  const [runtimeSources, viewSources, testSources, workflowModule] = await Promise.all([
    readSources(runtimeFiles),
    readSources(viewFiles),
    readSources(testFiles),
    import(pathToFileURL(aggregatorFile).href),
  ]);

  return Object.entries(workflowModule)
    .filter(([, value]) => typeof value === "function")
    .map(([symbol, value]) => {
      const escaped = escapeRegExp(symbol);
      const declarations = declarationFiles(runtimeSources, symbol);
      const staticCallers = runtimeReferenceFiles(
        runtimeSources,
        symbol,
        declarations,
        aggregatorFile,
      );
      const dynamicPattern = new RegExp(
        "(?:[\"'`]" + escaped + "[\"'`]|\\." + escaped + "\\s*\\()",
        "u",
      );
      const htmlPattern = new RegExp(`data-fn=["']${escaped}["']`, "u");
      const dynamicCallers = filesMatching(runtimeSources, dynamicPattern, new Set(declarations));
      const htmlCallers = [
        ...filesMatching(runtimeSources, htmlPattern),
        ...filesMatching(viewSources, htmlPattern),
      ];
      const testReferences = filesMatching(testSources, new RegExp(`\\b${escaped}\\b`, "u"));
      const kind = /^class\s/u.test(Function.prototype.toString.call(value)) ? "class" : "function";
      const hasRuntimeEvidence = staticCallers.length || dynamicCallers.length || htmlCallers.length;
      return {
        command: symbol,
        kind,
        declaredIn: declarations.map((file) => relative(projectRoot, file)),
        installed: true,
        staticCallers: staticCallers.map((file) => relative(projectRoot, file)),
        dynamicCallers: dynamicCallers.map((file) => relative(projectRoot, file)),
        htmlCallers: [...new Set(htmlCallers.map((file) => relative(projectRoot, file)))],
        testOnly: !hasRuntimeEvidence && testReferences.length > 0,
        testReferences: testReferences.map((file) => relative(projectRoot, file)),
        action: hasRuntimeEvidence ? "KEEP" : "MANUAL_REVIEW_DO_NOT_DELETE",
      };
    })
    .sort((left, right) => left.command.localeCompare(right.command));
}

function markdownCell(values) {
  if (Array.isArray(values)) return values.length ? values.join("<br>") : "—";
  return String(values ?? "—").replaceAll("|", "\\|");
}

function printMarkdown(inventory) {
  console.log("| Command/export | Kind | Declared in | Installed? | Static caller | Dynamic/string caller | HTML caller | Test-only | Action |");
  console.log("|---|---|---|---:|---|---|---|---:|---|");
  for (const row of inventory) {
    console.log(`| ${markdownCell(row.command)} | ${row.kind} | ${markdownCell(row.declaredIn)} | yes | ${markdownCell(row.staticCallers)} | ${markdownCell(row.dynamicCallers)} | ${markdownCell(row.htmlCallers)} | ${row.testOnly ? "yes" : "no"} | ${row.action} |`);
  }
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const inventory = await buildControllerCommandInventory(projectRoot);
  if (process.argv.includes("--markdown")) printMarkdown(inventory);
  else console.log(JSON.stringify({ count: inventory.length, inventory }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await main();
}
