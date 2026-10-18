import { describe, expect, it } from 'vitest';
import {
  createDefaultDiagnostics,
  createDoctorCommand,
} from '../src/commands/doctor.js';
import { runDiagnostics } from '../src/diagnostics/run.js';
import type {
  DiagnosticCheck,
  DiagnosticStatus,
} from '../src/diagnostics/types.js';
import { createCapturedTerminalOutput } from './helpers/index.js';

function mockCheck(
  id: string,
  status: DiagnosticStatus,
  remediation?: string,
): DiagnosticCheck {
  return {
    id,
    label: `Check ${id}`,
    run: () => ({
      id,
      label: `Check ${id}`,
      status,
      message: `${id} ${status}`,
      ...(remediation === undefined ? {} : { remediation }),
    }),
  };
}

function throwingCheck(id: string): DiagnosticCheck {
  return {
    id,
    label: `Check ${id}`,
    run() {
      throw new Error('unexpected');
    },
  };
}

function renderDoctor(checks: readonly DiagnosticCheck[]): string[] {
  const captured = createCapturedTerminalOutput();
  createDoctorCommand({
    checks,
    output: captured.output,
    setExitCode: () => undefined,
  }).parse(['node', 'doctor']);

  return captured
    .stdoutText()
    .split('\n')
    .filter((line) => line.length > 0);
}

describe('doctor result ordering', () => {
  it('keeps registration order instead of sorting by status or id', () => {
    const report = runDiagnostics([
      mockCheck('zeta', 'fail'),
      mockCheck('alpha', 'pass'),
      mockCheck('mid', 'warn'),
      mockCheck('beta', 'pass'),
    ]);

    expect(report.results.map((result) => result.id)).toEqual([
      'zeta',
      'alpha',
      'mid',
      'beta',
    ]);
  });

  it('keeps a throwing check in its original position', () => {
    const report = runDiagnostics([
      mockCheck('first', 'pass'),
      throwingCheck('broken'),
      mockCheck('last', 'warn'),
    ]);

    expect(report.results.map((result) => [result.id, result.status])).toEqual([
      ['first', 'pass'],
      ['broken', 'fail'],
      ['last', 'warn'],
    ]);
  });

  it('runs checks sequentially in registration order', () => {
    const calls: string[] = [];
    const tracked = (id: string): DiagnosticCheck => ({
      id,
      label: id,
      run() {
        calls.push(id);
        return { id, label: id, status: 'pass', message: 'ok' };
      },
    });

    runDiagnostics([tracked('c'), tracked('a'), tracked('b')]);

    expect(calls).toEqual(['c', 'a', 'b']);
  });

  it('is not affected by the caller mutating the check list mid-run', () => {
    const checks: DiagnosticCheck[] = [];
    checks.push(
      {
        id: 'mutator',
        label: 'Mutator',
        run() {
          checks.reverse();
          checks.push(mockCheck('late', 'fail'));
          return {
            id: 'mutator',
            label: 'Mutator',
            status: 'pass',
            message: 'ok',
          };
        },
      },
      mockCheck('second', 'warn'),
      mockCheck('third', 'pass'),
    );

    const report = runDiagnostics(checks);

    expect(report.results.map((result) => result.id)).toEqual([
      'mutator',
      'second',
      'third',
    ]);
  });

  it('produces identical rendered output across repeated runs', () => {
    const checks = [
      mockCheck('node', 'pass'),
      mockCheck('docker', 'warn', 'Start Docker when needed.'),
      throwingCheck('stellar'),
      mockCheck('git', 'fail', 'Install Git.'),
    ];

    const first = renderDoctor(checks);

    for (let run = 0; run < 5; run += 1) {
      expect(renderDoctor(checks)).toEqual(first);
    }
  });

  it('renders each remediation directly under its own result', () => {
    const lines = renderDoctor([
      mockCheck('a', 'warn', 'Fix a.'),
      mockCheck('b', 'pass'),
      mockCheck('c', 'fail', 'Fix c.'),
    ]);

    expect(lines).toEqual([
      '[WARN] Check a: a warn',
      '  Remediation: Fix a.',
      '[PASS] Check b: b pass',
      '[FAIL] Check c: c fail',
      '  Remediation: Fix c.',
      'Summary: 1 passed, 1 warnings, 1 failed.',
      'Overall health: action required.',
    ]);
  });

  it('keeps aggregation semantics unchanged when order changes', () => {
    const checks = [
      mockCheck('a', 'pass'),
      mockCheck('b', 'warn'),
      throwingCheck('c'),
      mockCheck('d', 'pass'),
    ];

    const forward = runDiagnostics(checks);
    const reversed = runDiagnostics([...checks].reverse());

    expect(forward.summary).toEqual({ pass: 2, warn: 1, fail: 1, total: 4 });
    expect(reversed.summary).toEqual(forward.summary);
    expect(reversed.results.map((result) => result.id)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ]);
  });

  it('registers default diagnostics in a fixed canonical order', () => {
    // Only ids are read; no check is run, so no real tool is invoked.
    const ids = createDefaultDiagnostics().map((check) => check.id);

    expect(ids).toEqual([
      'node',
      'npm',
      'git',
      'rust',
      'cargo',
      'stellar',
      'docker',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(createDefaultDiagnostics().map((check) => check.id)).toEqual(ids);
  });
});
