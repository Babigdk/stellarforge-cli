import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import {
  planProjectDestination,
  validateProjectInput,
  type DestinationFileSystem,
} from '../src/generator/validation.js';
import { withTempDirectory } from './helpers/index.js';

const platformSep = process.platform === 'win32' ? '\\' : '/';

const emptyFileSystem: DestinationFileSystem = {
  exists: () => false,
  isDirectory: () => false,
  entries: () => [],
};

function validated(cwd: string, projectName: string) {
  return validateProjectInput({ cwd, projectName });
}

describe('generator destination containment', () => {
  it('keeps a normalized destination inside the selected root', () => {
    const input = validated('/workspace/./nested/..', 'demo');
    const plan = planProjectDestination(input, emptyFileSystem);

    expect(plan.destination).toBe(resolve('/workspace', 'demo'));
    expect(plan.destination.startsWith(resolve('/workspace'))).toBe(true);
  });

  it('resolves relative cwd segments before planning', () => {
    const input = validated('./workspace/../workspace', 'app');
    const plan = planProjectDestination(input, emptyFileSystem);

    expect(plan.destination).toBe(resolve('workspace', 'app'));
    expect(plan.destination).toBe(resolve(input.cwd, 'app'));
  });

  it('rejects parent-directory traversal in the project name', () => {
    expect(() => validated('/workspace', '..')).toThrow(ValidationCliError);
    expect(() => validated('/workspace', '../evil')).toThrow(
      ValidationCliError,
    );
    expect(() => validated('/workspace', `..${platformSep}evil`)).toThrow(
      ValidationCliError,
    );
  });

  it.each(['/absolute', 'nested/child', `nested${sep}child`, 'a\\b', 'a/b'])(
    'rejects path-bearing project name %j',
    (projectName) => {
      expect(() => validated('/workspace', projectName)).toThrow(
        ValidationCliError,
      );
    },
  );

  it('fails containment when a crafted destination escapes the root', () => {
    const input = validateProjectInput({
      projectName: 'demo',
      cwd: '/workspace',
    });

    expect(() =>
      planProjectDestination({ ...input, projectName: '..' }, emptyFileSystem),
    ).toThrow(ValidationCliError);
  });

  it('revalidates an existing empty destination as writable', () =>
    withTempDirectory((root) => {
      mkdirSync(join(root, 'demo'));

      const fs: DestinationFileSystem = {
        exists: () => true,
        isDirectory: () => true,
        entries: () => [],
      };

      const plan = planProjectDestination(validated(root, 'demo'), fs);

      expect(plan.destination).toBe(join(resolve(root), 'demo'));
    }));

  it('rejects an existing non-empty destination without touching it', () =>
    withTempDirectory((root) => {
      mkdirSync(join(root, 'demo'));
      writeFileSync(join(root, 'demo', 'existing.txt'), 'keep');

      const fs: DestinationFileSystem = {
        exists: () => true,
        isDirectory: () => true,
        entries: () => ['existing.txt'],
      };

      expect(() => planProjectDestination(validated(root, 'demo'), fs)).toThrow(
        'not empty',
      );
    }));

  it('rejects a destination that already exists as a file', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'demo'), 'file');

      const fs: DestinationFileSystem = {
        exists: () => true,
        isDirectory: () => false,
        entries: () => [],
      };

      expect(() => planProjectDestination(validated(root, 'demo'), fs)).toThrow(
        'not a directory',
      );
    }));

  it('resolves an existing ancestor without escaping the root', () =>
    withTempDirectory((root) => {
      mkdirSync(join(root, 'existing'));
      const input = validated(join(root, 'existing', '..'), 'demo');
      const plan = planProjectDestination(input, emptyFileSystem);

      expect(input.cwd).toBe(resolve(root));
      expect(plan.destination).toBe(join(resolve(root), 'demo'));
    }));

  it('does not accept a destination equal to the selected root', () => {
    const input = validateProjectInput({
      projectName: 'demo',
      cwd: '/workspace',
    });

    expect(() =>
      planProjectDestination(
        { ...input, projectName: '.' },
        emptyFileSystem,
      ),
    ).toThrow(ValidationCliError);
  });
});
