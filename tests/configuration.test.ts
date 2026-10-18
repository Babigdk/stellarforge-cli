import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
  resolveProjectConfig,
} from '../src/config/project.js';
import { ValidationCliError } from '../src/errors/errors.js';
import { withTempDirectory } from './helpers/index.js';

describe('project configuration', () => {
  it('returns undefined when project configuration is missing', () =>
    withTempDirectory((root) => {
      expect(loadProjectConfig(root)).toBeUndefined();
      expect(resolveProjectConfig(root)).toEqual({});
    }));

  it('loads a valid versioned configuration from the project root', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({
          version: 1,
          network: 'testnet',
          identity: 'deployer',
        }),
      );

      expect(loadProjectConfig(root)).toEqual({
        version: 1,
        network: 'testnet',
        identity: 'deployer',
      });
    }));

  it('applies CLI overrides above project configuration without inventing missing values', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({
          version: 1,
          network: 'futurenet',
          identity: 'project-deployer',
        }),
      );

      expect(
        resolveProjectConfig(root, {
          network: 'testnet',
          identity: 'cli-deployer',
        }),
      ).toEqual({
        network: 'testnet',
        identity: 'cli-deployer',
      });

      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1 }),
      );
      expect(resolveProjectConfig(root)).toEqual({});
    }));

  it('rejects unsupported networks with an actionable error', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, network: 'local' }),
      );

      expect(() => loadProjectConfig(root)).toThrow(
        'Configuration network must be one of: testnet, futurenet, mainnet.',
      );
    }));

  it('rejects unknown top-level fields with generic non-reflective error', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, unknownField: 'value' }),
      );
      expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);
      try {
        loadProjectConfig(root);
      } catch (e) {
        expect((e as Error).message).not.toContain('unknownField');
        expect((e as Error).message).not.toContain('value');
      }
    }));

  it('rejects nested/array unexpected values safely', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, nested: { bad: 'x' } }),
      );
      expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);
    }));

  it('does not echo secret-looking field values in errors', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, password: 's3cr3t' }),
      );
      try {
        loadProjectConfig(root);
      } catch (e) {
        expect((e as Error).message).not.toContain('s3cr3t');
      }
    }));

  it('schema version remains unchanged (version 1)', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, network: 'testnet' }),
      );
      const cfg = loadProjectConfig(root);
      expect(cfg?.version).toBe(1);
    }));

  it('rejects project-config larger than 64 KiB with predictable error and no content echo', () =>
    withTempDirectory((root) => {
      const large = 'x'.repeat(64 * 1024 + 1);
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, extra: large }),
      );
      try {
        loadProjectConfig(root);
        throw new Error('Expected failure');
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationCliError);
        expect((e as Error).message).toContain('64 KiB');
        expect((e as Error).message).not.toContain(large);
      }
    }));

  it.each([64 * 1024 - 1, 64 * 1024])(
    'does not reject a configuration of exactly %i bytes for size',
    (totalBytes) =>
      withTempDirectory((root) => {
        const base = JSON.stringify({ version: 1, padding: '' });
        const padding = 'x'.repeat(totalBytes - base.length);
        const content = JSON.stringify({ version: 1, padding });
        expect(Buffer.byteLength(content)).toBe(totalBytes);

        writeFileSync(join(root, PROJECT_CONFIG_FILENAME), content);

        try {
          loadProjectConfig(root);
        } catch (error) {
          expect((error as Error).message).not.toContain('64 KiB');
          expect((error as Error).message).toContain('unsupported field');
        }
      }),
  );

  it.each([
    'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ])('rejects raw Stellar StrKey identity value %j', (identity) =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, identity }),
      );

      expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);
    }),
  );

  it('rejects a symlinked project configuration', () =>
    withTempDirectory((root) => {
      const target = join(root, 'actual-config.json');
      writeFileSync(target, JSON.stringify({ version: 1, network: 'testnet' }));
      symlinkSync(target, join(root, PROJECT_CONFIG_FILENAME));

      expect(() => loadProjectConfig(root)).toThrow('not a symbolic link');
    }));
});
