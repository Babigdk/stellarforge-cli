import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import { resolveDevProcessPlan } from '../src/dev/project.js';
import { withTempDirectory } from './helpers/index.js';

function writePackage(root: string, value: unknown): void {
  writeFileSync(
    join(root, 'package.json'),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

describe('stellarforge dev project diagnostics', () => {
  it('reports an empty directory as unsupported before spawning', () =>
    withTempDirectory((root) => {
      expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);
      expect(() => resolveDevProcessPlan(root)).toThrow(/package\.json/i);
    }));

  it('reports an incomplete scripts object as unsupported', () =>
    withTempDirectory((root) => {
      writePackage(root, { name: 'demo' });
      expect(() => resolveDevProcessPlan(root)).toThrow(/scripts object/);
    }));

  it('reports a non-object scripts value as unsupported', () =>
    withTempDirectory((root) => {
      writePackage(root, { name: 'demo', scripts: ['start'] });
      expect(() => resolveDevProcessPlan(root)).toThrow(/scripts object/);
    }));

  it('reports unsupported scripts with actionable guidance', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'demo',
        scripts: { build: 'node build.js', lint: 'eslint .' },
      });
      expect(() => resolveDevProcessPlan(root)).toThrow(
        /No supported development script/,
      );
    }));

  it('reports malformed package metadata clearly', () =>
    withTempDirectory((root) => {
      writePackage(root, '{ not-json');
      expect(() => resolveDevProcessPlan(root)).toThrow(/not valid JSON/);
    }));

  it('fails ambiguous layouts before any child process can start', () =>
    withTempDirectory((root) => {
      mkdirSync(join(root, 'nested'));
      let spawned = false;
      const spawn = () => {
        spawned = true;
      };

      try {
        resolveDevProcessPlan(root);
        spawn();
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationCliError);
      }

      expect(spawned).toBe(false);
    }));

  it.each(['dev', 'start'])(
    'supports generated Node projects using %s',
    (script) =>
      withTempDirectory((root) => {
        writePackage(root, {
          name: 'demo',
          scripts: { [script]: 'node x.js' },
        });

        const plan = resolveDevProcessPlan(root);

        expect(plan).toHaveLength(1);
        expect(plan[0]?.label).toBe('demo');
        expect(plan[0]?.args).toContain(script);
      }),
  );
});
