import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import { createNpmInvocation } from '../src/process/npm.js';
import { createTestCommand } from '../src/commands/test.js';
import {
  MAX_PACKAGE_JSON_BYTES,
  resolveDevProcessPlan,
  resolveProjectPath,
  resolveProjectRoot,
} from '../src/dev/project.js';
import { resolveTestProcessPlan } from '../src/testing/project.js';
import {
  createCapturedTerminalOutput,
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

function captureValidationMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationCliError);
    return (error as Error).message;
  }

  throw new Error('Expected the resolver to reject the project.');
}

function writeTestManifestOfSize(root: string, size: number): string {
  const base = JSON.stringify({
    name: 'demo',
    scripts: { test: 'vitest run' },
  });
  const padding = size - Buffer.byteLength(base);
  expect(padding).toBeGreaterThanOrEqual(0);

  const content = base + ' '.repeat(padding);
  writeFileSync(join(root, 'package.json'), content);
  return content;
}

describe('project test workflow resolution', () => {
  it('resolves a Node.js test script without executing package script text directly', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'demo',
          scripts: { test: 'node --test && echo never-interpolated' },
        }),
      );

      const npm = createNpmInvocation(['run', 'test']);
      expect(resolveTestProcessPlan(root)).toEqual([
        {
          label: 'demo:test',
          command: npm.command,
          args: npm.args,
          cwd: root,
        },
      ]);
    }));

  it('resolves a Cargo workspace test workflow', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');

      expect(resolveTestProcessPlan(root)).toEqual([
        {
          label: 'cargo:test',
          command: process.platform === 'win32' ? 'cargo.exe' : 'cargo',
          args: ['test'],
          cwd: root,
        },
      ]);
    }));

  it.each(['', ' ', '  ', '\t', '\n', '\r\n', '   \n\t  ', '\u00A0'])(
    'rejects a present-but-blank test script: %j',
    (script) =>
      withTempDirectory((root) => {
        writeFileSync(
          join(root, 'package.json'),
          JSON.stringify({ name: 'demo', scripts: { test: script } }),
        );

        expect(() => resolveTestProcessPlan(root)).toThrow(ValidationCliError);
        expect(() => resolveTestProcessPlan(root)).toThrow(
          'defines an empty package.json test script',
        );
      }),
  );

  it('does not spawn npm for an empty test script when the command path is used', async () => {
    const spawnMock = vi.fn();
    const captured = createCapturedTerminalOutput();

    await withTempDirectory(async (root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'demo', scripts: { test: '   ' } }),
      );

      const command = createTestCommand({
        cwd: () => root,
        output: captured.output,
        spawnProcess: spawnMock as never,
      });

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(
        'defines an empty package.json test script',
      );
      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  it('keeps resolving whitespace-trimmed (but non-empty) scripts unchanged', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'demo', scripts: { test: '  vitest run  ' } }),
      );

      expect(resolveTestProcessPlan(root)).toEqual([
        {
          label: 'demo:test',
          command: createNpmInvocation(['run', 'test']).command,
          args: createNpmInvocation(['run', 'test']).args,
          cwd: root,
        },
      ]);
    }));

  it('rejects unsupported and malformed projects with actionable guidance', () =>
    withTempDirectory((root) => {
      expect(() => resolveTestProcessPlan(root)).toThrow(ValidationCliError);
      expect(() => resolveTestProcessPlan(root)).toThrow(
        'No supported StellarForge project root',
      );

      writeFileSync(join(root, 'package.json'), '{not-json');
      expect(() => resolveTestProcessPlan(root)).toThrow('not valid JSON');

      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ scripts: { start: 'node app.js' } }),
      );
      expect(() => resolveTestProcessPlan(root)).toThrow(
        'does not define a test script',
      );
    }));

  it('shares the normalized project-root policy used by dev', () => {
    expect(resolveProjectRoot('.')).toBe(resolve('.'));
    expect(resolveProjectRoot('workspace/nested/..')).toBe(
      resolve('workspace'),
    );
    expect(resolveProjectPath(resolve('workspace'), 'Cargo.toml')).toBe(
      join(resolve('workspace'), 'Cargo.toml'),
    );
  });

  it('resolves test manifests with either separator style', () => {
    const root = resolve('workspace');

    expect(resolveProjectPath(root, `nested${sep}Cargo.toml`)).toBe(
      join(root, 'nested', 'Cargo.toml'),
    );
    expect(resolveProjectPath(root, 'nested/Cargo.toml')).toBe(
      join(root, 'nested', 'Cargo.toml'),
    );
  });

  it('keeps spaces and Unicode in the project path out of test argv', () =>
    withTempDirectory((root) => {
      const projectRoot = join(root, 'test project — Ünicode');
      mkdirSync(projectRoot, { recursive: true });
      writeFileSync(
        join(projectRoot, 'package.json'),
        JSON.stringify({ name: 'demo', scripts: { test: 'vitest run' } }),
      );

      const [spec] = resolveTestProcessPlan(projectRoot);

      expect(spec?.cwd).toBe(projectRoot);
      expect(spec?.command).not.toContain(projectRoot);
      for (const arg of spec?.args ?? []) {
        expect(arg).not.toContain(projectRoot);
      }
    }));

  it('accepts a package.json exactly at the documented byte limit', () =>
    withTempDirectory((root) => {
      const content = writeTestManifestOfSize(root, MAX_PACKAGE_JSON_BYTES);
      expect(Buffer.byteLength(content)).toBe(MAX_PACKAGE_JSON_BYTES);

      const [spec] = resolveTestProcessPlan(root);
      expect(spec).toMatchObject({ cwd: root });
    }));

  it('rejects an oversized package.json without echoing its path or content', () =>
    withTempDirectory((root) => {
      const content = writeTestManifestOfSize(root, MAX_PACKAGE_JSON_BYTES + 1);
      expect(Buffer.byteLength(content)).toBe(MAX_PACKAGE_JSON_BYTES + 1);

      const readMessage = (): string => {
        try {
          resolveTestProcessPlan(root);
          return '';
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationCliError);
          return (error as Error).message;
        }
      };

      const message = readMessage();
      expect(message).toContain('package.json exceeds');
      expect(message).toContain(`${MAX_PACKAGE_JSON_BYTES} bytes`);
      expect(message).not.toContain(root);
      expect(message).not.toContain('vitest run');
    }));

  it('keeps a missing manifest distinguishable from a directory entry', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      expect(resolveTestProcessPlan(root)).toEqual([
        {
          label: 'cargo:test',
          command: process.platform === 'win32' ? 'cargo.exe' : 'cargo',
          args: ['test'],
          cwd: root,
        },
      ]);

      mkdirSync(join(root, 'package.json'));
      const message = captureValidationMessage(() =>
        resolveTestProcessPlan(root),
      );
      expect(message).toContain('must be a regular project file');
      expect(message).not.toContain(root);
    }));

  it('applies the same entry policy as the dev resolver', () =>
    withTempDirectory((root) => {
      mkdirSync(join(root, 'package.json'));

      expect(captureValidationMessage(() => resolveDevProcessPlan(root))).toBe(
        captureValidationMessage(() => resolveTestProcessPlan(root)),
      );
    }));

  it.skipIf(!symlinksSupported)(
    'rejects a file symlink as package.json without reading its target',
    () =>
      withTempDirectory((root) => {
        const target = join(root, 'outside-manifest.json');
        writeFileSync(
          target,
          JSON.stringify({
            name: 'target',
            scripts: { test: 'TEST_SYMLINK_TARGET_MARKER' },
          }),
        );
        symlinkSync(target, join(root, 'package.json'));

        const message = captureValidationMessage(() =>
          resolveTestProcessPlan(root),
        );
        expect(message).toContain('not a symbolic link');
        expect(message).not.toContain(root);
        expect(message).not.toContain(target);
        expect(message).not.toContain('TEST_SYMLINK_TARGET_MARKER');
      }),
  );

  it.skipIf(!symlinksSupported)(
    'rejects a dangling package.json symlink instead of falling back to Cargo',
    () =>
      withTempDirectory((root) => {
        writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
        const target = join(root, 'missing-target.json');
        symlinkSync(target, join(root, 'package.json'));

        const message = captureValidationMessage(() =>
          resolveTestProcessPlan(root),
        );
        expect(message).toContain('not a symbolic link');
        expect(message).not.toContain(root);
        expect(message).not.toContain(target);
      }),
  );

  it.skipIf(!symlinksSupported)(
    'rejects a directory symlink in place of package.json',
    () =>
      withTempDirectory((root) => {
        const target = join(root, 'manifest-directory');
        mkdirSync(target);
        symlinkSync(
          target,
          join(root, 'package.json'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );

        const message = captureValidationMessage(() =>
          resolveTestProcessPlan(root),
        );
        expect(message).toContain('not a symbolic link');
        expect(message).not.toContain(root);
        expect(message).not.toContain(target);
      }),
  );
});
