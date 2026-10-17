import type {
  DiagnosticCheck,
  DiagnosticReport,
  DiagnosticResult,
  DiagnosticSummary,
} from './types.js';

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

function summarize(results: readonly DiagnosticResult[]): DiagnosticSummary {
  let pass = 0;
  let warn = 0;
  let fail = 0;

  for (const result of results) {
    if (result.status === 'pass') pass += 1;
    if (result.status === 'warn') warn += 1;
    if (result.status === 'fail') fail += 1;
  }

  return {
    pass,
    warn,
    fail,
    total: results.length,
  };
}

/**
 * Runs diagnostic checks sequentially and returns results in registration
 * order. Ordering is part of the doctor output contract: results are never
 * sorted by status, label, or completion time, and a check that throws keeps
 * its original position as a failed result.
 */
export function runDiagnostics(
  checks: readonly DiagnosticCheck[],
): DiagnosticReport {
  // Snapshot the registration order so a caller mutating its own array while
  // checks run cannot reorder, skip, or duplicate results.
  const registered = [...checks];
  const results: DiagnosticResult[] = [];

  for (const check of registered) {
    try {
      results.push(check.run());
    } catch {
      results.push(failedCheckResult(check));
    }
  }

  return {
    results,
    summary: summarize(results),
  };
}
