import { describe, expect, it } from 'vitest';
import {
  createDoctorCommand,
  renderDiagnosticReport,
} from '../src/commands/doctor.js';
import type {
  DiagnosticCheck,
  DiagnosticReport,
  DiagnosticStatus,
  DiagnosticReportJSON,
} from '../src/diagnostics/types.js';
import { DIAGNOSTIC_SCHEMA_VERSION } from '../src/diagnostics/types.js';
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

function runDoctorJsonWithChecks(checks: readonly DiagnosticCheck[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: DiagnosticReportJSON | null;
} {
  const captured = createCapturedTerminalOutput();
  let exitCode = -1;
  const command = createDoctorCommand({
    checks,
    output: captured.output,
    setExitCode: (code) => {
      exitCode = code;
    },
    json: true,
  });

  command.parse(['node', 'doctor']);

  let json: DiagnosticReportJSON | null = null;
  try {
    const stdout = captured.stdoutText().trim();
    if (stdout) {
      json = JSON.parse(stdout) as DiagnosticReportJSON;
    }
  } catch {
    // Invalid JSON
  }

  return {
    exitCode,
    stdout: captured.stdoutText(),
    stderr: captured.stderrText(),
    json,
  };
}

describe('SW-001: Doctor output snapshot conformance tests', () => {
  it('matches output snapshot and contract for all-pass diagnostics', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck(
        'node',
        'Node.js',
        'pass',
        'Supported version 22.13.0 detected.',
      ),
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
      mockCheck(
        'node',
        'Node.js',
        'pass',
        'Supported version 22.13.0 detected.',
      ),
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
      mockCheck(
        'node',
        'Node.js',
        'pass',
        'Supported version 22.13.0 detected.',
      ),
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

describe('SW-002: Doctor JSON output schema and determinism tests', () => {
  it('outputs valid JSON with stable schema version', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('node', 'Node.js', 'pass', 'Supported version 22.13.0 detected.'),
      mockCheck('npm', 'npm', 'pass', 'Supported version 10.9.2 detected.'),
    ];

    const result = runDoctorJsonWithChecks(checks);

    expect(result.exitCode).toBe(EXIT_CODES.success);
    expect(result.stderr).toBe('');
    expect(result.json).not.toBeNull();
    expect(result.json?.schemaVersion).toBe(DIAGNOSTIC_SCHEMA_VERSION);
    expect(result.json?.schemaVersion).toBe('1.0.0');
  });

  it('JSON output includes check id, label, status, message, and optional remediation', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck(
        'node',
        'Node.js',
        'pass',
        'Supported version 22.13.0 detected.',
      ),
      mockCheck(
        'docker',
        'Docker',
        'warn',
        'Docker daemon is unavailable.',
        'Start Docker Desktop when needed.',
      ),
    ];

    const result = runDoctorJsonWithChecks(checks);

    expect(result.json?.checks).toEqual([
      {
        id: 'node',
        label: 'Node.js',
        status: 'pass',
        message: 'Supported version 22.13.0 detected.',
      },
      {
        id: 'docker',
        label: 'Docker',
        status: 'warn',
        message: 'Docker daemon is unavailable.',
        remediation: 'Start Docker Desktop when needed.',
      },
    ]);
  });

  it('JSON output excludes remediation field when not present', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('node', 'Node.js', 'pass', 'Supported version 22.13.0 detected.'),
    ];

    const result = runDoctorJsonWithChecks(checks);

    expect(result.json?.checks[0]).toHaveProperty('id');
    expect(result.json?.checks[0]).toHaveProperty('status');
    expect(result.json?.checks[0]).not.toHaveProperty('remediation');
  });

  it('JSON output includes accurate summary counts', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('node', 'Node.js', 'pass', 'Supported version 22.13.0 detected.'),
      mockCheck('npm', 'npm', 'pass', 'Supported version 10.9.2 detected.'),
      mockCheck('docker', 'Docker', 'warn', 'Docker daemon is unavailable.'),
      mockCheck('stellar', 'Stellar CLI', 'fail', 'Stellar CLI not found.'),
    ];

    const result = runDoctorJsonWithChecks(checks);

    expect(result.json?.summary).toEqual({
      pass: 2,
      warn: 1,
      fail: 1,
      total: 4,
    });
  });

  it('JSON output is deterministic across multiple runs', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('node', 'Node.js', 'pass', 'Supported version 22.13.0 detected.'),
      mockCheck('npm', 'npm', 'pass', 'Supported version 10.9.2 detected.'),
      mockCheck('docker', 'Docker', 'warn', 'Docker daemon is unavailable.', 'Start Docker.'),
    ];

    const result1 = runDoctorJsonWithChecks(checks);
    const result2 = runDoctorJsonWithChecks(checks);

    expect(JSON.stringify(result1.json)).toBe(JSON.stringify(result2.json));
  });

  it('JSON output maintains check registration order (not sorted)', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('z-tool', 'Z Tool', 'pass', 'Z is available.'),
      mockCheck('a-tool', 'A Tool', 'fail', 'A is not available.'),
      mockCheck('m-tool', 'M Tool', 'warn', 'M is available but degraded.'),
    ];

    const result = runDoctorJsonWithChecks(checks);

    const ids = result.json?.checks.map((c) => c.id) ?? [];
    expect(ids).toEqual(['z-tool', 'a-tool', 'm-tool']);
  });

  it('JSON exit code semantics match human output: fail returns diagnostic exit code', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('node', 'Node.js', 'pass', 'Supported version 22.13.0 detected.'),
      mockCheck('stellar', 'Stellar CLI', 'fail', 'Stellar CLI not found.'),
    ];

    const result = runDoctorJsonWithChecks(checks);

    expect(result.exitCode).toBe(EXIT_CODES.diagnostic);
  });

  it('JSON exit code semantics match human output: warning+pass returns success', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('node', 'Node.js', 'pass', 'Supported version 22.13.0 detected.'),
      mockCheck('docker', 'Docker', 'warn', 'Docker daemon is unavailable.'),
    ];

    const result = runDoctorJsonWithChecks(checks);

    expect(result.exitCode).toBe(EXIT_CODES.success);
  });

  it('JSON output is clean on stdout (no progress/banner noise)', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck('node', 'Node.js', 'pass', 'Supported version 22.13.0 detected.'),
    ];

    const result = runDoctorJsonWithChecks(checks);

    // stdout should be valid JSON only
    const stdout = result.stdout.trim();
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stdout).toMatch(/^{\s*"schemaVersion"/);
  });

  it('JSON output redacts secrets from messages and remediation', () => {
    const checks: readonly DiagnosticCheck[] = [
      mockCheck(
        'token-test',
        'Token Test',
        'fail',
        'Token ghp_1234567890abcdefghijklmnop is invalid.',
        'Use a valid token like ghp_abcdefghijklmnopqrstuvwxyz123456.',
      ),
    ];

    const result = runDoctorJsonWithChecks(checks);

    expect(result.json?.checks[0].message).toContain('[REDACTED]');
    expect(result.json?.checks[0].remediation).toContain('[REDACTED]');
  });
});
