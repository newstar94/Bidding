import fs from "node:fs";
import path from "node:path";
import { parse } from "acorn";

const root = path.resolve(import.meta.dirname, "..");
const frontend = path.join(root, "frontend");
const trustedTypesFile = path.join(frontend, "shared", "trustedTypes.js");

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? filesUnder(target)
      : (entry.isFile() && entry.name.endsWith(".js") ? [target] : []);
  });
}

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) value.forEach((item) => walk(item, visitor));
    else if (value && typeof value.type === "string") walk(value, visitor);
  }
}

function isHtmlSinkMember(node) {
  return node?.type === "MemberExpression"
    && !node.computed
    && ["innerHTML", "outerHTML"].includes(node.property?.name);
}

function isAlreadyTrusted(node) {
  return node?.type === "CallExpression"
    && node.callee?.type === "Identifier"
    && node.callee.name === "trustedHTML";
}

let changedFiles = 0;
let wrappedSinks = 0;
for (const file of filesUnder(frontend)) {
  if (path.resolve(file) === trustedTypesFile) continue;
  const source = fs.readFileSync(file, "utf8");
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowHashBang: true
  });
  const edits = [];
  walk(ast, (node) => {
    if (
      node.type === "AssignmentExpression"
      && node.operator === "="
      && isHtmlSinkMember(node.left)
      && !isAlreadyTrusted(node.right)
    ) {
      edits.push({ start: node.right.start, end: node.right.end });
    }
    if (
      node.type === "CallExpression"
      && node.callee?.type === "MemberExpression"
      && !node.callee.computed
      && node.callee.property?.name === "insertAdjacentHTML"
      && node.arguments.length >= 2
      && !isAlreadyTrusted(node.arguments[1])
    ) {
      edits.push({ start: node.arguments[1].start, end: node.arguments[1].end });
    }
  });
  if (!edits.length) continue;

  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, edit.start)}trustedHTML(${output.slice(edit.start, edit.end)})${output.slice(edit.end)}`;
  }
  const relative = path.relative(path.dirname(file), trustedTypesFile)
    .replaceAll(path.sep, "/");
  const importPath = relative.startsWith(".") ? relative : `./${relative}`;
  output = `import { trustedHTML } from "${importPath}";\n${output}`;
  fs.writeFileSync(file, output, "utf8");
  changedFiles += 1;
  wrappedSinks += edits.length;
}

const flatpickrFile = path.join(root, "views", "vendor", "flatpickr", "flatpickr.min.js");
const flatpickrSource = fs.readFileSync(flatpickrFile, "utf8");
const flatpickrAst = parse(flatpickrSource, {
  ecmaVersion: "latest",
  sourceType: "script"
});
const vendorEdits = [];
walk(flatpickrAst, (node) => {
  if (
    node.type === "AssignmentExpression"
    && node.operator === "="
    && isHtmlSinkMember(node.left)
    && !(
      node.right?.type === "CallExpression"
      && node.right.callee?.type === "MemberExpression"
      && node.right.callee.property?.name === "__BF_TRUSTED_HTML__"
    )
  ) {
    vendorEdits.push({ start: node.right.start, end: node.right.end });
  }
});
if (vendorEdits.length) {
  let output = flatpickrSource;
  for (const edit of vendorEdits.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, edit.start)}globalThis.__BF_TRUSTED_HTML__(${output.slice(edit.start, edit.end)})${output.slice(edit.end)}`;
  }
  fs.writeFileSync(flatpickrFile, output, "utf8");
}

process.stdout.write(
  `Wrapped ${wrappedSinks} first-party sinks in ${changedFiles} files and ${vendorEdits.length} Flatpickr sinks.\n`
);
