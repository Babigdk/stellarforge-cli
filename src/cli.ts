#!/usr/bin/env node

import {
  CANCELLATION_EXIT_CODE,
  isDebugEnabled,
  runWithCliErrorBoundary,
} from './errors/index.js';
import { EXIT_CODES } from './errors/errors.js';
import { runCli } from './main.js';

/**
 * Documented cancellation exit code for user interrupts (SIGINT/SIGTERM).
 * This is the conventional 130 exit code for signal-terminated processes.
 */


/**
 * Tracks whether a cancellation signal has already been observed.
 * The first signal triggers graceful cleanup and a documented non-zero exit.
 * A second signal follows the documented forced-exit behavior (immediate termination).
 */
let cancellationRequested = false;

function handleSignal(signal: NodeJS.Signals): void {
  if (cancellationRequested) {
    // Second signal: forced exit. Do not swallow the signal or override
    // OS termination semantics -- restore the default handler and re-raise.
    process.removeListener(signal, handleSignal);
    process.kill(process.pid, signal);
    return;
  }

  cancellationRequested = true;

  // Report cancellation on stderr so it is not confused with success output.
  if (!process.stderr.destroyed) {
    process.stderr.write('\nCancelled.\n');
  }

  // Signal the running command to stop and allow cleanup to complete.
  // The error boundary will propagate the cancellation exit code.
  process.exitCode = CANCELLATION_EXIT_CODE;
  if (typeof process.emit === 'function') {
    // Notify any listeners (e.g. cleanup coordinators) without swallowing the signal.
    (process as unknown as {
  emit(event: string): boolean;
}).emit('cancellationRequested');
  }
}

process.on('SIGINT', handleSignal);
process.on('SIGTERM', handleSignal);

const boundaryExitCode = await runWithCliErrorBoundary(
  () => runCli(),
  undefined,
  { debug: isDebugEnabled(process.env.DEBUG) },
);

if (cancellationRequested) {
  // Cancellation takes precedence over command results: no success output after cancellation.
  process.exitCode = CANCELLATION_EXIT_CODE;
} else if (boundaryExitCode !== EXIT_CODES.success) {
  process.exitCode = boundaryExitCode;
}
