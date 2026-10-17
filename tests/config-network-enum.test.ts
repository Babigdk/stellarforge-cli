import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
} from '../src/config/project.js';
import { validateStellarForgeConfig } from '../src/config/schema.js';
import { resolveTestnetDeploymentPlan } from '../src/deployment/project.js';
import { ValidationCliError } from '../src/errors/index.js';
import { withTempDirectory } from './helpers/index.js';

const ENUM_MESSAGE =
  'Configuration network must be one of: testnet, futurenet, mainnet.';

const unsupportedNetworks = [
  'local',
  'public',
  'TESTNET',
  'Testnet',
  'main',
  'dev',
  'test',
  'future',
  ' testnet',
  'testnet ',
  'test net',
  '',
];

const nonStringNetworks = [1, 0, true, false, null, [], {}];

function writeCargoWorkspace(root: string): void {
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
}

describe('configuration network enum', () => {
  it.each(['testnet', 'futurenet', 'mainnet'])(
    'accepts supported network %j',
    (network) => {
      expect(validateStellarForgeConfig({ version: 1, network })).toEqual({
        version: 1,
        network,
      });
    },
  );

  it.each(unsupportedNetworks)(
    'rejects unsupported network %j with an actionable message',
    (network) => {
      expect(() =>
        validateStellarForgeConfig({ version: 1, network }),
      ).toThrow(ENUM_MESSAGE);
    },
  );

  it.each(nonStringNetworks)('rejects non-string network %j', (network) => {
    expect(() => validateStellarForgeConfig({ version: 1, network })).toThrow(
      ENUM_MESSAGE,
    );
  });

  it('does not echo the rejected network value', () => {
    try {
      validateStellarForgeConfig({ version: 1, network: 'SENTINEL-NET' });
      throw new Error('Expected network validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationCliError);
      expect((error as Error).message).not.toContain('SENTINEL-NET');
    }
  });

  it('loads a configuration file with a supported network', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, network: 'futurenet' }),
      );

      expect(loadProjectConfig(root)).toEqual({
        version: 1,
        network: 'futurenet',
      });
    }));

  it('rejects a configuration file with an unsupported network', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, network: 'local' }),
      );

      expect(() => loadProjectConfig(root)).toThrow(ENUM_MESSAGE);
    }));

  it.each(['mainnet', 'futurenet', 'main', 'local', 'Testnet', ''])(
    'keeps the deploy command Testnet-only for network %j',
    (network) =>
      withTempDirectory((root) => {
        writeCargoWorkspace(root);

        expect(() =>
          resolveTestnetDeploymentPlan({
            cwd: root,
            network,
            source: 'alice',
          }),
        ).toThrow('only the explicit `--network testnet`');
      }),
  );

  it('deploys a Cargo workspace on the explicit Testnet target', () =>
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
});
