import { ValidationCliError } from '../errors/errors.js';

export type StellarForgeNetwork = 'testnet' | 'futurenet' | 'mainnet';

export interface StellarForgeConfig {
  readonly version: 1;
  readonly network?: StellarForgeNetwork;
  readonly identity?: string;
}

const SUPPORTED_NETWORKS = new Set<StellarForgeNetwork>([
  'testnet',
  'futurenet',
  'mainnet',
]);
const SAFE_IDENTITY_ALIAS = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const STELLAR_ACCOUNT_OR_SECRET_STRKEY = /^[GS][A-Z2-7]{55}$/;
const SENSITIVE_FIELD_NAME =
  /(?:secret|private[_-]?key|seed|mnemonic|password|passphrase|token)/i;
const ALLOWED_FIELDS = new Set(['version', 'network', 'identity']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateIdentityAlias(identity: string): string {
  if (
    STELLAR_ACCOUNT_OR_SECRET_STRKEY.test(identity) ||
    !SAFE_IDENTITY_ALIAS.test(identity)
  ) {
    throw new ValidationCliError(
      'Stellar identity must be a named Stellar CLI identity alias. Raw secret keys, seed phrases, public keys, and path-like values are not accepted.',
    );
  }

  return identity;
}

export function validateStellarForgeConfig(value: unknown): StellarForgeConfig {
  if (!isRecord(value)) {
    throw new ValidationCliError(
      'stellarforge.config.json must contain a JSON object.',
    );
  }

  for (const field of Object.keys(value)) {
    if (ALLOWED_FIELDS.has(field)) {
      continue;
    }

    if (SENSITIVE_FIELD_NAME.test(field)) {
      throw new ValidationCliError(
        'StellarForge project configuration must not contain secret material. Store signing keys in Stellar CLI identity management instead.',
      );
    }

    throw new ValidationCliError(
      'stellarforge.config.json contains an unsupported field.',
    );
  }

  if (value.version === undefined) {
    throw new ValidationCliError(
      'stellarforge.config.json is missing the required "version" field.',
    );
  }

  if (
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version) ||
    value.version < 1
  ) {
    throw new ValidationCliError('"version" must be a positive integer.');
  }

  if (value.version > 1) {
    throw new ValidationCliError(
      `This config declares schema version ${value.version}, which requires a newer stellarforge CLI. Please upgrade stellarforge to continue.`,
    );
  }

  let network: StellarForgeNetwork | undefined;
  if (value.network !== undefined) {
    if (
      typeof value.network !== 'string' ||
      !SUPPORTED_NETWORKS.has(value.network as StellarForgeNetwork)
    ) {
      throw new ValidationCliError(
        'Configuration network must be one of: testnet, futurenet, mainnet.',
      );
    }

    network = value.network as StellarForgeNetwork;
  }

  let identity: string | undefined;
  if (value.identity !== undefined) {
    if (typeof value.identity !== 'string') {
      throw new ValidationCliError(
        'Configuration identity must be a named Stellar CLI identity alias.',
      );
    }

    identity = validateIdentityAlias(value.identity);
  }

  return {
    version: 1,
    ...(network === undefined ? {} : { network }),
    ...(identity === undefined ? {} : { identity }),
  };
}
