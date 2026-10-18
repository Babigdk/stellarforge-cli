import { describe, expect, it } from 'vitest';
import type { RunCommand } from '../src/diagnostics/process.js';
import { createStellarDiagnostic } from '../src/diagnostics/stellar.js';

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

describe('Stellar CLI diagnostic', () => {
  it('uses the official machine-friendly version command', () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const execute: RunCommand = (executable, args) => {
      calls.push({ executable, args });
      return result(0, '27.1.0\n');
    };

    const diagnostic = createStellarDiagnostic(execute).run();

    expect(calls).toEqual([
      { executable: 'stellar', args: ['version', '--only-version'] },
    ]);
    expect(diagnostic.status).toBe('pass');
    expect(diagnostic.message).toContain('27.1.0');
  });

  it('accepts a leading v and newer compatible versions', () => {
    const execute: RunCommand = () => result(0, 'v28.0.0\n');

    const diagnostic = createStellarDiagnostic(execute).run();

    expect(diagnostic.status).toBe('pass');
    expect(diagnostic.message).toContain('28.0.0');
  });

  it('accepts supported versions with whitespace, prereleases, and build metadata', () => {
    const validOutputs = [
      '27.1.0',
      '27.1.0\n',
      '  27.1.0  \r\n',
      '\t27.1.0\n',
      'v27.1.0\n',
      '  v27.1.0\n',
      '27.1.1\n',
      '27.2.0\n',
      '28.0.0\n',
      '27.1.0-rc.1\n',
      'v27.1.0-beta.2\n',
      '27.1.0+build.123\n',
      'v27.1.0-pre.1+sha.abcdef\n',
    ];

    for (const stdout of validOutputs) {
      const execute: RunCommand = () => result(0, stdout);
      const diagnostic = createStellarDiagnostic(execute).run();

      expect(diagnostic.status).toBe('pass');
      expect(diagnostic.message).toContain('Supported version');
      expect(diagnostic.message).toMatch(/27\.[1-9]\.\d+|28\.0\.0/);
    }
  });

  it('fails versions below the supported Stellar baseline', () => {
    const execute: RunCommand = () => result(0, '27.0.0\n');

    const diagnostic = createStellarDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toContain('27.0.0');
    expect(diagnostic.remediation).toContain('>=27.1.0');
  });

  it('fails when Stellar CLI is unavailable without leaking process details or invoking legacy fallbacks', () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const execute: RunCommand = (executable, args) => {
      calls.push({ executable, args });
      return result(
        null,
        '',
        'SECRET_SEED=do-not-render',
        new Error('spawn stellar ENOENT SECRET_SEED=do-not-render'),
      );
    };

    const diagnostic = createStellarDiagnostic(execute).run();

    expect(calls).toEqual([
      { executable: 'stellar', args: ['version', '--only-version'] },
    ]);
    expect(calls.some((c) => c.executable.includes('soroban'))).toBe(false);
    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toBe(
      'Stellar CLI is unavailable or could not be executed.',
    );
    expect(diagnostic.remediation).toContain(
      'Install or update the official Stellar CLI',
    );
    expect(diagnostic.remediation).not.toContain('soroban');
    expect(JSON.stringify(diagnostic)).not.toContain('SECRET_SEED');
  });

  it('classifies non-zero Stellar CLI version execution safely', () => {
    const nonZeroCases = [
      result(1, '', 'stellar: error: API_KEY=secret_12345'),
      result(127, 'command not found: stellar PRIVATE_KEY=classified'),
      result(
        null,
        'some text',
        'SIGKILL',
        new Error('process killed with SEED_PHRASE=secret words'),
      ),
    ];

    for (const res of nonZeroCases) {
      const execute: RunCommand = () => res;
      const diagnostic = createStellarDiagnostic(execute).run();

      expect(diagnostic.status).toBe('fail');
      expect(diagnostic.message).toBe(
        'Stellar CLI is unavailable or could not be executed.',
      );
      expect(diagnostic.remediation).toContain(
        'Install or update the official Stellar CLI',
      );
      const serialized = JSON.stringify(diagnostic);
      expect(serialized).not.toContain('API_KEY');
      expect(serialized).not.toContain('PRIVATE_KEY');
      expect(serialized).not.toContain('SEED_PHRASE');
      expect(serialized).not.toContain('secret');
    }
  });

  it('fails malformed version output, unexpected prefixes, suffixes, and empty outputs safely', () => {
    const malformedCases = [
      'stellar-cli unknown\n',
      'stellar 27.1.0\n',
      'stellar-cli 27.1.0\n',
      'version 27.1.0\n',
      '27.1.0 extra text\n',
      '27.1\n',
      '27\n',
      '27.1.0.1\n',
      'unknown\n',
      '',
      '   \n\t  ',
      '\n',
      'not-a-version\n',
      'NaN.0.0\n',
      '27.x.0\n',
      '9007199254740992.0.0\n',
      'vv27.1.0\n',
      'v 27.1.0\n',
      '27.1.0\nSECRET_KEY=do_not_leak\n',
    ];

    for (const stdout of malformedCases) {
      const execute: RunCommand = () => result(0, stdout);
      const diagnostic = createStellarDiagnostic(execute).run();

      expect(diagnostic.status).toBe('fail');
      expect(diagnostic.message).toBe(
        'Stellar CLI returned an unrecognized version.',
      );
      expect(diagnostic.remediation).toContain(
        'stellar version --only-version',
      );
      expect(JSON.stringify(diagnostic)).not.toContain('SECRET_KEY');
      expect(JSON.stringify(diagnostic)).not.toContain('do_not_leak');
    }
  });

  it('preserves the strict command contract without inspecting identities or config', () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const execute: RunCommand = (executable, args) => {
      calls.push({ executable, args });
      return result(0, '27.1.0\n');
    };

    createStellarDiagnostic(execute).run();

    // Verify only the exact command is executed and no identity/config subcommands are invoked
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      executable: 'stellar',
      args: ['version', '--only-version'],
    });
    for (const forbidden of [
      'identity',
      'keys',
      'config',
      'network',
      'account',
      'soroban',
    ]) {
      expect(calls[0]?.args).not.toContain(forbidden);
    }
  });
});
