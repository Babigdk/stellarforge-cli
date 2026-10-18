import { Command } from 'commander';
import { createDockerDiagnostic } from '../diagnostics/docker.js';
import { createGitDiagnostic } from '../diagnostics/git.js';
import { runDiagnostics } from '../diagnostics/run.js';
import {
  createCargoDiagnostic,
  createRustDiagnostic,
} from '../diagnostics/rust.js';
import { createRuntimeDiagnostics } from '../diagnostics/runtime.js';
import { createStellarDiagnostic } from '../diagnostics/stellar.js';
import type {
  DiagnosticCheck,
  DiagnosticReport,
  DiagnosticResult,
  DiagnosticSummary,
} from '../diagnostics/types.js';
import { EXIT_CODES } from '../errors/errors.js';
import { TerminalOutput } from '../output/terminal.js';

export interface DoctorCommandOptions {
  readonly checks?: readonly DiagnosticCheck[];
  readonly output?: TerminalOutput;
  readonly setExitCode?: (code: number) => void;
}

// Exported bounds for diagnostic text rendering.
const MAX_LABEL_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 200;
const MAX_REMEDIATION_LENGTH = 200;

const SECRET_PATTERNS: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bghp_[A-Za-z0-9]{10,}/gi,
  /\bgithub_pat_[A-Za-z0-9_]{10,}/gi,
  /\bxoxx[A-Za-z0-9]+/gi,
  /\bAKIA[0-9A-Z]{16,}/g,
  /\b(?:secret|token|password|api[ke]?|auth)\s*[:=]\s*\S?/gi,
];

function sanitizeText(value: string, maxLength: number): string {
  if (!value) {
    return '';
  }

  let sanitized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  if (sanitized.length > maxLength) {
    const ellipsis = '...';
    sanitized = `${sanitized.slice(0, Math.max(0, maxLength - ellipsis.length))}${ellipsis}`;
  }

  return sanitized;
}

function formatResult(result: DiagnosticResult): string {
  const label = sanitizeText(result.label, MAX_LABEL_LENGTH);
  const message = sanitizeText(result.message, MAX_MESSAGE_LENGTH);
  return `[${result.status.toUpperCase()}] ${label}: ${message}`;
}

function formatOverallHealth(summary: DiagnosticSummary): string {
  if (summary.total === 0) {
    return 'Overall health: no diagnostics registered.';
  }

  if (summary.fail > 0) {
    return 'Overall health: action required.';
  }

  if (summary.warn > 0) {
    return 'Overall health: usable with warnings.';
  }

  return 'Overall health: ready.';
}

/**
 * Default doctor checks in their canonical, platform-independent display
 * order: runtime, source control, Rust toolchain, Stellar CLI, then Docker.
 */
export function createDefaultDiagnostics(): readonly DiagnosticCheck[] {
  return [
    ...createRuntimeDiagnostics(),
    createGitDiagnostic(),
    createRustDiagnostic(),
    createCargoDiagnostic(),
    createStellarDiagnostic(),
    createDockerDiagnostic(),
  ];
}

export function renderDiagnosticReport(
  report: DiagnosticReport,
  output: TerminalOutput,
): void {
  if (report.results.length === 0) {
    output.info('No diagnostics are registered yet.');
  }

  for (const result of report.results) {
    output.info(formatResult(result));

    if (result.remediation) {
      const remediation = sanitizeText(
        result.remediation,
        MAX_REMEDIATION_LENGTH,
      );
      output.info(`  Remediation: ${remediation}`);
    }
  }

  output.info(
    `Summary: ${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed.`,
  );
  output.info(formatOverallHealth(report.summary));
}

export function createDoctorCommand(
  options: DoctorCommandOptions = {},
): Command {
  const checks = options.checks ?? createDefaultDiagnostics();
  const output = options.output ?? new TerminalOutput();
  const setExitCode =
    options.setExitCode ?? ((code) => (process.exitCode = code));

  return new Command('doctor')
    .description('Check the local StellarForge development environment.')
    .action(() => {
      const report = runDiagnostics(checks);
      renderDiagnosticReport(report, output);
      setExitCode(
        report.summary.fail > 0 ? EXIT_CODES.diagnostic : EXIT_CODES.success,
      );
    });
}
