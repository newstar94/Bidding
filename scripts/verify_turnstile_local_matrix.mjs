import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { findAvailableLoopbackPort } from "./local_e2e_port.mjs";


const cases = [
  {
    expectation: "pass",
    siteKey: "1x00000000000000000000AA",
    secretKey: "1x0000000000000000000000000000000AA",
  },
  {
    expectation: "fail",
    siteKey: "2x00000000000000000000AB",
    secretKey: "2x0000000000000000000000000000000AA",
  },
  {
    expectation: "interactive",
    siteKey: "3x00000000000000000000FF",
    secretKey: "1x0000000000000000000000000000000AA",
  },
  {
    expectation: "slow",
    siteKey: "1x00000000000000000000AA",
    secretKey: "1x0000000000000000000000000000000AA",
  },
  {
    expectation: "script-failure",
    siteKey: "1x00000000000000000000AA",
    secretKey: "1x0000000000000000000000000000000AA",
  },
  {
    expectation: "auto-pending",
    siteKey: "1x00000000000000000000AA",
    secretKey: "1x0000000000000000000000000000000AA",
  },
];


async function waitForServer(url, child, stderr) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Local server exited early (${child.exitCode}): ${stderr.value}`);
    }
    try {
      const response = await fetch(`${url}/health/live`);
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${stderr.value}`);
}


async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}


for (const testCase of cases) {
  const port = await findAvailableLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const stderr = { value: "" };
  const child = spawn(
    process.env.PYTHON || "python",
    [
      "-m", "uvicorn", "backend.app:app",
      "--host", "127.0.0.1",
      "--port", String(port),
      "--no-proxy-headers",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: "development",
        APP_DEBUG: "True",
        TURNSTILE_ENABLED: "true",
        TURNSTILE_SITE_KEY: testCase.siteKey,
        TURNSTILE_SECRET_KEY: testCase.secretKey,
        TURNSTILE_ALLOWED_HOSTNAMES: "localhost,127.0.0.1",
        TURNSTILE_VERIFY_TIMEOUT_SECONDS: "5",
      },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr.value = `${stderr.value}${chunk}`.slice(-4_000);
  });

  try {
    await waitForServer(baseUrl, child, stderr);
    process.env.TURNSTILE_E2E_BASE_URL = baseUrl;
    process.env.TURNSTILE_E2E_EXPECTATION = testCase.expectation;
    await import(`./verify_turnstile_local_e2e.mjs?case=${testCase.expectation}`);
  } finally {
    await stopServer(child);
  }
}

process.stdout.write("Turnstile local browser matrix passed.\n");
