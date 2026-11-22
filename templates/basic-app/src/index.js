import { getNetworkConfig } from './network.js';

let heartbeat;
let stopping = false;

function writeLine(stream, message) {
  stream.write(`${message}\n`);
}

function shutdown(signal) {
  if (stopping) {
    return;
  }

  stopping = true;
  if (heartbeat !== undefined) {
    clearInterval(heartbeat);
  }
  writeLine(process.stdout, `status: stopping signal=${signal}`);
  process.exit(0);
}

process.once('SIGINT', () => {
  shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  shutdown('SIGTERM');
});

function assertConfiguredUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }

  return url.toString().replace(/\/$/, '');
}

try {
  writeLine(process.stdout, 'status: starting');
  const network = getNetworkConfig();

  if (
    typeof network.networkPassphrase !== 'string' ||
    network.networkPassphrase.trim().length === 0
  ) {
    throw new Error('STELLAR_NETWORK_PASSPHRASE must not be empty.');
  }

  const horizonUrl = assertConfiguredUrl(
    'STELLAR_HORIZON_URL',
    network.horizonUrl,
  );
  const rpcUrl = assertConfiguredUrl('STELLAR_RPC_URL', network.rpcUrl);

  heartbeat = setInterval(() => {}, 60_000);

  writeLine(process.stdout, 'status: ready');
  writeLine(process.stdout, `app: {{projectName}}`);
  writeLine(
    process.stdout,
    'info: Configured for Stellar Testnet. No listening socket is opened.',
  );
  writeLine(process.stdout, `horizonUrl: ${horizonUrl}`);
  writeLine(process.stdout, `rpcUrl: ${rpcUrl}`);
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unknown startup failure.';
  writeLine(process.stderr, 'status: failed');
  writeLine(process.stderr, `error: ${message}`);
  process.exit(1);
}
globalThis.console.log(`{{projectName}} is configured for the ${network.network} Stellar network.`);
globalThis.console.log(`Horizon: ${network.horizonUrl}`);
globalThis.console.log(`RPC: ${network.rpcUrl}`);
