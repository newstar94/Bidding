import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';


const profilePath = __ENV.BF_LOAD_PROFILE || '../profiles/mixed-100.json';
const profile = JSON.parse(open(profilePath));
const baseUrl = (__ENV.BF_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const summaryPath = __ENV.BF_SUMMARY_PATH || 'load-summary.json';

function fail(message) {
  throw new Error(`Load safety check failed: ${message}`);
}

function hostFromUrl(value) {
  const match = value.match(/^https?:\/\/([^/:?#]+)(?::\d+)?(?:[/?#]|$)/i);
  return match ? match[1].toLowerCase() : '';
}

function requireSafeTarget() {
  const host = hostFromUrl(baseUrl);
  const localHosts = ['127.0.0.1', 'localhost', '::1'];
  if (!host) {
    fail('BF_BASE_URL must be an absolute HTTP(S) URL');
  }
  if (__ENV.BF_LOAD_RUN_ACK !== profile.name) {
    fail(`set BF_LOAD_RUN_ACK exactly to '${profile.name}'`);
  }
  if (localHosts.indexOf(host) !== -1) {
    return;
  }
  const environment = (__ENV.BF_LOAD_ENVIRONMENT || '').toLowerCase();
  if (environment === 'production') {
    fail('production targets are intentionally prohibited');
  }
  if (environment !== 'staging' && environment !== 'performance') {
    fail("non-local targets require BF_LOAD_ENVIRONMENT='staging' or 'performance'");
  }
  if (__ENV.BF_LOAD_TARGET_ACK !== host) {
    fail('BF_LOAD_TARGET_ACK must exactly match the non-local target hostname');
  }
  if (!baseUrl.toLowerCase().startsWith('https://') && __ENV.BF_LOAD_ALLOW_HTTP !== '1') {
    fail('non-local targets require HTTPS (or explicit BF_LOAD_ALLOW_HTTP=1)');
  }
}

function parseArrayFile(path, key, label) {
  if (!path) {
    return [];
  }
  const payload = JSON.parse(open(path));
  const values = Array.isArray(payload) ? payload : payload[key];
  if (!Array.isArray(values)) {
    fail(`${label} file must contain a '${key}' array`);
  }
  return values;
}

function scenarioEnabled(name) {
  return Boolean(profile.scenarios[name] && profile.scenarios[name].enabled);
}

requireSafeTarget();

const sessions = parseArrayFile(__ENV.BF_SESSIONS_FILE, 'sessions', 'sessions');
const loginUsers = parseArrayFile(__ENV.BF_LOGIN_USERS_FILE, 'users', 'login users');
const authenticatedScenarioEnabled = ['pagination', 'sync', 'upload', 'export', 'websocket']
  .some((name) => scenarioEnabled(name));

if (authenticatedScenarioEnabled && sessions.length < profile.target.minDistinctSessions) {
  fail(`at least ${profile.target.minDistinctSessions} distinct staging sessions are required`);
}
if (scenarioEnabled('login') && loginUsers.length < profile.target.minDistinctLoginUsers) {
  fail(`at least ${profile.target.minDistinctLoginUsers} distinct staging login users are required`);
}
const distinctCookies = new Set(sessions.map((session) => String((session && session.cookie) || '').trim()));
if (authenticatedScenarioEnabled && distinctCookies.size < profile.target.minDistinctSessions) {
  fail(`at least ${profile.target.minDistinctSessions} distinct cookie values are required`);
}
const distinctUsernames = new Set(
  loginUsers.map((user) => String((user && user.username) || '').trim().toLowerCase()),
);
if (scenarioEnabled('login') && distinctUsernames.size < profile.target.minDistinctLoginUsers) {
  fail(`at least ${profile.target.minDistinctLoginUsers} distinct login usernames are required`);
}
for (let index = 0; index < sessions.length; index += 1) {
  const session = sessions[index];
  if (!session || !session.cookie) {
    fail(`sessions[${index}].cookie is required`);
  }
  if (scenarioEnabled('websocket') && !session.organizationId) {
    fail(`sessions[${index}].organizationId is required for WebSocket load`);
  }
  const requiredExportId = profile.runtime.exportType === 'plan' ? 'planId' : 'packageId';
  if (scenarioEnabled('export') && !session[requiredExportId]) {
    fail(`sessions[${index}].${requiredExportId} is required for export load`);
  }
}
for (let index = 0; index < loginUsers.length; index += 1) {
  const user = loginUsers[index];
  if (!user || !user.username || typeof user.password !== 'string') { // pragma: allowlist secret
    fail(`users[${index}] requires username and password`);
  }
}

const syncPayload = __ENV.BF_SYNC_FIXTURE
  ? JSON.parse(open(__ENV.BF_SYNC_FIXTURE))
  : profile.runtime.safeSyncPayload;
if (!syncPayload || typeof syncPayload !== 'object' || Array.isArray(syncPayload)) {
  fail('sync payload must be a JSON object');
}

const uploadBytes = scenarioEnabled('upload')
  ? (__ENV.BF_UPLOAD_FIXTURE ? open(__ENV.BF_UPLOAD_FIXTURE, 'b') : null)
  : null;
if (scenarioEnabled('upload') && !uploadBytes) {
  fail('BF_UPLOAD_FIXTURE is required when the upload scenario is enabled');
}

const server5xx = new Rate('server_5xx_rate');
const throttled429 = new Rate('throttled_429_rate');
const unexpectedFailure = new Rate('unexpected_failure_rate');
const recoveryFailure = new Rate('recovery_failure_rate');
const snapshotConflict = new Rate('snapshot_conflict_rate');
const readLatency = new Trend('read_latency_ms', true);
const syncLatency = new Trend('sync_latency_ms', true);
const exportLatency = new Trend('export_latency_ms', true);
const recoveryLatency = new Trend('recovery_latency_ms', true);
const loginLatency = new Trend('login_latency_ms', true);
const uploadLatency = new Trend('upload_latency_ms', true);
const websocketConnectLatency = new Trend('websocket_connect_latency_ms', true);

function duration(seconds) {
  return `${seconds}s`;
}

function arrivalScenario(name, execName) {
  const config = profile.scenarios[name];
  const phases = profile.phases;
  return {
    executor: 'ramping-arrival-rate',
    exec: execName,
    startRate: Math.max(1, Math.floor(config.ratePerMinute / 4)),
    timeUnit: '1m',
    preAllocatedVUs: config.preAllocatedVUs,
    maxVUs: config.maxVUs,
    gracefulStop: '30s',
    stages: [
      { duration: duration(phases.warmupSeconds), target: config.ratePerMinute },
      { duration: duration(phases.steadySeconds), target: config.ratePerMinute },
      { duration: duration(phases.burstSeconds), target: config.burstRatePerMinute },
      { duration: duration(phases.recoverySeconds), target: config.ratePerMinute },
    ],
  };
}

function websocketScenario() {
  const config = profile.scenarios.websocket;
  const phases = profile.phases;
  return {
    executor: 'ramping-vus',
    exec: 'websocketFlow',
    startVUs: 0,
    gracefulRampDown: '30s',
    gracefulStop: '30s',
    stages: [
      { duration: duration(phases.warmupSeconds), target: config.baseVUs },
      { duration: duration(phases.steadySeconds), target: config.baseVUs },
      { duration: duration(phases.burstSeconds), target: config.burstVUs },
      { duration: duration(phases.recoverySeconds), target: config.baseVUs },
    ],
  };
}

function recoveryScenario() {
  const config = profile.scenarios.recovery;
  const phases = profile.phases;
  const startSeconds = phases.warmupSeconds + phases.steadySeconds + phases.burstSeconds;
  return {
    executor: 'constant-arrival-rate',
    exec: 'recoveryProbe',
    rate: config.ratePerMinute,
    timeUnit: '1m',
    duration: duration(phases.recoverySeconds),
    startTime: duration(startSeconds),
    preAllocatedVUs: config.preAllocatedVUs,
    maxVUs: config.maxVUs,
    gracefulStop: '10s',
  };
}

const scenarios = {};
for (const name of ['login', 'pagination', 'sync', 'upload', 'export']) {
  if (scenarioEnabled(name)) {
    const execNames = {
      login: 'loginFlow',
      pagination: 'paginationFlow',
      sync: 'syncFlow',
      upload: 'uploadFlow',
      export: 'exportFlow',
    };
    scenarios[name] = arrivalScenario(name, execNames[name]);
  }
}
if (scenarioEnabled('websocket')) {
  scenarios.websocket = websocketScenario();
}
if (scenarioEnabled('recovery')) {
  scenarios.recovery = recoveryScenario();
}

const slo = profile.thresholds;
export const options = {
  scenarios,
  discardResponseBodies: true,
  thresholds: {
    server_5xx_rate: [`rate<${slo.server5xxRate}`],
    throttled_429_rate: [`rate<${slo.throttled429Rate}`],
    unexpected_failure_rate: [`rate<${slo.unexpectedFailureRate}`],
    recovery_failure_rate: [`rate<${slo.recoveryFailureRate}`],
    snapshot_conflict_rate: [`rate<${slo.snapshotConflictRate}`],
    read_latency_ms: [`p(95)<${slo.readP95Ms}`, `p(99)<${slo.readP99Ms}`],
    sync_latency_ms: [`p(95)<${slo.syncP95Ms}`, `p(99)<${slo.syncP99Ms}`],
    export_latency_ms: [`p(95)<${slo.exportP95Ms}`, `p(99)<${slo.exportP99Ms}`],
    recovery_latency_ms: [`p(95)<${slo.recoveryP95Ms}`, `p(99)<${slo.recoveryP99Ms}`],
    dropped_iterations: ['count==0'],
  },
};

function cookieHeader(value) {
  const raw = String(value || '').trim();
  return raw.includes('=') ? raw : `session_token=${raw}`;
}

function sessionForVu() {
  return sessions[(__VU - 1) % sessions.length];
}

function loginUserForVu() {
  return loginUsers[(__VU - 1) % loginUsers.length];
}

function authParams(session, tags, extraHeaders, extraOptions) {
  return Object.assign({
    headers: Object.assign(
      {
        Cookie: cookieHeader(session.cookie),
        Origin: baseUrl,
      },
      extraHeaders || {},
    ),
    tags,
    redirects: 0,
    timeout: '30s',
  }, extraOptions || {});
}

function recordResponse(response, latencyMetric, expectedStatuses) {
  const status = response.status;
  const throttled = status === 429;
  const expected = expectedStatuses.indexOf(status) !== -1;
  server5xx.add(status >= 500 && status <= 599);
  throttled429.add(throttled);
  unexpectedFailure.add(!expected && !throttled);
  if (latencyMetric) {
    latencyMetric.add(response.timings.duration);
  }
  return expected || throttled;
}

export function loginFlow() {
  const user = loginUserForVu();
  const response = http.post(
    `${baseUrl}/api/auth/login`,
    JSON.stringify({ username: user.username, password: user.password, remember: false }),
    {
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      tags: { operation: 'login' },
      redirects: 0,
      timeout: '20s',
    },
  );
  check(response, { 'login accepted or throttled': (item) => recordResponse(item, loginLatency, [200]) });

  const cookieValues = response.cookies && response.cookies.session_token;
  if (response.status === 200 && cookieValues && cookieValues.length > 0) {
    const logout = http.post(
      `${baseUrl}/api/auth/logout`,
      null,
      {
        headers: { Cookie: `session_token=${cookieValues[0].value}`, Origin: baseUrl },
        tags: { operation: 'login_cleanup_logout' },
        redirects: 0,
        timeout: '10s',
      },
    );
    recordResponse(logout, null, [200]);
  }
}

export function paginationFlow() {
  const session = sessionForVu();
  const table = encodeURIComponent(profile.runtime.pageTable);
  const pageSize = encodeURIComponent(profile.runtime.pageSize);
  const response = http.get(
    `${baseUrl}/api/paginate?table=${table}&page=1&pageSize=${pageSize}`,
    authParams(session, { operation: 'pagination' }),
  );
  check(response, { 'pagination accepted or throttled': (item) => recordResponse(item, readLatency, [200]) });
}

export function syncFlow() {
  const session = sessionForVu();
  const response = http.post(
    `${baseUrl}/api/sync`,
    JSON.stringify(syncPayload),
    authParams(
      session,
      { operation: 'sync' },
      { 'Content-Type': 'application/json' },
    ),
  );
  check(response, { 'sync accepted or throttled': (item) => recordResponse(item, syncLatency, [200]) });
}

export function uploadFlow() {
  const session = sessionForVu();
  const response = http.post(
    `${baseUrl}/api/templates/upload`,
    { file: http.file(uploadBytes, 'load-test-template.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') },
    authParams(session, { operation: 'template_upload' }),
  );
  check(response, { 'upload accepted or throttled': (item) => recordResponse(item, uploadLatency, [200]) });
}

function exportPath(session, snapshotVersion) {
  const encodedSnapshot = encodeURIComponent(snapshotVersion);
  if (profile.runtime.exportType === 'plan' && session.planId) {
    return `/api/export-plan/${encodeURIComponent(session.planId)}?snapshotVersion=${encodedSnapshot}`;
  }
  if (profile.runtime.exportType === 'timeline' && session.packageId) {
    return `/api/export-timeline/${encodeURIComponent(session.packageId)}?snapshotVersion=${encodedSnapshot}`;
  }
  return `/api/export-report/${encodeURIComponent(session.packageId)}?type=${encodeURIComponent(profile.runtime.exportType)}&snapshotVersion=${encodedSnapshot}`;
}

function prepareExportSnapshot(session) {
  const response = http.get(
    `${baseUrl}/api/sync-version`,
    authParams(session, { operation: 'export_snapshot_read' }, null, { responseType: 'text' }),
  );
  const accepted = recordResponse(response, readLatency, [200]);
  if (!accepted || response.status !== 200) {
    return null;
  }
  try {
    const payload = response.json();
    const version = String(payload.syncVersion ?? '');
    if (!/^\d+$/.test(version)) {
      unexpectedFailure.add(true);
      return null;
    }
    return version;
  } catch (_error) {
    unexpectedFailure.add(true);
    return null;
  }
}

function requestExport(session, snapshotVersion) {
  return http.get(
    `${baseUrl}${exportPath(session, snapshotVersion)}`,
    authParams(session, { operation: 'word_export' }),
  );
}

export function exportFlow() {
  const session = sessionForVu();
  let snapshotVersion = prepareExportSnapshot(session);
  if (snapshotVersion === null) return;

  let response = requestExport(session, snapshotVersion);
  const conflicted = response.status === 409;
  snapshotConflict.add(conflicted);
  if (conflicted) {
    recordResponse(response, exportLatency, [409]);
    snapshotVersion = prepareExportSnapshot(session);
    if (snapshotVersion === null) return;
    response = requestExport(session, snapshotVersion);
  }
  check(response, { 'export accepted or throttled': (item) => recordResponse(item, exportLatency, [200]) });
}

export function websocketFlow() {
  const session = sessionForVu();
  const websocketUrl = baseUrl.replace(/^http/i, 'ws') + '/ws/sync';
  const startedAt = Date.now();
  const response = ws.connect(
    websocketUrl,
    {
      headers: {
        Cookie: cookieHeader(session.cookie),
        Origin: baseUrl,
      },
      tags: { operation: 'websocket' },
    },
    (socket) => {
      socket.on('open', () => {
        websocketConnectLatency.add(Date.now() - startedAt);
        socket.send(JSON.stringify({ action: 'auth', organizationId: session.organizationId }));
      });
      socket.on('message', (message) => {
        if (String(message).includes('"type":"ping"')) {
          socket.send('{"type":"pong"}');
        }
      });
      socket.setTimeout(() => socket.close(), 30_000);
    },
  );
  const accepted = response && response.status === 101;
  const status = response ? response.status : 0;
  server5xx.add(status >= 500 && status <= 599);
  throttled429.add(status === 429);
  unexpectedFailure.add(!accepted && status !== 429);
  check(response, { 'WebSocket upgrade accepted or throttled': () => accepted || status === 429 });
  sleep(0.1);
}

export function recoveryProbe() {
  const response = http.get(`${baseUrl}/health/live`, {
    tags: { operation: 'event_loop_recovery' },
    redirects: 0,
    timeout: '3s',
  });
  const healthy = response.status === 200;
  recoveryLatency.add(response.timings.duration);
  recoveryFailure.add(!healthy);
  server5xx.add(response.status >= 500 && response.status <= 599);
  throttled429.add(response.status === 429);
  unexpectedFailure.add(!healthy && response.status !== 429);
  check(response, { 'event loop recovered': () => healthy });
}

function metricSnapshot(data, name) {
  const metric = data.metrics[name];
  return metric ? metric.values : null;
}

function thresholdsPassed(data) {
  for (const metric of Object.values(data.metrics)) {
    if (!metric.thresholds) {
      continue;
    }
    for (const threshold of Object.values(metric.thresholds)) {
      if (threshold && threshold.ok === false) {
        return false;
      }
    }
  }
  return true;
}

export function handleSummary(data) {
  const passed = thresholdsPassed(data);
  const result = {
    schemaVersion: 1,
    profile: profile.name,
    generatedAt: new Date().toISOString(),
    passed,
    targetConcurrentActiveUsers: profile.target.concurrentActiveUsers,
    configuredPhases: profile.phases,
    configuredThresholds: profile.thresholds,
    metrics: {
      server5xxRate: metricSnapshot(data, 'server_5xx_rate'),
      throttled429Rate: metricSnapshot(data, 'throttled_429_rate'),
      unexpectedFailureRate: metricSnapshot(data, 'unexpected_failure_rate'),
      recoveryFailureRate: metricSnapshot(data, 'recovery_failure_rate'),
      snapshotConflictRate: metricSnapshot(data, 'snapshot_conflict_rate'),
      readLatencyMs: metricSnapshot(data, 'read_latency_ms'),
      syncLatencyMs: metricSnapshot(data, 'sync_latency_ms'),
      exportLatencyMs: metricSnapshot(data, 'export_latency_ms'),
      recoveryLatencyMs: metricSnapshot(data, 'recovery_latency_ms'),
      websocketConnectLatencyMs: metricSnapshot(data, 'websocket_connect_latency_ms'),
      droppedIterations: metricSnapshot(data, 'dropped_iterations'),
      iterations: metricSnapshot(data, 'iterations'),
      requests: metricSnapshot(data, 'http_reqs'),
    },
  };
  return {
    [summaryPath]: `${JSON.stringify(result, null, 2)}\n`,
    stdout: `BiddingFlow load gate ${passed ? 'PASSED' : 'FAILED'} (${profile.name}).\n`,
  };
}
