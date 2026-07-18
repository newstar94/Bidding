import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApiError,
  apiFetch,
  configureApiClient,
  deleteJson,
  getJson,
  postJson,
  putJson,
  resetApiClientConfiguration
} from '../../frontend/shared/apiClient.js';

function response({ status = 200, data = null, contentType = 'application/json' } = {}) {
  const create = () => ({
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 404 ? 'Not Found' : 'OK',
    headers: { get: () => contentType },
    async json() { return data; },
    async text() { return typeof data === 'string' ? data : JSON.stringify(data); },
    clone: create
  });
  return create();
}

test('api client reads JSON responses', async () => {
  const result = await getJson('/api/example', {}, async () => response({ data: { ok: true } }));
  assert.deepEqual(result, { ok: true });
});

test('api client serializes JSON request bodies', async () => {
  let received;
  await postJson('/api/example', { name: 'BiddingFlow' }, {}, async (_url, options) => {
    received = options;
    return response({ status: 201, data: { saved: true } });
  });
  assert.equal(received.method, 'POST');
  assert.equal(received.headers.get('Content-Type'), 'application/json');
  assert.equal(received.body, JSON.stringify({ name: 'BiddingFlow' }));
});

test('api client sends PUT and DELETE requests through the shared transport', async () => {
  const methods = [];
  const fetchImpl = async (_url, options) => {
    methods.push({ method: options.method, body: options.body });
    return response({ data: { ok: true } });
  };
  await putJson('/api/example/1', { name: 'Updated' }, {}, fetchImpl);
  await deleteJson('/api/example/1', null, {}, fetchImpl);
  assert.deepEqual(methods, [
    { method: 'PUT', body: JSON.stringify({ name: 'Updated' }) },
    { method: 'DELETE', body: null }
  ]);
});

test('api client exposes server validation errors consistently', async () => {
  await assert.rejects(
    () => getJson('/api/missing', {}, async () => response({ status: 404, data: { error: 'Không tìm thấy dữ liệu' } })),
    error => error instanceof ApiError && error.status === 404 && error.message === 'Không tìm thấy dữ liệu'
  );
});

test('authenticated writes bootstrap a CSRF cookie and send its token', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { cookie: '' };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url === '/api/auth/check-session') {
      globalThis.document.cookie = 'csrf_token=csrf-from-server';
      return response({ data: { valid: true } });
    }
    return response({ data: { success: true, username: 'google_user' } });
  };

  try {
    const result = await postJson(
      '/api/auth/set-username',
      { username: 'google_user' },
      {},
      fetchImpl
    );

    assert.equal(result.username, 'google_user');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, '/api/auth/check-session');
    assert.equal(requests[1].options.headers.get('X-CSRF-Token'), 'csrf-from-server');
    assert.equal(requests[1].options.credentials, 'same-origin');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('CSRF-exempt login requests do not bootstrap or attach a token', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { cookie: '' };
  const requests = [];

  try {
    await postJson('/api/auth/google-login', { credential: 'google-token' }, {}, async (url, options) => {
      requests.push({ url, options });
      return response({ data: { success: true } });
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/auth/google-login');
    assert.equal(requests[0].options.headers.has('X-CSRF-Token'), false);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('api transport binds the active organization without trusting legacy identity headers', async () => {
  let received;
  configureApiClient({ activeOrganization: () => 'org one' });
  try {
    await apiFetch('/api/example', {
      headers: { 'X-Session-Token': 'legacy', 'X-Username': 'legacy-user' }
    }, async (_url, options) => {
      received = options;
      return response({ data: { ok: true } });
    });
    assert.equal(received.credentials, 'same-origin');
    assert.equal(received.headers.get('X-Active-Org'), 'org%20one');
    assert.equal(received.headers.has('X-Session-Token'), false);
    assert.equal(received.headers.has('X-Username'), false);
  } finally {
    resetApiClientConfiguration();
  }
});

test('unsafe requests are not retried unless an idempotency key is supplied', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { cookie: 'csrf_token=csrf' };
  let unsafeAttempts = 0;
  let idempotentAttempts = 0;
  try {
    const unsafeResponse = await apiFetch('/api/example', { method: 'POST' }, async () => {
      unsafeAttempts += 1;
      return response({ status: 503, data: { error: 'busy' } });
    });
    const idempotentResponse = await apiFetch('/api/example', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'request-1' }
    }, async () => {
      idempotentAttempts += 1;
      return response({
        status: idempotentAttempts === 1 ? 503 : 200,
        data: { ok: true }
      });
    });
    assert.equal(unsafeResponse.status, 503);
    assert.equal(unsafeAttempts, 1);
    assert.equal(idempotentResponse.status, 200);
    assert.equal(idempotentAttempts, 2);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('401, 403, 409 and 429 responses use one recovery adapter', async () => {
  const statuses = [];
  configureApiClient({
    onHttpError: ({ response: failedResponse, data }) => {
      statuses.push([failedResponse.status, data.error]);
      return null;
    }
  });
  try {
    for (const status of [401, 403, 409, 429]) {
      await apiFetch('/api/example', { retries: 0 }, async () => (
        response({ status, data: { error: `error-${status}` } })
      ));
    }
    assert.deepEqual(statuses, [
      [401, 'error-401'],
      [403, 'error-403'],
      [409, 'error-409'],
      [429, 'error-429']
    ]);
  } finally {
    resetApiClientConfiguration();
  }
});
