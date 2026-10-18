/**
 * Repeated-signal idempotency in the dev supervisor (#162, #163).
 *
 * `dev-orchestrator.test.ts` emits each signal exactly once, so the `shuttingDown`
 * guard inside `superviseDevProcesses` — the thing that makes cleanup run at most
 * once — was never exercised under repetition.
 *
 * That guard is the whole safety story for a supervisor. Without it, a user
 * hammering Ctrl-C, or a container runtime delivering SIGTERM alongside a
 * shutdown signal, would call `child.kill()` repeatedly. On a real process group
 * that escalates SIGINT → SIGKILL, and a child that has already exited gets
 * signalled again, so the failure surfaces as a non-deterministic exit code rather
 * than a clean shutdown.
 *
 * Each case below asserts both halves of idempotency: the kill is requested once
 * per child, and the supervisor still settles deterministically.
 */

import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  superviseDevProcesses,
  type DevSignalSource,
  type ManagedChildProcess,
} from '../src/dev/orchestrator.js';
import type { DevProcessSpec } from '../src/dev/project.js';
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

/**
 * Unlike `process`, this keeps the listener registered after `emit`, so a second
 * signal really does re-enter the handler — the behaviour under test.
 */
class RepeatingSignalSource implements DevSignalSource {
  readonly #listeners = new Map<NodeJS.Signals, Set<() => void>>();

  once(signal: NodeJS.Signals, listener: () => void): void {
    const set = this.#listeners.get(signal) ?? new Set<() => void>();
    set.add(listener);
    this.#listeners.set(signal, set);
  }

  removeListener(signal: NodeJS.Signals, listener: () => void): void {
    this.#listeners.get(signal)?.delete(listener);
  }

  emit(signal: NodeJS.Signals): void {
    for (const listener of [...(this.#listeners.get(signal) ?? [])]) {
      listener();
    }
  }

  has(signal: NodeJS.Signals): boolean {
    return (this.#listeners.get(signal)?.size ?? 0) > 0;
  }
}

const SPECS: readonly DevProcessSpec[] = [
  { label: 'api', command: 'npm', args: ['run', 'start'], cwd: '/workspace' },
  {
    label: 'worker',
    command: 'npm',
    args: ['run', 'start'],
    cwd: '/workspace',
  },
];

describe.each([
  { signal: 'SIGINT', issue: '#162' },
  { signal: 'SIGTERM', issue: '#163' },
] as const)(
  'repeated $signal cleanup stays idempotent ($issue)',
  ({ signal }) => {
    it('kills each child exactly once however many times the signal arrives', async () => {
      const children = [new FakeChild(), new FakeChild()];
      const signals = new RepeatingSignalSource();
      let index = 0;

      const running = superviseDevProcesses(SPECS, {
        spawnProcess: () => children[index++]!,
        signalSource: signals,
      });

      signals.emit(signal);
      signals.emit(signal);
      signals.emit(signal);

      await running;

      for (const child of children) {
        expect(child.killedSignals).toEqual([signal]);
      }
    });

    it('does not escalate to a second signal after the first shutdown', async () => {
      const children = [new FakeChild(), new FakeChild()];
      const signals = new RepeatingSignalSource();
      let index = 0;

      const running = superviseDevProcesses(SPECS, {
        spawnProcess: () => children[index++]!,
        signalSource: signals,
      });

      // First SIGTERM starts shutdown; the second must be a no-op even though the
      // children have not reported exit yet.
      signals.emit('SIGTERM');
      expect(children[0]?.killedSignals).toEqual(['SIGTERM']);
      expect(children[1]?.killedSignals).toEqual(['SIGTERM']);

      signals.emit('SIGTERM');
      signals.emit('SIGINT');

      await running;

      // No SIGINT escalation and no double SIGTERM on either child.
      for (const child of children) {
        expect(child.killedSignals).toEqual(['SIGTERM']);
      }
    });

    it('settles without an error even though the children exited by signal', async () => {
      const children = [new FakeChild(), new FakeChild()];
      const signals = new RepeatingSignalSource();
      const captured = createCapturedTerminalOutput();
      let index = 0;

      const running = superviseDevProcesses(SPECS, {
        output: captured.output,
        spawnProcess: () => children[index++]!,
        signalSource: signals,
      });

      signals.emit(signal);
      signals.emit(signal);

      // A requested shutdown must resolve, not reject with "exited unexpectedly".
      await expect(running).resolves.toBeUndefined();
    });

    it('removes the signal handlers even when the signal repeats', async () => {
      const children = [new FakeChild(), new FakeChild()];
      const signals = new RepeatingSignalSource();
      let index = 0;

      const running = superviseDevProcesses(SPECS, {
        spawnProcess: () => children[index++]!,
        signalSource: signals,
      });

      signals.emit(signal);
      signals.emit(signal);
      await running;

      // A leaked handler would re-run stopChildren against an empty child list on
      // the next signal, so teardown is part of idempotency.
      expect(signals.has('SIGINT')).toBe(false);
      expect(signals.has('SIGTERM')).toBe(false);
    });
  },
);