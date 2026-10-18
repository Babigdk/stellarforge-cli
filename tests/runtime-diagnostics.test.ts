import { describe, expect, it } from 'vitest';
import {
  createNodeDiagnostic,
  createNpmDiagnostic,
} from '../src/diagnostics/runtime.js';
import type { RunCommand } from '../src/diagnostics/process.js';
import { createNpmInvocation } from '../src/process/npm.js';

function commandResult(
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

describe('Node.js diagnostic', () => {
  it('passes a supported Node.js version', () => {
    const result = createNodeDiagnostic('22.13.0').run();

    expect(result.status).toBe('pass');
    expect(result.message).toContain('22.13.0');
  });

  it('fails versions below the supported minimum', () => {
    const result = createNodeDiagnostic('22.12.9').run();

    expect(result.status).toBe('fail');
    expect(result.remediation).toContain('>=22.13.0');
  });

  it('fails Node.js 25 and newer', () => {
    const result = createNodeDiagnostic('25.0.0').run();

    expect(result.status).toBe('fail');
    expect(result.remediation).toContain('<25');
  });

  it('fails malformed versions without throwing', () => {
    const malformedCases = [
      'unknown',
      '',
      '   ',
      'v22.13.0',
      '22.13',
      '22',
      '22.13.0.1',
      'not.a.version',
      '22.x.0',
      'NaN.0.0',
      '-22.13.0',
      '22.13.0extra',
      '9007199254740992.0.0',
    ];

    for (const version of malformedCases) {
      const result = createNodeDiagnostic(version).run();

      expect(result.status).toBe('fail');
      expect(result.message).toBe(
        'Could not determine a valid Node.js version.',
      );
      expect(result.remediation).toBe(
        'Install a supported Node.js release (>=22.13.0 and <25).',
      );
    }
  });

  it('handles supported versions with leading and trailing whitespace', () => {
    const result = createNodeDiagnostic('  22.13.0\n\t').run();

    expect(result.status).toBe('pass');
    expect(result.message).toContain('22.13.0');
  });

  it('handles supported versions with prerelease or build metadata', () => {
    const result = createNodeDiagnostic('22.13.0-rc.1+build.123').run();

    expect(result.status).toBe('pass');
    expect(result.message).toContain('22.13.0-rc.1+build.123');
  });
});

describe('npm diagnostic', () => {
  it('executes npm with an argument array and passes a supported version', () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const execute: RunCommand = (executable, args) => {
      calls.push({ executable, args });
      return commandResult(0, '10.9.2\n');
    };

    const result = createNpmDiagnostic(execute).run();

    const npm = createNpmInvocation(['--version']);
    expect(calls).toEqual([{ executable: npm.command, args: npm.args }]);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('10.9.2');
  });

  it('passes supported npm versions with leading/trailing whitespace and metadata', () => {
    const cases = [
      '  10.9.0\r\n',
      '\t10.9.2\n',
      '10.9.0-next.1\n',
      '  10.9.2+sha.abcdef  \n',
    ];

    for (const stdout of cases) {
      const execute: RunCommand = () => commandResult(0, stdout);
      const result = createNpmDiagnostic(execute).run();

      expect(result.status).toBe('pass');
      expect(result.message).toContain('Supported version');
    }
  });

  it('fails when npm is unavailable without exposing subprocess details', () => {
    const execute: RunCommand = () =>
      commandResult(
        null,
        '',
        'SECRET_TOKEN=do-not-render',
        new Error('spawn npm ENOENT SECRET_TOKEN=do-not-render'),
      );

    const result = createNpmDiagnostic(execute).run();

    expect(result.status).toBe('fail');
    expect(result.message).toBe('npm is unavailable or could not be executed.');
    expect(result.remediation).toBe(
      'Install npm >=10.9.0 and ensure it is available on PATH.',
    );
    expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
  });

  it('classifies non-zero npm version execution safely without leaking output', () => {
    const nonZeroCases = [
      commandResult(1, '', 'npm ERR! code ENOTFOUND API_KEY=secret_key_12345'),
      commandResult(127, 'command not found: npm AWS_SECRET=super_secret'),
      commandResult(
        null,
        'some output',
        'SIGKILL',
        new Error('process killed with API_SECRET=classified'),
      ),
    ];

    for (const res of nonZeroCases) {
      const execute: RunCommand = () => res;
      const result = createNpmDiagnostic(execute).run();

      expect(result.status).toBe('fail');
      expect(result.message).toBe(
        'npm is unavailable or could not be executed.',
      );
      expect(result.remediation).toBe(
        'Install npm >=10.9.0 and ensure it is available on PATH.',
      );
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('API_KEY');
      expect(serialized).not.toContain('AWS_SECRET');
      expect(serialized).not.toContain('API_SECRET');
      expect(serialized).not.toContain('secret');
    }
  });

  it('fails missing or empty npm version output safely', () => {
    const emptyOutputs = ['', '   ', '\n', '\r\n\t  \n'];

    for (const stdout of emptyOutputs) {
      const execute: RunCommand = () => commandResult(0, stdout);
      const result = createNpmDiagnostic(execute).run();

      expect(result.status).toBe('fail');
      expect(result.message).toBe('npm returned an unrecognized version.');
      expect(result.remediation).toBe(
        'Install npm >=10.9.0 and verify `npm --version` returns a numeric version.',
      );
    }
  });

  it('fails malformed, partial, and unexpected extra npm version output safely', () => {
    const malformedCases = [
      'npm unknown\n',
      'v10.9.2\n',
      '10.9\n',
      '10\n',
      '10.9.2.1\n',
      '10.9.2 extra unexpected text\n',
      'notice: new update available\n10.9.2\n',
      'unknown\n',
      'NaN.0.0\n',
      '10.x.0\n',
      'not-a-version\n',
      '9007199254740992.0.0\n',
      '10.9.2\nSECRET_ENV=token_value\n',
    ];

    for (const stdout of malformedCases) {
      const execute: RunCommand = () => commandResult(0, stdout);
      const result = createNpmDiagnostic(execute).run();

      expect(result.status).toBe('fail');
      expect(result.message).toBe('npm returned an unrecognized version.');
      expect(result.remediation).toBe(
        'Install npm >=10.9.0 and verify `npm --version` returns a numeric version.',
      );
      expect(JSON.stringify(result)).not.toContain('SECRET_ENV');
      expect(JSON.stringify(result)).not.toContain('token_value');
    }
  });

  it('fails npm versions below the supported minimum', () => {
    const execute: RunCommand = () => commandResult(0, '10.8.9\n');

    const result = createNpmDiagnostic(execute).run();

    expect(result.status).toBe('fail');
    expect(result.message).toBe('Unsupported npm version 10.8.9.');
    expect(result.remediation).toContain('>=10.9.0');
  });

  it('fails unrecognized npm version output', () => {
    const execute: RunCommand = () => commandResult(0, 'npm unknown\n');

    const result = createNpmDiagnostic(execute).run();

    expect(result.status).toBe('fail');
    expect(result.message).toBe('npm returned an unrecognized version.');
  });
});
