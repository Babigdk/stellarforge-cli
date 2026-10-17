import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_CONFIG_FILENAME,
  resolveProjectConfig,
} from '../src/config/project.js';
import { validateStellarForgeConfig } from '../src/config/schema.js';
import { withTempDirectory } from './helpers/index.js';

const root = join(import.meta.dirname, '..');
const configurationReference = readFileSync(
  join(root, 'docs', 'reference', 'configuration.md'),
  'utf8',
);

const JSON_BLOCK = /```json\n([\s\S]*?)```/g;
const jsonMatches = [...configurationReference.matchAll(JSON_BLOCK)];
const jsonBlocks = jsonMatches.map((match) => (match[1] ?? '').trim());

function writeConfig(dir: string, value: unknown): void {
  writeFileSync(join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify(value));
}

describe('configuration reference examples', () => {
  it('ships at least the schema and precedence examples', () => {
    expect(jsonBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it('parses and validates every documented JSON example', () => {
    for (const block of jsonBlocks) {
      const parsed: unknown = JSON.parse(block);

      expect(() => validateStellarForgeConfig(parsed)).not.toThrow();
    }
  });

  it('documents only supported schema fields in the schema example', () => {
    const parsed = JSON.parse(jsonBlocks[0] ?? '') as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual([
      'identity',
      'network',
      'version',
    ]);
  });

  it('never places secret material inside a documented example', () => {
    const combined = jsonBlocks.join('\n').toLowerCase();

    for (const field of [
      'privatekey',
      'secret',
      'seed',
      'mnemonic',
      'password',
      'passphrase',
      'token',
    ]) {
      expect(combined).not.toContain(field);
    }
  });

  it('documents a precedence example that the resolver honours', () =>
    withTempDirectory((dir) => {
      writeConfig(dir, {
        version: 1,
        network: 'testnet',
        identity: 'team-deployer',
      });

      expect(resolveProjectConfig(dir)).toEqual({
        network: 'testnet',
        identity: 'team-deployer',
      });
      expect(
        resolveProjectConfig(dir, { identity: 'release-deployer' }),
      ).toEqual({
        network: 'testnet',
        identity: 'release-deployer',
      });
    }));

  it('documents the precedence order, missing default, and secret boundary', () => {
    expect(configurationReference).toContain('explicit CLI option;');
    expect(configurationReference).toContain('project configuration;');
    expect(configurationReference).toContain('missing.');
    expect(configurationReference).toContain(
      'StellarForge does not silently default a missing network to Mainnet or any other network.',
    );
    expect(configurationReference).toContain('does not accept raw secret keys');
    expect(configurationReference).toContain(
      'A configured network does not bypass command-specific restrictions',
    );
    expect(configurationReference).not.toContain('defaults to Mainnet');
    expect(configurationReference).not.toContain('defaults to mainnet');
  });
});
