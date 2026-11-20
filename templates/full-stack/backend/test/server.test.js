import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { startBackend } from '../src/start.js';
import {
  BASELINE_SECURITY_HEADERS,
  BackendConfigurationError,
  createBackendServer,
  createHealthPayload,
  getBackendConfig,
  MAX_REQUEST_BODY_BYTES,
  validateBackendConfig,
} from '../src/server.js';

test('uses safe Testnet defaults without secrets', () => {
  const config = getBackendConfig({});

  assert.equal(config.network, 'TESTNET');
  assert.equal(config.horizonUrl, 'https://horizon-testnet.stellar.org');
  assert.equal(config.rpcUrl, 'https://soroban-testnet.stellar.org');
  assert.equal(config.port, 3000);
});

test('returns a generated application health payload', () => {
  assert.deepEqual(createHealthPayload({}), {
    status: 'ok',
    app: '{{projectName}}',
    network: 'TESTNET',
  });
});

test('health route answers GET and HEAD with status 200', async () => {
  const server = createBackendServer({ STELLAR_NETWORK: 'TESTNET' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const getRes = await globalThis.fetch(`${baseUrl}/health`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.headers.get('content-type'), 'application/json');
    assert.equal(getRes.headers.get('x-content-type-options'), 'nosniff');
    const getPayload = await getRes.json();
    assert.equal(getPayload.status, 'ok');
    assert.equal(getPayload.app, '{{projectName}}');
    assert.equal(getPayload.network, 'TESTNET');

    const headRes = await globalThis.fetch(`${baseUrl}/health`, {
      method: 'HEAD',
    });
    assert.equal(headRes.status, 200);
    assert.equal(headRes.headers.get('content-type'), 'application/json');
    const headText = await headRes.text();
    assert.equal(headText, '');
  } finally {
    server.close();
  }
});

test('health route returns deterministic 405 with Allow header for unsupported methods', async () => {
  const server = createBackendServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await globalThis.fetch(`${baseUrl}/health`, { method });
      assert.equal(res.status, 405);
      assert.equal(res.headers.get('allow'), 'GET, HEAD');
      assert.equal(res.headers.get('content-type'), 'application/json');
      for (const [header, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
        assert.equal(res.headers.get(header), value);
      }
      const payload = await res.json();
      assert.deepEqual(payload, { error: 'method_not_allowed' });
    }
  } finally {
    server.close();
  }
});

test('unknown routes return safe 404 response without information leakage', async () => {
  const server = createBackendServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    for (const path of ['/', '/unknown', '/health/nested', '/api/not-found']) {
      const getRes = await globalThis.fetch(`${baseUrl}${path}`);
      assert.equal(getRes.status, 404);
      assert.equal(getRes.headers.get('content-type'), 'application/json');
      for (const [header, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
        assert.equal(getRes.headers.get(header), value);
      }
      assert.deepEqual(await getRes.json(), { error: 'not_found' });

      const postRes = await globalThis.fetch(`${baseUrl}${path}`, {
        method: 'POST',
      });
      assert.equal(postRes.status, 404);
      assert.deepEqual(await postRes.json(), { error: 'not_found' });
    }
  } finally {
    server.close();
  }
});

test('POST /api/echo accepts valid JSON and enforces method boundary', async () => {
  const server = createBackendServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Valid POST
    const postRes = await globalThis.fetch(`${baseUrl}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello stellar' }),
    });
    assert.equal(postRes.status, 200);
    for (const [header, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
      assert.equal(postRes.headers.get(header), value);
    }
    const postPayload = await postRes.json();
    assert.deepEqual(postPayload, {
      status: 'ok',
      data: { message: 'hello stellar' },
    });

    // Unsupported GET on /api/echo returns 405 with Allow: POST
    const getRes = await globalThis.fetch(`${baseUrl}/api/echo`);
    assert.equal(getRes.status, 405);
    assert.equal(getRes.headers.get('allow'), 'POST');
    assert.deepEqual(await getRes.json(), { error: 'method_not_allowed' });
  } finally {
    server.close();
  }
});

test('rejects unsupported content types with 415 on JSON routes', async () => {
  const server = createBackendServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    for (const contentType of ['text/plain', 'application/xml', 'text/html']) {
      const res = await globalThis.fetch(`${baseUrl}/api/echo`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: 'raw content',
      });
      assert.equal(res.status, 415);
      const payload = await res.json();
      assert.deepEqual(payload, { error: 'unsupported_media_type' });
    }

    // Missing content-type header
    const missingRes = await globalThis.fetch(`${baseUrl}/api/echo`, {
      method: 'POST',
      body: '{"foo":"bar"}',
    });
    assert.equal(missingRes.status, 415);
  } finally {
    server.close();
  }
});

test('rejects malformed JSON with 400 Bad Request', async () => {
  const server = createBackendServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const res = await globalThis.fetch(`${baseUrl}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ invalid json payload, missing quotes ',
    });
    assert.equal(res.status, 400);
    const payload = await res.json();
    assert.deepEqual(payload, { error: 'malformed_json' });
  } finally {
    server.close();
  }
});

test('rejects oversized request bodies before unbounded buffering', async () => {
  // Test with a small maxBodyBytes boundary of 128 bytes
  const limit = 128;
  const server = createBackendServer({}, { maxBodyBytes: limit });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Payload exceeding limit by declared Content-Length
    const oversizedBody = JSON.stringify({
      data: 'x'.repeat(limit + 50),
    });

    const res = await globalThis.fetch(`${baseUrl}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversizedBody,
    });
    assert.equal(res.status, 413);
    const payload = await res.json();
    assert.deepEqual(payload, { error: 'payload_too_large' });

    // Payload within limit succeeds
    const acceptableBody = JSON.stringify({ ok: true });
    assert.ok(Buffer.byteLength(acceptableBody) <= limit);

    const okRes = await globalThis.fetch(`${baseUrl}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: acceptableBody,
    });
    assert.equal(okRes.status, 200);
    assert.deepEqual(await okRes.json(), {
      status: 'ok',
      data: { ok: true },
    });
  } finally {
    server.close();
  }
});

test('rejects chunked streamed body exceeding maxBodyBytes during transfer', async () => {
  const limit = 256;
  const server = createBackendServer({}, { maxBodyBytes: limit });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    // Make low-level request using node:http to stream chunks without Content-Length
    const statusPromise = new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/api/echo',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'transfer-encoding': 'chunked',
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              body: raw ? JSON.parse(raw) : null,
            });
          });
        },
      );

      req.on('error', (err) => {
        // Connection may be reset when server destroys stream; handle gracefully
        resolve({ error: err });
      });

      // Stream small chunk then an oversized chunk
      req.write('{"chunk": "');
      req.write('a'.repeat(limit + 100));
      req.write('"}');
      req.end();
    });

    const result = await statusPromise;
    if (result.statusCode) {
      assert.equal(result.statusCode, 413);
      assert.deepEqual(result.body, { error: 'payload_too_large' });
    }
  } finally {
    server.close();
  }
});

test('default MAX_REQUEST_BODY_BYTES bound is 64 KiB', () => {
  assert.equal(MAX_REQUEST_BODY_BYTES, 65536);
});

test('HTTP server exposes health and serves static frontend assets with baseline security headers', async () => {
  const server = createBackendServer({ STELLAR_NETWORK: 'TESTNET' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');

    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Test API route: /health
    const health = await globalThis.fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('content-type'), 'application/json');

    for (const [header, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
      assert.equal(
        health.headers.get(header),
        value,
        `expected baseline header ${header}: ${value}`,
      );
    }
    assert.equal(
      health.headers.get('strict-transport-security'),
      null,
      'HSTS must not be enabled for plain HTTP loopback development',
    );
    assert.equal(
      health.headers.get('content-security-policy'),
      null,
      'header policy must not create an invalid CSP for the starter UI',
    );

    const healthPayload = await health.json();
    assert.deepEqual(healthPayload, {
      status: 'ok',
      app: '{{projectName}}',
      network: 'TESTNET',
    });

    // Test static asset route: /app.js
    const asset = await globalThis.fetch(`${baseUrl}/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(
      asset.headers.get('content-type'),
      'application/javascript; charset=utf-8',
    );
    assert.equal(asset.headers.get('cache-control'), 'no-cache');

    for (const [header, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
      assert.equal(
        asset.headers.get(header),
        value,
        `expected baseline header ${header}: ${value} on static asset`,
      );
    }
    assert.equal(
      asset.headers.get('strict-transport-security'),
      null,
      'HSTS must not be enabled on static asset responses in loopback',
    );

    const assetBody = await asset.text();
    assert.match(assetBody, /createAppModel/);
  } finally {
    server.close();
  }
});

test('HTTP server applies baseline security headers on error and traversal responses', async () => {
  const server = createBackendServer({ STELLAR_NETWORK: 'TESTNET' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');

    const baseUrl = `http://127.0.0.1:${address.port}`;

    for (const target of ['/unknown', '/../package.json', '/app.js/outside']) {
      const response = await globalThis.fetch(`${baseUrl}${target}`);
      assert.equal(response.status, 404);
      for (const [header, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
        assert.equal(
          response.headers.get(header),
          value,
          `expected baseline header ${header} on 404 response to ${target}`,
        );
      }
      assert.equal(
        response.headers.get('strict-transport-security'),
        null,
      );
      const json = await response.json();
      assert.deepEqual(json, { error: 'not_found' });
    }

    // Method not allowed / unsupported method
    const postResponse = await globalThis.fetch(`${baseUrl}/health`, {
      method: 'POST',
    });
    assert.equal(postResponse.status, 405);
    for (const [header, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
      assert.equal(postResponse.headers.get(header), value);
    }
    assert.equal(postResponse.headers.get('allow'), 'GET, HEAD');
  } finally {
    server.close();
  }
});

test('validates the documented Testnet defaults', () => {
  const config = getBackendConfig({});

  assert.deepEqual(validateBackendConfig(config), config);
});

test('rejects missing or malformed port values before startup', () => {
  for (const value of ['', ' ', 'abc', '3000abc', '0', '-1', '65536', '3.5']) {
    const config = getBackendConfig({ BACKEND_PORT: value });
    assert.throws(
      () => validateBackendConfig(config),
      (error) =>
        error instanceof BackendConfigurationError &&
        /BACKEND_PORT/.test(error.message),
    );
  }

  assert.equal(getBackendConfig({ BACKEND_PORT: '3100' }).port, 3100);
});

test('rejects malformed Stellar endpoints without echoing secret-like values', () => {
  const secretEndpoint = 'https://user:token@example.test/health';
  const config = getBackendConfig({
    STELLAR_HORIZON_URL: secretEndpoint,
    STELLAR_RPC_URL: 'not-a-url',
  });

  assert.throws(
    () => validateBackendConfig(config),
    (error) => {
      assert.ok(error instanceof BackendConfigurationError);
      assert.match(error.message, /STELLAR_HORIZON_URL/);
      assert.match(error.message, /STELLAR_RPC_URL/);
      assert.doesNotMatch(error.message, /token|user|example\.test|not-a-url/);
      return true;
    },
  );
});

test('rejects conflicting network mode and endpoint values', () => {
  assert.throws(
    () => validateBackendConfig(getBackendConfig({ STELLAR_NETWORK: 'MAINNET' })),
    (error) =>
      error instanceof BackendConfigurationError &&
      /STELLAR_NETWORK must be TESTNET/.test(error.message),
  );

  assert.throws(
    () =>
      validateBackendConfig(
        getBackendConfig({
          STELLAR_HORIZON_URL: 'https://horizon-mainnet.stellar.org',
        }),
      ),
    (error) =>
      error instanceof BackendConfigurationError &&
      /non-Testnet Stellar endpoint/.test(error.message),
  );
});

test('startup validation runs before any listener is opened', () => {
  const listened = [];
  const listen = (server, port) => {
    listened.push({ server, port });
    return 'listener';
  };

  assert.throws(
    () => startBackend({ BACKEND_PORT: 'not-a-port' }, listen),
    BackendConfigurationError,
  );
  assert.deepEqual(listened, []);

  const started = startBackend({ BACKEND_PORT: '3100' }, listen);
  assert.equal(started.config.port, 3100);
  assert.equal(started.listener, 'listener');
  assert.deepEqual(
    listened.map((entry) => entry.port),
    [3100],
  );
});
