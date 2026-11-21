import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import { createNpmInvocation } from '../src/process/npm.js';
import { createTestCommand } from '../src/commands/test.js';
import { resolveTestProcessPlan } from '../src/testing/project.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';

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
        'No supported StellarForge test workflow',
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
});
