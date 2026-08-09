import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

test("package scripts reference existing local Node entrypoints", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(projectRoot, "package.json"), "utf8"),
  );
  const missing = [];
  for (const [scriptName, command] of Object.entries(packageJson.scripts || {})) {
    const tokens = String(command).match(/[^\s"']+/gu) || [];
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index] !== "node") continue;
      const entrypoint = tokens.slice(index + 1).find((token) => (
        !token.startsWith("-") && /\.(?:cjs|mjs|js)$/u.test(token)
      ));
      if (!entrypoint) continue;
      if (/[*?[\]]/u.test(entrypoint)) continue;
      try {
        await access(resolve(projectRoot, entrypoint));
      } catch {
        missing.push(`${scriptName}:${entrypoint}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});

test("manual performance benchmarks are owned and discoverable", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(projectRoot, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["benchmark:persistence"],
    "node scripts/benchmark_explicit_persistence.mjs",
  );
  assert.equal(
    packageJson.scripts["benchmark:n-plus-one"],
    "python scripts/benchmark_n_plus_one.py",
  );

  const documentation = await readFile(
    resolve(projectRoot, "docs/performance/BENCHMARKS.md"),
    "utf8",
  );
  for (const contract of [
    "npm run benchmark:persistence",
    "npm run benchmark:n-plus-one",
    "rollback",
    "không phải CI pass/fail gate",
  ]) {
    assert.match(documentation, new RegExp(contract, "u"));
  }
});
