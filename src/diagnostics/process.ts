import { spawnSync } from 'node:child_process';

export const DIAGNOSTIC_COMMAND_TIMEOUT_MS = 5_000;
export const DIAGNOSTIC_KILL_SIGNAL_GRACE_MS = 1_000;

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

export type RunCommand = (
  executable: string,
  args: readonly string[],
) => CommandResult;

const RUNNER_SCRIPT = `
const { spawn, spawnSync } = require('node:child_process');

const [executable, argsJson, timeoutMsRaw] = process.argv.slice(1);
const args = JSON.parse(argsJson);
const timeoutMs = Number(timeoutMsRaw);

const child = spawn(executable, args, {
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
let spawnError;
let status = null;
let settled = false;
let timedOut = false;

child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

function finish() {
  if (settled) return;
  settled = true;

  const payload = { status, stdout, stderr };
  if (spawnError) {
    payload.error = {
      message: String(spawnError.message || spawnError),
      code: spawnError.code,
    };
  } else if (timedOut) {
    payload.error = {
      message: 'Command timed out after ' + timeoutMs + 'ms',
      code: 'ETIMEDOUT',
    };
  }

  process.stdout.write(JSON.stringify(payload));
}

function killNow() {
  if (!child.pid) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: false,
    });
    return;
  }

  try { process.kill(child.pid, 'SIGKILL'); } catch {}
}

child.on('error', (error) => {
  spawnError = error;
  finish();
});

child.on('close', (code) => {
  status = code;
  finish();
});

const timer = setTimeout(() => {
  timedOut = true;
  killNow();
  // Fallback in case close never arrives.
  setTimeout(finish, 250).unref();
}, timeoutMs);

timer.unref?.();
`;

function parseRunnerOutput(raw: string): CommandResult | undefined {
  const text = raw.trim();
  if (text.length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as {
      status?: number | null;
      stdout?: string;
      stderr?: string;
      error?: { message?: string; code?: string };
    };

    const error =
      parsed.error === undefined
        ? undefined
        : Object.assign(
            new Error(parsed.error.message ?? 'Command failed'),
            parsed.error.code ? { code: parsed.error.code } : {},
          );

    return {
      status: parsed.status ?? null,
      stdout: parsed.stdout ?? '',
      stderr: parsed.stderr ?? '',
      ...(error ? { error } : {}),
    };
  } catch {
    return undefined;
  }
}

export const runCommand: RunCommand = (executable, args) => {
  const runner = spawnSync(
    process.execPath,
    [
      '-e',
      RUNNER_SCRIPT,
      executable,
      JSON.stringify([...args]),
      String(DIAGNOSTIC_COMMAND_TIMEOUT_MS),
    ],
    {
      encoding: 'utf8',
      shell: false,
      timeout: DIAGNOSTIC_COMMAND_TIMEOUT_MS + 1_500,
    },
  );

  const parsed = parseRunnerOutput(runner.stdout ?? '');
  if (parsed !== undefined) {
    return parsed;
  }

  if (runner.error) {
    if ((runner.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      return {
        status: null,
        stdout: runner.stdout ?? '',
        stderr: runner.stderr ?? '',
        error: Object.assign(
          new Error(
            `Command timed out after ${DIAGNOSTIC_COMMAND_TIMEOUT_MS}ms`,
          ),
          { code: 'ETIMEDOUT' },
        ),
      };
    }

    return {
      status: runner.status,
      stdout: runner.stdout ?? '',
      stderr: runner.stderr ?? '',
      error: runner.error,
    };
  }

  return {
    status: runner.status,
    stdout: runner.stdout ?? '',
    stderr: runner.stderr ?? '',
    ...(runner.status === 0
      ? {}
      : {
          error: new Error(
            (runner.stderr ?? '').trim() || 'Command runner failed',
          ),
        }),
  };
};

export type CommandOutcome =
  'ok' | 'missing-executable' | 'timed-out' | 'failed';

/**
 * Recognizes the platform-specific ways Node reports that an executable could
 * not be found, without inspecting or reflecting raw process output.
 */
export function isExecutableNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }

  if ((error as { code?: unknown }).code === 'ENOENT') {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /\bENOENT\b/.test(message);
}

/**
 * Classifies a command result into a small, shared set of outcomes so every
 * diagnostic treats a missing executable consistently.
 */
export function classifyCommandResult(result: CommandResult): CommandOutcome {
  if (
    result.error !== undefined &&
    (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
  ) {
    return 'timed-out';
  }

  if (result.error !== undefined && isExecutableNotFound(result.error)) {
    return 'missing-executable';
  }

  if (result.error !== undefined || result.status !== 0) {
    return 'failed';
  }

  return 'ok';
}
