import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';
import { setImmediate, setTimeout } from 'node:timers';
import { getConfig } from '../src/config.js';
import {
  ALLOWED_CORS_HEADERS,
  ALLOWED_CORS_METHODS,
  BASELINE_SECURITY_HEADERS,
  CORRELATION_ID_HEADER,
  createApiServer,
  isJsonContentType,
  MAX_REQUEST_BODY_BYTES,
  readJsonBody,
  REQUEST_ID_HEADER,
  resolveCorrelationId,
} from '../src/server.js';
import {
  registerGracefulShutdown,
  SHUTDOWN_GRACE_MS,
} from '../src/start.js';
import {
  createStellarBoundary,
  getStellarNetworkDescriptor,
} from '../src/stellar-client.js';

function rawRequest(port, path, method = 'GET', headers = {}, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path, method, headers },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: raw,
          });
        });
      },
    );

    request.on('error', reject);
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}

function createFakeBodyRequest(headers) {
  const request = new EventEmitter();
  request.headers = headers;
  request.resume = () => {
    request.resumed = true;
  };
  return request;
}

function createFakeHttpServer() {
  const server = new EventEmitter();
  server.calls = { close: 0, idle: 0, all: 0 };
  server.close = (callback) => {
    server.calls.close += 1;
    server.closeCallback = callback;
  };
  server.closeIdleConnections = () => {
    server.calls.idle += 1;
  };
  server.closeAllConnections = () => {
    server.calls.all += 1;
  };
  return server;
}

test('configuration validates ports and remote endpoint protocols', () => {
  assert.throws(() => getConfig({ API_PORT: '70000' }), /API_PORT/);
  assert.throws(
    () => getConfig({ STELLAR_RPC_URL: 'http://example.com/rpc' }),
    /HTTPS/,
  );
});

test('Stellar boundary exposes configured public endpoints without network calls', () => {
  const config = getConfig({
    STELLAR_NETWORK: 'TESTNET',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
  });

  assert.deepEqual(
    getStellarNetworkDescriptor(createStellarBoundary(config)),
    {
      network: 'TESTNET',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      rpcUrl: 'https://soroban-testnet.stellar.org',
    },
  );
});

test('HTTP server exposes health and Stellar network routes', async () => {
  const server = createApiServer({ STELLAR_NETWORK: 'TESTNET' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const health = await globalThis.fetch(`${baseUrl}/health`);
    const healthPayload = await health.json();

    assert.equal(health.status, 200);
    assert.deepEqual(healthPayload, { status: 'ok' });

    // Readiness reports ready only after initialization completes.
    const ready = await globalThis.fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready' });

    const stellar = await globalThis.fetch(`${baseUrl}/stellar/network`);
    const stellarPayload = await stellar.json();

    assert.equal(stellar.status, 200);
    assert.equal(stellarPayload.network, 'TESTNET');
    assert.match(stellarPayload.horizonUrl, /^https:\/\//);
    assert.match(stellarPayload.rpcUrl, /^https:\/\//);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('health route rejects invalid HTTP methods', async () => {
  const server = createApiServer({ STELLAR_NETWORK: 'TESTNET' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');

    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Test POST to /health
    const postResponse = await globalThis.fetch(`${baseUrl}/health`, {
      method: 'POST',
    });
    assert.equal(postResponse.status, 404);
    const postPayload = await postResponse.json();
    assert.deepEqual(postPayload, { error: 'not_found' });

    // Test PUT to /health
    const putResponse = await globalThis.fetch(`${baseUrl}/health`, {
      method: 'PUT',
    });
    assert.equal(putResponse.status, 404);
    const putPayload = await putResponse.json();
    assert.deepEqual(putPayload, { error: 'not_found' });

    // Test DELETE to /health
    const deleteResponse = await globalThis.fetch(`${baseUrl}/health`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 404);
    const deletePayload = await deleteResponse.json();
    assert.deepEqual(deletePayload, { error: 'not_found' });

    // Test PATCH to /health
    const patchResponse = await globalThis.fetch(`${baseUrl}/health`, {
      method: 'PATCH',
    });
    assert.equal(patchResponse.status, 404);
    const patchPayload = await patchResponse.json();
    assert.deepEqual(patchPayload, { error: 'not_found' });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('health route rejects invalid paths', async () => {
  const server = createApiServer({ STELLAR_NETWORK: 'TESTNET' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');

    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Test /health with trailing slash
    const trailingSlashResponse = await globalThis.fetch(
      `${baseUrl}/health/`,
    );
    assert.equal(trailingSlashResponse.status, 404);
    const trailingSlashPayload = await trailingSlashResponse.json();
    assert.deepEqual(trailingSlashPayload, { error: 'not_found' });

    // Test /health with extra path segments
    const extraPathResponse = await globalThis.fetch(
      `${baseUrl}/health/status`,
    );
    assert.equal(extraPathResponse.status, 404);
    const extraPathPayload = await extraPathResponse.json();
    assert.deepEqual(extraPathPayload, { error: 'not_found' });

    // Test completely invalid path
    const invalidPathResponse = await globalThis.fetch(`${baseUrl}/invalid`);
    assert.equal(invalidPathResponse.status, 404);
    const invalidPathPayload = await invalidPathResponse.json();
    assert.deepEqual(invalidPathPayload, { error: 'not_found' });

    // Test root path
    const rootResponse = await globalThis.fetch(`${baseUrl}/`);
    assert.equal(rootResponse.status, 404);
    const rootPayload = await rootResponse.json();
    assert.deepEqual(rootPayload, { error: 'not_found' });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('health route response structure remains stable', async () => {
  const server = createApiServer({ STELLAR_NETWORK: 'MAINNET' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const health = await globalThis.fetch(`${baseUrl}/health`);
    const healthPayload = await health.json();

    // Verify the liveness response is status-only (no configuration values).
    assert.equal(typeof healthPayload, 'object');
    assert.deepEqual(Object.keys(healthPayload), ['status']);
    assert.equal(healthPayload.status, 'ok');

    // Readiness reports a stable exact shape.
    const ready = await globalThis.fetch(`${baseUrl}/ready`);
    const readyPayload = await ready.json();
    assert.deepEqual(Object.keys(readyPayload), ['status']);
    assert.equal(readyPayload.status, 'ready');

    // Verify content-type header
    assert.equal(
      health.headers.get('content-type'),
      'application/json',
    );
    assert.equal(
      ready.headers.get('content-type'),
      'application/json',
    );
    assert.equal(
      health.headers.get('x-content-type-options'),
      'nosniff',
    );
    assert.equal(
      health.headers.get('x-frame-options'),
      'DENY',
    );
    assert.equal(
      health.headers.get('referrer-policy'),
      'no-referrer',
    );
    assert.equal(
      health.headers.get('strict-transport-security'),
      null,
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('HTTP server applies baseline security headers to success and error responses without HSTS', async () => {
  const server = createApiServer({ STELLAR_NETWORK: 'TESTNET' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');

    const baseUrl = `http://127.0.0.1:${address.port}`;

    for (const path of ['/health', '/stellar/network', '/non-existent']) {
      const response = await globalThis.fetch(`${baseUrl}${path}`);
      for (const [header, expectedValue] of Object.entries(BASELINE_SECURITY_HEADERS)) {
        assert.equal(
          response.headers.get(header),
          expectedValue,
          `expected header ${header} to match ${expectedValue} on ${path}`,
        );
      }
      assert.equal(
        response.headers.get('strict-transport-security'),
        null,
        `HSTS must not be enabled without an HTTPS deployment context on ${path}`,
      );
      assert.equal(
        response.headers.get('content-type'),
        'application/json',
      );
      const json = await response.json();
      assert.equal(typeof json, 'object');
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('readiness reports unavailable until a delayed initialization completes', async () => {
  let releaseInit;
  const gate = new Promise((resolve) => {
    releaseInit = resolve;
  });

  const server = createApiServer(
    { STELLAR_NETWORK: 'TESTNET' },
    {
      initialize: () => gate,
      initializationTimeoutMs: 5000,
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Readiness is unavailable during initialization.
    const during = await globalThis.fetch(`${baseUrl}/ready`);
    assert.equal(during.status, 503);
    assert.deepEqual(await during.json(), { status: 'unavailable' });

    // Liveness is always available, independent of initialization.
    const alive = await globalThis.fetch(`${baseUrl}/health`);
    assert.equal(alive.status, 200);

    // Recovery: readiness flips to ready once initialization completes.
    releaseInit();
    await gate;
    await new Promise((resolve) => setImmediate(resolve));

    const after = await globalThis.fetch(`${baseUrl}/ready`);
    assert.equal(after.status, 200);
    assert.deepEqual(await after.json(), { status: 'ready' });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('readiness stays unavailable and does not expose internal error details on failure', async () => {
  const server = createApiServer(
    { STELLAR_NETWORK: 'TESTNET' },
    {
      initialize: () =>
        Promise.reject(new Error('secret C:\\internal\\path bootstrap')),
      initializationTimeoutMs: 5000,
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Let the initialization rejection settle.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const ready = await globalThis.fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 503);
    const payload = await ready.json();
    assert.deepEqual(payload, { status: 'unavailable' });
    assert.doesNotMatch(JSON.stringify(payload), /secret|internal|path/i);

    // Liveness still responds; no internal details leak there either.
    const alive = await globalThis.fetch(`${baseUrl}/health`);
    assert.equal(alive.status, 200);
    assert.deepEqual(await alive.json(), { status: 'ok' });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('readiness fails within the bounded initialization timeout', async () => {
  const server = createApiServer(
    { STELLAR_NETWORK: 'TESTNET' },
    {
      initialize: () => new Promise(() => {}), // never settles
      initializationTimeoutMs: 50,
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // The liveness probe answers immediately regardless.
    const alive = await globalThis.fetch(`${baseUrl}/health`);
    assert.equal(alive.status, 200);

    // Wait beyond the configured bound, then readiness must be 503.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const ready = await globalThis.fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), { status: 'unavailable' });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('ready route rejects invalid HTTP methods', async () => {
  const server = createApiServer({ STELLAR_NETWORK: 'TESTNET' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await globalThis.fetch(`${baseUrl}/ready`, { method });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'not_found' });
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('CORS allowlist configuration is restrictive by default and validates origins strictly', () => {
  assert.deepEqual(getConfig({}).corsAllowedOrigins, []);
  assert.deepEqual(
    getConfig({
      API_CORS_ALLOWED_ORIGINS:
        'https://app.example.com, https://admin.example.com, https://app.example.com',
    }).corsAllowedOrigins,
    ['https://app.example.com', 'https://admin.example.com'],
  );

  assert.throws(
    () => getConfig({ API_CORS_ALLOWED_ORIGINS: '*' }),
    /wildcards/,
  );
  assert.throws(
    () => getConfig({ API_CORS_ALLOWED_ORIGINS: 'https://*.example.com' }),
    /wildcards/,
  );
  assert.throws(
    () => getConfig({ API_CORS_ALLOWED_ORIGINS: 'null' }),
    /valid absolute origin/,
  );
  assert.throws(
    () => getConfig({ API_CORS_ALLOWED_ORIGINS: 'https://example.com/app' }),
    /without credentials, path/,
  );
  assert.throws(
    () => getConfig({ API_CORS_ALLOWED_ORIGINS: 'ftp://example.com' }),
    /HTTPS or HTTP/,
  );
  assert.throws(
    () => getConfig({ API_CORS_ALLOWED_ORIGINS: 'https://user@example.com' }),
    /without credentials, path/,
  );
});

test('responses carry a bounded correlation id and reuse only valid incoming ids', async () => {
  const server = createApiServer({});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();

    const reused = await globalThis.fetch(`http://127.0.0.1:${port}/health`, {
      headers: { 'x-correlation-id': 'client-trace.123abc' },
    });
    assert.equal(
      reused.headers.get(CORRELATION_ID_HEADER),
      'client-trace.123abc',
    );
    assert.equal(
      reused.headers.get(REQUEST_ID_HEADER),
      'client-trace.123abc',
    );
    await reused.json();

    const generated = await globalThis.fetch(
      `http://127.0.0.1:${port}/health`,
    );
    const generatedId = generated.headers.get(CORRELATION_ID_HEADER);
    assert.match(generatedId, /^[0-9a-f-]{36}$/);
    assert.equal(generated.headers.get(REQUEST_ID_HEADER), generatedId);
    await generated.json();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('malformed, oversized, and multi-value correlation ids are replaced', async () => {
  assert.match(resolveCorrelationId('has spaces'), /^[0-9a-f-]{36}$/);
  assert.match(resolveCorrelationId('x'.repeat(65)), /^[0-9a-f-]{36}$/);
  assert.match(resolveCorrelationId('bad\r\nInjected: yes'), /^[0-9a-f-]{36}$/);
  assert.match(resolveCorrelationId(['first', 'second']), /^[0-9a-f-]{36}$/);

  const server = createApiServer({});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();

    for (const value of ['has spaces', 'x'.repeat(65), 'id,other', ';bad']) {
      const response = await globalThis.fetch(
        `http://127.0.0.1:${port}/health`,
        { headers: { 'x-correlation-id': value } },
      );
      const actual = response.headers.get(CORRELATION_ID_HEADER);
      assert.match(actual, /^[0-9a-f-]{36}$/);
      assert.notEqual(actual, value);
      await response.json();
    }

    const headers = new Headers();
    headers.append('x-correlation-id', 'first');
    headers.append('x-correlation-id', 'second');
    const repeated = await globalThis.fetch(
      `http://127.0.0.1:${port}/health`,
      { headers },
    );
    assert.match(
      repeated.headers.get(CORRELATION_ID_HEADER),
      /^[0-9a-f-]{36}$/,
    );
    await repeated.json();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('request logs contain only bounded transport metadata and never sensitive inputs', async () => {
  const lines = [];
  const server = createApiServer(
    {},
    { logger: { info: (line) => lines.push(line) } },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();
    const secret = 'super-secret-payload-value';

    const response = await globalThis.fetch(
      `http://127.0.0.1:${port}/health?token=${secret}&password=hunter2`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secret}`,
          cookie: `session=${secret}`,
          'x-correlation-id': 'log-trace-1',
        },
        body: JSON.stringify({ secret, password: 'hunter2' }),
      },
    );

    assert.equal(response.status, 404);
    await response.json();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(record).sort(), [
      'correlationId',
      'durationMs',
      'method',
      'path',
      'status',
    ]);
    assert.equal(record.method, 'POST');
    assert.equal(record.path, '/health');
    assert.equal(record.status, 404);
    assert.equal(record.correlationId, 'log-trace-1');
    assert.equal(typeof record.durationMs, 'number');
    assert.ok(Number.isFinite(record.durationMs) && record.durationMs >= 0);
    assert.doesNotMatch(
      lines[0],
      /super-secret|hunter2|token=|password=|authorization|cookie/i,
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('cross-origin requests and preflight are denied by default', async () => {
  const server = createApiServer({});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();

    const actual = await globalThis.fetch(`http://127.0.0.1:${port}/health`, {
      headers: { origin: 'https://app.example.com' },
    });
    assert.equal(actual.status, 403);
    assert.deepEqual(await actual.json(), { error: 'origin_not_allowed' });
    assert.equal(actual.headers.get('access-control-allow-origin'), null);

    const preflight = await rawRequest(
      port,
      '/health',
      'OPTIONS',
      {
        origin: 'https://app.example.com',
        'access-control-request-method': 'GET',
      },
    );
    assert.equal(preflight.status, 403);
    assert.deepEqual(JSON.parse(preflight.body), {
      error: 'origin_not_allowed',
    });
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);

    const sameOrigin = await globalThis.fetch(
      `http://127.0.0.1:${port}/health`,
    );
    assert.equal(sameOrigin.status, 200);
    assert.equal(sameOrigin.headers.get('access-control-allow-origin'), null);
    await sameOrigin.json();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('explicit CORS allowlist matches origins exactly and rejects spoofed or null origins', async () => {
  const server = createApiServer({
    API_CORS_ALLOWED_ORIGINS:
      'https://app.example.com, https://admin.example.com',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();

    for (const origin of [
      'https://app.example.com',
      'https://admin.example.com',
    ]) {
      const response = await globalThis.fetch(
        `http://127.0.0.1:${port}/health`,
        { headers: { origin } },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('vary'), 'Origin');
      assert.equal(
        response.headers.get('access-control-allow-credentials'),
        null,
      );
      assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
      await response.json();
    }

    for (const origin of [
      'null',
      'https://app.example.com.evil.test',
      'https://app.example.com/',
      'http://app.example.com',
      'https://evil.test/?next=https://app.example.com',
    ]) {
      const response = await rawRequest(port, '/health', 'GET', { origin });
      assert.equal(response.status, 403);
      assert.deepEqual(JSON.parse(response.body), {
        error: 'origin_not_allowed',
      });
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('preflight exposes only intended CORS methods and headers', async () => {
  const server = createApiServer({
    API_CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();

    const allowed = await rawRequest(
      port,
      '/stellar/network',
      'OPTIONS',
      {
        origin: 'https://app.example.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers': `content-type, ${CORRELATION_ID_HEADER}`,
        'x-correlation-id': 'preflight-1',
      },
    );
    assert.equal(allowed.status, 204);
    assert.equal(allowed.body, '');
    assert.equal(
      allowed.headers['access-control-allow-origin'],
      'https://app.example.com',
    );
    assert.equal(
      allowed.headers['access-control-allow-methods'],
      ALLOWED_CORS_METHODS.join(', '),
    );
    assert.equal(
      allowed.headers['access-control-allow-headers'],
      ALLOWED_CORS_HEADERS.join(', '),
    );
    assert.equal(allowed.headers['access-control-max-age'], '600');
    assert.equal(allowed.headers[CORRELATION_ID_HEADER], 'preflight-1');
    assert.equal(allowed.headers['access-control-allow-credentials'], undefined);
    assert.doesNotMatch(JSON.stringify(allowed.headers), /authorization|cookie/i);

    const badMethod = await rawRequest(port, '/health', 'OPTIONS', {
      origin: 'https://app.example.com',
      'access-control-request-method': 'DELETE',
    });
    assert.equal(badMethod.status, 403);
    assert.equal(badMethod.headers['access-control-allow-methods'], undefined);

    const badHeaders = await rawRequest(port, '/health', 'OPTIONS', {
      origin: 'https://app.example.com',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    });
    assert.equal(badHeaders.status, 403);
    assert.equal(badHeaders.headers['access-control-allow-headers'], undefined);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('JSON body validation rejects unsupported media types, malformed JSON, and oversized payloads', async () => {
  const server = createApiServer({}, { maxBodyBytes: 128 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();
    const secret = 'payload-secret-abc123';

    const unsupported = await globalThis.fetch(
      `http://127.0.0.1:${port}/health`,
      {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: secret,
      },
    );
    assert.equal(unsupported.status, 415);
    assert.deepEqual(await unsupported.json(), {
      error: 'unsupported_media_type',
    });

    const malformed = await globalThis.fetch(
      `http://127.0.0.1:${port}/health`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: `{"secret":"${secret}",`,
      },
    );
    assert.equal(malformed.status, 400);
    const malformedPayload = await malformed.json();
    assert.deepEqual(malformedPayload, { error: 'malformed_json' });
    assert.doesNotMatch(JSON.stringify(malformedPayload), /abc123|payload-secret/);

    const oversized = await globalThis.fetch(
      `http://127.0.0.1:${port}/health`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: secret.repeat(20) }),
      },
    );
    assert.equal(oversized.status, 413);
    const oversizedPayload = await oversized.json();
    assert.deepEqual(oversizedPayload, { error: 'payload_too_large' });
    assert.doesNotMatch(JSON.stringify(oversizedPayload), /abc123|payload-secret/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('JSON body reader enforces byte boundaries without unbounded buffering', async () => {
  assert.equal(MAX_REQUEST_BODY_BYTES, 64 * 1024);
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true);
  assert.equal(isJsonContentType('application/jsonp'), false);
  assert.equal(isJsonContentType('text/plain'), false);

  const payload = { data: 'x'.repeat(64) };
  const serialized = JSON.stringify(payload);
  const limit = Buffer.byteLength(serialized);

  const atLimit = createFakeBodyRequest({
    'content-type': 'application/json',
    'content-length': String(limit),
  });
  const atLimitResult = readJsonBody(atLimit, limit);
  atLimit.emit('data', Buffer.from(serialized));
  atLimit.emit('end');
  assert.deepEqual(await atLimitResult, { ok: true, value: payload });
  assert.equal(atLimit.resumed, undefined);

  const overDeclared = createFakeBodyRequest({
    'content-type': 'application/json',
    'content-length': String(limit + 1),
  });
  assert.deepEqual(await readJsonBody(overDeclared, limit), {
    ok: false,
    status: 413,
    error: 'payload_too_large',
  });
  assert.equal(overDeclared.resumed, true);

  const overStreamed = createFakeBodyRequest({
    'content-type': 'application/json',
  });
  const overStreamedResult = readJsonBody(overStreamed, limit);
  overStreamed.emit('data', Buffer.from(serialized.slice(0, 16)));
  overStreamed.emit('data', Buffer.from('x'.repeat(limit)));
  overStreamed.emit('end');
  assert.deepEqual(await overStreamedResult, {
    ok: false,
    status: 413,
    error: 'payload_too_large',
  });
  assert.equal(overStreamed.resumed, true);

  assert.deepEqual(
    await readJsonBody(
      createFakeBodyRequest({ 'content-type': 'text/plain' }),
      limit,
    ),
    { ok: false, status: 415, error: 'unsupported_media_type' },
  );
});

test('graceful shutdown stops accepting work, drains once, and is idempotent', () => {
  assert.equal(SHUTDOWN_GRACE_MS, 10_000);

  const server = createFakeHttpServer();
  const signals = new EventEmitter();
  const exits = [];
  const stop = registerGracefulShutdown(server, {
    signalSource: signals,
    graceMs: 1000,
    exit: (code) => exits.push(code),
    logger: { info() {} },
  });

  signals.emit('SIGINT');
  signals.emit('SIGTERM');
  stop();

  assert.equal(server.calls.close, 1);
  assert.equal(server.calls.idle, 1);
  assert.equal(server.calls.all, 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.deepEqual(exits, []);

  server.closeCallback();
  assert.deepEqual(exits, [0]);
});

test('stuck connections cannot keep graceful shutdown alive past the grace period', async () => {
  const server = createFakeHttpServer();
  const signals = new EventEmitter();
  const exits = [];

  registerGracefulShutdown(server, {
    signalSource: signals,
    graceMs: 20,
    exit: (code) => exits.push(code),
    logger: { info() {} },
  });

  signals.emit('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(server.calls.all, 1);
  assert.deepEqual(exits, [0]);

  server.closeCallback();
  assert.deepEqual(exits, [0]);
});

test('in-flight local requests drain during shutdown and new connections are refused', async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader('connection', 'close');
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('done');
    }, 40);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address();
  const closed = once(server, 'close');
  const signals = new EventEmitter();
  let exitCode;

  registerGracefulShutdown(server, {
    signalSource: signals,
    graceMs: 1000,
    exit: (code) => {
      exitCode = code;
    },
    logger: { info() {} },
  });

  const received = once(server, 'request');
  const inFlight = globalThis.fetch(`http://127.0.0.1:${port}/slow`);
  await received;
  signals.emit('SIGINT');
  await new Promise((resolve) => setImmediate(resolve));

  const response = await inFlight;
  assert.equal(await response.text(), 'done');
  await closed;
  assert.equal(exitCode, 0);
  assert.equal(server.listening, false);
});