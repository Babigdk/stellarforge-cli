import assert from 'node:assert/strict';
import test from 'node:test';
import { getNetworkConfig } from '../src/network.js';

test('uses safe Stellar Testnet defaults', () => {
  const config = getNetworkConfig({});

  assert.equal(config.network, 'testnet');
  assert.equal(config.horizonUrl, 'https://horizon-testnet.stellar.org');
  assert.equal(config.rpcUrl, 'https://soroban-testnet.stellar.org');
  assert.equal(config.networkPassphrase, 'Test SDF Network ; September 2015');
});

test('uses explicit network selection from STELLAR_NETWORK', () => {
  const config = getNetworkConfig({ STELLAR_NETWORK: 'testnet' });

  assert.equal(config.network, 'testnet');
  assert.equal(config.networkPassphrase, 'Test SDF Network ; September 2015');
});

test('rejects unsupported network identifiers', () => {
  assert.throws(() => getNetworkConfig({ STELLAR_NETWORK: 'mainnet' }), /Unsupported network/);
  assert.throws(() => getNetworkConfig({ STELLAR_NETWORK: 'futurenet' }), /Unsupported network/);
});

test('allows endpoint overrides without requiring secrets', () => {
  const config = getNetworkConfig({
    STELLAR_HORIZON_URL: 'http://127.0.0.1:8000',
    STELLAR_RPC_URL: 'http://127.0.0.1:8001',
  });

  assert.equal(config.horizonUrl, 'http://127.0.0.1:8000');
  assert.equal(config.rpcUrl, 'http://127.0.0.1:8001');
});

test('rejects non-http(s) protocols', () => {
  assert.throws(
    () => getNetworkConfig({ STELLAR_HORIZON_URL: 'ftp://horizon-testnet.stellar.org' }),
    /protocol/i,
  );
  assert.throws(
    () => getNetworkConfig({ STELLAR_RPC_URL: 'ws://soroban-testnet.stellar.org' }),
    /protocol/i,
  );
});

test('rejects endpoints without a host', () => {
  assert.throws(
    () => getNetworkConfig({ STELLAR_HORIZON_URL: 'https://' }),
    /host/i,
  );
  assert.throws(
    () => getNetworkConfig({ STELLAR_RPC_URL: 'http://' }),
    /host/i,
  );
});

test('rejects malformed URLs', () => {
  assert.throws(() => getNetworkConfig({ STELLAR_HORIZON_URL: 'not a url' }), /Invalid/);
  assert.throws(() => getNetworkConfig({ STELLAR_RPC_URL: 'http://[::1' }), /Invalid/);
});

test('error messages do not echo credential-bearing URLs', () => {
  const secret = 'https://user:super-secret-pass@horizon-testnet.stellar.org';

  assert.throws(
    () => getNetworkConfig({ STELLAR_HORIZON_URL: secret }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(!err.message.includes('super-secret-pass'));
      assert.ok(!err.message.includes(secret));
      return true;
    },
  );
});
