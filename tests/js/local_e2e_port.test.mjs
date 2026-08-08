import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { findAvailableLoopbackPort } from "../../scripts/local_e2e_port.mjs";

test("local E2E allocator never returns an already occupied loopback port", async () => {
  const occupied = net.createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  try {
    const occupiedPort = occupied.address().port;
    const availablePort = await findAvailableLoopbackPort();
    assert.notEqual(availablePort, occupiedPort);
    assert.ok(Number.isInteger(availablePort) && availablePort > 0);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test("Turnstile matrix allocates a fresh port for every isolated server", async () => {
  const source = await readFile(
    new URL("../../scripts/verify_turnstile_local_matrix.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /findAvailableLoopbackPort/);
  assert.doesNotMatch(source, /port:\s*87\d{2}/);
});
