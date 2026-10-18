import { describe, expect, it } from 'vitest';
import { createDockerDiagnostic } from '../src/diagnostics/docker.js';
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

describe('Docker diagnostic', () => {
  it('passes when the Docker CLI and daemon are available', () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const execute: RunCommand = (executable, args) => {
      calls.push({ executable, args });

      if (args[0] === '--version') {
        return result(0, 'Docker version 28.4.0, build abcdef\n');
      }

      return result(0, '28.4.0\n');
    };

    const diagnostic = createDockerDiagnostic({ execute }).run();

    expect(calls).toEqual([
      { executable: 'docker', args: ['--version'] },
      {
        executable: 'docker',
        args: ['info', '--format', '{{.ServerVersion}}'],
      },
    ]);
    expect(diagnostic.status).toBe('pass');
    expect(diagnostic.message).toContain('28.4.0');
  });

  it('warns when Docker is missing for a generic doctor run', () => {
    const execute: RunCommand = () =>
      result(null, '', '', new Error('spawn docker ENOENT'));

    const diagnostic = createDockerDiagnostic({ execute }).run();

    expect(diagnostic.status).toBe('warn');
    expect(diagnostic.remediation).toContain('if your selected workflow');
  });

  it('fails when Docker is required but the CLI is missing', () => {
    const execute: RunCommand = () =>
      result(null, '', '', new Error('spawn docker ENOENT'));

    const diagnostic = createDockerDiagnostic({
      execute,
      required: true,
    }).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toContain('required');
  });

  it('distinguishes an unavailable daemon from a missing CLI', () => {
    const execute: RunCommand = (_executable, args) => {
      if (args[0] === '--version') {
        return result(0, 'Docker version 28.4.0, build abcdef\n');
      }

      return result(1, '', 'SECRET_TOKEN=do-not-render');
    };

    const diagnostic = createDockerDiagnostic({ execute }).run();

    expect(diagnostic.status).toBe('warn');
    expect(diagnostic.message).toContain('daemon is unavailable');
    expect(JSON.stringify(diagnostic)).not.toContain('SECRET_TOKEN');
  });

  it('fails an unavailable daemon when Docker is required', () => {
    const execute: RunCommand = (_executable, args) => {
      if (args[0] === '--version') {
        return result(0, 'Docker version 28.4.0, build abcdef\n');
      }

      return result(1);
    };

    const diagnostic = createDockerDiagnostic({
      execute,
      required: true,
    }).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toContain('daemon is unavailable');
  });

  it('reports malformed Docker client output without crashing', () => {
    const execute: RunCommand = () => result(0, 'Docker unknown\n');

    const diagnostic = createDockerDiagnostic({ execute }).run();

    expect(diagnostic.status).toBe('warn');
    expect(diagnostic.message).toContain('unrecognized client version');
  });

  it.each([
    ['daemon exit error', result(1, '', 'daemon unreachable')],
    ['whitespace-only daemon output', result(0, '   \n')],
    ['daemon execution error object', result(null, '', '', new Error('EPIPE'))],
  ])(
    'classifies daemon failure as unavailable: %s',
    (_label, daemonOutcome) => {
      const execute: RunCommand = (_executable, args) => {
        if (args[0] === '--version') {
          return result(0, 'Docker version 28.4.0, build abcdef\n');
        }

        return daemonOutcome;
      };

      const diagnostic = createDockerDiagnostic({ execute }).run();

      expect(diagnostic.status).toBe('warn');
      expect(diagnostic.message).toContain('daemon');
      expect(diagnostic.message).not.toContain('unreachable');
    });
});
