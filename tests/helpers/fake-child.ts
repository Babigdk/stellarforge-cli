import { PassThrough } from 'node:stream';
import type { ManagedChildProcess } from '../../src/dev/orchestrator.js';

/** Deterministic in-memory stand-in for a supervised child process. */
export class FakeChildProcess implements ManagedChildProcess {
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
    return true;
  }

  /** Writes output, lets stream listeners observe it, then exits. */
  async finish(
    code: number,
    output: { readonly stdout?: string[]; readonly stderr?: string[] } = {},
  ): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const chunk of output.stdout ?? []) {
      this.stdout.write(chunk);
    }
    for (const chunk of output.stderr ?? []) {
      this.stderr.write(chunk);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.#exitListener?.(code, null);
  }

  async fail(error: Error): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.#errorListener?.(error);
  }
}
