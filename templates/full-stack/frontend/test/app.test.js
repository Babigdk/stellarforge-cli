import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BACKEND_STATUS,
  HEALTH_CONTRACT_VERSION,
  createAppModel,
  createBackendStatusClient,
  createStatusView,
  renderBackendStatus,
} from '../src/app.js';

function createHealthyResponse(payload = {
  status: 'ok',
  version: HEALTH_CONTRACT_VERSION,
}) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

test('exposes the generated app identity and Testnet boundary', () => {
  const model = createAppModel();

  assert.equal(model.name, '{{projectName}}');
  assert.equal(model.network, 'Stellar Testnet');
  assert.equal(model.backendHealthPath, '/health');
});

test('loading, healthy, and unavailable states are textually distinct', () => {
  const loading = createStatusView(BACKEND_STATUS.LOADING);
  const healthy = createStatusView(BACKEND_STATUS.HEALTHY);
  const unavailable = createStatusView(BACKEND_STATUS.UNAVAILABLE);

  assert.equal(loading.state, 'loading');
  assert.equal(loading.isLoading, true);
  assert.equal(healthy.state, 'healthy');
  assert.equal(healthy.isLoading, false);
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.isLoading, false);

  const messages = [loading.message, healthy.message, unavailable.message];
  assert.equal(new Set(messages).size, 3);
  for (const message of messages) {
    assert.match(message, /^Status:/);
  }
  assert.match(unavailable.message, /backend unavailable/i);
});

test('an initial backend failure renders an understandable unavailable state', async () => {
  const states = [];
  const client = createBackendStatusClient({
    fetchImpl: async () => {
      throw new Error('offline');
    },
    onStatusChange: (view) => states.push(view.state),
  });

  const result = await client.refresh();

  assert.equal(result.state, BACKEND_STATUS.UNAVAILABLE);
  assert.match(result.message, /backend unavailable/i);
  assert.deepEqual(states, ['loading', 'unavailable']);
});

test('accepts the documented versioned health response and ignores extra fields', async () => {
  const client = createBackendStatusClient({
    fetchImpl: async () =>
      createHealthyResponse({
        status: 'ok',
        version: HEALTH_CONTRACT_VERSION,
        futureOptionalField: 'ignored',
      }),
  });

  const result = await client.refresh();
  assert.equal(result.state, BACKEND_STATUS.HEALTHY);
});

test('treats missing, unknown, and malformed health fields as unavailable', async () => {
  const invalidPayloads = [
    { status: 'ok' },
    { status: 'ok', version: 999 },
    { version: HEALTH_CONTRACT_VERSION },
    null,
    [],
    'ok',
  ];

  for (const payload of invalidPayloads) {
    const client = createBackendStatusClient({
      fetchImpl: async () => createHealthyResponse(payload),
    });

    const result = await client.refresh();
    assert.equal(result.state, BACKEND_STATUS.UNAVAILABLE);
  }

  const malformedJsonClient = createBackendStatusClient({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }),
  });
  assert.equal(
    (await malformedJsonClient.refresh()).state,
    BACKEND_STATUS.UNAVAILABLE,
  );
});

test('treats an unavailable HTTP health response as unavailable', async () => {
  const client = createBackendStatusClient({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        status: 'unavailable',
        version: HEALTH_CONTRACT_VERSION,
      }),
    }),
  });

  assert.equal(
    (await client.refresh()).state,
    BACKEND_STATUS.UNAVAILABLE,
  );
});

test('a user-triggered retry recovers when the backend returns', async () => {
  let calls = 0;
  const client = createBackendStatusClient({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('offline');
      }
      return createHealthyResponse();
    },
  });

  assert.equal((await client.refresh()).state, BACKEND_STATUS.UNAVAILABLE);
  const recovered = await client.refresh();

  assert.equal(calls, 2);
  assert.equal(recovered.state, BACKEND_STATUS.HEALTHY);
  assert.match(recovered.message, /backend healthy/i);
});

test('repeated retry actions do not start unbounded concurrent requests', async () => {
  let calls = 0;
  const pending = createDeferred();
  const client = createBackendStatusClient({
    fetchImpl: async () => {
      calls += 1;
      return pending.promise;
    },
  });

  const first = client.refresh();
  const second = client.refresh();
  const third = client.refresh();

  assert.equal(calls, 1);

  pending.resolve(createHealthyResponse());
  const results = await Promise.all([first, second, third]);
  assert.equal(calls, 1);
  assert.ok(results.every((result) => result.state === BACKEND_STATUS.HEALTHY));

  await client.refresh();
  assert.equal(calls, 2);
});

test('rendering status updates text, live-region metadata, and retry control', () => {
  const attributes = {};
  const statusElement = {
    textContent: '',
    className: '',
    setAttribute(name, value) {
      attributes[name] = value;
    },
  };
  const retryButton = { disabled: false, textContent: '' };

  renderBackendStatus(createStatusView(BACKEND_STATUS.LOADING, 1), {
    statusElement,
    retryButton,
  });

  assert.equal(statusElement.textContent, 'Status: checking backend...');
  assert.equal(statusElement.className, 'status status--loading');
  assert.deepEqual(attributes, {
    'data-state': 'loading',
    'aria-busy': 'true',
  });
  assert.equal(retryButton.disabled, true);
  assert.equal(retryButton.textContent, 'Retry backend status');

  renderBackendStatus(createStatusView(BACKEND_STATUS.UNAVAILABLE, 2), {
    statusElement,
    retryButton,
  });

  assert.equal(statusElement.className, 'status status--unavailable');
  assert.equal(attributes['data-state'], 'unavailable');
  assert.equal(attributes['aria-busy'], 'false');
  assert.equal(retryButton.disabled, false);
});

test('starter markup and styles provide accessible structure without polling', () => {
  const markup = readFileSync(
    new URL('../src/index.html', import.meta.url),
    'utf8',
  );
  const styles = readFileSync(
    new URL('../src/styles.css', import.meta.url),
    'utf8',
  );
  const source = readFileSync(
    new URL('../src/app.js', import.meta.url),
    'utf8',
  );

  assert.match(markup, /<html lang="en">/);
  assert.match(markup, /<header[\s\S]*<h1>/);
  assert.match(markup, /<main id="main-content">/);
  assert.match(markup, /<h2 id="status-heading">/);
  assert.ok(markup.indexOf('<h1>') < markup.indexOf('<h2'));
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /aria-atomic="true"/);
  assert.match(markup, /<button id="retry-backend" type="button"/);
  assert.match(styles, /\.skip-link:focus/);
  assert.match(styles, /:focus-visible/);
  assert.match(source, /Status: backend unavailable/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});
