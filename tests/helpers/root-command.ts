import { CommanderError } from 'commander';
import { createRootCommand } from '../../src/commands/root.js';
import { handleCliError, type CliExitCode } from '../../src/errors/index.js';
import { createCapturedTerminalOutput } from './captured-output.js';

export interface RootCommandRun {
  readonly exitCode: CliExitCode;
  readonly error: unknown;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Parses user arguments through the real root command in-process, capturing
 * Commander output for the root and every registered subcommand.
 */
export async function runRootCommand(
  args: readonly string[],
): Promise<RootCommandRun> {
  const program = createRootCommand('1.2.3');
  const stdout: string[] = [];
  const stderr: string[] = [];

  for (const command of [program, ...program.commands]) {
    command.configureOutput({
      writeOut: (text) => stdout.push(text),
      writeErr: (text) => stderr.push(text),
    });
  }

  const captured = createCapturedTerminalOutput();
  let error: unknown;
  let exitCode: CliExitCode = 0;

  try {
    await program.parseAsync([...args], { from: 'user' });
  } catch (caught) {
    error = caught;
    exitCode = handleCliError(caught, captured.output);
  }

  return {
    exitCode,
    error,
    stdout: stdout.join('') + captured.stdoutText(),
    stderr: stderr.join('') + captured.stderrText(),
  };
}

export function commanderCode(error: unknown): string | undefined {
  return error instanceof CommanderError ? error.code : undefined;
}
