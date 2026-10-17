import { describe, expect, it } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import type { DevProcessSpec } from '../src/dev/project.js';
import {
  EXIT_CODES,
  SubprocessCliError,
  runWithCliErrorBoundary,
} from '../src/errors/index.js';
import {
  createCapturedTerminalOutput,
  type CapturedTerminalOutput,
} from './helpers/index.js';
import { MockChildProcess } from './helpers/mock-child-process.js';

const DEPLOY_SPEC: DevProcessSpec = {
  label: 'stellar:deploy',
  command: 'stellar',
  args: [
    'contract',
    'deploy',
    '--source-account',
    'deployer',
    '--network',
    'testnet',
  ],
  cwd: '/workspace',
};

const deployArgs = [
  'node',
  'deploy',
  '--network',
  'testnet',
  '--source',
  'deployer',
];

function createDeploy(
  child: MockChildProcess,
  captured: CapturedTerminalOutput,
) {
  return createDeployCommand({
    cwd: () => '/workspace',
    output: captured.output,
    resolvePlan: () => [DEPLOY_SPEC],
    spawnProcess: () => child,
  });
}

function takeRejection(running: Promise<unknown>): Promise<unknown> {
  return running.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

describe('deploy subprocess failure propagation', () => {
  it('propagates a non-zero Stellar exit as a typed subprocess failure', async () => {
    const child = new MockChildProcess();
    const captured = createCapturedTerminalOutput();
    const command = createDeploy(child, captured);

    const running = command.parseAsync(deployArgs);
    child.exitWith(2);

    const error = await takeRejection(running);

    expect(error).toBeInstanceOf(SubprocessCliError);
    expect((error as SubprocessCliError).exitCode).toBe(EXIT_CODES.subprocess);
    expect((error as SubprocessCliError).userMessage).toBe(
      "Development process 'stellar:deploy' exited unexpectedly with code 2.",
    );
  });

  it('reports signal termination without masking the failure category', async () => {
    const child = new MockChildProcess();
    const captured = createCapturedTerminalOutput();
    const command = createDeploy(child, captured);

    const running = command.parseAsync(deployArgs);
    child.exitWith(null, 'SIGKILL');

    const error = await takeRejection(running);

    expect(error).toBeInstanceOf(SubprocessCliError);
    expect((error as SubprocessCliError).userMessage).toContain(
      'after SIGKILL',
    );
  });

  it('preserves a start failure with the original cause', async () => {
    const child = new MockChildProcess();
    const captured = createCapturedTerminalOutput();
    const command = createDeploy(child, captured);
    const startError = new Error('spawn stellar ENOENT');

    const running = command.parseAsync(deployArgs);
    child.fail(startError);

    const error = await takeRejection(running);

    expect(error).toBeInstanceOf(SubprocessCliError);
    expect((error as SubprocessCliError).cause).toBe(startError);
    expect((error as SubprocessCliError).userMessage).toBe(
      "Development process 'stellar:deploy' failed to start.",
    );
  });

  it('does not reflect secret-bearing output in the failure message', async () => {
    const child = new MockChildProcess();
    const captured = createCapturedTerminalOutput();
    const command = createDeploy(child, captured);

    const running = command.parseAsync(deployArgs);
    child.stderr.write('seed=SENTINEL-SUBPROCESS-OUTPUT\n');
    child.exitWith(1);

    const error = await takeRejection(running);

    expect(error).toBeInstanceOf(SubprocessCliError);
    expect((error as SubprocessCliError).userMessage).not.toContain(
      'SENTINEL-SUBPROCESS-OUTPUT',
    );
  });

  it('sanitizes streamed subprocess output before it reaches the terminal', async () => {
    const child = new MockChildProcess();
    const captured = createCapturedTerminalOutput();
    const command = createDeploy(child, captured);

    const running = command.parseAsync(deployArgs);
    child.stderr.write('error: \u001b[31mred\u001b[0m detail\n');
    child.exitWith(1);
    await takeRejection(running);

    expect(captured.stderrText()).toContain(
      '[stellar:deploy] error: red detail',
    );
    expect(captured.stderrText()).not.toContain('\u001b');
  });

  it('renders the subprocess failure with exit code 3 and a safe message', async () => {
    const child = new MockChildProcess();
    const captured = createCapturedTerminalOutput();
    const command = createDeploy(child, captured);

    const exitCode = await runWithCliErrorBoundary(async () => {
      const running = command.parseAsync(deployArgs);
      child.exitWith(2);
      await running;
    }, captured.output);

    expect(exitCode).toBe(EXIT_CODES.subprocess);
    expect(captured.stderrText()).toContain(
      "Development process 'stellar:deploy' exited unexpectedly with code 2.",
    );
  });
});
