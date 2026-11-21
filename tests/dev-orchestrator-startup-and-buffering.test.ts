/**
 * Startup ordering and partial-line buffering in the dev supervisor (#158, #159).
 *
 * Neither behaviour had coverage. The existing `dev-orchestrator.test.ts` writes
 * only whole lines (`child.stdout.write('ready\n')`) and never asserts the order
 * in which children are spawned, so both regressions could land unnoticed:
 *
 *   - #158 â€” if the spawn loop were ever reordered or parallelised, children
 *     would start in an unstable order. `superviseDevProcesses` walks `specs`
 *     in order and spawns each before registering its listeners, so the order is
 *     a real contract: a later spec may depend on an earlier one being up.
 *
 *   - #159 â€” `createPrefixedLineWriter` buffers a partial trailing line so a
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
    ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;

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
    // End both stdio streams so the supervisor, which settles once they close,
    // observes the same lifecycle a real child produces.
    this.stdout.end();
    this.stderr.end();
    this.#exitListener?.(code, signal);
  }

  // Exit can be observed before stdio has delivered its final bytes; keep the
  // streams open so tests can deliver the remainder afterwards.
  emitExitKeepingStreamsOpen(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
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
      spawnProcess(planned) {
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
    // credential assignment â€” only the reassembled line is.
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
    const ended = new Promise<void>((resolve) =>
      child.stdout.once('end', resolve),
    );
    child.stdout.end();
    await ended;
    expect(captured.stdoutText()).toContain('[api] done');

    child.emitExit(0, null);
    await running;
  });
});

describe('dev supervisor bare CR progress frames (#392)', () => {
  it('treats a bare CR as a line boundary and emits each progress frame', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    child.stdout.write('building 10%\r');
    child.stdout.write('building 20%\r');
    await Promise.resolve();

    const emitted = captured.stdoutText();
    // Both frames are visible as their own lines â€” nothing was overwritten,
    // and no raw CR reached the terminal.
    expect(emitted).toContain('[api] building 10%\n');
    expect(emitted).toContain('[api] building 20%\n');
    expect(emitted).not.toContain('\r');

    child.emitExit(0, null);
    await running;
  });

  it('handles LF, CRLF and bare CR deterministically in one stream', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    child.stdout.write('one\rtwo\nthree\r\nfour\r');
    await Promise.resolve();

    expect(captured.stdoutText()).toBe(
      '[api] one\n[api] two\n[api] three\n[api] four\n',
    );

    child.stdout.write('five\n');
    await Promise.resolve();
    expect(captured.stdoutText()).toBe(
      '[api] one\n[api] two\n[api] three\n[api] four\n[api] five\n',
    );

    child.emitExit(0, null);
    await running;
  });

  it('drops empty CR frames without printing blank lines', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    child.stdout.write('loading\r\r\rdone\r');
    await Promise.resolve();

    expect(captured.stdoutText()).toBe('[api] loading\n[api] done\n');

    child.emitExit(0, null);
    await running;
  });

  it('keeps the 64 KiB pending bound effective for unterminated output', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // No terminator at all: the pending buffer drains via the bound instead of
    // growing without limit. Line output is capped at 8 KiB by redaction.
    child.stdout.write('y'.repeat(70 * 1024));
    await Promise.resolve();
    // NOTE: redactSecretLikeText currently truncates each line to the first
    // 8192 bytes, so only that prefix reaches the terminal here.
    expect(captured.stdoutText()).toBe('[api] ' + 'y'.repeat(8192) + '\n');

    child.emitExit(0, null);
    await running;
  });

  it('emits an over-long CR-terminated frame as a single line', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // A CR-terminated frame is emitted as its own complete line; line output
    // is capped at 8 KiB by redaction.
    child.stdout.write('x'.repeat(70 * 1024) + '\r');
    await Promise.resolve();
    // NOTE: redactSecretLikeText currently truncates each line to the first
    // 8192 bytes, so only that prefix reaches the terminal here.
    expect(captured.stdoutText()).toBe('[api] ' + 'x'.repeat(8192) + '\n');

    child.emitExit(0, null);
    await running;
  });

  it('redacts a secret-like value that completes on a bare CR boundary', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    child.stdout.write('api_tok');
    child.stdout.write('en=sk_live_ABCDEF0123456789\r');
    await Promise.resolve();

    const emitted = captured.stdoutText();
    expect(emitted).not.toContain('sk_live_ABCDEF0123456789');
    expect(emitted).toContain('api_token=[REDACTED]');

    child.emitExit(0, null);
    await running;
  });
});

describe('dev supervisor UTF-8 chunk decoding (#205)', () => {
  it('reconstructs a multi-byte character split across byte chunks', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // U+20AC (EURO SIGN) is e2 82 ac in UTF-8; split between the second and third bytes.
    child.stdout.write(Buffer.from([0xe2, 0x82]));
    child.stdout.write(Buffer.from([0xac, 0x0a]));
    await Promise.resolve();

    expect(captured.stdoutText()).toContain('[api] €\n');

    child.emitExit(0, null);
    await running;
  });

  it('reconstructs a 4-byte code point split across chunks', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // U+1F600 (GRINNING FACE): f0 9f 98 80 — split after the first two bytes.
    child.stdout.write(Buffer.from([0xf0, 0x9f]));
    child.stdout.write(Buffer.from([0x98, 0x80]));
    child.stdout.write(' fine\n');
    await Promise.resolve();

    expect(captured.stdoutText()).toContain('[api] 😀 fine\n');

    child.emitExit(0, null);
    await running;
  });

  it('keeps decoder state independent across stdout and stderr', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // Hold an incomplete EURO SIGN on stdout while stderr completes a full line.
    child.stdout.write(Buffer.from([0xe2, 0x82]));
    child.stderr.write('ready\n');
    await Promise.resolve();

    expect(captured.stderrText()).toContain('[api] ready\n');
    expect(captured.stdoutText()).not.toContain('ready');

    child.stdout.write(Buffer.from([0xac, 0x0a]));
    await Promise.resolve();

    expect(captured.stdoutText()).toContain('[api] €\n');

    child.emitExit(0, null);
    await running;
  });

  it('emits U+FFFD for a truncated code point at stream end without throwing', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // The held bytes cannot be completed; the stream end flushes them as U+FFFD.
    child.stdout.write(Buffer.from([0xe2, 0x82]));
    const ended = new Promise<void>((resolve) =>
      child.stdout.once('end', resolve),
    );
    child.stdout.end();
    await ended;
    await Promise.resolve();

    expect(captured.stdoutText()).toContain('[api] �\n');

    child.emitExit(0, null);
    await running;
  });

  it('still redacts a secret split across a multi-byte character boundary', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // A complete assignment whose multi-byte é is split across chunks: redaction only
    // works when the line is reassembled before it reaches the terminal.
    const line = Buffer.from(
      'note=café; api_token=sk_live_ABCDEF0123456789\n',
      'utf8',
    );
    child.stdout.write(line.subarray(0, 9)); // cuts inside the multi-byte é
    child.stdout.write(line.subarray(9));
    await Promise.resolve();

    const emitted = captured.stdoutText();
    expect(emitted).not.toContain('sk_live_ABCDEF0123456789');
    expect(emitted).toContain('api_token=[REDACTED]');

    child.emitExit(0, null);
    await running;
  });
});
describe('dev supervisor stdio completion (#206)', () => {
  it('does not flush a pending sensitive assignment at process exit', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });
    running.catch(() => undefined);

    // The first half of a sensitive assignment is pending a newline.
    child.stdout.write('secret: sk_li');

    // Node may emit exit before stdio has delivered the rest.
    child.emitExitKeepingStreamsOpen(1, null);

    // The pending half must NOT reach the terminal at exit time.
    await Promise.resolve();
    expect(captured.stdoutText()).toBe('');

    // The rest arrives after exit, still through the same stream.
    child.stdout.write('ve_ABCDEF0123456789\n');
    child.stdout.end();
    child.stderr.end();

    await expect(running).rejects.toThrow(/exited unexpectedly/);

    const emitted = captured.stdoutText();
    expect(emitted).not.toContain('sk_li');
    expect(emitted).toContain('secret: [REDACTED]');
  });

  it('redacts a sensitive assignment split across the exit boundary as one line', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    child.stdout.write('secret: sk_li');
    child.emitExitKeepingStreamsOpen(0, null);

    child.stdout.write('ve_ABCDEF0123456789\n');
    child.stdout.end();
    child.stderr.end();

    await running;

    const emitted = captured.stdoutText();
    expect(emitted).not.toContain('sk_li');
    expect(emitted).toContain('secret: [REDACTED]');
  });

  it('emits a final partial line exactly once after stdio completes', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    // No trailing newline: emitted exactly once, on stream end.
    child.stdout.write('done');
    child.emitExit(0, null);
    child.stdout.end();
    child.stderr.end();

    await running;

    const occurrences = captured.stdoutText().split('[api] done').length - 1;
    expect(occurrences).toBe(1);
  });

  it('settles once exit is observed after both streams end (end-before-exit)', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    child.stdout.end();
    child.stderr.end();
    child.emitExit(0, null);

    await running;
  });

  it('settles once both streams end after exit is observed (exit-before-end)', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });

    child.emitExit(0, null);
    child.stdout.end();
    child.stderr.end();

    await running;
  });

  it('waits for both stdio streams, not just one', async () => {
    const captured = createCapturedTerminalOutput();
    const child = new FakeChild();
    let settled = false;

    const running = superviseDevProcesses([spec('api')], {
      output: captured.output,
      spawnProcess: () => child,
      signalSource: new FakeSignalSource(),
    });
    running.then(() => {
      settled = true;
    });

    child.stdout.end();
    child.emitExit(0, null);
    await Promise.resolve();
    expect(settled).toBe(false);

    child.stderr.end();
    await running;
    expect(settled).toBe(true);
  });
});
