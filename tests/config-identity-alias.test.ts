import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
} from '../src/config/project.js';
import { validateIdentityAlias } from '../src/config/schema.js';
import { ValidationCliError } from '../src/errors/index.js';
import { withTempDirectory } from './helpers/index.js';

const SENTINEL = 'SENTINEL7';

const validAliases = [
  'deployer',
  'a',
  'A',
  'A1',
  'my-identity',
  'my_identity',
  'Team-Deployer_2',
  'a'.repeat(63),
  'a'.repeat(64),
];

const invalidAliases = [
  '',
  ' ',
  '1start',
  '-leading',
  '_leading',
  'has space',
  ' leading',
  'trailing ',
  'two words',
  'a'.repeat(65),
  'alias!',
  'alias.',
  'a.b',
  '../identity',
  'alice/bob',
  '/absolute',
  'C:\\Users\\deployer',
  '~/deployer',
  'alias;id',
  'alias$(id)',
  'alias|id',
  'alias\tid',
  'alias\nid',
  'caf\u00e9',
  'S'.concat('A'.repeat(55)),
  'G'.concat('A'.repeat(55)),
];

const sensitiveAliases = [
  `${SENTINEL} words`,
  `../${SENTINEL}`,
  `${SENTINEL}/child`,
  `-${SENTINEL}`,
  `${SENTINEL}$(id)`,
  `${SENTINEL}.value`,
  `${SENTINEL}!`,
];

describe('configuration identity alias boundaries', () => {
  it.each(validAliases)('accepts identity alias %j', (alias) => {
    expect(validateIdentityAlias(alias)).toBe(alias);
  });

  it.each(invalidAliases)('rejects identity alias %j', (alias) => {
    expect(() => validateIdentityAlias(alias)).toThrow(ValidationCliError);
  });

  it.each(sensitiveAliases)(
    'does not echo rejected identity alias %j',
    (alias) => {
      try {
        validateIdentityAlias(alias);
        throw new Error('Expected identity validation to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationCliError);
        expect((error as Error).message).not.toContain(SENTINEL);
      }
    },
  );

  it('loads a supported identity alias from project configuration', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, identity: 'team-deployer' }),
      );

      expect(loadProjectConfig(root)).toEqual({
        version: 1,
        identity: 'team-deployer',
      });
    }));

  it('rejects a raw StrKey identity in project configuration', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, identity: 'G'.concat('A'.repeat(55)) }),
      );

      expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);
    }));

  it('rejects a non-string identity field', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, identity: 42 }),
      );

      expect(() => loadProjectConfig(root)).toThrow(
        'Configuration identity must be a named Stellar CLI identity alias.',
      );
    }));
});
