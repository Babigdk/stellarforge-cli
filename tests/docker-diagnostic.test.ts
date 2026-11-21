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

function etimedout(message = 'Command timed out'): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'ETIMEDOUT';
  return error;
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
    },
  );
});

describe('Docker timeout handling', () => {
  it('reports timeout for Docker CLI without leaking error codes', () => {
    const execute: RunCommand = () =>
      result(null, '', '', etimedout('Docker CLI timed out'));

    const diagnostic = createDockerDiagnostic({ execute }).run();

    expect(diagnostic.status).toBe('warn');
    expect(diagnostic.message).toContain('timed out');
    expect(diagnostic.remediation).toContain('responds promptly');
    expect(JSON.stringify(diagnostic)).not.toContain('ETIMEDOUT');
    expect(JSON.stringify(diagnostic)).not.toContain('Error:');
  });

  it('reports timeout for Docker daemon separately from CLI', () => {
    const execute: RunCommand = (_executable, args) => {
      if (args[0] === '--version') {
        return result(0, 'Docker version 28.4.0, build abcdef\n');
      }

      // Daemon info times out
      return result(null, '', '', etimedout('Docker daemon timed out'));
    };

    const diagnostic = createDockerDiagnostic({ execute }).run();

    expect(diagnostic.status).toBe('warn');
    expect(diagnostic.message).toContain('28.4.0');
    expect(diagnostic.message).toContain('daemon timed out');
    expect(diagnostic.remediation).toContain('docker info');
    expect(JSON.stringify(diagnostic)).not.toContain('ETIMEDOUT');
  });

  it('fails required Docker when CLI times out', () => {
    const execute: RunCommand = () =>
      result(null, '', '', etimedout('Docker CLI timed out'));

    const diagnostic = createDockerDiagnostic({
      execute,
      required: true,
    }).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toContain('required');
    expect(diagnostic.message).toContain('timed out');
    expect(JSON.stringify(diagnostic)).not.toContain('ETIMEDOUT');
  });

  it('fails required Docker when daemon times out', () => {
    const execute: RunCommand = (_executable, args) => {
      if (args[0] === '--version') {
        return result(0, 'Docker version 28.4.0, build abcdef\n');
      }

      return result(null, '', '', etimedout('Docker daemon timed out'));
    };

    const diagnostic = createDockerDiagnostic({
      execute,
      required: true,
    }).run();

    expect(diagnostic.status).toBe('fail');
    expect(diagnostic.message).toContain('28.4.0');
    expect(diagnostic.message).toContain('daemon timed out');
    expect(JSON.stringify(diagnostic)).not.toContain('ETIMEDOUT');
  });

  it('distinguishes timeout from other daemon failures', () => {
    const timeoutExecute: RunCommand = (_executable, args) => {
      if (args[0] === '--version') {
        return result(0, 'Docker version 28.4.0, build abcdef\n');
      }
      return result(null, '', '', etimedout());
    };

    const failureExecute: RunCommand = (_executable, args) => {
      if (args[0] === '--version') {
        return result(0, 'Docker version 28.4.0, build abcdef\n');
      }
      return result(1, '', 'connection refused');
    };

    const timeoutDiag = createDockerDiagnostic({
      execute: timeoutExecute,
    }).run();
    const failureDiag = createDockerDiagnostic({
      execute: failureExecute,
    }).run();

    expect(timeoutDiag.message).toContain('timed out');
    expect(timeoutDiag.remediation).toContain('responds promptly');

    expect(failureDiag.message).toContain('unavailable');
    expect(failureDiag.message).not.toContain('timed out');
    expect(failureDiag.remediation).toContain('Start the Docker daemon');
  });
});
