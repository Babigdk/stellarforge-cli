import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CliVersionResolutionError,
  resolveCliMetadata,
  resolveCliVersion,
} from '../src/version.js';
import { createRootCommand } from '../src/commands/root.js';
import { repositoryRoot } from './helpers/index.js';

const packageJson = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as {
  name: string;
  version: string;
  description: string;
  bin: Record<string, string>;
};

const BIN_KEY = Object.keys(packageJson.bin)[0];

describe('CLI version resolution', () => {
  it('returns the package metadata version', () => {
    expect(
      resolveCliVersion(() => ({
        version: '1.2.3',
        description: 'd',
        bin: { x: 'd' },
      })),
    ).toBe('1.2.3');
  });

  it.each([
    {},
    { version: '' },
    { version: '   ' },
    { version: 123 },
    null,
    { version: '1.2.3', description: '' },
    { version: '1.2.3', description: 1 },
    { version: '1.2.3', description: 'd', bin: 'dist/cli.js' },
    { version: '1.2.3', description: 'd', bin: { x: 'a', y: 'b' } },
  ])('rejects invalid package metadata: %j', (metadata) => {
    expect(() => resolveCliMetadata(() => metadata)).toThrow(
      CliVersionResolutionError,
    );
  });

  it('wraps package metadata loading failures predictably', () => {
    const cause = new Error('package metadata unavailable');

    try {
      resolveCliVersion(() => {
        throw cause;
      });
      throw new Error('Expected version resolution to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CliVersionResolutionError);
      expect((error as CliVersionResolutionError).cause).toBe(cause);
    }
  });

  it('reports the manifest bin name when the bin is a single string', () => {
    expect(
      resolveCliMetadata(() => ({
        name: '@scope/package',
        version: '1.2.3',
        description: 'anything',
        bin: 'dist/cli.js',
      })).executable,
    ).toBe('package');
  });
});

describe('root command metadata parity', () => {
  it('reports the manifest version via resolveCliVersion()', () => {
    expect(resolveCliVersion()).toBe(packageJson.version);
  });

  it('uses the bin executable name for the root command', () => {
    expect(createRootCommand('9.9.9').name()).toBe(BIN_KEY);
    expect(Object.keys(packageJson.bin)).toHaveLength(1);
  });

  it('uses the manifest description, not a stale hard-coded string', () => {
    expect(createRootCommand('9.9.9').description()).toBe(
      packageJson.description,
    );
  });

  it('uses the manifest description in global help', () => {
    const help = createRootCommand('9.9.9').helpInformation();

    expect(help).toContain(`Usage: ${BIN_KEY} [options] [command]`);
    expect(help).toContain(packageJson.description);
  });

  it('falls back to the manifest version when no version override is given', () => {
    expect(createRootCommand().version()).toBe(packageJson.version);
    expect(createRootCommand('override').version()).toBe('override');
  });
});
