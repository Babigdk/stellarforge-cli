export const SAFE_ENVIRONMENT_KEYS = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'ComSpec',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'CARGO_TARGET_DIR',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
  'NODE_ENV',
  'PORT',
  'API_HOST',
  'API_PORT',
  'BACKEND_PORT',
  'STELLAR_NETWORK',
  'STELLAR_HORIZON_URL',
  'STELLAR_RPC_URL',
] as const;

export const DETERMINISTIC_LOCALE_ENVIRONMENT = {
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  LANGUAGE: 'C',
} as const;

const CREDENTIAL_KEY_PATTERN =
  /(?:SECRET|TOKEN|PASSWORD|PASSPHRASE|CREDENTIAL|PRIVATE[_-]?KEY|API[_-]?KEY|ACCESS[_-]?KEY|AUTH)/i;

function normalizeEnvironmentKey(key: string): string {
  return key.toLowerCase();
}

function copySafeValue(
  source: NodeJS.ProcessEnv,
  target: NodeJS.ProcessEnv,
  canonicalKey: string,
): void {
  const normalized = normalizeEnvironmentKey(canonicalKey);
  let match: string | undefined;

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || normalizeEnvironmentKey(key) !== normalized) {
      continue;
    }

    if (key === canonicalKey) {
      match = value;
      break;
    }

    if (match === undefined) {
      match = value;
    }
  }

  if (match !== undefined) {
    target[canonicalKey] = match;
  }
}

export function isSafeEnvironmentKey(key: string): boolean {
  const normalized = normalizeEnvironmentKey(key);
  return SAFE_ENVIRONMENT_KEYS.some(
    (safeKey) => normalizeEnvironmentKey(safeKey) === normalized,
  );
}

export function isCredentialEnvironmentKey(key: string): boolean {
  return CREDENTIAL_KEY_PATTERN.test(key);
}

export function buildSafeChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const key of SAFE_ENVIRONMENT_KEYS) {
    copySafeValue(source, environment, key);
  }

  for (const [key, value] of Object.entries(DETERMINISTIC_LOCALE_ENVIRONMENT)) {
    environment[key] = value;
  }

  return environment;
}

export function collectRedactableEnvironmentValues(
  source: NodeJS.ProcessEnv,
): readonly string[] {
  const values = new Set<string>();

  for (const [key, value] of Object.entries(source)) {
    if (
      value === undefined ||
      value.length === 0 ||
      isSafeEnvironmentKey(key)
    ) {
      continue;
    }

    if (value.length >= 8 || isCredentialEnvironmentKey(key)) {
      values.add(value);
    }
  }

  return [...values].sort((left, right) => right.length - left.length);
}
