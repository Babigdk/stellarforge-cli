import { CommanderError } from 'commander';
import { TerminalOutput } from '../output/index.js';
import { redactSecretLikeText } from '../output/redaction.js';
import { CliError, EXIT_CODES, type CliExitCode } from './errors.js';

const UNEXPECTED_ERROR_MESSAGE =
  'StellarForge encountered an unexpected error.';

export const CANCELLATION_MESSAGE = 'Cancelled.';

export const FORCED_EXIT_MESSAGE =
  'Received a second interrupt signal; forcing exit.';

export const CANCELLATION_EXIT_CODE: CliExitCode = EXIT_CODES.cancelled;

export class CancellationCliError extends CliError {
  constructor(command: string, options?: ErrorOptions) {
    super(
      'CancellationCliError',
      CANCELLATION_MESSAGE,
      EXIT_CODES.cancelled,
      options,
    );
    this.command = command;
  }

  readonly command: string;
}

interface CancellationEventSource {
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}

const cancellationEvents =
  process as unknown as CancellationEventSource;

export interface CancellationController {
  begin(): AbortSignal;
  end(): void;
}

export function createCancellationController(): CancellationController {
  let controller: AbortController | undefined;
  let listener: (() => void) | undefined;

  return {
    begin(): AbortSignal {
      controller = new AbortController();
      listener = () => {
        controller?.abort(new CancellationCliError('new'));
      };
      cancellationEvents.on('cancellationRequested', listener);
      return controller.signal;
    },

    end(): void {
      if (listener) {
                cancellationEvents.removeListener(
          'cancellationRequested',
          listener,
        );
      }
      listener = undefined;
      controller = undefined;
    },
  };
}

export interface CancellationHandler {
  isCancelled(): boolean;
  reportCancellation(): void;
  dispose(): void;
}

export function createCancellationHandler(_options: {
  command: string;
  output: TerminalOutput;
}): CancellationHandler {
  let cancelled = false;

  const listener = (): void => {
    cancelled = true;
  };

  cancellationEvents.on('cancellationRequested', listener);

  return {
    isCancelled: () => cancelled,

    // The CLI signal handler already prints the cancellation message.
    reportCancellation: () => undefined,

    dispose(): void {
      cancellationEvents.removeListener('cancellationRequested', listener);
    },
  };
}

export interface CliErrorBoundaryOptions {
  readonly debug?: boolean;
}

export function isDebugEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return value
    .split(',')
    .map((token) => token.trim())
    .some(
      (token) =>
        token === '*' ||
        token === 'stellarforge' ||
        token === 'stellarforge*' ||
        token.startsWith('stellarforge:'),
    );
}

function reportDebugDetail(
  output: TerminalOutput,
  options: CliErrorBoundaryOptions,
  detail: unknown,
): void {
  if (!options.debug || detail === undefined) {
    return;
  }

  const text =
    detail instanceof Error ? (detail.stack ?? detail.message) : String(detail);

  const redacted = text
    .split('\n')
    .map((line) => redactSecretLikeText(line))
    .join('\n');

  output.error(`[debug] ${redacted}`);
}

export function handleCliError(
  error: unknown,
  output: TerminalOutput = new TerminalOutput(),
  options: CliErrorBoundaryOptions = {},
): CliExitCode {
  if (error instanceof CommanderError) {
    return error.exitCode === EXIT_CODES.success
      ? EXIT_CODES.success
      : EXIT_CODES.validation;
  }

  if (error instanceof CancellationCliError) {
    return EXIT_CODES.cancelled;
  }

  if (error instanceof CliError) {
    output.error(error.userMessage);
    reportDebugDetail(output, options, error.cause);
    return error.exitCode;
  }

  output.error(UNEXPECTED_ERROR_MESSAGE);
  reportDebugDetail(output, options, error);
  return EXIT_CODES.unexpected;
}

export async function runWithCliErrorBoundary(
  action: () => void | Promise<void>,
  output: TerminalOutput = new TerminalOutput(),
  options: CliErrorBoundaryOptions = {},
): Promise<CliExitCode> {
  try {
    await action();
    return EXIT_CODES.success;
  } catch (error) {
    return handleCliError(error, output, options);
  }
}
