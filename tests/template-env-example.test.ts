/**
 * Cross-template environment-file safety and example drift checks (SW-195).
 *
 * Verifies, per template, that:
 *   1. every `.env.example` ships placeholders only — public Testnet URLs,
 *      loopback addresses, the public network identifier enum, a loopback
 *      host, ports, or the public network passphrase — and never anything
 *      that looks like a credential or matches a known test fixture;
 *   2. every documented variable is consumed by the template's code, and
 *      every variable the template's code consumes is documented or
 *      explicitly reserved (none are reserved today);
 *   3. generated `.env` files stay git-ignored via a `.env` / `.env.*` /
 *      `!.env.example` rule in the template's `.gitignore`;
 *   4. failure messages from the api-service configuration loader never
 *      reflect sentinel secrets embedded in rejected values.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PASSWORD_FIXTURE,
  SECRET_FIXTURE_VALUES,
  TOKEN_FIXTURE,
} from './helpers/index.js';

const root = join(import.meta.dirname, '..');
const TEMPLATES_ROOT = join(root, 'templates');

interface TemplateEnvContract {
  readonly dir: string;
  readonly expectedVariables: readonly string[];
  readonly reservedVariables: readonly string[];
}

const CONTRACTS: readonly TemplateEnvContract[] = [
  {
    dir: 'basic-app',
    expectedVariables: [
      'STELLAR_HORIZON_URL',
      'STELLAR_RPC_URL',
      'STELLAR_NETWORK_PASSPHRASE',
    ],
    reservedVariables: [],
  },
  {
    dir: 'full-stack',
    expectedVariables: [
      'STELLAR_NETWORK',
      'STELLAR_HORIZON_URL',
      'STELLAR_RPC_URL',
      'BACKEND_PORT',
    ],
    reservedVariables: [],
  },
  {
    dir: 'api-service',
    expectedVariables: [
      'API_HOST',
      'API_PORT',
      'STELLAR_NETWORK',
      'STELLAR_HORIZON_URL',
      'STELLAR_RPC_URL',
    ],
    reservedVariables: [],
  },
  {
    dir: 'smart-contract',
    expectedVariables: [],
    reservedVariables: [],
  },
];

const PLACEHOLDER_VALUE_PATTERNS: readonly RegExp[] = [
  /^https:\/\/[A-Za-z0-9.-]+\/?$/,
  /^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}(?:\/.*)?$/,
  /^https:\/\/soroban-testnet\.stellar\.org$/,
  /^(?:TESTNET|FUTURENET|MAINNET|STANDALONE)$/,
  /^127\.0\.0\.1$/,
  /^\d{1,5}$/,
  /^Test SDF Network ; September 2015$/,
];

const CREDENTIAL_VALUE_PATTERNS: readonly RegExp[] = [
  /S[A-Z2-7]{55}/,
  /(?:tok|sk|pk|secret|api[-_]?key|password|bearer)[-_][A-Za-z0-9]{10,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function readExampleVariables(dir: string): Map<string, string> {
  const file = join(dir, '.env.example');
  const variables = new Map<string, string>();

  if (!existsSync(file)) {
    return variables;
  }

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      continue;
    }

    // Strip leading comment markers so documented-but-commented standalone
    // example values are validated too (they are shipped content).
    const candidate = trimmed.startsWith('#')
      ? trimmed.replace(/^#\s?/, '')
      : trimmed;

    const separator = candidate.indexOf('=');

    if (separator === -1) {
      continue;
    }

    const key = candidate.slice(0, separator).trim();

    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      continue;
    }

    variables.set(key, candidate.slice(separator + 1).trim());
  }

  return variables;
}

function collectConsumedVariables(dir: string): Set<string> {
  const consumed = new Set<string>();

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'target' ||
        entry.name === 'coverage'
      ) {
        continue;
      }

      const path = join(current, entry.name);

      if (entry.isDirectory()) {
        walk(path);
        continue;
      }

      if (!/\.(js|mjs|cjs|ts|jsx|tsx)$/.test(entry.name)) {
        continue;
      }

      const text = readFileSync(path, 'utf8');

      for (const match of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)) {
        consumed.add(match[1] ?? '');
      }
    }
  };

  walk(dir);
  return consumed;
}

function readGitignore(dir: string): string {
  const file = join(dir, '.gitignore');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

describe('template .env.example safety and drift (SW-195)', () => {
  it.each(CONTRACTS.map((contract) => [contract.dir, contract] as const))(
    'ships placeholders only in %s',
    (_dir, contract) => {
      const example = readExampleVariables(join(TEMPLATES_ROOT, contract.dir));

      for (const [key, value] of example) {
        const allowed = PLACEHOLDER_VALUE_PATTERNS.some((pattern) =>
          pattern.test(value),
        );
        expect(
          allowed,
          `variable ${key} in ${contract.dir}/.env.example has a suspicious value (${value})`,
        ).toBe(true);

        const credentialLike = CREDENTIAL_VALUE_PATTERNS.some((pattern) =>
          pattern.test(value),
        );
        expect(
          credentialLike,
          `variable ${key} in ${contract.dir}/.env.example looks like a credential`,
        ).toBe(false);
      }

      for (const fixture of SECRET_FIXTURE_VALUES) {
        for (const [, value] of example) {
          expect(value).not.toBe(fixture);
        }
      }
    },
  );

  it.each(CONTRACTS.map((contract) => [contract.dir, contract] as const))(
    'documents exactly the variables its code consumes in %s',
    (_dir, contract) => {
      const dir = join(TEMPLATES_ROOT, contract.dir);
      const documented = readExampleVariables(dir);
      const consumed = collectConsumedVariables(dir);

      for (const variable of contract.expectedVariables) {
        expect(
          documented.has(variable),
          `${contract.dir}/.env.example is missing documented variable ${variable}`,
        ).toBe(true);
        expect(
          consumed.has(variable),
          `${contract.dir} code does not consume documented variable ${variable}`,
        ).toBe(true);
      }

      for (const variable of documented.keys()) {
        expect(
          consumed.has(variable),
          `${contract.dir} documents unused variable ${variable}`,
        ).toBe(true);
      }

      for (const variable of consumed) {
        if (contract.reservedVariables.includes(variable)) {
          continue;
        }

        expect(
          documented.has(variable),
          `${contract.dir} consumes undocumented variable ${variable}`,
        ).toBe(true);
      }
    },
  );

  it.each(CONTRACTS.map((contract) => [contract.dir, contract] as const))(
    'keeps generated .env files git-ignored in %s',
    (_dir, contract) => {
      const gitignore = readGitignore(join(TEMPLATES_ROOT, contract.dir));
      const lines = gitignore.split(/\r?\n/).map((line) => line.trim());

      expect(lines).toContain('.env');
      expect(lines).toContain('.env.*');
      expect(lines).toContain('!.env.example');

      const example = join(TEMPLATES_ROOT, contract.dir, '.env.example');

      if (existsSync(example)) {
        const negationIndex = lines.indexOf('!.env.example');
        const wildcardIndex = lines.indexOf('.env.*');
        expect(negationIndex).toBeGreaterThan(wildcardIndex);
      }
    },
  );

  it('never reflects sentinel secrets in api-service configuration errors', async () => {
    const moduleUrl = fileURLToPath(
      new URL('../templates/api-service/src/config.js', import.meta.url),
    );

    const { getConfig } = (await import(moduleUrl)) as {
      getConfig: (env?: Record<string, string>) => unknown;
    };

    const baseline = {
      API_HOST: '127.0.0.1',
      API_PORT: '3000',
      STELLAR_NETWORK: 'TESTNET',
      STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
      STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
    };

    expect(() => getConfig(baseline)).not.toThrow();

    const hostile = {
      ...baseline,
      STELLAR_RPC_URL: `https://user:${PASSWORD_FIXTURE}@example.com/rpc`,
    };

    let error: unknown;

    try {
      getConfig(hostile);
      throw new Error('expected embedded-credentials rejection');
    } catch (caught) {
      error = caught;
    }

    expect(String((error as Error).message)).not.toContain(PASSWORD_FIXTURE);
    expect(String((error as Error).message)).not.toContain(TOKEN_FIXTURE);
    expect((error as Error).message.length).toBeLessThan(120);
  });
});
