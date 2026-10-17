import { PassThrough } from 'node:stream';
import type { ManagedChildProcess } from '../../src/dev/orchestrator.js';

/**
 * Deterministic in-memory stand-in for a spawned child process.
 *
 * Tests drive the process lifecycle explicitly through {@link exitWith} and
 * {@link fail} instead of starting a real executable, so deploy and test
 * workflows can be exercised without a Stellar network, identity, or secret.
 */
export class MockChildProcess implements ManagedChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  #exitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  #errorListener: ((error: Error) => void) | undefined;

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
    } else {
      this.#errorListener = listener as (error: Error) => void;
    }

    return this;
  }

  kill(): boolean {
    return true;
  }

  exitWith(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.#exitListener?.(code, signal);
  }

  fail(error: Error): void {
    this.#errorListener?.(error);
  }
}
