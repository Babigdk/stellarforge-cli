import { spawnSync } from 'node:child_process';

export const DIAGNOSTIC_COMMAND_TIMEOUT_MS = 5_000;

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

export const runCommand: RunCommand = (executable, args) => {
  const result = spawnSync(executable, [...args], {
    encoding: 'utf8',
    shell: false,
    timeout: DIAGNOSTIC_COMMAND_TIMEOUT_MS,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error === undefined ? {} : { error: result.error }),
  };
};

export type CommandOutcome = 'ok' | 'missing-executable' | 'failed';

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
  if (result.error !== undefined && isExecutableNotFound(result.error)) {
    return 'missing-executable';
  }

  if (result.error !== undefined || result.status !== 0) {
    return 'failed';
  }

  return 'ok';
}
