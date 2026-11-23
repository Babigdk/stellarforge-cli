import { describe, expect, it } from 'vitest';
import { createDoctorCommand } from '../src/commands/doctor.js';
import { runDiagnostics } from '../src/diagnostics/run.js';
import type { DiagnosticCheck } from '../src/diagnostics/types.js';
import { EXIT_CODES } from '../src/errors/errors.js';
import { createCapturedTerminalOutput } from './helpers/index.js';

function check(
  id: string,
  label: string,
  status: 'pass' | 'warn' | 'fail',
  message: string,
  remediation?: string,
): DiagnosticCheck {
  return {
    id,
    label,
    run: () => ({
      id,
      label,
      status,
      message,
      ...(remediation === undefined ? {} : { remediation }),
    }),
  };
}

function runDoctor(checks: readonly DiagnosticCheck[]) {
  const captured = createCapturedTerminalOutput();
  let exitCode = -1;
  const command = createDoctorCommand({
    checks,
    output: captured.output,
    setExitCode: (code) => {
      exitCode = code;
    },
  });

  command.parse(['node', 'doctor']);

  const stdout = captured.stdoutText();
  const summaryLine = stdout
    .split('\n')
    .find((line) => line.startsWith('Summary: '));

  return {
    exitCode,
    stdout,
    stderr: captured.stderrText(),
    summaryLine,
  };
}

describe('doctor command', () => {
  it('renders an empty scaffold without failing when checks are explicitly empty', () => {
    const { exitCode, stdout, stderr, summaryLine } = runDoctor([]);

    expect(exitCode).toBe(EXIT_CODES.success);
    expect(stdout).toContain('No diagnostics are registered yet.');
    expect(summaryLine).toBe('Summary: 0 passed, 0 warnings, 0 failed.');
    expect(stdout).toContain('Overall health: no diagnostics registered.');
    expect(stderr).toBe('');
  });

  it('keeps empty/incomplete diagnostic sets deterministic across repeated runs', () => {
    const checks = [
      check('node', 'Node.js', 'pass', 'Supported version detected.'),
      check('docker', 'Docker', 'warn', 'Docker is not available.'),
    ];

    const first = runDoctor(checks);
    const second = runDoctor(checks);
    const report = runDiagnostics(checks);

    expect(first).toEqual(second);
    expect(first.stdout).toContain('[WARN] Docker: Docker is not available.');
    expect(first.stdout).not.toContain('Remediation:');
    expect(first.summaryLine).toBe('Summary: 1 passed, 1 warnings, 0 failed.');
    expect(first.summaryLine).toBe(
      `Summary: ${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed.`,
    );
  });

  it('integration matrix: aggregate status, summary counts, and exit codes agree', () => {
    const scenarios = [
      {
        name: 'all-pass',
        checks: [
          check('node', 'Node.js', 'pass', 'Supported version detected.'),
          check('npm', 'npm', 'pass', 'Supported version detected.'),
        ],
        expectedExit: EXIT_CODES.success,
        expectedSummary: 'Summary: 2 passed, 0 warnings, 0 failed.',
        expectedHealth: 'Overall health: ready.',
      },
      {
        name: 'mixed',
        checks: [
          check('node', 'Node.js', 'pass', 'Supported version detected.'),
          check(
            'docker',
            'Docker',
            'warn',
            'Docker daemon is unavailable.',
            'Start Docker when needed.',
          ),
          check(
            'stellar',
            'Stellar CLI',
            'fail',
            'Stellar CLI is unavailable or could not be executed.',
            'Install or update the official Stellar CLI.',
          ),
        ],
        expectedExit: EXIT_CODES.diagnostic,
        expectedSummary: 'Summary: 1 passed, 1 warnings, 1 failed.',
        expectedHealth: 'Overall health: action required.',
      },
      {
        name: 'all-fail',
        checks: [
          check('node', 'Node.js', 'fail', 'Unsupported Node.js version.'),
          check('npm', 'npm', 'fail', 'npm is unavailable.'),
        ],
        expectedExit: EXIT_CODES.diagnostic,
        expectedSummary: 'Summary: 0 passed, 0 warnings, 2 failed.',
        expectedHealth: 'Overall health: action required.',
      },
      {
        name: 'timeout',
        checks: [
          check('node', 'Node.js', 'pass', 'Supported version detected.'),
          check(
            'git',
            'Git',
            'fail',
            'Git timed out while reporting its version.',
            'Check that `git --version` responds promptly and retry the diagnostic.',
          ),
        ],
        expectedExit: EXIT_CODES.diagnostic,
        expectedSummary: 'Summary: 1 passed, 0 warnings, 1 failed.',
        expectedHealth: 'Overall health: action required.',
      },
      {
        name: 'unavailable-tool',
        checks: [
          check(
            'rust',
            'Rust',
            'fail',
            'Rust is unavailable or could not be executed.',
            'Install Rust >=1.84.0 and ensure `rustc` is available on PATH.',
          ),
        ],
        expectedExit: EXIT_CODES.diagnostic,
        expectedSummary: 'Summary: 0 passed, 0 warnings, 1 failed.',
        expectedHealth: 'Overall health: action required.',
      },
    ] as const;

    for (const scenario of scenarios) {
      const result = runDoctor(scenario.checks);
      const report = runDiagnostics(scenario.checks);

      expect(result.exitCode, scenario.name).toBe(scenario.expectedExit);
      expect(result.stderr, scenario.name).toBe('');
      expect(result.summaryLine, scenario.name).toBe(scenario.expectedSummary);
      expect(result.stdout, scenario.name).toContain(scenario.expectedHealth);
      expect(result.summaryLine, scenario.name).toBe(
        `Summary: ${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed.`,
      );
      expect(report.summary.total, scenario.name).toBe(
        report.summary.pass + report.summary.warn + report.summary.fail,
      );
      expect(report.summary.total, scenario.name).toBe(scenario.checks.length);
    }
  });

  it('converts an unexpected check exception into a safe failed diagnostic', () => {
    const captured = createCapturedTerminalOutput();
    let exitCode = -1;
    const command = createDoctorCommand({
      checks: [
        {
          id: 'unsafe',
          label: 'Unsafe check',
          run() {
            throw new Error('SECRET_TOKEN=do-not-render');
          },
        },
      ],
      output: captured.output,
      setExitCode: (code) => {
        exitCode = code;
      },
    });

    command.parse(['node', 'doctor']);

    expect(exitCode).toBe(EXIT_CODES.diagnostic);
    expect(captured.stdoutText()).toContain(
      '[FAIL] Unsafe check: Diagnostic check could not complete.',
    );
    expect(captured.stdoutText()).toContain(
      'Remediation: Retry the command or inspect the relevant tool configuration.',
    );
    expect(captured.stdoutText()).not.toContain('SECRET_TOKEN');
  });
});