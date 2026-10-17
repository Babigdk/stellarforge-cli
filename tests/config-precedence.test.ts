import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
  resolveProjectConfig,
} from '../src/config/project.js';
import { ValidationCliError } from '../src/errors/index.js';
import { withTempDirectory } from './helpers/index.js';

function writeConfig(root: string, value: unknown): void {
  writeFileSync(join(root, PROJECT_CONFIG_FILENAME), JSON.stringify(value));
}

describe('configuration precedence', () => {
  it('prefers explicit CLI overrides over project configuration', () =>
    withTempDirectory((root) => {
      writeConfig(root, {
        version: 1,
        network: 'futurenet',
        identity: 'project-deployer',
      });

      expect(
        resolveProjectConfig(root, {
          network: 'testnet',
          identity: 'cli-deployer',
        }),
      ).toEqual({ network: 'testnet', identity: 'cli-deployer' });
    }));

  it('uses project configuration when no CLI override is provided', () =>
    withTempDirectory((root) => {
      writeConfig(root, {
        version: 1,
        network: 'futurenet',
        identity: 'project-deployer',
      });

      expect(resolveProjectConfig(root)).toEqual({
        network: 'futurenet',
        identity: 'project-deployer',
      });
    }));

  it('applies a partial override without discarding the other project value', () =>
    withTempDirectory((root) => {
      writeConfig(root, {
        version: 1,
        network: 'futurenet',
        identity: 'project-deployer',
      });

      expect(resolveProjectConfig(root, { identity: 'cli-deployer' })).toEqual({
        network: 'futurenet',
        identity: 'cli-deployer',
      });
      expect(resolveProjectConfig(root, { network: 'testnet' })).toEqual({
        network: 'testnet',
        identity: 'project-deployer',
      });
    }));

  it('does not invent missing values', () =>
    withTempDirectory((root) => {
      writeConfig(root, { version: 1 });

      expect(resolveProjectConfig(root)).toEqual({});
      expect(resolveProjectConfig(root, {})).toEqual({});
    }));

  it('reports a missing configuration without a default', () =>
    withTempDirectory((root) => {
      expect(loadProjectConfig(root)).toBeUndefined();
      expect(resolveProjectConfig(root)).toEqual({});
    }));

  it('validates a CLI identity override before accepting it', () =>
    withTempDirectory((root) => {
      expect(() =>
        resolveProjectConfig(root, { identity: '../escape-attempt' }),
      ).toThrow(ValidationCliError);
    }));

  it('does not consult environment variables for precedence', () =>
    withTempDirectory((root) => {
      const environmentKeys = [
        'STELLARFORGE_NETWORK',
        'STELLARFORGE_IDENTITY',
        'STELLAR_NETWORK',
        'NETWORK',
        'IDENTITY',
      ];
      const previous = new Map<string, string | undefined>();
      for (const key of environmentKeys) {
        previous.set(key, process.env[key]);
        process.env[key] = 'mainnet';
      }

      try {
        expect(resolveProjectConfig(root)).toEqual({});

        writeConfig(root, {
          version: 1,
          network: 'testnet',
          identity: 'project-deployer',
        });

        expect(resolveProjectConfig(root)).toEqual({
          network: 'testnet',
          identity: 'project-deployer',
        });
      } finally {
        for (const key of environmentKeys) {
          const value = previous.get(key);
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    }));
});
