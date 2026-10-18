import { describe, expect, it } from 'vitest';
import { createGitDiagnostic } from '../src/diagnostics/git.js';
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

describe('Git diagnostic', () => {
  it('executes git with an argument array and parses standard version output', () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const execute: RunCommand = (executable, args) => {
      calls.push({ executable, args });
      return result(0, 'git version 2.47.1\n');
    };

    const diagnostic = createGitDiagnostic(execute).run();

    expect(calls).toEqual([{ executable: 'git', args: ['--version'] }]);
    expect(diagnostic.status).toBe('pass');
    expect(diagnostic.message).toContain('2.47.1');
  });

  it('accepts platform-suffixed Git version output', () => {
    const execute: RunCommand = () =>
      result(0, 'git version 2.47.1.windows.1\n');

    const diagnostic = createGitDiagnostic(execute).run();

    expect(diagnostic.status).toBe('pass');
    expect(diagnostic.message).toContain('2.47.1');
  });

  it('fails when Git is unavailable without leaking process details', () => {
    const execute: RunCommand = () =>
      result(
        null,
        '',
        'SECRET_TOKEN=do-not-render',
        new Error('spawn git ENOENT SECRET_TOKEN=do-not-render'),
      );

    const diagnostic = createGitDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toBe(
      'Git is unavailable or could not be executed.',
    );
    expect(JSON.stringify(diagnostic)).not.toContain('SECRET_TOKEN');
  });

  it('fails malformed Git version output with remediation guidance', () => {
    const execute: RunCommand = () => result(0, 'git version unknown\n');

    const diagnostic = createGitDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toBe('Git returned an unrecognized version.');
    expect(diagnostic.remediation).toContain('git --version');
  });

  it.each([
    ['non-zero exit with valid stdout', result(128, 'git version 2.47.1\n')],
    ['empty stdout', result(0, '')],
    ['null status without error', result(null, 'git version 2.47.1\n')],
    ['unexpected prefix', result(0, 'fatal: not a git repository\n')],
  ])('fails safely for %s', (_label, outcome) => {
    const execute: RunCommand = () => outcome;

    const diagnostic = createGitDiagnostic(execute).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).not.toContain('fatal:');
  });

  it('tolerates surrounding whitespace and newlines in version output', () => {
    const execute: RunCommand = () =>
      result(0, '\n   git version 2.43.0  \n\n');

    const diagnostic = createGitDiagnostic(execute).run();

    expect(diagnostic.status).toBe('pass');
    expect(diagnostic.message).toContain('2.43.0');
  });
});
