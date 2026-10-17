import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createTestCommand } from '../src/commands/test.js';
import type { ManagedChildProcess } from '../src/dev/orchestrator.js';
import { SubprocessCliError, ValidationCliError } from '../src/errors/index.js';
import { createNpmInvocation } from '../src/process/npm.js';
import { resolveTestProcessPlan } from '../src/testing/project.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';

class TestChild implements ManagedChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  #exitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;

  once(event: 'error', listener: (error: Error) => void): this;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  once(
    event: 'error' | 'exit',
    listener:
      | ((error: Error) => void)
      | ((code: number | null, signal: NodeJS.Signals | null) => void),
  ): this {
    if (event === 'exit') {
      this.#exitListener = listener as (
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => void;
    }
    return this;
  }

  kill(): boolean {
    return true;
  }

  exit(code: number): void {
    this.#exitListener?.(code, null);
  }
}

function writeNodeProject(root: string, name = 'demo'): void {
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name, scripts: { test: 'node --test' } }),
  );
}

describe('unified test orchestration regression coverage', () => {
  it('selects the Node.js test workflow through npm without executing script text', () =>
    withTempDirectory((root) => {
      writeNodeProject(root);
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

  it('selects the Cargo test workflow for a Cargo workspace', () =>
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

  it('prefers the Node.js workflow when both project forms are present', () =>
    withTempDirectory((root) => {
      writeNodeProject(root);
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');

      expect(resolveTestProcessPlan(root)[0]?.label).toBe('demo:test');
    }));

  it('rejects unsupported and malformed projects with actionable guidance', () =>
    withTempDirectory((root) => {
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

  it('streams a successful Node.js test workflow', async () => {
    const child = new TestChild();
    const captured = createCapturedTerminalOutput();
    const command = createTestCommand({
      cwd: () => '/workspace',
      output: captured.output,
      resolvePlan: () => [
        {
          label: 'demo:test',
          command: 'npm',
          args: ['run', 'test'],
          cwd: '/workspace',
        },
      ],
      spawnProcess: () => child,
    });

    const running = command.parseAsync(['node', 'test']);
    child.stdout.write('all tests passed\n');
    child.stderr.write('coverage summary\n');
    child.exit(0);
    await running;

    expect(captured.stdoutText()).toContain('Running 1 project test workflow.');
    expect(captured.stdoutText()).toContain('[demo:test] all tests passed');
    expect(captured.stderrText()).toContain('[demo:test] coverage summary');
  });

  it('streams a successful Cargo test workflow', async () => {
    const child = new TestChild();
    const captured = createCapturedTerminalOutput();
    const command = createTestCommand({
      cwd: () => '/workspace',
      output: captured.output,
      resolvePlan: () => [
        {
          label: 'cargo:test',
          command: 'cargo',
          args: ['test'],
          cwd: '/workspace',
        },
      ],
      spawnProcess: () => child,
    });

    const running = command.parseAsync(['node', 'test']);
    child.stdout.write('test result: ok\n');
    child.exit(0);
    await running;

    expect(captured.stdoutText()).toContain('[cargo:test] test result: ok');
  });

  it('preserves a failing project test as a subprocess failure', async () => {
    const child = new TestChild();
    const command = createTestCommand({
      cwd: () => '/workspace',
      resolvePlan: () => [
        {
          label: 'demo:test',
          command: 'npm',
          args: ['run', 'test'],
          cwd: '/workspace',
        },
      ],
      spawnProcess: () => child,
    });

    const running = command.parseAsync(['node', 'test']);
    child.exit(9);

    const error = await running.then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(SubprocessCliError);
    expect((error as SubprocessCliError).userMessage).toContain('with code 9');
  });

  it('does not start a process for an unsupported project', () =>
    withTempDirectory(async (root) => {
      let spawnCalled = false;
      const command = createTestCommand({
        cwd: () => root,
        spawnProcess: () => {
          spawnCalled = true;
          return new TestChild();
        },
      });

      await expect(command.parseAsync(['node', 'test'])).rejects.toBeInstanceOf(
        ValidationCliError,
      );
      expect(spawnCalled).toBe(false);
    }));

  it('does not start a process for a malformed project configuration', () =>
    withTempDirectory(async (root) => {
      writeFileSync(join(root, 'package.json'), '{not-json');
      let spawnCalled = false;
      const command = createTestCommand({
        cwd: () => root,
        spawnProcess: () => {
          spawnCalled = true;
          return new TestChild();
        },
      });

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(
        'not valid JSON',
      );
      expect(spawnCalled).toBe(false);
    }));
});
