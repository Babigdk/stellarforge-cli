const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
const DEFAULT_NETWORK_PASSTHRASE = 'Test SDF Network ; September 2015';

export const SUPPORTED_NETWORKS = Object.freeze({
  testnet: Object.freeze({
    horizonUrl: DEFAULT_HORIZON_URL,
    rpcUrl: DEFAULT_RPC_URL,
    networkPassphrase: DEFAULT_NETWORK_PASSTHRASE,
  }),
  local: Object.freeze({
    horizonUrl: 'http://127.0.0.1:8000',
    rpcUrl: 'http://127.0.0.1:8001',
    networkPassphrase: DEFAULT_NETWORK_PASSTHRASE,
  }),
});

export const DEFAULT_NETWORK = 'testnet';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEnv(env) {
  if (env === undefined) {
    return {};
  }
  if (!isPlainObject(env)) {
    throw new TypeError('Network configuration must be provided as a plain object.');
  }
  return env;
}

function resolveNetworkIdentifier(env) {
  const raw = env.STELLAR_NETWORK;
  if (raw === undefined || raw === null) {
    return DEFAULT_NETWORK;
  }
  if (typeof raw !== 'string') {
    throw new TypeError('STELLAR_NETWORK must be a string.');
  }
  const identifier = raw.trim().toLowerCase();
  if (identifier === '') {
    throw new TypeError('STELLAR_NETWORK must not be empty.');
  }
  if (!Object.prototype.hasOwnProperty.call(SUPPORTED_NETWORKS, identifier)) {
    throw new TypeError(
      `Unsupported STELLAR_NETWORK "${identifier}". Supported values: ${Object.keys(SUPPORTED_NETWORKS).join(', ')}.`,
    );
  }
  return identifier;
}

function validateEndpoint(label, value) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string URL.`);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new TypeError(`${label} must not be empty.`);
  }

  let parsed;
  try {
    parsed = new globalThis.URL(trimmed);
  } catch {
    // Do not echo the input: URLs may contain credentials.
    throw new TypeError(`${label} is not a valid URL.`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' ) {
    throw new TypeError(
      `${label} must use the https: or http: protocol.`,
    );
  }

  if (parsed.hostname === '') {
    throw new TypeError(`${label} must include a hostname.`);
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new TypeError(
      `${label} must not embed credentials; provide authentication out of band.`,
    );
  }

  if (parsed.search !== '' || parsed.hash !== '') {
    throw new TypeError(`${label} must not include a query string or fragment.`);
  }

  return parsed.toString();
}

function resolveEndpoint(label, override, defaultValue) {
  if (override === undefined || override === null) {
    return defaultValue;
  }
  return validateEndpoint(label, override);
}

function resolvePassphrase(override, defaultValue) {
  if (override === undefined || override === null) {
    return defaultValue;
  }
  if (typeof override !== 'string') {
    throw new TypeError('STELLAR_NETWORK_PASSTHRASE must be a string.');
  }
  const trimmed = override.trim();
  if (trimmed === '') {
    throw new TypeError('STELLAR_NETWORK_PASSPHRASE must not be empty.');
  }
  return trimmed;
}

export function getNetworkConfig(env = globalThis.process.env) {
  const source = readEnv(env);
  const network = resolveNetworkIdentifier(source);
  const defaults = SUPPORTED_NETWORKS[network];

  return {
    network,
    horizonUrl: resolveEndpoint(
      'STELLAR_HORIZON_URL',
      source.STELLAR_HORIZON_URL,
      defaults.horizonUrl,
    ),
    rpcUrl: resolveEndpoint(
      'STELLAR_RPC_URL',
      source.STELLAR_RPC_URL,
      defaults.rpcUrl,
    ),
    networkPassphrase: resolvePassphrase(
      source.STELLAR_NETWORK_PASSPHRASE,
      defaults.networkPassphrase,
    ),
  };
}
