import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getConfig } from '../src/config.js';
import {
  createStellarBoundary,
  getStellarNetworkDescriptor,
} from '../src/stellar-client.js';

test('default configuration uses accurate public Stellar Testnet endpoints', () => {
  const config = getConfig({});

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.equal(config.network, 'TESTNET');
  assert.equal(config.horizonUrl, 'https://horizon-testnet.stellar.org');
  assert.equal(config.rpcUrl, 'https://soroban-testnet.stellar.org');
});

test('accepts valid custom remote HTTPS Stellar endpoints and normalizes trailing slashes', () => {
  const config = getConfig({
    STELLAR_NETWORK: 'FUTURENET',
    STELLAR_HORIZON_URL: 'https://horizon-futurenet.stellar.org/',
    STELLAR_RPC_URL: 'https://rpc-futurenet.stellar.org/soroban/rpc/',
  });

  assert.equal(config.network, 'FUTURENET');
  assert.equal(config.horizonUrl, 'https://horizon-futurenet.stellar.org');
  assert.equal(config.rpcUrl, 'https://rpc-futurenet.stellar.org/soroban/rpc');
});

test('accepts plain HTTP endpoints for localhost and 127.0.0.1 development', () => {
  const localhostConfig = getConfig({
    STELLAR_NETWORK: 'STANDALONE',
    STELLAR_HORIZON_URL: 'http://localhost:8000',
    STELLAR_RPC_URL: 'http://localhost:8000/rpc',
  });

  assert.equal(localhostConfig.horizonUrl, 'http://localhost:8000');
  assert.equal(localhostConfig.rpcUrl, 'http://localhost:8000/rpc');

  const loopbackConfig = getConfig({
    STELLAR_NETWORK: 'STANDALONE',
    STELLAR_HORIZON_URL: 'http://127.0.0.1:8000',
    STELLAR_RPC_URL: 'http://127.0.0.1:8000/rpc',
  });

  assert.equal(loopbackConfig.horizonUrl, 'http://127.0.0.1:8000');
  assert.equal(loopbackConfig.rpcUrl, 'http://127.0.0.1:8000/rpc');
});

test('rejects malformed URL strings with clear field-specific errors', () => {
  assert.throws(
    () => getConfig({ STELLAR_HORIZON_URL: 'not-a-valid-url' }),
    (error) => {
      assert.match(error.message, /STELLAR_HORIZON_URL/);
      assert.match(error.message, /valid absolute URL/);
      return true;
    },
  );

  assert.throws(
    () => getConfig({ STELLAR_RPC_URL: 'relative/path/rpc' }),
    (error) => {
      assert.match(error.message, /STELLAR_RPC_URL/);
      assert.match(error.message, /valid absolute URL/);
      return true;
    },
  );
});

test('rejects remote Stellar endpoints using insecure plain HTTP', () => {
  assert.throws(
    () =>
      getConfig({ STELLAR_HORIZON_URL: 'http://horizon-testnet.stellar.org' }),
    /STELLAR_HORIZON_URL must use HTTPS unless it targets localhost\./,
  );

  assert.throws(
    () => getConfig({ STELLAR_RPC_URL: 'http://example.com:8000/rpc' }),
    /STELLAR_RPC_URL must use HTTPS unless it targets localhost\./,
  );
});

test('rejects non-HTTP/HTTPS protocols even on localhost', () => {
  assert.throws(
    () => getConfig({ STELLAR_RPC_URL: 'ftp://localhost:8000' }),
    /STELLAR_RPC_URL must use HTTPS or HTTP protocol\./,
  );

  assert.throws(
    () => getConfig({ STELLAR_HORIZON_URL: 'file:///etc/hosts' }),
    /STELLAR_HORIZON_URL must use HTTPS or HTTP protocol\./,
  );
});

test('rejects URLs containing embedded credentials or secrets', () => {
  const secret = 'https://user:super-secret-pass@horizon-testnet.stellar.org';

  assert.throws(
    () =>
      getConfig({
        STELLAR_HORIZON_URL:
          secret,
      }),
    (error) => {
      assert.match(
        error.message,
        /STELLAR_HORIZON_URL must not contain embedded user credentials\./,
      );
      assert.doesNotMatch(error.message, /super-secret-pass/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );

  assert.throws(
    () =>
      getConfig({
        STELLAR_RPC_URL: 'https://apikey@soroban-testnet.stellar.org',
      }),
    /STELLAR_RPC_URL must not contain embedded user credentials\./,
  );
});

test('rejects fragments, query strings, whitespace, and malformed hosts or ports', () => {
  assert.throws(
    () => getConfig({ STELLAR_HORIZON_URL: 'https:example.com/rpc' }),
    /STELLAR_HORIZON_URL must be an absolute URL using HTTPS or HTTP protocol\./,
  );
  assert.throws(
    () => getConfig({ STELLAR_RPC_URL: 'http:/localhost:8000/rpc' }),
    /STELLAR_RPC_URL must be an absolute URL using HTTPS or HTTP protocol\./,
  );
  assert.throws(
    () => getConfig({ STELLAR_HORIZON_URL: 'https://horizon.example.com/#docs' }),
    /STELLAR_HORIZON_URL must not contain a fragment\./,
  );
  assert.throws(
    () => getConfig({ STELLAR_RPC_URL: 'https://rpc.example.com/rpc?key=secret' }),
    /STELLAR_RPC_URL must not contain a query string\./,
  );
  assert.throws(
    () => getConfig({ STELLAR_RPC_URL: ' https://rpc.example.com/rpc' }),
    /STELLAR_RPC_URL must not contain surrounding whitespace\./,
  );
  assert.throws(
    () => getConfig({ STELLAR_HORIZON_URL: 'https://horizon.example.com /rpc' }),
    /STELLAR_HORIZON_URL must not contain whitespace\./,
  );
  assert.throws(
    () => getConfig({ STELLAR_RPC_URL: 'https://' }),
    /STELLAR_RPC_URL must be a valid absolute URL\./,
  );
  assert.throws(
    () => getConfig({ STELLAR_HORIZON_URL: 'https://horizon.example.com:abc/rpc' }),
    /STELLAR_HORIZON_URL must be a valid absolute URL\./,
  );
  assert.throws(
    () => getConfig({ STELLAR_RPC_URL: 'https:\\\\rpc.example.com\\rpc' }),
    /STELLAR_RPC_URL must not contain backslashes\./,
  );
});

test('validates API port boundaries and rejects malformed values', () => {
  assert.throws(() => getConfig({ API_PORT: '0' }), /API_PORT/);
  assert.throws(() => getConfig({ API_PORT: '65536' }), /API_PORT/);
  assert.throws(() => getConfig({ API_PORT: '-1' }), /API_PORT/);
  assert.throws(() => getConfig({ API_PORT: '3000abc' }), /API_PORT/);
  assert.throws(() => getConfig({ API_PORT: 'abc' }), /API_PORT/);

  const customPort = getConfig({ API_PORT: '8080' });
  assert.equal(customPort.port, 8080);
});

test('rejects empty network or host strings', () => {
  assert.throws(
    () => getConfig({ STELLAR_NETWORK: '   ' }),
    /STELLAR_NETWORK must not be empty\./,
  );

  assert.throws(
    () => getConfig({ API_HOST: '   ' }),
    /API_HOST must not be empty\./,
  );
});

test('Stellar boundary contains only public descriptors with no signing secrets', () => {
  const config = getConfig({});
  const boundary = createStellarBoundary(config);
  const descriptor = getStellarNetworkDescriptor(boundary);

  assert.deepEqual(Object.keys(descriptor).sort(), [
    'horizonUrl',
    'network',
    'rpcUrl',
  ]);
  assert.equal(Object.isFrozen(boundary), true);

  // Assert no secret keys or seed phrases are exposed on the boundary or config
  const serialized = JSON.stringify({ config, descriptor });
  assert.doesNotMatch(serialized, /secret|seed|private[_-]?key/i);
});
