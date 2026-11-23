import { mkdirSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDevProcessPlan } from '../src/dev/project.js';
import { ValidationCliError } from '../src/errors/errors.js';
import { resolveTestProcessPlan } from '../src/testing/project.js';
import { withTempDirectory } from './helpers/index.js';

const MAX_DEPTH = 8;

function writePackage(
  root: string,
  scripts: Record<string, string> = {
    dev: 'node dev.js',
    test: 'node --test',
  },
): void {
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'demo', scripts }),
  );
}

describe('nested project root discovery', () => {
  it('resolves a project root from nested folders for dev and test', () =>
    withTempDirectory((root) => {
      writePackage(root);
      const nested = join(root, 'frontend', 'src');
      mkdirSync(nested, { recursive: true });

      expect(resolveDevProcessPlan(nested)[0]?.cwd).toBe(root);
      expect(resolveTestProcessPlan(nested)[0]?.cwd).toBe(root);
    }));

  it('uses the generated marker as a bounded root boundary', () =>
    withTempDirectory((root) => {
      writePackage(root);
      writeFileSync(join(root, '.stellarforge.json'), '{}');
      const nested = join(root, 'backend', 'src');
      mkdirSync(nested, { recursive: true });

      expect(resolveDevProcessPlan(nested)[0]?.cwd).toBe(root);
      expect(resolveTestProcessPlan(nested)[0]?.cwd).toBe(root);
    }));

  it('rejects multiple supported project roots instead of guessing', () =>
    withTempDirectory((root) => {
      writePackage(root);
      const nested = join(root, 'frontend');
      mkdirSync(nested);
      writePackage(nested);

      expect(() => resolveDevProcessPlan(nested)).toThrow(ValidationCliError);
      expect(() => resolveDevProcessPlan(nested)).toThrow(
        /Multiple supported StellarForge project roots/,
      );
      expect(() => resolveTestProcessPlan(nested)).toThrow(
        /Multiple supported StellarForge project roots/,
      );
    }));

  it('stops discovery at a repository boundary', () =>
    withTempDirectory((root) => {
      writePackage(root);
      const boundary = join(root, 'repo');
      const nested = join(boundary, 'frontend', 'src');
      mkdirSync(join(boundary, '.git'), { recursive: true });
      mkdirSync(nested, { recursive: true });

      expect(() => resolveDevProcessPlan(nested)).toThrow(
        /No supported StellarForge project root/,
      );
      expect(() => resolveTestProcessPlan(nested)).toThrow(
        /No supported StellarForge project root/,
      );
    }));

  it('stops discovery at the maximum search depth', () =>
    withTempDirectory((root) => {
      writePackage(root);
      const deep = join(
        root,
        ...Array.from({ length: MAX_DEPTH + 2 }, (_, index) =>
          `level-${index}`,
        ),
      );
      mkdirSync(deep, { recursive: true });

      expect(() => resolveDevProcessPlan(deep)).toThrow(
        /No supported StellarForge project root/,
      );
    }));

  it('terminates at a filesystem root without finding a project', () => {
    const filesystemRoot = parse(process.cwd()).root;

    expect(() => resolveDevProcessPlan(filesystemRoot)).toThrow(
      ValidationCliError,
    );
    expect(() => resolveTestProcessPlan(filesystemRoot)).toThrow(
      ValidationCliError,
    );
  });
});
