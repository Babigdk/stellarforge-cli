import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_WASM_ARTIFACT_PATH,
  resolveTestnetDeploymentPlan,
} from '../src/deployment/project.js';
import { ValidationCliError } from '../src/errors/index.js';
import {
  withTempDirectory,
  writeGeneratedWasmArtifact,
} from './helpers/index.js';

const STELLAR_EXECUTABLE =
  process.platform === 'win32' ? 'stellar.exe' : 'stellar';

function writeCargoWorkspace(root: string): void {
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
  writeGeneratedWasmArtifact(root);
}

describe('Stellar deploy argument plan', () => {
  it('locks the exact executable and argument order', () =>
    withTempDirectory((root) => {
      writeCargoWorkspace(root);

      expect(
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source: 'deployer',
        }),
      ).toEqual([
        {
          label: 'stellar:deploy',
          command: STELLAR_EXECUTABLE,
          args: [
            'contract',
            'deploy',
            '--wasm',
            GENERATED_WASM_ARTIFACT_PATH,
            '--source-account',
            'deployer',
            '--network',
            'testnet',
          ],
          cwd: root,
        },
      ]);
    }));

  it('keeps the source alias and network as separate argv entries', () =>
    withTempDirectory((root) => {
      writeCargoWorkspace(root);

      const [spec] = resolveTestnetDeploymentPlan({
        cwd: root,
        network: 'testnet',
        source: 'team-deployer',
      });
      const args = spec?.args ?? [];

      expect(args).toEqual([
        'contract',
        'deploy',
        '--wasm',
        GENERATED_WASM_ARTIFACT_PATH,
        '--source-account',
        'team-deployer',
        '--network',
        'testnet',
      ]);
      expect(args[5]).toBe('team-deployer');
      expect(args[7]).toBe('testnet');
      for (const arg of args) {
        expect(arg).not.toMatch(/\s/);
      }
    }));

  it('rejects a non-Testnet network before building any argument plan', () =>
    withTempDirectory((root) => {
      writeCargoWorkspace(root);

      expect(() =>
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'mainnet',
          source: 'deployer',
        }),
      ).toThrow(ValidationCliError);
      expect(() =>
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'futurenet',
          source: 'deployer',
        }),
      ).toThrow('only the explicit `--network testnet`');
    }));
});
