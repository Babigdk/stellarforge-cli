import { describe, expect, it } from 'vitest';
import {
  createDoctorCommand,
  renderDiagnosticReport,
} from '../src/commands/doctor.js';
import type {
  DiagnosticCheck,
  DiagnosticReport,
  DiagnosticStatus,
} from '../src/diagnostics/types.js';
import { EXIT_CODES } from '../src/errors/errors.js';
import { createCapturedTerminalOutput } from './helpers/captured-output.js';

function mockCheck(
  id: string,
  label: string,
  status: DiagnosticStatus,
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

function runDoctorWithChecks(checks: readonly DiagnosticCheck[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
  lines: string[];
} {
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

  return {
    exitCode,
    stdout: captured.stdoutText(),
    stderr: captured.stderrText(),
    lines: captured
      .stdoutText()
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0),
  };
}

describe('SW-001: Doctor output snapshot conformance tests', () => {
  it('matches output snapshot and contract for all-pass diagnostics', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('node', 'Node.js', 'pass', 'Supported version 22.13.0 detected.'),
      mockCheck('npm', 'npm', 'pass', 'Supported version 10.9.2 detected.'),
      mockCheck('git', 'Git', 'pass', 'git version 2.45.0 detected.'),
      mockCheck('rust', 'Rust', 'pass', 'rustc 1.84.0 detected.'),
      mockCheck('cargo', 'Cargo', 'pass', 'cargo 1.84.0 detected.'),
      mockCheck('stellar', 'Stellar CLI', 'pass', 'stellar 21.0.0 detected.'),
      mockCheck('docker', 'Docker', 'pass', 'Docker version 27.0.0 detected.'),
    ];

    const result = runDoctorWithChecks(checks);

    expect(result.exitCode).toBe(EXIT_CODES.success);
    expect(result.stderr).toBe('');

    // Line-by-line ordering envelope and status markers
    expect(result.lines).toEqual([
      '[PASS] Node.js: Supported version 22.13.0 detected.',
      '[PASS] npm: Supported version 10.9.2 detected.',
      '[PASS] Git: git version 2.45.0 detected.',
      '[PASS] Rust: rustc 1.84.0 detected.',
      '[PASS] Cargo: cargo 1.84.0 detected.',
      '[PASS] Stellar CLI: stellar 21.0.0 detected.',
      '[PASS] Docker: Docker version 27.0.0 detected.',
      'Summary: 7 passed, 0 warnings, 0 failed.',
      'Overall health: ready.',
    ]);
  });

  it('matches output snapshot and contract for warning diagnostics (usable with warnings)', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('node', 'Node.js', 'pass', 'Supported version 22.13.0 detected.'),
      mockCheck('npm', 'npm', 'pass', 'Supported version 10.9.2 detected.'),
      mockCheck(
        'docker',
        'Docker',
        'warn',
        'Docker daemon is unavailable.',
        'Start Docker Desktop or service only when a container-based workflow is needed.',
      ),
    ];

    const result = runDoctorWithChecks(checks);

    expect(result.exitCode).toBe(EXIT_CODES.success);
    expect(result.stderr).toBe('');

    // Assert status markers and indentation of remediation directly under the warning
    expect(result.lines).toEqual([
      '[PASS] Node.js: Supported version 22.13.0 detected.',
      '[PASS] npm: Supported version 10.9.2 detected.',
      '[WARN] Docker: Docker daemon is unavailable.',
      '  Remediation: Start Docker Desktop or service only when a container-based workflow is needed.',
      'Summary: 2 passed, 1 warnings, 0 failed.',
      'Overall health: usable with warnings.',
    ]);
  });

  it('matches output snapshot and contract for failure diagnostics (action required)', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('node', 'Node.js', 'pass', 'Supported version 22.13.0 detected.'),
      mockCheck(
        'stellar',
        'Stellar CLI',
        'fail',
        'Stellar CLI is not installed or not found on PATH.',
        'Install Stellar CLI >=21.0.0 and ensure it is available on PATH.',
      ),
      mockCheck(
        'docker',
        'Docker',
        'warn',
        'Docker is optional and not running.',
        'Start Docker if required by your template.',
      ),
    ];

    const result = runDoctorWithChecks(checks);

    expect(result.exitCode).toBe(EXIT_CODES.diagnostic);
    expect(result.stderr).toBe('');

    expect(result.lines).toEqual([
      '[PASS] Node.js: Supported version 22.13.0 detected.',
      '[FAIL] Stellar CLI: Stellar CLI is not installed or not found on PATH.',
      '  Remediation: Install Stellar CLI >=21.0.0 and ensure it is available on PATH.',
      '[WARN] Docker: Docker is optional and not running.',
      '  Remediation: Start Docker if required by your template.',
      'Summary: 1 passed, 1 warnings, 1 failed.',
      'Overall health: action required.',
    ]);
  });

  it('matches output snapshot and contract when no diagnostics are registered', () => {
    const result = runDoctorWithChecks([]);

    expect(result.exitCode).toBe(EXIT_CODES.success);
    expect(result.stderr).toBe('');

    expect(result.lines).toEqual([
      'No diagnostics are registered yet.',
      'Summary: 0 passed, 0 warnings, 0 failed.',
      'Overall health: no diagnostics registered.',
    ]);
  });

  it('renders directly via renderDiagnosticReport conforming to the summary envelope', () => {
    const captured = createCapturedTerminalOutput();

    const report: DiagnosticReport = {
      results: [
        {
          id: 'test-tool',
          label: 'Test Tool',
          status: 'fail',
          message: 'Tool verification failed.',
          remediation: 'Follow instructions to fix Tool.',
        },
      ],
      summary: {
        pass: 0,
        warn: 0,
        fail: 1,
        total: 1,
      },
    };

    renderDiagnosticReport(report, captured.output);

    const lines = captured
      .stdoutText()
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);

    expect(lines).toEqual([
      '[FAIL] Test Tool: Tool verification failed.',
      '  Remediation: Follow instructions to fix Tool.',
      'Summary: 0 passed, 0 warnings, 1 failed.',
      'Overall health: action required.',
    ]);
  });
});
