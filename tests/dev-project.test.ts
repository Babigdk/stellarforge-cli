import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import { createNpmInvocation } from '../src/process/npm.js';
import {
  resolveDevProcessPlan,
  resolveProjectPath,
  resolveProjectRoot,
} from '../src/dev/project.js';
import { withTempDirectory } from './helpers/index.js';

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
});
