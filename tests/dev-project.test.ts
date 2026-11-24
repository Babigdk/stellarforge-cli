import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import { createNpmInvocation } from '../src/process/npm.js';
import {
  MAX_PACKAGE_JSON_BYTES,
  readPackageJsonManifest,
  resolveDevProcessPlan,
  resolveProjectPath,
  resolveProjectRoot,
} from '../src/dev/project.js';
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

function captureValidationMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationCliError);
    return (error as Error).message;
  }

  throw new Error('Expected the resolver to reject the project.');
}

function writeDevManifestOfSize(root: string, size: number): string {
  const base = JSON.stringify({
    name: 'demo',
    scripts: { dev: 'node dev.js' },
  });
  const padding = size - Buffer.byteLength(base);
  expect(padding).toBeGreaterThanOrEqual(0);

  const content = base + ' '.repeat(padding);
  writeFileSync(join(root, 'package.json'), content);
  return content;
}

describe('development project plan', () => {
  it('selects a safe npm start script from a generated Node project', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'demo',
          scripts: { start: 'node src/index.js' },
        }),
      );

      const plan = resolveDevProcessPlan(root);

      expect(plan).toHaveLength(1);
      const npm = createNpmInvocation(['run', 'start']);
      expect(plan[0]).toEqual({
        label: 'demo',
        command: npm.command,
        args: npm.args,
        cwd: root,
      });
    }));

  it('prefers an explicit dev script and never executes package script text itself', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'demo',
          scripts: {
            dev: 'node dev.js --flag && echo unsafe-if-shell-expanded',
            start: 'node start.js',
          },
        }),
      );

      const [spec] = resolveDevProcessPlan(root);

      const npm = createNpmInvocation(['run', 'dev']);
      expect(spec).toMatchObject({ command: npm.command, args: npm.args });
      expect(spec?.args).not.toContain(
        'node dev.js --flag && echo unsafe-if-shell-expanded',
      );
    }));

  it('rejects unsupported or malformed project roots before spawning', () =>
    withTempDirectory((root) => {
      expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);

      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, 'package.json'), '{not-json');
      expect(() => resolveDevProcessPlan(root)).toThrow('not valid JSON');

      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ scripts: {} }),
      );
      expect(() => resolveDevProcessPlan(root)).toThrow(
        'No supported development script',
      );
    }));

  it('selects a lower-precedence script when an earlier candidate is blank', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'demo',
          scripts: { dev: '   ', start: 'node start.js' },
        }),
      );

      const [spec] = resolveDevProcessPlan(root);

      const npm = createNpmInvocation(['run', 'start']);
      expect(spec).toMatchObject({ command: npm.command, args: npm.args });
    }));

  it('ignores whitespace-only start and start:backend to keep precedence sane', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'demo',
          scripts: {
            dev: '\n\t ',
            'start:backend': 'node backend.js',
          },
        }),
      );

      const [spec] = resolveDevProcessPlan(root);

      const npm = createNpmInvocation(['run', 'start:backend']);
      expect(spec).toMatchObject({ command: npm.command, args: npm.args });
    }));

  it('prefers dev over start over start:backend when all are non-blank', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'demo',
          scripts: {
            dev: 'node dev.js',
            start: 'node start.js',
            'start:backend': 'node backend.js',
          },
        }),
      );

      const [spec] = resolveDevProcessPlan(root);

      const npm = createNpmInvocation(['run', 'dev']);
      expect(spec).toMatchObject({ command: npm.command, args: npm.args });
    }));

  it('rejects blank and whitespace-only candidate scripts with actionable guidance', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'demo',
          scripts: { dev: '', start: '   ', 'start:backend': '\n' },
        }),
      );

      expect(() => resolveDevProcessPlan(root)).toThrow(
        /non-blank value.*dev, start, start:backend.*package\.json/,
      );

      // And it never reaches a spawn decision: the resolver throws first.
      expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);
    }));

  it('ignores non-string scripts instead of accepting them as runnable', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'demo',
          scripts: { dev: 42, start: ['node', 'start.js'] },
        }),
      );

      expect(() => resolveDevProcessPlan(root)).toThrow(
        'No supported development script',
      );
    }));

  it('uses one normalized project-root policy for relative and absolute paths', () => {
    expect(resolveProjectRoot('.')).toBe(resolve('.'));
    expect(resolveProjectRoot('workspace/nested/..')).toBe(
      resolve('workspace'),
    );
  });

  it('resolves relative manifest paths with either separator style', () => {
    const root = resolve('workspace');

    expect(resolveProjectPath(root, 'nested', 'package.json')).toBe(
      join(root, 'nested', 'package.json'),
    );
    expect(resolveProjectPath(root, `nested${sep}package.json`)).toBe(
      join(root, 'nested', 'package.json'),
    );
    expect(resolveProjectPath(root, 'nested/package.json')).toBe(
      join(root, 'nested', 'package.json'),
    );
  });

  it('keeps spaces and Unicode in the project path out of argv', () =>
    withTempDirectory((root) => {
      const projectRoot = join(root, 'project with spaces — Ünicode');
      mkdirSync(projectRoot, { recursive: true });
      writeFileSync(
        join(projectRoot, 'package.json'),
        JSON.stringify({ name: 'demo', scripts: { dev: 'node dev.js' } }),
      );

      const [spec] = resolveDevProcessPlan(projectRoot);

      expect(spec?.cwd).toBe(projectRoot);
      expect(spec?.command).not.toContain(projectRoot);
      for (const arg of spec?.args ?? []) {
        expect(arg).not.toContain(projectRoot);
      }
    }));

  it('accepts a package.json exactly at the documented byte limit', () =>
    withTempDirectory((root) => {
      const content = writeDevManifestOfSize(root, MAX_PACKAGE_JSON_BYTES);
      expect(Buffer.byteLength(content)).toBe(MAX_PACKAGE_JSON_BYTES);

      const [spec] = resolveDevProcessPlan(root);
      expect(spec).toMatchObject({ cwd: root });
    }));

  it('rejects an oversized package.json without echoing its path or content', () =>
    withTempDirectory((root) => {
      const content = writeDevManifestOfSize(root, MAX_PACKAGE_JSON_BYTES + 1);
      expect(Buffer.byteLength(content)).toBe(MAX_PACKAGE_JSON_BYTES + 1);

      const readMessage = (): string => {
        try {
          resolveDevProcessPlan(root);
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
      expect(message).not.toContain('node dev.js');
    }));

  it('keeps a missing manifest distinguishable from a directory entry', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');

      const missing = captureValidationMessage(() =>
        resolveDevProcessPlan(root),
      );
      expect(missing).toContain('No package.json was found');

      mkdirSync(join(root, 'package.json'));
      const invalid = captureValidationMessage(() =>
        resolveDevProcessPlan(root),
      );
      expect(invalid).toContain('must be a regular project file');
      expect(invalid).not.toContain(root);
    }));

  it('applies the regular-file policy in the shared manifest reader', () =>
    withTempDirectory((root) => {
      const packagePath = join(root, 'package.json');
      mkdirSync(packagePath);

      expect(() => readPackageJsonManifest(packagePath)).toThrow(
        'must be a regular project file',
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
            scripts: { dev: 'NODE_DEV_SYMLINK_TARGET_MARKER' },
          }),
        );
        symlinkSync(target, join(root, 'package.json'));

        const message = captureValidationMessage(() =>
          resolveDevProcessPlan(root),
        );
        expect(message).toContain('not a symbolic link');
        expect(message).not.toContain(root);
        expect(message).not.toContain(target);
        expect(message).not.toContain('NODE_DEV_SYMLINK_TARGET_MARKER');
      }),
  );

  it.skipIf(!symlinksSupported)(
    'rejects a dangling package.json symlink instead of treating it as missing',
    () =>
      withTempDirectory((root) => {
        const target = join(root, 'missing-target.json');
        symlinkSync(target, join(root, 'package.json'));

        const message = captureValidationMessage(() =>
          resolveDevProcessPlan(root),
        );
        expect(message).toContain('not a symbolic link');
        expect(message).not.toContain('No package.json was found');
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
          resolveDevProcessPlan(root),
        );
        expect(message).toContain('not a symbolic link');
        expect(message).not.toContain(root);
        expect(message).not.toContain(target);
      }),
  );
});
