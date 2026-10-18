/**
 * Raw StrKey rejection matrix for deploy and config identity (SW-086, #186).
 *
 * `validateIdentityAlias` (src/config/schema.ts) is the single gate in front of
 * both the deploy `--source` and the config `identity`. It rejects a value when
 * either rule matches:
 *
 *   STELLAR_ACCOUNT_OR_SECRET_STRKEY  /^[GS][A-Z2-7]{55}$/
 *   !SAFE_IDENTITY_ALIAS              /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
 *
 * The first rule is what stops a raw account address or secret seed being passed
 * through as an identity name. The existing `deploy-source-rejection.test.ts`
 * covers it with two cases — `'S' + 'A'.repeat(55)` and `'G' + 'A'.repeat(55)` —
 * which is enough to prove the rule fires but not enough to describe where its
 * edge is.
 *
 * That edge is genuinely asymmetric, and this file pins it from both sides so a
 * future change to either regex has to be deliberate:
 *
 *   - a canonical 56-character `G…`/`S…` StrKey is rejected;
 *   - a *near-miss* — wrong length, lowercased, mixed-case, or carrying a
 *     character outside the base32 alphabet — is not a valid key, so it is
 *     accepted as an ordinary alias and forwarded to the Stellar CLI as one.
 *
 * No secret material is exposed by the second group: none of those values is a
 * usable seed, so the CLI simply fails to resolve them as an identity. It is
 * worth knowing about, though, and it is asserted explicitly below rather than
 * left to be discovered.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateIdentityAlias } from '../src/config/schema.js';
import { resolveTestnetDeploymentPlan } from '../src/deployment/project.js';
import { ValidationCliError } from '../src/errors/index.js';
import { withTempDirectory } from './helpers/index.js';

const IDENTITY_REJECTION =
  'Stellar identity must be a named Stellar CLI identity alias.';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A well-formed StrKey body of `length` characters drawn from the base32 set. */
function strkeyBody(length: number): string {
  return Array.from(
    { length },
    (_, index) => BASE32[index % BASE32.length]!,
  ).join('');
}

const CANONICAL_ACCOUNT = `G${strkeyBody(55)}`;
const CANONICAL_SEED = `S${strkeyBody(55)}`;

/** Canonical, uppercase, exactly 56 characters — the shapes that must be refused. */
const CANONICAL_STRKEYS = [
  { name: 'G account address', value: CANONICAL_ACCOUNT },
  { name: 'S secret seed', value: CANONICAL_SEED },
  { name: 'G address over the full base32 alphabet', value: `G${BASE32.repeat(2).slice(0, 55)}` },
  { name: 'S seed over the full base32 alphabet', value: `S${BASE32.repeat(2).slice(0, 55)}` },
  { name: 'G address with digits 2-7', value: `G${'2'.repeat(55)}` },
] as const;

/**
 * Rejected by the alias rule rather than the StrKey rule: these cannot be a key,
 * and they cannot be an alias either.
 */
const NOT_AN_ALIAS = [
  { name: 'G-shaped value with a space', value: `G${strkeyBody(54)} ` },
  { name: 'G-shaped value with an equals sign', value: `G${strkeyBody(54)}=` },
  { name: 'G-shaped value with a tab', value: `G${strkeyBody(54)}\t` },
  { name: 'G-shaped value with a slash', value: `G${strkeyBody(54)}/x` },
  { name: '65 characters, one past the alias limit', value: `G${strkeyBody(64)}` },
  { name: 'leading digit', value: `1${strkeyBody(55)}` },
  { name: 'leading hyphen', value: `-${strkeyBody(55)}` },
  { name: 'leading dot', value: `.${strkeyBody(55)}` },
  { name: 'empty string', value: '' },
  { name: 'whitespace only', value: '   ' },
  { name: 'path traversal', value: '../identity' },
  { name: 'absolute path', value: '/etc/passwd' },
  { name: 'seed phrase', value: 'seed phrase words' },
  { name: 'shell fragment', value: 'name;rm -rf /' },
] as const;

/**
 * StrKey-shaped values that are *not* valid keys and are therefore treated as
 * plain aliases. Asserted explicitly so that widening the StrKey rule has to be a
 * conscious decision rather than a side effect of editing the regex.
 */
const NEAR_MISS_STRKEYS = [
  { name: '55 characters, one short', value: `G${strkeyBody(54)}` },
  { name: '57 characters, one long', value: `G${strkeyBody(56)}` },
  { name: 'lower-cased G address', value: CANONICAL_ACCOUNT.toLowerCase() },
  { name: 'lower-cased S seed', value: CANONICAL_SEED.toLowerCase() },
  { name: 'mixed-case G address', value: `G${strkeyBody(54).toLowerCase()}` },
  { name: 'muxed M account', value: `M${strkeyBody(56)}` },
  { name: 'contract C address', value: `C${strkeyBody(56)}` },
  { name: 'G address with a 0, outside base32', value: `G${'0'.repeat(55)}` },
  { name: 'G address with a 1, outside base32', value: `G${'1'.repeat(55)}` },
  { name: 'G address with an 8, outside base32', value: `G${'8'.repeat(55)}` },
  { name: 'G address with hyphens', value: `G${'-'.repeat(55)}` },
  { name: 'S seed with underscores', value: `S${'_'.repeat(55)}` },
] as const;

/** Named aliases that must keep working — the regression the whole rule protects. */
const SAFE_ALIASES = [
  'deployer',
  'alice',
  'team-deployer',
  'team_deployer',
  'A1',
] as const;

function captureIdentityError(value: string): ValidationCliError {
  try {
    validateIdentityAlias(value);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ValidationCliError);
    return error as ValidationCliError;
  }

  throw new Error(`Expected ${JSON.stringify(value)} to be rejected.`);
}

describe('canonical raw StrKeys are refused (#186)', () => {
  it.each(CANONICAL_STRKEYS)('rejects a $name', ({ value }) => {
    const error = captureIdentityError(value);

    expect(error.message).toContain(IDENTITY_REJECTION);
  });

  it.each(CANONICAL_STRKEYS)('never reflects a $name in the error', ({ value }) => {
    const error = captureIdentityError(value);

    // The message is fixed text; nothing interpolates the rejected value.
    expect(error.message).not.toContain(value);
    expect(error.message).not.toContain(value.slice(1, 12));
  });

  it('rejects a 56-character value on length alone, whatever the prefix', () => {
    // Any G/S-prefixed 56-character uppercase base32 string hits the rule; the
    // rule cannot distinguish a real key from a fabricated one, by design.
    expect(() => validateIdentityAlias(`G${strkeyBody(55)}`)).toThrow(
      IDENTITY_REJECTION,
    );
    expect(() => validateIdentityAlias(`S${strkeyBody(55)}`)).toThrow(
      IDENTITY_REJECTION,
    );
  });
});

describe('values that cannot be an alias are refused (#186)', () => {
  it.each(NOT_AN_ALIAS)('rejects $name', ({ value }) => {
    const error = captureIdentityError(value);

    expect(error.message).toContain(IDENTITY_REJECTION);
  });

  it.each(NOT_AN_ALIAS)('never reflects $name in the error', ({ value }) => {
    const error = captureIdentityError(value);

    expect(error.message).not.toContain(value);
  });

  it('keeps the boundary at 64 characters', () => {
    // 64 is the alias limit and is accepted; 65 is one past it and is not.
    expect(validateIdentityAlias(`A${'a'.repeat(63)}`)).toBe(`A${'a'.repeat(63)}`);
    expect(() => validateIdentityAlias(`A${'a'.repeat(64)}`)).toThrow(
      IDENTITY_REJECTION,
    );
  });
});

describe('the StrKey rule boundary is explicit (#186)', () => {
  it.each(NEAR_MISS_STRKEYS)('accepts a $name as a plain alias', ({ value }) => {
    // None of these is a valid Stellar key, so nothing secret is exposed. They
    // are forwarded as an identity name and the Stellar CLI fails to resolve
    // them. Pinned so a widened rule fails loudly instead of by accident.
    expect(validateIdentityAlias(value)).toBe(value);
  });
});

describe('named aliases keep working (#186)', () => {
  it.each(SAFE_ALIASES)('accepts %j unchanged', (alias) => {
    expect(validateIdentityAlias(alias)).toBe(alias);
  });
});

describe('deploy refuses a raw StrKey before spawning (#186)', () => {
  it.each(CANONICAL_STRKEYS)(
    'rejects a $name before any subprocess is planned',
    ({ value }) =>
      withTempDirectory((root: string) => {
        // A valid workspace, so only the source can be the reason for failure.
        writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n', 'utf8');

        expect(() =>
          resolveTestnetDeploymentPlan({
            cwd: root,
            network: 'testnet',
            source: value,
          }),
        ).toThrow(IDENTITY_REJECTION);
      }),
  );

  it.each(NOT_AN_ALIAS)(
    'rejects $name before any subprocess is planned',
    ({ value }) =>
      withTempDirectory((root: string) => {
        writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n', 'utf8');

        expect(() =>
          resolveTestnetDeploymentPlan({
            cwd: root,
            network: 'testnet',
            source: value,
          }),
        ).toThrow(IDENTITY_REJECTION);
      }),
  );

  it('plans a deployment for a named alias in a generated workspace', () =>
    withTempDirectory((root: string) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n', 'utf8');

      const plan = resolveTestnetDeploymentPlan({
        cwd: root,
        network: 'testnet',
        source: 'deployer',
      });

      expect(plan).toHaveLength(1);
      expect(plan[0]?.args).toContain('--source-account');
      expect(plan[0]?.args).toContain('deployer');
      // The alias is forwarded as its own argv entry, never joined into a string.
      expect(Array.isArray(plan[0]?.args)).toBe(true);
    }));

  it('does not check the source before the network target', () =>
    withTempDirectory((root: string) => {
      // Ordering matters: a wrong network is reported on its own terms, so a user
      // fixing one problem does not just walk into the next.
      expect(() =>
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'mainnet',
          source: CANONICAL_SEED,
        }),
      ).toThrow('supports only the explicit `--network testnet` target');
    }));
});
