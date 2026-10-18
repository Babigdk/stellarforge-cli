/**
 * Dev supervisor cleanup umbrella (SW-065, #166).
 *
 * Pulls the failure-path cleanup cases together into one regression suite. The
 * existing `dev-orchestrator.test.ts` covers a single-child spawn failure and a
 * two-child sibling exit, so two properties of cleanup were still unverified:
 *
 *   - **No child is orphaned.** With more than two children, a failure partway
 *     through the spawn loop must still terminate every child that was already
 *     started. The existing case only proves the second child is signalled, which
 *     cannot distinguish "all children killed" from "the next one killed".
 *
 *   - **The failure cause survives.** `fail()` wraps the original error as the
 *     `cause` of a `SubprocessCliError` so the underlying reason is not lost.
 *     The existing case asserts only the error *type* and message; nothing
 *     checked that the cause is actually attached.
 *
 * Cleanup is also idempotent — but the repeated-signal half of that contract is
 * covered separately by `dev-orchestrator-signal-idempotency.test.ts`, so this
 * file stays focused on failure paths.
 */

import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  superviseDevProcesses,
  type DevSignalSource,
  type ManagedChildProcess,
} from '../src/dev/orchestrator.js';
import type { DevProcessSpec } from '../src/dev/project.js';
import { SubprocessCliError } from '../src/errors/errors.js';
import { createCapturedTerminalOutput } from './helpers/index.js';

class FakeChild implements ManagedChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killedSignals: NodeJS.Signals[] = [];
  #errorListener: ((error: Error) => void) | undefined;
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
    if (event === 'error') {
      this.#errorListener = listener as (error: Error) => void;
    } else {
      this.#exitListener = listener as (
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => void;
    }
    return this;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killedSignals.push(signal);
    queueMicrotask(() => this.emitExit(null, signal));
    return true;
  }

  emitError(error: Error): void {
    this.#errorListener?.(error);
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

function specs(...labels: string[]): DevProcessSpec[] {
  return labels.map((label) => ({
    label,
    command: 'npm',
    args: ['run', 'start'],
    cwd: '/workspace',
  }));
}

describe('supervisor cleanup never orphans a child (#166)', () => {
  it('terminates every started child when one fails to spawn', async () => {
    const spawned: FakeChild[] = [];

    const running = superviseDevProcesses(
      specs('database', 'api', 'worker'),
      {
        spawnProcess(planned) {
          if (planned.label === 'api') {
            throw new Error('spawn EACCES');
          }
          const child = new FakeChild();
          spawned.push(child);
          return child;
        },
        signalSource: new FakeSignalSource(),
      },
    );

    await expect(running).rejects.toBeInstanceOf(SubprocessCliError);

    // Only 'database' was started before the failure, and it must not be left
    // running. 'worker' was never spawned, so there is nothing to clean up.
    expect(spawned).toHaveLength(1);
    for (const child of spawned) {
      expect(child.killedSignals).toEqual(['SIGTERM']);
    }
  });

  it('terminates all siblings when one exits non-zero', async () => {
    const children = [new FakeChild(), new FakeChild(), new FakeChild()];
    let index = 0;

    const running = superviseDevProcesses(
      specs('database', 'api', 'worker'),
      {
        spawnProcess: () => children[index++]!,
        signalSource: new FakeSignalSource(),
      },
    );

    children[1]?.emitExit(3, null);

    await expect(running).rejects.toThrow('exited unexpectedly with code 3');

    for (const child of children) {
      expect(child.killedSignals).toEqual(['SIGTERM']);
    }
  });

  it('preserves the original error as the cause of a spawn failure', async () => {
    const original = new Error('spawn EACCES on /usr/bin/npm');
    const captured = createCapturedTerminalOutput();

    const error = await superviseDevProcesses(specs('api'), {
      output: captured.output,
      spawnProcess() {
        throw original;
      },
      signalSource: new FakeSignalSource(),
    }).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(SubprocessCliError);
    // The wrapper is user-facing; the cause is what a maintainer needs.
    expect((error as SubprocessCliError).userMessage).toContain(
      "development process 'api'",
    );
    expect((error as { cause?: unknown }).cause).toBe(original);
  });

  it('preserves the non-zero exit code and signal in the failure message', async () => {
    const children = [new FakeChild(), new FakeChild()];
    let index = 0;

    const running = superviseDevProcesses(specs('api', 'worker'), {
      spawnProcess: () => children[index++]!,
      signalSource: new FakeSignalSource(),
    });

    children[0]?.emitExit(9, 'SIGKILL');

    await expect(running).rejects.toThrow(
      'Development process \'api\' exited unexpectedly with code 9 after SIGKILL.',
    );
  });

  it('removes signal handlers after a failure', async () => {
    const children = [new FakeChild()];
    const signals = new FakeSignalSource();

    const running = superviseDevProcesses(specs('api'), {
      spawnProcess: () => children[0]!,
      signalSource: signals,
    });

    children[0]?.emitExit(1, null);
    await expect(running).rejects.toBeInstanceOf(SubprocessCliError);

    // A leaked handler would try to kill an already-terminated child on the next
    // signal.
    expect(signals.has('SIGINT')).toBe(false);
    expect(signals.has('SIGTERM')).toBe(false);
  });

  it('reports a child error event as a failure and still cleans up', async () => {
    const children = [new FakeChild(), new FakeChild()];
    let index = 0;

    const running = superviseDevProcesses(specs('api', 'worker'), {
      spawnProcess: () => children[index++]!,
      signalSource: new FakeSignalSource(),
    });

    children[1]?.emitError(new Error('EPIPE'));

    await expect(running).rejects.toThrow(
      "Development process 'worker' failed to start.",
    );
    expect(children[0]?.killedSignals).toEqual(['SIGTERM']);
  });
});