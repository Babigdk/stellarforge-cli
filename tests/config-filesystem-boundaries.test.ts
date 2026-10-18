import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
} from '../src/config/project.js';
import { ValidationCliError } from '../src/errors/index.js';
import {
  createTempDirectoryFixture,
  withTempDirectory,
} from './helpers/index.js';

function canCreateSymlink(): boolean {
  const fixture = createTempDirectoryFixture();
  try {
    const target = join(fixture.path, 'target');
    writeFileSync(target, 'link-target');
    symlinkSync(target, join(fixture.path, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    fixture.cleanup();
  }
}

const symlinksSupported = canCreateSymlink();

function writeValidConfig(root: string, name = PROJECT_CONFIG_FILENAME): void {
  writeFileSync(
    join(root, name),
    JSON.stringify({ version: 1, network: 'testnet' }),
  );
}

describe('configuration filesystem boundaries', () => {
  it('loads only the exact project-root configuration filename', () =>
    withTempDirectory((root) => {
      writeValidConfig(root);

      expect(loadProjectConfig(root)).toEqual({
        version: 1,
        network: 'testnet',
      });
    }));

  it.each([
    'config.json',
    '.stellarforge.config.json',
    'stellarforge.config.json.bak',
    'stellarforge.config.jsonc',
  ])('ignores a differently named file %j', (name) =>
    withTempDirectory((root) => {
      writeValidConfig(root, name);

      expect(loadProjectConfig(root)).toBeUndefined();
    }),
  );

  it('ignores a configuration file outside the project root', () =>
    withTempDirectory((root) => {
      const nested = join(root, 'nested');
      mkdirSync(nested);
      writeValidConfig(nested);

      expect(loadProjectConfig(root)).toBeUndefined();
    }));

  it('rejects a directory in place of the configuration file', () =>
    withTempDirectory((root) => {
      mkdirSync(join(root, PROJECT_CONFIG_FILENAME));

      expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);
      expect(() => loadProjectConfig(root)).toThrow(
        'must be a regular project file',
      );
    }));

  it.skipIf(!symlinksSupported)('rejects a symlinked configuration file', () =>
    withTempDirectory((root) => {
      const target = join(root, 'actual-config.json');
      writeFileSync(target, JSON.stringify({ version: 1, network: 'testnet' }));
      symlinkSync(target, join(root, PROJECT_CONFIG_FILENAME));

      expect(() => loadProjectConfig(root)).toThrow('not a symbolic link');
    }),
  );

  it.skipIf(!symlinksSupported)(
    'rejects a directory symlink in place of the configuration file',
    () =>
      withTempDirectory((root) => {
        const target = join(root, 'config-dir');
        mkdirSync(target);
        symlinkSync(target, join(root, PROJECT_CONFIG_FILENAME), 'junction');

        expect(() => loadProjectConfig(root)).toThrow('not a symbolic link');
      }),
  );

  it.skipIf(!symlinksSupported)(
    'treats a dangling symlink as a missing configuration',
    () =>
      withTempDirectory((root) => {
        symlinkSync(
          join(root, 'missing-target.json'),
          join(root, PROJECT_CONFIG_FILENAME),
        );

        expect(loadProjectConfig(root)).toBeUndefined();
      }),
  );
});
