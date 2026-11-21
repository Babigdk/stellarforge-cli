import { URL } from 'node:url';

const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 3000,
  network: 'TESTNET',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  rpcUrl: 'https://soroban-testnet.stellar.org',
});

function parseHost(value) {
  const host = (value ?? DEFAULTS.host).trim();

  if (host.length === 0) {
    throw new Error('API_HOST must not be empty.');
  }

  return host;
}

function parsePort(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULTS.port;
  }

  const trimmed = String(value).trim();
  const port = Number.parseInt(trimmed, 10);

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    String(port) !== trimmed
  ) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }

  return port;
}

function parseUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must use HTTPS or HTTP protocol.`);
  }

  if (
    url.protocol !== 'https:' &&
    url.hostname !== '127.0.0.1' &&
    url.hostname !== 'localhost'
  ) {
    throw new Error(`${name} must use HTTPS unless it targets localhost.`);
  }

  if (url.username || url.password) {
    throw new Error(`${name} must not contain embedded user credentials.`);
  }

  return url.toString().replace(/\/$/, '');
}

function parseNetwork(value) {
  const network = (value ?? DEFAULTS.network).trim();

  if (network.length === 0) {
    throw new Error('STELLAR_NETWORK must not be empty.');
  }

  return network;
}

function parseAllowedOrigins(value) {
  const raw = value === undefined || value === null ? '' : String(value).trim();

  if (raw.length === 0) {
    return Object.freeze([]);
  }

  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const origins = entries.map((entry, index) => {
    const label = `API_CORS_ALLOWED_ORIGINS entry ${index + 1}`;

    if (entry.includes('*')) {
      throw new Error(`${label} must be an explicit origin without wildcards.`);
    }

    let url;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`${label} must be a valid absolute origin.`);
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`${label} must use HTTPS or HTTP protocol.`);
    }

    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        `${label} must be an origin without credentials, path, query, or fragment.`,
      );
    }

    if (url.origin === 'null') {
      throw new Error(`${label} must be a concrete origin, not null.`);
    }

    return url.origin;
  });

  return Object.freeze([...new Set(origins)]);
}

export function getConfig(env = globalThis.process.env) {
  return {
    host: parseHost(env.API_HOST),
    port: parsePort(env.API_PORT),
    network: parseNetwork(env.STELLAR_NETWORK),
    horizonUrl: parseUrl(
      'STELLAR_HORIZON_URL',
      env.STELLAR_HORIZON_URL ?? DEFAULTS.horizonUrl,
    ),
    rpcUrl: parseUrl('STELLAR_RPC_URL', env.STELLAR_RPC_URL ?? DEFAULTS.rpcUrl),
    corsAllowedOrigins: parseAllowedOrigins(env.API_CORS_ALLOWED_ORIGINS),
  };
}
