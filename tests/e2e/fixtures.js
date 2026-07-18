import { expect, test as base } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HOST = '127.0.0.1';
const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = 'e2e-only-password-2026';

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on('error', reject);
  server.listen(0, HOST, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(error => error ? reject(error) : resolve(port));
  });
});

const waitForReady = async (baseURL, child, output) => {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Isolated E2E server exited (${child.exitCode}).\n${output.join('')}`);
    }
    try {
      const response = await fetch(`${baseURL}/health/ready`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Startup/migration is still in progress.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Isolated E2E server did not become ready.\n${output.join('')}`);
};

const stopProcess = async child => {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
};

export const test = base.extend({
  serverInfo: [async ({}, use, workerInfo) => {
    const runtimeRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), `biddingflow-e2e-w${workerInfo.workerIndex}-`),
    );
    const databasePath = path.join(runtimeRoot, 'database', 'bidding.db');
    if (!path.isAbsolute(databasePath) || databasePath.startsWith(process.cwd())) {
      throw new Error('E2E database guard rejected a non-isolated path.');
    }
    const port = await reservePort();
    const baseURL = `http://${HOST}:${port}`;
    const environment = {
      ...process.env,
      APP_DEBUG: 'True',
      APP_ENV: 'test',
      APP_HOST: HOST,
      APP_PORT: String(port),
      APP_SECURE_COOKIES: 'False',
      ADMIN_USERNAME: E2E_USERNAME,
      ADMIN_PASSWORD: E2E_PASSWORD,
      ADMIN_EMAIL: `e2e-worker-${workerInfo.workerIndex}@localhost`,
      DEFAULT_ORG_NAME: `E2E Organization ${workerInfo.workerIndex}`,
      BIDDING_DB_PATH: databasePath,
      BIDDING_DATA_DIR: path.join(runtimeRoot, 'data'),
      BIDDING_BACKUP_DIR: path.join(runtimeRoot, 'backups'),
      BIDDING_LOG_DIR: path.join(runtimeRoot, 'logs'),
      BIDDING_TEMPLATE_DATA_DIR: path.join(runtimeRoot, 'templates'),
      BIDDING_UPLOAD_DIR: path.join(runtimeRoot, 'templates', 'images'),
      BIDDING_WORD_TEMPLATE_DIR: path.join(runtimeRoot, 'templates', 'words'),
      BIDDING_RESTORE_DRILL_STATE_FILE: path.join(runtimeRoot, 'restore-drill.json'),
      DOCUMENT_WORKER_TEMP_DIR: path.join(runtimeRoot, 'document-temp'),
      // Each worker owns a different disposable database.  Inheriting a
      // developer/production checkpoint would make one database validate
      // against another database's audit-chain head.
      AUDIT_CHECKPOINT_DIR: '',
      AUDIT_CHECKPOINT_HMAC_KEY: '',
      AUDIT_CHECKPOINT_OFFHOST_CONFIRMED: 'false',
      GOOGLE_CLIENT_ID: '',
      PYTHONDONTWRITEBYTECODE: '1',
    };
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3');
    const child = spawn(
      python,
      ['-m', 'uvicorn', 'backend.app:app', '--host', HOST, '--port', String(port), '--no-proxy-headers'],
      {
      cwd: process.cwd(),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      },
    );
    const output = [];
    const rememberOutput = chunk => {
      output.push(chunk.toString());
      if (output.length > 40) output.shift();
    };
    child.stdout.on('data', rememberOutput);
    child.stderr.on('data', rememberOutput);

    try {
      await waitForReady(baseURL, child, output);
      await use({
        baseURL,
        credentials: { username: E2E_USERNAME, password: E2E_PASSWORD },
        databasePath,
        runtimeRoot,
      });
    } finally {
      await stopProcess(child);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  }, { scope: 'worker' }],
  baseURL: async ({ serverInfo }, use) => use(serverInfo.baseURL),
  credentials: async ({ serverInfo }, use) => use(serverInfo.credentials),
});

export { expect };
