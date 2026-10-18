/**
 * Secret-looking configuration field-name rejection matrix (SW-081, #181).
 *
 * `configuration-secret-reflection.test.ts` already covers fifteen field names,
 * but they cluster into a handful of shapes — `privateKey` / `private_key` /
 * `private-key`, `secretKey` / `secret`, `token` / `apiToken` / `authToken` /
 * `my_token` — and the matrix never varies casing or separator style across the
 * whole set.
 *
 * That matters because the guard is a single regex (src/config/schema.ts):
 *
 *   /(?:secret|private[_-]?key|seed|mnemonic|password|passphrase|token)/i
 *
 * Two properties are worth pinning explicitly, because changing either one is a
 * silent regression:
 *
 *   1. **Casing is irrelevant.** The `/i` flag means `SECRET_KEY`, `SecretKey` and
 *      `sEcReTkEy` are all rejected. Nothing asserts this, so dropping the flag
 *      would be invisible to the suite.
 *   2. **Separator style is irrelevant for most terms.** Only `private[_-]?key`
 *      permits a separator *inside* the term. Every other alternative is matched
 *      by its head word alone — `secretKey`, `seedPhrase` and `apiToken` match on
 *      `secret`, `seed` and `token`. The last group below documents where that
 *      leaves the boundary, which is the useful part of the map.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateStellarForgeConfig } from '../src/config/schema.js';
import {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
} from '../src/config/project.js';
import { ValidationCliError } from '../src/errors/index.js';
import { withTempDirectory } from './helpers/index.js';

const SECRET_REJECTION = 'must not contain secret material';
const UNSUPPORTED_FIELD =
  'stellarforge.config.json contains an unsupported field.';

/**
 * Names the guard does recognise. Each differs from the existing suite only by
 * casing, separator style, or a scope prefix.
 */
const RECOGNISED_SECRET_NAMES = [
  // Casing — the `/i` flag is what makes these equivalent to the plain forms.
  'SECRET',
  'Secret',
  'SECRET_KEY',
  'SecretKey',
  'sEcReTkEy',
  'PRIVATEKEY',
  'PrivateKey',
  'SEED',
  'SeedPhrase',
  'MNEMONIC',
  'Mnemonic',
  'PASSWORD',
  'PassPhrase',
  'Token',
  'TOKEN',
  'ACCESS_TOKEN',
  'RefreshToken',

  // Separator style across the head-word terms. `private[_-]?key` is the only
  // alternative that accepts a separator inside the term.
  'secret_key',
  'secret-key',
  'secretkey',
  'api_token',
  'api-token',
  'refresh_token',
  'service_token',
  'auth_token',
  'seed_phrase',
  'seed-phrase',
  'seedphrase',
  'privatekey',
  'private_key',
  'private-key',

  // Scope prefixes a real config might drift toward.
  'stellarforge_secret',
  'stellarforge-token',
  'signingSecret',
  'signing_secret',
  'signingToken',
  'credentialSecret',
  'bearerToken',
  'accessSecret',
  'deploymentToken',
  'privateSecretKeyBase',
] as const;

/**
 * Secret-adjacent names the guard does *not* recognise. `passphrase` is the only
 * multi-word alternative in the regex and it tolerates no separator, and there is
 * no alternative matching a bare `key`. These are therefore rejected as ordinary
 * unsupported fields — still refused before use, but with the generic message
 * rather than the secret-specific one.
 *
 * Asserted deliberately: if the regex is ever widened to catch them, this test
 * fails and the change has to be made on purpose.
 */
const SECRET_ADJACENT_UNRECOGNISED_NAMES = [
  'pass_phrase',
  'pass-phrase',
  'encryptionKey',
  'encryption_key',
  'signingKey',
  'signing-key',
  'signing_key',
  'hdAccountIndex',
] as const;

function captureValidationError(value: unknown): ValidationCliError {
  try {
    validateStellarForgeConfig(value);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ValidationCliError);
    return error as ValidationCliError;
  }

  throw new Error('Expected configuration validation to fail.');
}

describe('secret field-name variants are rejected (#181)', () => {
  it.each(RECOGNISED_SECRET_NAMES)(
    'rejects %j as secret material, not as an unknown field',
    (field) => {
      const error = captureValidationError({
        version: 1,
        [field]: 'irrelevant-value',
      });

      expect(error.message).toContain(SECRET_REJECTION);
      expect(error.message).not.toContain('unsupported field');
    },
  );

  it.each(RECOGNISED_SECRET_NAMES)(
    'never reflects the value of %j',
    (field) => {
      const sentinel = 'SENTINEL9-do-not-log';
      const error = captureValidationError({ version: 1, [field]: sentinel });

      expect(error.message).toContain(SECRET_REJECTION);
      expect(error.message).not.toContain(sentinel);
      // The field name is not secret material, and is not echoed either.
      expect(error.message).not.toContain(field);
    },
  );

  it.each(RECOGNISED_SECRET_NAMES)(
    'rejects %j through the on-disk load path too',
    (field) =>
      withTempDirectory((root: string) => {
        const sentinel = 'SENTINEL9-do-not-log';
        writeFileSync(
          join(root, PROJECT_CONFIG_FILENAME),
          JSON.stringify({ version: 1, [field]: sentinel }),
          'utf8',
        );

        const error = captureLoadError(root);

        expect(error.message).toContain(SECRET_REJECTION);
        expect(error.message).not.toContain(sentinel);
      }),
  );

  it('rejects a secret-named field even when its value is empty', () => {
    const error = captureValidationError({ version: 1, apiToken: '' });

    expect(error.message).toContain(SECRET_REJECTION);
  });

  it('rejects a secret-named field before the version check runs', () => {
    // Field-name rejection happens first, so a malformed version cannot mask a
    // secret-bearing key.
    const error = captureValidationError({ version: 99, api_token: 'x' });

    expect(error.message).toContain(SECRET_REJECTION);
  });

  it('rejects a secret-named field that is the only field, with no version', () => {
    const error = captureValidationError({ secretKey: 'x' });

    expect(error.message).toContain(SECRET_REJECTION);
  });
});

describe('the guard boundary is explicit (#181)', () => {
  it.each(SECRET_ADJACENT_UNRECOGNISED_NAMES)(
    'refuses %j as an unsupported field rather than as secret material',
    (field) => {
      const error = captureValidationError({
        version: 1,
        [field]: 'irrelevant-value',
      });

      // Still refused before the config is usable — just via the generic path.
      expect(error.message).toBe(UNSUPPORTED_FIELD);
    },
  );

  it.each(SECRET_ADJACENT_UNRECOGNISED_NAMES)(
    'never reflects the value of %j',
    (field) => {
      const sentinel = 'SENTINEL9-do-not-log';
      const error = captureValidationError({ version: 1, [field]: sentinel });

      expect(error.message).toBe(UNSUPPORTED_FIELD);
      expect(error.message).not.toContain(sentinel);
    },
  );

  it('refuses a secret hidden one level down as an unsupported field', () => {
    // The guard walks top-level keys only, so a nested secret cannot slip through.
    const error = captureValidationError({
      version: 1,
      nested: { apiToken: 'SENTINEL9-do-not-log' },
    });

    expect(error.message).toBe(UNSUPPORTED_FIELD);
    expect(error.message).not.toContain('SENTINEL9-do-not-log');
  });
});

describe('legitimate schema fields remain accepted (#181)', () => {
  it('accepts the minimal config', () => {
    expect(validateStellarForgeConfig({ version: 1 })).toEqual({ version: 1 });
  });

  it.each(['testnet', 'futurenet', 'mainnet'] as const)(
    'accepts network %s',
    (network) => {
      expect(validateStellarForgeConfig({ version: 1, network })).toEqual({
        version: 1,
        network,
      });
    },
  );

  it.each([
    'deployer',
    'team-deployer',
    'team_deployer',
    'Alice',
    'a1',
  ])('accepts the named identity alias %j', (identity) => {
    expect(validateStellarForgeConfig({ version: 1, identity })).toEqual({
      version: 1,
      identity,
    });
  });

  it('accepts a fully populated valid config', () => {
    expect(
      validateStellarForgeConfig({
        version: 1,
        network: 'testnet',
        identity: 'deployer',
      }),
    ).toEqual({ version: 1, network: 'testnet', identity: 'deployer' });
  });

  it('loads a valid config from disk', () =>
    withTempDirectory((root: string) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({
          version: 1,
          network: 'testnet',
          identity: 'deployer',
        }),
        'utf8',
      );

      expect(loadProjectConfig(root)).toEqual({
        version: 1,
        network: 'testnet',
        identity: 'deployer',
      });
    }));
});

function captureLoadError(root: string): ValidationCliError {
  try {
    loadProjectConfig(root);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ValidationCliError);
    return error as ValidationCliError;
  }

  throw new Error('Expected configuration loading to fail.');
}
