import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
  type ConfigFileMetadata,
  type ConfigFsBoundary,
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

/** The production boundary, reused as a base for deterministic simulations. */
const realBoundary: ConfigFsBoundary = {
  lstat: (path) => lstatSync(path),
  open: (path, flags) => openSync(path, flags),
  fstat: (fd) => fstatSync(fd),
  read: (fd, buffer, offset, length) =>
    readSync(fd, buffer, offset, length, null),
  close: (fd) => closeSync(fd),
};

function metadataWith(
  identity: ConfigFileMetadata,
  overrides: Partial<ConfigFileMetadata> = {},
): ConfigFileMetadata {
  return {
    dev: identity.dev,
    ino: identity.ino,
    size: identity.size,
    isFile: () => identity.isFile(),
    isSymbolicLink: () => identity.isSymbolicLink(),
    ...overrides,
  };
}

function metadataForKind(
  identity: ConfigFileMetadata,
  kind: 'file' | 'directory' | 'symlink',
): ConfigFileMetadata {
  return metadataWith(identity, {
    isFile: () => kind === 'file',
    isSymbolicLink: () => kind === 'symlink',
  });
}

describe('configuration descriptor verification (SW-219)', () => {
  it('requests a no-follow open where the platform exposes O_NOFOLLOW', () =>
    withTempDirectory((root) => {
      writeValidConfig(root);
      let observedFlags: number | undefined;

      const boundary: ConfigFsBoundary = {
        ...realBoundary,
        open: (path, flags) => {
          observedFlags = flags;
          return openSync(path, flags);
        },
      };

      expect(loadProjectConfig(root, boundary)).toEqual({
        version: 1,
        network: 'testnet',
      });

      if (typeof constants.O_NOFOLLOW === 'number') {
        expect(observedFlags).toBeDefined();
        expect((observedFlags ?? 0) & constants.O_NOFOLLOW).toBe(
          constants.O_NOFOLLOW,
        );
      }
    }));

  it('rejects a path swapped for a different regular file between inspection and open', () =>
    withTempDirectory((root) => {
      writeValidConfig(root);
      const attacker = join(root, 'attacker.json');
      writeFileSync(
        attacker,
        JSON.stringify({
          version: 1,
          network: 'mainnet',
          password: 'SW219_SENTINEL',
        }),
      );

      let closedDescriptors = 0;
      const boundary: ConfigFsBoundary = {
        ...realBoundary,
        // Deterministically simulates the entry being replaced by a link to
        // `attacker.json` just before the open. On platforms without
        // O_NOFOLLOW the open follows it, so only the identity check can catch
        // the redirection.
        open: (_path, flags) => openSync(attacker, flags),
        close: (fd) => {
          closedDescriptors += 1;
          realBoundary.close(fd);
        },
      };

      let message = '';
      try {
        loadProjectConfig(root, boundary);
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain('changed while it was being read');
      expect(message).not.toContain('SW219_SENTINEL');
      expect(closedDescriptors).toBe(1);
    }));

  it.skipIf(!symlinksSupported)(
    'rejects a symlink substituted immediately before open',
    () =>
      withTempDirectory((root) => {
        writeValidConfig(root);
        const configPath = join(root, PROJECT_CONFIG_FILENAME);
        const attacker = join(root, 'attacker.json');
        writeFileSync(
          attacker,
          JSON.stringify({
            version: 1,
            network: 'mainnet',
            password: 'SW219_SENTINEL',
          }),
        );

        const boundary: ConfigFsBoundary = {
          ...realBoundary,
          open: (path, flags) => {
            rmSync(configPath);
            symlinkSync(attacker, configPath);
            return openSync(path, flags);
          },
        };

        let message = '';
        try {
          loadProjectConfig(root, boundary);
        } catch (error) {
          message = (error as Error).message;
        }

        expect(message).not.toBe('');
        expect(message).not.toContain('SW219_SENTINEL');
      }),
  );

  it('keeps reading the verified descriptor when the path is replaced after open', () =>
    withTempDirectory((root) => {
      writeValidConfig(root);
      const configPath = join(root, PROJECT_CONFIG_FILENAME);
      const moved = join(root, 'moved-config.json');

      const boundary: ConfigFsBoundary = {
        ...realBoundary,
        fstat: (fd) => {
          const opened = fstatSync(fd);
          renameSync(configPath, moved);
          writeFileSync(
            configPath,
            JSON.stringify({ version: 1, network: 'mainnet' }),
          );
          return opened;
        },
      };

      expect(loadProjectConfig(root, boundary)).toEqual({
        version: 1,
        network: 'testnet',
      });
    }));

  it.skipIf(!symlinksSupported)(
    'keeps reading the verified descriptor when the path becomes a symlink after open',
    () =>
      withTempDirectory((root) => {
        writeValidConfig(root);
        const configPath = join(root, PROJECT_CONFIG_FILENAME);
        const attacker = join(root, 'attacker.json');
        writeFileSync(
          attacker,
          JSON.stringify({ version: 1, network: 'mainnet' }),
        );

        const boundary: ConfigFsBoundary = {
          ...realBoundary,
          fstat: (fd) => {
            const opened = fstatSync(fd);
            // The name is swapped only after a descriptor has been obtained
            // and verified, so the symlink must not affect the bytes read.
            rmSync(configPath);
            symlinkSync(attacker, configPath);
            return opened;
          },
        };

        expect(loadProjectConfig(root, boundary)).toEqual({
          version: 1,
          network: 'testnet',
        });
      }),
  );

  it.each([
    ['symbolic link', 'symlink', 'not a symbolic link'],
    ['directory', 'directory', 'must be a regular project file'],
  ] as const)('rejects an opened %s descriptor', (_label, kind, message) =>
    withTempDirectory((root) => {
      writeValidConfig(root);
      const inspected = lstatSync(join(root, PROJECT_CONFIG_FILENAME));
      const boundary: ConfigFsBoundary = {
        ...realBoundary,
        fstat: () => metadataForKind(inspected, kind),
      };

      expect(() => loadProjectConfig(root, boundary)).toThrow(message);
    }),
  );

  it('rejects a file that grows past the limit after inspection', () =>
    withTempDirectory((root) => {
      writeValidConfig(root);
      const configPath = join(root, PROJECT_CONFIG_FILENAME);
      const inspected = lstatSync(configPath);
      writeFileSync(
        configPath,
        JSON.stringify({ version: 1, padding: 'x'.repeat(64 * 1024) }),
      );

      const boundary: ConfigFsBoundary = {
        ...realBoundary,
        // Report the pre-growth size so only the bounded descriptor read can
        // detect that the file is now too large.
        lstat: () => metadataWith(inspected),
      };

      expect(() => loadProjectConfig(root, boundary)).toThrow('64 KiB');
    }));
});
