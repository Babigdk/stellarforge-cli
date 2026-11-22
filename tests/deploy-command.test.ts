import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import type { ManagedChildProcess } from '../src/dev/orchestrator.js';
import { SubprocessCliError } from '../src/errors/errors.js';
import {
  DEPLOYMENT_TERMINATION_GRACE_MS,
  DEPLOYMENT_TIMEOUT_MS,
} from '../src/deployment/project.js';
import { createCapturedTerminalOutput } from './helpers/index.js';

class DeployChild implements ManagedChildProcess {
  readonly pid?: number;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killedSignals: NodeJS.Signals[] = [];
  #exitListener:
    ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;

  constructor(pid?: number) {
    if (pid !== undefined) {
      this.pid = pid;
    }
  }

  once(event: 'error', listener: (error: Error) => void): this;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  once(
    event: 'error' | 'exit',
    listener:
      | ((error: Error) => void)
      | ((code: number | null, signal: NodeJS.Signals | null) => void),
  ): this {
    if (event === 'exit') {
      this.#exitListener = listener as (
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => void;
    }
    return this;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killedSignals.push(signal);
    return true;
  }

  exit(code: number): void {
    // End both stdio streams so the supervisor observes the full lifecycle.
    this.stdout.end();
    this.stderr.end();
    this.#exitListener?.(code, null);
  }
}

describe('deploy command', () => {
  it('runs preflight without spawning subprocesses or network calls', async () => {
    const spawnProcess = vi.fn(() => new DeployChild());
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const captured = createCapturedTerminalOutput();
    const command = createDeployCommand({
      cwd: () => '/workspace',
      output: captured.output,
      runPreflight: () => ({
        passed: true,
        checks: [{ label: 'Preflight', passed: true }],
      }),
      resolvePlan: () => [],
      spawnProcess,
    });

    await command.parseAsync([
      'node',
      'deploy',
      '--network',
      'testnet',
      '--source',
      'alice',
      '--preflight',
    ]);

    expect(spawnProcess).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(captured.stdoutText()).toContain('Preflight');
    expect(captured.stdoutText()).not.toContain('alice');
    fetchSpy.mockRestore();
  });

  it('forwards explicit Testnet and identity input to a safe deployment plan', async () => {
    const child = new DeployChild();
    const captured = createCapturedTerminalOutput();
    let received:
      | {
          readonly cwd: string;
          readonly network: string;
          readonly source: string;
        }
      | undefined;
    const command = createDeployCommand({
      cwd: () => '/workspace',
      output: captured.output,
      runPreflight: () => ({
        passed: true,
        checks: [{ label: 'Preflight', passed: true }],
      }),
      resolvePlan(input) {
        received = input;
        return [
          {
            label: 'stellar:deploy',
            command: 'stellar',
            args: [
              'contract',
              'deploy',
              '--source-account',
              input.source,
              '--network',
              input.network,
            ],
            cwd: input.cwd,
          },
        ];
      },
      spawnProcess: () => child,
    });

    const running = command.parseAsync([
      'node',
      'deploy',
      '--network',
      'testnet',
      '--source',
      'deployer',
    ]);
    child.stdout.write('CABC123\n');
    child.exit(0);
    await running;

    expect(received).toEqual({
      cwd: '/workspace',
      network: 'testnet',
      source: 'deployer',
    });
    expect(captured.stdoutText()).toContain(
      'Deploying smart contract to Stellar Testnet.',
    );
    expect(captured.stdoutText()).toContain('[stellar:deploy] CABC123');
  });

  it('preserves a failed Stellar CLI deployment as a subprocess failure', async () => {
    const child = new DeployChild();
    const command = createDeployCommand({
      cwd: () => '/workspace',
      runPreflight: () => ({
        passed: true,
        checks: [{ label: 'Preflight', passed: true }],
      }),
      resolvePlan: () => [
        {
          label: 'stellar:deploy',
          command: 'stellar',
          args: [
            'contract',
            'deploy',
            '--source-account',
            'alice',
            '--network',
            'testnet',
          ],
          cwd: '/workspace',
        },
      ],
      spawnProcess: () => child,
    });

    const running = command.parseAsync([
      'node',
      'deploy',
      '--network',
      'testnet',
      '--source',
      'alice',
    ]);
    child.exit(2);

    await expect(running).rejects.toBeInstanceOf(SubprocessCliError);
  });

  it('bounds local deployment cleanup and reports the remote outcome as uncertain', async () => {
    vi.useFakeTimers();
    try {
      const pid = process.platform === 'win32' ? undefined : 31337;
      const child = new DeployChild(pid);
      const processKill = vi.spyOn(process, 'kill').mockReturnValue(true);
      const command = createDeployCommand({
        cwd: () => '/workspace',
        runPreflight: () => ({
          passed: true,
          checks: [{ label: 'Preflight', passed: true }],
        }),
        resolvePlan: () => [
          {
            label: 'stellar:deploy',
            command: 'stellar',
            args: ['contract', 'deploy'],
            cwd: '/workspace',
          },
        ],
        spawnProcess: () => child,
      });

      const running = command.parseAsync([
        'node',
        'deploy',
        '--network',
        'testnet',
        '--source',
        'alice',
      ]);
      const rejection = expect(running).rejects.toMatchObject({
        exitCode: 3,
        userMessage: expect.stringContaining(
          'The remote submission outcome is uncertain',
        ),
      });
      await vi.advanceTimersByTimeAsync(
        DEPLOYMENT_TIMEOUT_MS + 2 * DEPLOYMENT_TERMINATION_GRACE_MS,
      );

      await rejection;
      if (pid === undefined) {
        expect(child.killedSignals).toEqual(['SIGTERM', 'SIGKILL']);
      } else {
        expect(processKill).toHaveBeenCalledWith(-pid, 'SIGTERM');
        expect(processKill).toHaveBeenCalledWith(-pid, 'SIGKILL');
      }
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
