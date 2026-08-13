import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse } from "espree";

const scriptsRoot = path.resolve("scripts");
const canonicalE2eScripts = fs.readdirSync(scriptsRoot)
  .filter((name) => (
    /^verify_.+e2e\.mjs$/.test(name)
      || name === "verify_full_lifecycle.mjs"
  ))
  .sort();

function walkSyntax(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => walkSyntax(item, visit));
    else if (value?.type) walkSyntax(value, visit);
  }
}

function hasDomClickInsideEvaluate(source) {
  const syntax = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  let violation = false;
  walkSyntax(syntax, (node) => {
    const property = node?.callee?.property;
    if (
      node.type !== "CallExpression"
      || node.callee?.type !== "MemberExpression"
      || (property?.name || property?.value) !== "evaluate"
    ) return;
    const callback = node.arguments?.[0];
    walkSyntax(callback, (child) => {
      const childProperty = child?.callee?.property;
      if (
        child.type === "CallExpression"
        && child.callee?.type === "MemberExpression"
        && (childProperty?.name || childProperty?.value) === "click"
      ) violation = true;
    });
  });
  return violation;
}


test("canonical E2E harnesses use actionability and condition barriers", () => {
  const violations = [];
  for (const name of canonicalE2eScripts) {
    const source = fs.readFileSync(path.join(scriptsRoot, name), "utf8");
    if (/\.waitForTimeout\s*\(/.test(source)) violations.push(`${name}: waitForTimeout`);
    if (hasDomClickInsideEvaluate(source)) {
      violations.push(`${name}: DOM click through evaluate`);
    }
  }
  assert.deepEqual(violations, []);
});


test("canonical E2E harnesses derive calendar values from the test clock", () => {
  const violations = [];
  for (const name of canonicalE2eScripts) {
    const source = fs.readFileSync(path.join(scriptsRoot, name), "utf8")
      .replace(/\\u[0-9a-f]{4}/gi, "");
    if (/(?<!\d)(?:19|20)\d{2}(?!\d)/.test(source)) {
      violations.push(`${name}: raw calendar year`);
    }
  }
  assert.deepEqual(violations, []);
});


test("plan approval E2E selections use the stable stored value, not its display label", () => {
  for (const name of [
    "verify_crud_modules_e2e.mjs",
    "verify_full_lifecycle.mjs",
  ]) {
    const source = fs.readFileSync(path.join(scriptsRoot, name), "utf8");
    assert.match(
      source,
      /#kh-pheduyet", \{ value: "Dự toán và kế hoạch" \}/u,
      name,
    );
    assert.doesNotMatch(
      source,
      /#kh-pheduyet", \{ label: "Dự toán và kế hoạch" \}/u,
      name,
    );
  }
});
