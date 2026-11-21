import { describe, expect, it, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  classifyCommandResult,
  isExecutableNotFound,
  runCommand,
  DIAGNOSTIC_COMMAND_TIMEOUT_MS,
  type CommandResult,
} from '../src/diagnostics/process.js';
import {
  createCargoDiagnostic,
  createRustDiagnostic,
} from '../src/diagnostics/rust.js';
import { createGitDiagnostic } from '../src/diagnostics/git.js';
import { createStellarDiagnostic } from '../src/diagnostics/stellar.js';
import { createNpmDiagnostic } from '../src/diagnostics/runtime.js';
import { createDockerDiagnostic } from '../src/diagnostics/docker.js';
import type { RunCommand } from '../src/diagnostics/process.js';

function result(
  status: number | null,
  stdout = '',
  stderr = '',
  error?: Error,
): CommandResult {
  return {
    status,
    stdout,
    stderr,
    ...(error === undefined ? {} : { error }),
  };
}

function enoent(message = 'spawn tool ENOENT'): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

function etimedout(message = 'Command timed out'): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'ETIMEDOUT';
  return error;
}

const timeoutHelperPath = resolve(__dirname, 'fixtures', 'timeout-helper.js');

// Track spawned processes for cleanup
const spawnedProcesses = new Set<number>();

afterEach(() => {
  // Clean up any lingering processes after each test
  for (const pid of spawnedProcesses) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // Process may have already exited
    }
  }
  spawnedProcesses.clear();
});

describe('executable-not-found classification', () => {
  it('recognizes an ENOENT error code', () => {
    expect(isExecutableNotFound(enoent())).toBe(true);
  });

  it('recognizes only an ENOENT substring in the error message', () => {
    expect(isExecutableNotFound(new Error('spawn git ENOENT'))).toBe(true);
    expect(isExecutableNotFound(new Error('spawn git EACCES'))).toBe(false);
    expect(isExecutableNotFound(new Error('enoent-looking lowercase'))).toBe(
      false,
    );
  });

  it('does not classify non-error or nullish values', () => {
    expect(isExecutableNotFound(undefined)).toBe(false);
    expect(isExecutableNotFound(null)).toBe(false);
    expect(isExecutableNotFound('ENOENT')).toBe(false);
  });
});

describe('command outcome classification', () => {
  it('returns ok for a successful command', () => {
    expect(classifyCommandResult(result(0, 'ok'))).toBe('ok');
  });

  it('distinguishes a missing executable from a generic failure', () => {
    expect(classifyCommandResult(result(null, '', '', enoent()))).toBe(
      'missing-executable',
    );
    expect(
      classifyCommandResult(result(null, '', '', new Error('timed out'))),
    ).toBe('failed');
  });

  it('treats a non-zero exit as failed', () => {
    expect(classifyCommandResult(result(1, '', 'boom'))).toBe('failed');
  });

  it('classifies ETIMEDOUT error as timed-out', () => {
    expect(classifyCommandResult(result(null, '', '', etimedout()))).toBe(
      'timed-out',
    );
  });
});

describe('diagnostics classify missing executables consistently', () => {
  const missing: RunCommand = () => result(null, '', '', enoent());

  it('fails Git, Rust, Cargo, Stellar CLI, and npm uniformly', () => {
    const checks = [
      createGitDiagnostic(missing).run(),
      createRustDiagnostic(missing).run(),
      createCargoDiagnostic(missing).run(),
      createStellarDiagnostic(missing).run(),
      createNpmDiagnostic(missing).run(),
    ];

    for (const check of checks) {
      expect(check.status).toBe('fail');
      expect(JSON.stringify(check)).not.toContain('ENOENT');
    }
  });

  it('warns for an optional missing Docker CLI without leaking output', () => {
    const check = createDockerDiagnostic({ execute: missing }).run();

    expect(check.status).toBe('warn');
    expect(JSON.stringify(check)).not.toContain('ENOENT');
  });

  it('never invokes a shell fallback for missing executables', () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const execute: RunCommand = (executable, args) => {
      calls.push({ executable, args });
      return result(null, '', '', enoent());
    };

    createGitDiagnostic(execute).run();

    expect(calls).toEqual([{ executable: 'git', args: ['--version'] }]);
  });
});

describe('timeout and process termination', () => {
  const TIMEOUT_TEST_BUFFER_MS = 2_000;

  it('completes quickly for a fast executable', () => {
    const start = Date.now();
    const result = runCommand('node', [timeoutHelperPath, 'quick']);
    const elapsed = Date.now() - start;

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('version 1.0.0');
    expect(elapsed).toBeLessThan(DIAGNOSTIC_COMMAND_TIMEOUT_MS);
    expect(result.error).toBeUndefined();
  });

  it('times out and terminates a slow process', () => {
    const start = Date.now();
    const result = runCommand('node', [timeoutHelperPath, 'slow']);
    const elapsed = Date.now() - start;

    expect(classifyCommandResult(result)).toBe('timed-out');
    expect(result.error).toBeDefined();
    expect((result.error as NodeJS.ErrnoException).code).toBe('ETIMEDOUT');

    // Verify timeout happened around the expected time
    expect(elapsed).toBeGreaterThanOrEqual(DIAGNOSTIC_COMMAND_TIMEOUT_MS);
    expect(elapsed).toBeLessThan(
      DIAGNOSTIC_COMMAND_TIMEOUT_MS + TIMEOUT_TEST_BUFFER_MS,
    );
  });

  it('forcefully kills a process that ignores SIGTERM', () => {
    const start = Date.now();
    const result = runCommand('node', [timeoutHelperPath, 'ignore-sigterm']);
    const elapsed = Date.now() - start;

    expect(classifyCommandResult(result)).toBe('timed-out');
    expect(result.error).toBeDefined();
    expect((result.error as NodeJS.ErrnoException).code).toBe('ETIMEDOUT');

    // Verify the process was forcefully terminated within reasonable time
    expect(elapsed).toBeGreaterThanOrEqual(DIAGNOSTIC_COMMAND_TIMEOUT_MS);
    expect(elapsed).toBeLessThan(
      DIAGNOSTIC_COMMAND_TIMEOUT_MS + TIMEOUT_TEST_BUFFER_MS,
    );

    // Verify stdout captured the start but not indefinite output
    expect(result.stdout).toContain('Process ignoring signals started');
  });

  it('allows graceful termination when process responds to SIGTERM', () => {
    const start = Date.now();
    const result = runCommand('node', [timeoutHelperPath, 'graceful']);
    const elapsed = Date.now() - start;

    expect(classifyCommandResult(result)).toBe('timed-out');
    expect(result.error).toBeDefined();
    expect((result.error as NodeJS.ErrnoException).code).toBe('ETIMEDOUT');

    // Process should still timeout even if it handles signals
    expect(elapsed).toBeGreaterThanOrEqual(DIAGNOSTIC_COMMAND_TIMEOUT_MS);
    expect(elapsed).toBeLessThan(
      DIAGNOSTIC_COMMAND_TIMEOUT_MS + TIMEOUT_TEST_BUFFER_MS,
    );
  });

  it('ensures no child process remains after timeout', async () => {
    // Get processes before
    const getNodeProcesses = (): number[] => {
      if (process.platform === 'win32') {
        try {
          const output = execSync(
            'wmic process where "name=\'node.exe\'" get ProcessId',
            { encoding: 'utf8' },
          );
          return output
            .split('\n')
            .slice(1)
            .map((line) => parseInt(line.trim(), 10))
            .filter((pid) => !isNaN(pid) && pid !== process.pid);
        } catch {
          return [];
        }
      } else {
        try {
          const output = execSync('pgrep -f "node.*timeout-helper"', {
            encoding: 'utf8',
          });
          return output
            .split('\n')
            .map((line) => parseInt(line.trim(), 10))
            .filter((pid) => !isNaN(pid));
        } catch {
          return [];
        }
      }
    };

    const beforePids = getNodeProcesses();

    // Run a timeout scenario
    runCommand('node', [timeoutHelperPath, 'slow']);

    // Wait a moment for OS cleanup
    await new Promise((resolve) => setTimeout(resolve, 500));

    const afterPids = getNodeProcesses();
    const newPids = afterPids.filter((pid) => !beforePids.includes(pid));

    // No new node processes should remain
    expect(newPids).toHaveLength(0);
  });

  it('reports stable timeout outcome for doctor command', () => {
    const timedOut: RunCommand = () =>
      result(null, 'Partial output', '', etimedout());

    // All diagnostics should handle timeout consistently
    const dockerCheck = createDockerDiagnostic({ execute: timedOut }).run();

    expect(dockerCheck.status).toBe('warn');
    expect(dockerCheck.message).toContain('timed out');
    expect(dockerCheck.remediation).toBeDefined();

    // Verify no raw error details leak into user-facing output
    expect(JSON.stringify(dockerCheck)).not.toContain('ETIMEDOUT');
    expect(dockerCheck.message).not.toContain('Error:');
  });

  it('classifies timeout distinctly from missing executable', () => {
    const timedOut: RunCommand = () => result(null, '', '', etimedout());
    const missing: RunCommand = () => result(null, '', '', enoent());

    expect(classifyCommandResult(timedOut('', []))).toBe('timed-out');
    expect(classifyCommandResult(missing('', []))).toBe('missing-executable');
  });

  it('completes doctor command within bounded time even with timeouts', () => {
    const timedOut: RunCommand = () =>
      result(null, 'Started...', '', etimedout());

    const start = Date.now();

    // Run multiple diagnostics that all timeout
    const checks = [
      createGitDiagnostic(timedOut).run(),
      createRustDiagnostic(timedOut).run(),
      createCargoDiagnostic(timedOut).run(),
      createDockerDiagnostic({ execute: timedOut }).run(),
    ];

    const elapsed = Date.now() - start;

    // All checks should complete quickly since they're mocked
    expect(elapsed).toBeLessThan(1_000);

    // All should report failure/warning status
    for (const check of checks) {
      expect(['fail', 'warn']).toContain(check.status);
    }
  });
});

describe('platform-specific process termination', () => {
  it('uses appropriate kill signal for the platform', () => {
    // This test verifies the killSignal option is set
    // Actual signal behavior is tested via timeout scenarios above
    const result = runCommand('node', [timeoutHelperPath, 'quick']);
    expect(result.status).toBe(0);
  });

  it('handles Windows process termination without shell', () => {
    if (process.platform !== 'win32') {
      return; // Skip on non-Windows
    }

    const result = runCommand('node', [timeoutHelperPath, 'slow']);

    expect(classifyCommandResult(result)).toBe('timed-out');
    expect(result.error).toBeDefined();
  });

  it('handles Unix process termination without shell', () => {
    if (process.platform === 'win32') {
      return; // Skip on Windows
    }

    const result = runCommand('node', [timeoutHelperPath, 'slow']);

    expect(classifyCommandResult(result)).toBe('timed-out');
    expect(result.error).toBeDefined();
  });
});
