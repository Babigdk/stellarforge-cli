import { spawn } from 'node:child_process';
import { SubprocessCliError, ValidationCliError } from '../errors/errors.js';
import {
  REDACTED_PLACEHOLDER,
  redactSecretLikeText,
} from '../output/redaction.js';
import { TerminalOutput } from '../output/terminal.js';
import {
  buildSafeChildEnvironment,
  collectRedactableEnvironmentValues,
} from './environment.js';
import type { DevProcessSpec } from './project.js';

interface ManagedStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  pause(): unknown;
  resume(): unknown;
}

export interface ManagedChildProcess {
  readonly pid?: number;
  readonly stdout: ManagedStream;
  readonly stderr: ManagedStream;
  once(event: 'error', listener: (error: Error) => void): ManagedChildProcess;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): ManagedChildProcess;
  kill(signal?: NodeJS.Signals): boolean;
}

export type DevProcessSpawner = (
  spec: DevProcessSpec,
  environment: NodeJS.ProcessEnv,
) => ManagedChildProcess;

export interface DevSignalSource {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface DevOrchestratorOptions {
  readonly output?: TerminalOutput;
  readonly environment?: NodeJS.ProcessEnv;
  readonly spawnProcess?: DevProcessSpawner;
  readonly signalSource?: DevSignalSource;
  readonly timeoutMs?: number;
  readonly terminationGraceMs?: number;
  readonly timeoutMessage?: string;
}

export function defaultSpawnProcess(
  spec: DevProcessSpec,
  environment: NodeJS.ProcessEnv,
): ManagedChildProcess {
  return spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: environment,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as unknown as ManagedChildProcess;
}

function signalChildTree(
  child: ManagedChildProcess,
  signal: NodeJS.Signals,
): void {
  if (typeof child.pid !== 'number') {
    child.kill(signal);
    return;
  }

  if (process.platform === 'win32') {
    try {
      const args = ['/PID', String(child.pid), '/T'];
      if (signal === 'SIGKILL') {
        args.push('/F');
      }

      const killer = spawn('taskkill.exe', args, {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      let fellBack = false;
      const fallback = (): void => {
        if (fellBack) {
          return;
        }

        fellBack = true;
        child.kill(signal);
      };

      killer.once('error', fallback);
      killer.once('close', (code) => {
        if (code !== 0) {
          fallback();
        }
      });
    } catch {
      child.kill(signal);
    }
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

const MAX_BUFFERED_LINE_LENGTH = 64 * 1024;

function createEnvironmentValueRedactor(
  values: readonly string[],
): (line: string) => string {
  if (values.length === 0) {
    return (line) => line;
  }

  return (line) => {
    let redacted = line;

    for (const value of values) {
      redacted = redacted.split(value).join(REDACTED_PLACEHOLDER);
    }

    return redacted;
  };
}

// Upper bound on complete lines queued for a single child stream while its
// destination is backpressured. A noisy child can otherwise outpace a slow or
// redirected output sink and accumulate an unbounded in-memory queue; once
// this bound is hit the oldest queued lines are dropped (with a one-time
// notice) so memory stays bounded even if the destination never drains.
const MAX_QUEUED_OUTPUT_LINES = 1000;

interface PrefixedLineWriter {
  write(chunk: Buffer | string): void;
  end(): void;
}

interface BoundedForwarder {
  push(line: string): void;
}

// Forwards complete lines to the destination one at a time. If a write
// reports backpressure (returns false), the owning child stream is paused and
// further lines accumulate in a bounded queue; once the destination signals
// it has drained, queued lines resume flowing and the child stream is resumed
// only once the queue is fully flushed. Each stream (stdout/stderr) gets its
// own forwarder, so pausing one never blocks or interleaves the other.
function createBoundedForwarder(
  emitLine: (line: string) => boolean,
  onceDrained: (listener: () => void) => void,
  pauseChildStream: () => void,
  resumeChildStream: () => void,
  reportOverflow: () => void,
): BoundedForwarder {
  const queue: string[] = [];
  let childPaused = false;
  let overflowed = false;

  const flush = (): void => {
    while (queue.length > 0) {
      const line = queue.shift()!;

      if (!emitLine(line)) {
        if (!childPaused) {
          childPaused = true;
          pauseChildStream();
        }

        onceDrained(flush);
        return;
      }
    }

    if (childPaused) {
      childPaused = false;
      resumeChildStream();
    }
  };

  return {
    push(line) {
      queue.push(line);

      if (queue.length > MAX_QUEUED_OUTPUT_LINES) {
        queue.shift();

        if (!overflowed) {
          overflowed = true;
          reportOverflow();
        }
      }

      if (!childPaused) {
        flush();
      }
    },
  };
}

// Child output is untrusted: buffer partial lines so secret-like values split
// across chunks are still redacted as a whole before reaching the terminal.
// Each stream uses its own streaming UTF-8 decoder, so a multi-byte character
// split between chunks is reconstructed instead of being replaced with
// U+FFFD. Bare carriage returns are treated as line boundaries (progress-frame
// separators): every frame is emitted as its own complete line, never as a
// raw CR, so progress updates cannot overwrite terminal content already on
// screen. A CR-terminated frame with no text creates no line at all.
function createPrefixedLineWriter(
  output: TerminalOutput,
  label: string,
  isError: boolean,
  childStream: ManagedStream,
  redactEnvironmentValues: (line: string) => string,
): PrefixedLineWriter {
  let pending = '';
  let ended = false;
  const decoder = new TextDecoder('utf-8');
  let overflowReported = false;

  const emitLine = (line: string): boolean =>
    isError ? output.warning(line) : output.info(line);
  const onceDrained = (listener: () => void): void =>
    isError
      ? output.onceStderrDrained(listener)
      : output.onceStdoutDrained(listener);
  const forwarder = createBoundedForwarder(
    emitLine,
    onceDrained,
    () => childStream.pause(),
    () => childStream.resume(),
    () => {
      if (overflowReported) {
        return;
      }

      overflowReported = true;
      output.warning(
        `[${label}] output buffer exceeded ${MAX_QUEUED_OUTPUT_LINES} queued lines; oldest lines were dropped due to sustained backpressure.`,
      );
    },
  );

  const emit = (line: string): void => {
    if (line.length === 0) {
      return;
    }

    forwarder.push(
      `[${label}] ${redactSecretLikeText(redactEnvironmentValues(line))}`,
    );
  };

  // Splits decoded text into complete lines, keeping the trailing partial
  // line in the pending buffer. Redaction stays line-based, which is only
  // sound while no line reaches the terminal before its final byte arrives.
  const feed = (text: string): void => {
    const lines = `${pending}${text}`.split(/\r?\n|\r/);
    pending = lines.pop() ?? '';

    for (const line of lines) {
      emit(line);
    }

    if (pending.length > MAX_BUFFERED_LINE_LENGTH) {
      emit(pending);
      pending = '';
    }
  };

  return {
    write(chunk) {
      if (ended) {
        return;
      }

      // String chunks are passed through untouched for tests; byte chunks
      // stream through the decoder, holding incomplete trailing sequences.
      feed(
        typeof chunk === 'string'
          ? chunk
          : decoder.decode(chunk, { stream: true }),
      );
    },
    end() {
      if (ended) {
        return;
      }

      ended = true;
      // Flush any held bytes (complete the final code point or emit U+FFFD
      // for a truncated one), then emit the final partial line exactly once.
      const tail = decoder.decode();
      if (tail.length > 0) {
        feed(tail);
      }

      emit(pending);
      pending = '';
    },
  };
}

export async function superviseDevProcesses(
  specs: readonly DevProcessSpec[],
  options: DevOrchestratorOptions = {},
): Promise<void> {
  if (specs.length === 0) {
    throw new ValidationCliError('No development processes are configured.');
  }

  const output = options.output ?? new TerminalOutput();
  const sourceEnvironment = options.environment ?? process.env;
  const environment = buildSafeChildEnvironment(sourceEnvironment);
  const redactEnvironmentValues = createEnvironmentValueRedactor(
    collectRedactableEnvironmentValues(sourceEnvironment),
  );
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  const signalSource = options.signalSource ?? process;
  const children: ManagedChildProcess[] = [];
  const exitedChildren = new Set<ManagedChildProcess>();
  const terminationGraceMs = options.terminationGraceMs ?? 5_000;
  let shuttingDown = false;
  let timedOut = false;
  let settleShutdown: () => void = () => {};
  let timeoutTimer: NodeJS.Timeout | undefined;
  let escalationTimer: NodeJS.Timeout | undefined;
  let timeoutSettlementTimer: NodeJS.Timeout | undefined;

  const clearTimers = (): void => {
    clearTimeout(timeoutTimer);
    clearTimeout(escalationTimer);
    clearTimeout(timeoutSettlementTimer);
  };

  const signalChildren = (
    signal: NodeJS.Signals,
    activeOnly = false,
  ): void => {
    for (const child of children) {
      if (activeOnly && exitedChildren.has(child)) {
        continue;
      }

      signalChildTree(child, signal);
    }
  };

  const stopChildren = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    signalChildren(signal);

    if (children.length === 0) {
      return;
    }

    clearTimeout(escalationTimer);
    escalationTimer = setTimeout(() => {
      signalChildren('SIGKILL', true);
      clearTimeout(timeoutSettlementTimer);
      timeoutSettlementTimer = setTimeout(() => {
        settleShutdown();
      }, terminationGraceMs);
    }, terminationGraceMs);
  };

  const handleSigint = (): void => stopChildren('SIGINT');
  const handleSigterm = (): void => stopChildren('SIGTERM');

  signalSource.once('SIGINT', handleSigint);
  signalSource.once('SIGTERM', handleSigterm);

  try {
    await new Promise<void>((resolve, reject) => {
      let remaining = specs.length;
      let settled = false;
      const timeoutError = new SubprocessCliError(
        options.timeoutMessage ??
          `A development process timed out after ${options.timeoutMs ?? 0} ms.`,
      );

      const finishTimeout = (): void => {
        clearTimers();

        if (settled) {
          return;
        }

        settled = true;
        reject(timeoutError);
      };

      settleShutdown = () => {
        clearTimers();

        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };

      interface ChildState {
        label: string;
        stdoutWriter: PrefixedLineWriter;
        stderrWriter: PrefixedLineWriter;
        stdoutDone: boolean;
        stderrDone: boolean;
        exited: boolean;
        exitCode: number | null;
        exitSignal: NodeJS.Signals | null;
        completed: boolean;
      }

      const fail = (message: string, cause?: Error): void => {
        if (settled || timedOut) {
          return;
        }

        settled = true;
        // Signal siblings for cleanup but leave still-open streams alone: a
        // later flush there could emit half of a sensitive assignment. Any
        // pending line stays bounded in the writer until its stream ends.
        stopChildren('SIGTERM');
        reject(
          new SubprocessCliError(
            message,
            cause === undefined ? undefined : { cause },
          ),
        );
      };

      // Exit and stdio completion are separate events: a child only settles
      // once its exit has been observed AND every stream has ended. Flushing
      // before that could split a sensitive assignment across the flush
      // boundary and defeat line-based redaction.
      const maybeComplete = (state: ChildState): void => {
        if (
          settled ||
          state.completed ||
          !state.exited ||
          !state.stdoutDone ||
          !state.stderrDone
        ) {
          return;
        }

        state.completed = true;
        remaining -= 1;

        if (!shuttingDown && state.exitCode !== 0) {
          fail(
            `Development process '${state.label}' exited unexpectedly${
              state.exitCode === null ? '' : ` with code ${state.exitCode}`
            }${state.exitSignal === null ? '' : ` after ${state.exitSignal}`}.`,
          );
          return;
        }

        if (remaining === 0) {
          if (timedOut) {
            finishTimeout();
            return;
          }

          settled = true;
          clearTimers();
          resolve();
        }
      };

      for (const spec of specs) {
        let child: ManagedChildProcess;

        try {
          child = spawnProcess(spec, environment);
        } catch (error) {
          fail(
            `Failed to start development process '${spec.label}'.`,
            error instanceof Error ? error : undefined,
          );
          return;
        }

        children.push(child);
        const state: ChildState = {
          label: spec.label,
          stdoutWriter: createPrefixedLineWriter(
            output,
            spec.label,
            false,
            child.stdout,
            redactEnvironmentValues,
          ),
          stderrWriter: createPrefixedLineWriter(
            output,
            spec.label,
            true,
            child.stderr,
            redactEnvironmentValues,
          ),
          stdoutDone: false,
          stderrDone: false,
          exited: false,
          exitCode: null,
          exitSignal: null,
          completed: false,
        };

        child.stdout.on('data', (chunk) => state.stdoutWriter.write(chunk));
        child.stdout.on('end', () => {
          state.stdoutDone = true;
          state.stdoutWriter.end();
          maybeComplete(state);
        });
        child.stdout.on('error', (error) => {
          // A failed stream can never emit 'end'; mark it done, flush only
          // its own final output (redacted, bounded), and fail the supervisor.
          // Raw stream errors and local paths never reach the terminal.
          if (!state.stdoutDone) {
            state.stdoutDone = true;
            state.stdoutWriter.end();
          }

          fail(
            `Development process '${state.label}' stdout stream failed.`,
            error,
          );
        });
        child.stderr.on('data', (chunk) => state.stderrWriter.write(chunk));
        child.stderr.on('end', () => {
          state.stderrDone = true;
          state.stderrWriter.end();
          maybeComplete(state);
        });
        child.stderr.on('error', (error) => {
          if (!state.stderrDone) {
            state.stderrDone = true;
            state.stderrWriter.end();
          }

          fail(
            `Development process '${state.label}' stderr stream failed.`,
            error,
          );
        });
        child.once('error', (error) => {
          fail(`Development process '${spec.label}' failed to start.`, error);
        });
        child.once('exit', (code, signal) => {
          exitedChildren.add(child);
          state.exited = true;
          state.exitCode = code;
          state.exitSignal = signal;
          maybeComplete(state);
        });
      }

      if (options.timeoutMs !== undefined) {
        timeoutTimer = setTimeout(() => {
          if (settled) {
            return;
          }

          timedOut = true;
          settleShutdown = finishTimeout;
          stopChildren('SIGTERM');
        }, options.timeoutMs);
      }
    });
  } finally {
    signalSource.removeListener('SIGINT', handleSigint);
    signalSource.removeListener('SIGTERM', handleSigterm);
  }
}
