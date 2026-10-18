import { describe, expect, it } from 'vitest';
import {
  createCargoDiagnostic,
  createRustDiagnostic,
} from '../src/diagnostics/rust.js';
import type { RunCommand } from '../src/diagnostics/process.js';

function result(
  status: number | null,
  stdout = '',
  stderr = '',
  error?: Error,
) {
  return {
    status,
    stdout,
    stderr,
    ...(error === undefined ? {} : { error }),
  };
}

describe('Rust diagnostic', () => {
  it('passes Rust 1.84.0 and newer', () => {
    const execute: RunCommand = () =>
      result(0, 'rustc 1.84.0 (9fc6b4312 2025-01-07)\n');

    const diagnostic = createRustDiagnostic(execute).run();

    expect(diagnostic.status).toBe('pass');
    expect(diagnostic.message).toContain('1.84.0');
  });

  it('fails Rust below the Stellar smart-contract minimum', () => {
    const execute: RunCommand = () =>
      result(0, 'rustc 1.83.0 (90b35a623 2024-11-26)\n');

    const diagnostic = createRustDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.remediation).toBe(
      'Upgrade to Rust >=1.84.0 before building Stellar smart contracts.',
    );
  });

  it('fails when rustc is unavailable without leaking process details', () => {
    const execute: RunCommand = () =>
      result(
        null,
        '',
        'SECRET_TOKEN=do-not-render',
        new Error('spawn rustc ENOENT SECRET_TOKEN=do-not-render'),
      );

    const diagnostic = createRustDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toBe(
      'Rust is unavailable or could not be executed.',
    );
    expect(diagnostic.remediation).toBe(
      'Install Rust >=1.84.0 and ensure `rustc` is available on PATH.',
    );
    expect(JSON.stringify(diagnostic)).not.toContain('SECRET_TOKEN');
  });

  it('fails malformed rustc output without leaking stderr or process details', () => {
    const execute: RunCommand = () =>
      result(0, 'rustc unknown\n', 'SECRET_TOKEN=do-not-render');

    const diagnostic = createRustDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toBe('Rust returned an unrecognized version.');
    expect(diagnostic.remediation).toBe(
      'Verify `rustc --version` works and reinstall Rust if necessary.',
    );
    expect(JSON.stringify(diagnostic)).not.toContain('SECRET_TOKEN');
  });

  it.each([
    ['empty output', result(0, '')],
    ['missing release segment', result(0, 'rustc 1.84\n')],
    ['non-numeric version', result(0, 'rustc a.b.c\n')],
    ['binary garbage', result(0, '\u0000\u0001rustc ?\n')],
    ['no version prefix', result(0, '1.84.0\n')],
  ])('rejects malformed rustc fixture: %s', (_label, outcome) => {
    const execute: RunCommand = () => outcome;

    const diagnostic = createRustDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(JSON.stringify(diagnostic)).not.toContain('\u0000');
  });

  it('accepts newline-terminated rustc version with trailing metadata', () => {
    const execute: RunCommand = () =>
      result(0, 'rustc 1.85.0-nightly (abc1234 2025-02-01)\n');

    const diagnostic = createRustDiagnostic(execute).run();

    expect(diagnostic.status).toBe('pass');
    expect(diagnostic.message).toContain('1.85.0');
  });
});

describe('Cargo diagnostic', () => {
  it('checks Cargo independently and parses its version', () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const execute: RunCommand = (executable, args) => {
      calls.push({ executable, args });
      return result(0, 'cargo 1.89.0 (c24e10642 2025-06-23)\n');
    };

    const diagnostic = createCargoDiagnostic(execute).run();

    expect(calls).toEqual([{ executable: 'cargo', args: ['--version'] }]);
    expect(diagnostic.status).toBe('pass');
    expect(diagnostic.message).toContain('1.89.0');
  });

  it('fails when Cargo is unavailable without leaking process details', () => {
    const execute: RunCommand = () =>
      result(
        null,
        '',
        'SECRET_TOKEN=do-not-render',
        new Error('spawn cargo ENOENT SECRET_TOKEN=do-not-render'),
      );

    const diagnostic = createCargoDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toBe(
      'Cargo is unavailable or could not be executed.',
    );
    expect(diagnostic.remediation).toBe(
      'Install Cargo and ensure `cargo` is available on PATH.',
    );
    expect(JSON.stringify(diagnostic)).not.toContain('SECRET_TOKEN');
  });

  it('fails malformed Cargo output without leaking stderr or process details', () => {
    const execute: RunCommand = () =>
      result(0, 'cargo unknown\n', 'SECRET_TOKEN=do-not-render');

    const diagnostic = createCargoDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toBe('Cargo returned an unrecognized version.');
    expect(diagnostic.remediation).toBe(
      'Verify `cargo --version` works and reinstall Cargo if necessary.',
    );
    expect(JSON.stringify(diagnostic)).not.toContain('SECRET_TOKEN');
  });

  it('provides independently actionable guidance when rustc fails and cargo passes', () => {
    const rustExecute: RunCommand = () =>
      result(null, '', '', new Error('spawn rustc ENOENT'));
    const cargoExecute: RunCommand = () =>
      result(0, 'cargo 1.89.0 (c24e10642 2025-06-23)\n');

    const rustDiag = createRustDiagnostic(rustExecute).run();
    const cargoDiag = createCargoDiagnostic(cargoExecute).run();

    expect(rustDiag.status).toBe('fail');
    expect(rustDiag.remediation).toBe(
      'Install Rust >=1.84.0 and ensure `rustc` is available on PATH.',
    );
    expect(cargoDiag.status).toBe('pass');
  });

  it('provides independently actionable guidance when cargo fails and rustc passes', () => {
    const rustExecute: RunCommand = () =>
      result(0, 'rustc 1.84.0 (9fc6b4312 2025-01-07)\n');
    const cargoExecute: RunCommand = () =>
      result(null, '', '', new Error('spawn cargo ENOENT'));

    const rustDiag = createRustDiagnostic(rustExecute).run();
    const cargoDiag = createCargoDiagnostic(cargoExecute).run();

    expect(rustDiag.status).toBe('pass');
    expect(cargoDiag.status).toBe('fail');
    expect(cargoDiag.remediation).toBe(
      'Install Cargo and ensure `cargo` is available on PATH.',
    );
  });

  it.each([
    ['empty output', result(0, '')],
    ['missing release segment', result(0, 'cargo 1.89\n')],
    ['no version prefix', result(0, '1.89.0 (c24e10642 2025-06-23)\n')],
  ])('rejects malformed cargo fixture: %s', (_label, outcome) => {
    const execute: RunCommand = () => outcome;

    const diagnostic = createCargoDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toBe('Cargo returned an unrecognized version.');
  });
});
