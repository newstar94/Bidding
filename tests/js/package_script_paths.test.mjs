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
