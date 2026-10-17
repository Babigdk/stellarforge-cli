import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import { resolveTestnetDeploymentPlan } from '../src/deployment/project.js';
import { ValidationCliError } from '../src/errors/index.js';
import { withTempDirectory } from './helpers/index.js';

const REJECTION_MESSAGE =
  'StellarForge deploy supports only the explicit `--network testnet` target in the MVP.';

const rejectedNetworks = [
  'mainnet',
  'futurenet',
  'main',
  'public',
  'local',
  'TESTNET',
  'Testnet',
  ' testnet',
  'testnet ',
  'test net',
  'testnet\n',
  'testnet\r\n',
  '',
];

function writeCargoWorkspace(root: string): void {
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
}

function expectNetworkRejection(network: string, root: string): void {
  let thrown: unknown;
  try {
    resolveTestnetDeploymentPlan({ cwd: root, network, source: 'alice' });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ValidationCliError);
  expect((thrown as ValidationCliError).userMessage).toBe(REJECTION_MESSAGE);
}

describe('Stellar deploy network rejection matrix', () => {
  it.each(rejectedNetworks)('rejects non-Testnet target %j', (network) =>
    withTempDirectory((root) => {
      writeCargoWorkspace(root);

      expectNetworkRejection(network, root);
    }));

  it('accepts only the explicit Testnet target', () =>
    withTempDirectory((root) => {
      writeCargoWorkspace(root);

      expect(
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source: 'alice',
        }),
      ).toHaveLength(1);
    }));

  it('rejects a non-Testnet CLI network before any process is started', () =>
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
          'mainnet',
          '--source',
          'alice',
        ]),
      ).rejects.toBeInstanceOf(ValidationCliError);
      expect(spawnCalled).toBe(false);
    }));

  it('does not echo a rejected network value', () =>
    withTempDirectory((root) => {
      writeCargoWorkspace(root);

      try {
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'SENTINEL-NETWORK',
          source: 'alice',
        });
        throw new Error('Expected network validation to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationCliError);
        expect((error as Error).message).not.toContain('SENTINEL-NETWORK');
      }
    }));
});
