import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import { resolveTestnetDeploymentPlan } from '../src/deployment/project.js';
import { ValidationCliError } from '../src/errors/index.js';
import { withTempDirectory } from './helpers/index.js';

const SENTINEL = 'SENTINEL9';

const safeAliases = [
  'deployer',
  'alice',
  'team-deployer',
  'team_deployer',
  'A1',
  'a'.repeat(64),
];

const unsafeSources = [
  'S'.concat('A'.repeat(55)),
  'G'.concat('A'.repeat(55)),
  'seed phrase words',
  '../identity',
  '/etc/passwd',
  'alice/bob',
  '.hidden',
  '..',
  '~/deployer',
  'C:\\Users\\deployer',
  'name;rm -rf /',
  'name&&deploy',
  'name|deploy',
  'name$(id)',
  'name`id`',
  'name>out',
  'name<in',
  '-flag',
  '--source',
  'name=value',
  'two words',
  'tab\tseparated',
  'line\nbreak',
  'quote"name',
  '',
  '   ',
  ' leading',
  'trailing ',
];

const sensitiveSources = [
  `${SENTINEL} words`,
  `../${SENTINEL}`,
  `${SENTINEL}/child`,
  `-${SENTINEL}`,
  `${SENTINEL}; id`,
  `${SENTINEL}$(id)`,
];

function writeCargoWorkspace(root: string): void {
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
}

describe('Stellar deploy source validation', () => {
  it.each(unsafeSources)('rejects unsafe source value %j', (source) =>
    withTempDirectory((root) => {
      writeCargoWorkspace(root);

      expect(() =>
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source,
        }),
      ).toThrow(ValidationCliError);
    }));

  it.each(sensitiveSources)(
    'does not echo rejected source value %j',
    (source) =>
      withTempDirectory((root) => {
        writeCargoWorkspace(root);

        try {
          resolveTestnetDeploymentPlan({
            cwd: root,
            network: 'testnet',
            source,
          });
          throw new Error('Expected source validation to fail.');
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationCliError);
          expect((error as Error).message).not.toContain(SENTINEL);
        }
      }),
  );

  it.each(safeAliases)('accepts safe identity alias %j', (source) =>
    withTempDirectory((root) => {
      writeCargoWorkspace(root);

      const [spec] = resolveTestnetDeploymentPlan({
        cwd: root,
        network: 'testnet',
        source,
      });

      expect(spec?.args).toContain('--source-account');
      expect(spec?.args).toContain(source);
    }));

  it('rejects an unsafe source before the deploy subprocess starts', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      let spawnCalled = false;
      const command = createDeployCommand({
        cwd: () => root,
        spawnProcess: () => {
          spawnCalled = true;
          throw new Error('The deploy subprocess must not start.');
        },
      });

      await expect(
        command.parseAsync([
          'node',
          'deploy',
          '--network',
          'testnet',
          '--source',
          '../escape-attempt',
        ]),
      ).rejects.toBeInstanceOf(ValidationCliError);
      expect(spawnCalled).toBe(false);
    }));
});
