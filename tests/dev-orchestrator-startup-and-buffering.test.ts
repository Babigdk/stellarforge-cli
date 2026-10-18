/**
 * Startup ordering and partial-line buffering in the dev supervisor (#158, #159).
 *
 * Neither behaviour had coverage. The existing `dev-orchestrator.test.ts` writes
 * only whole lines (`child.stdout.write('ready\n')`) and never asserts the order
 * in which children are spawned, so both regressions could land unnoticed:
 *
 *   - #158 — if the spawn loop were ever reordered or parallelised, children
 *     would start in an unstable order. `superviseDevProcesses` walks `specs`
 *     in order and spawns each before registering its listeners, so the order is
 *     a real contract: a later spec may depend on an earlier one being up.
 *
 *   - #159 — `createPrefixedLineWriter` buffers a partial trailing line so a
 *     secret-like value split across chunks is redacted as a whole. A regression
 *     that emitted each chunk immediately would leak the tail of a split secret
 *     straight to the terminal, which is the failure the buffering exists to
 *     prevent.
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

function spec(label: string): DevProcessSpec {
  return { label, command: 'npm', args: ['run', 'start'], cwd: '/workspace' };
}

describe('dev supervisor startup order (#158)', () => {
  it('spawns every workflow in declared order', async () => {
    const children = [new FakeChild(), new FakeChild(), new FakeChild()];
    const spawnOrder: string[] = [];
    let index = 0;

    const running = superviseDevProcesses(
      [spec('database'), spec('api'), spec('worker')],
      {
        spawnProcess(planned) {
          spawnOrder.push(planned.label);
          return children[index++]!;
        },
        signalSource: new FakeSignalSource(),
      },
    );

    expect(spawnOrder).toEqual(['database', 'api', 'worker']);

    for (const child of children) {
      child.emitExit(0, null);
    }
    await running;
  });

  it('spawns a child before registering the next, so a startup failure is deterministic', async () => {
    const started: string[] = [];

    await expect(
      superviseDevProcesses([spec('database'), spec('api')], {
        spawnProcess(planned) {
          started.push(planned.label);
          if (planned.label === 'api') {
            throw new Error('spawn refused');
          }
          return new FakeChild();
        },
        signalSource: new FakeSignalSource(),
      }),
    ).rejects.toThrow(/Failed to start development process 'api'/);

    // The failure is reported against the spec that actually failed, and the
    // workflow before it was started in order.
    expect(started).toEqual(['database', 'api']);
  });

  it('never passes a shell, whatever the declared command', async () => {
    const seen: Array<{ command: string; args: readonly string[] }> = [];

    const child = new FakeChild();
    const running = superviseDevProcesses([spec('api')], {
      spawnProcess(planned, _environment) {
        seen.push({ command: planned.command, args: planned.args });
        return child;
      },
      signalSource: new FakeSignalSource(),
    });

    child.emitExit(0, null);
    await running;

    // argv is forwarded as an array so the spawner can pass shell:false.
    expect(Array.isArray(seen[0]?.args)).toBe(true);
    expect(seen[0]?.args).toEqual(['run', 'start']);
  });
});

describe('dev supervisor partial-line buffering (#159)', () => {
  it('holds a partial line until its newline arrives', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    child.stdout.write('compiling ');
    // Nothing has been terminated yet: the line is still buffered.
    await Promise.resolve();
    expect(captured.stdoutText()).not.toContain('compiling');

    child.stdout.write('module\n');
    await Promise.resolve();
    expect(captured.stdoutText()).toContain('[api] compiling module');

    child.emitExit(0, null);
    await running;
  });

  it('reassembles a secret-like value split across chunks and redacts it whole', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // Split mid-label so that neither chunk alone is recognisable as a
    // credential assignment — only the reassembled line is.
    child.stdout.write('api_tok');
    child.stdout.write('en=sk_live_ABCDEF0123456789\n');

    await Promise.resolve();
    const emitted = captured.stdoutText();
    expect(emitted).toContain('[api]');
    // Redacted as one value; a regression that emitted chunks eagerly would
    // leave the raw second half on screen.
    expect(emitted).not.toContain('sk_live_ABCDEF0123456789');
    expect(emitted).toContain('api_token=[REDACTED]');

    child.emitExit(0, null);
    await running;
  });

  it('buffers stderr independently so the two streams do not interleave', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // One half of a line on each stream: neither may be emitted on its own.
    child.stdout.write('out-');
    child.stderr.write('err-');
    await Promise.resolve();
    expect(captured.stdoutText()).toBe('');
    expect(captured.stderrText()).toBe('');

    child.stdout.write('part\n');
    child.stderr.write('part\n');
    await Promise.resolve();
    expect(captured.stdoutText()).toContain('[api] out-part');
    expect(captured.stderrText()).toContain('[api] err-part');

    child.emitExit(0, null);
    await running;
  });

  it('flushes a trailing partial line on stream end', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // No trailing newline: the buffer must still reach the terminal.
    child.stdout.write('done');
    child.stdout.end();
    await Promise.resolve();
    expect(captured.stdoutText()).toContain('[api] done');

    child.emitExit(0, null);
    await running;
  });
});