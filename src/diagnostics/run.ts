
import {
  boundDiagnosticText,
  MAX_DIAGNOSTIC_MESSAGE_LENGTH,
  MAX_DIAGNOSTIC_REMEDIATION_LENGTH,
} from './bounds.js';

import type {
  DiagnosticCheck,
  DiagnosticReport,
  DiagnosticResult,
  DiagnosticSummary,
} from './types.js';

/**
 * Creates a safe fallback result when a diagnostic check fails unexpectedly.
 *
 * Internal exception details are intentionally excluded to prevent sensitive
 * information from being exposed in terminal output.
 */
function failedCheckResult(check: DiagnosticCheck): DiagnosticResult {
  return {
    id: check.id,
    label: check.label,
    status: 'fail',
    message: 'Diagnostic check could not complete.',
    remediation:
      'Retry the command or inspect the relevant tool configuration.',
  };
}

/**
 * Calculates diagnostic totals from the completed results.
 *
 * @param results - Diagnostic results to summarize.
 * @returns Counts of passed, warned, and failed checks.
 */
function summarize(
  results: readonly DiagnosticResult[],
): DiagnosticSummary {
  const summary: DiagnosticSummary = {
    pass: 0,
    warn: 0,
    fail: 0,
    total: results.length,
  };

  for (const result of results) {
    if (result.status === 'pass') {
      pass += 1;
    } else if (result.status === 'warn') {
      warn += 1;
    } else {
      fail += 1;
    }
  }

  return {
    pass,
    warn,
    fail,
    total: pass + warn + fail,
  };
}

/**
 * Normalizes a diagnostic result by bounding its message and remediation text.
 *
 * Result identifiers and labels are preserved because they originate from
 * registered diagnostic checks rather than external tool output.
 *
 * @param result - Diagnostic result to normalize.
 * @returns A normalized diagnostic result.
 */
function boundResult(result: DiagnosticResult): DiagnosticResult {
  return {
    ...result,
    message: boundDiagnosticText(
      result.message,
      MAX_DIAGNOSTIC_MESSAGE_LENGTH,
    ),
    ...(result.remediation === undefined
      ? {}
      : {
          remediation: boundDiagnosticText(
            result.remediation,
            MAX_DIAGNOSTIC_REMEDIATION_LENGTH,
          ),
        }),
  };
}

/**
 * Runs registered diagnostic checks sequentially.
 *
 * Results preserve registration order regardless of execution time or status.
 * If a check throws, a safe failure result is generated in its original
 * position without preventing subsequent checks from executing.
 *
 * @param checks - Registered diagnostic checks to execute.
 * @returns Diagnostic results and their aggregate summary.
 */
export function runDiagnostics(
  checks: readonly DiagnosticCheck[],
): DiagnosticReport {
  // Snapshot registration order to prevent external array mutations from
  // affecting the execution sequence.
  const registeredChecks = [...checks];

  const results: DiagnosticResult[] = [];

  for (const check of registeredChecks) {
    let result: DiagnosticResult;

    try {
      result = check.run();
    } catch {
      result = failedCheckResult(check);
    }

    results.push(boundResult(result));
  }

  return {
    results,
    summary: summarize(results),
  };
}
