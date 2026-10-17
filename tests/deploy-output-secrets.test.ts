import { describe, expect, it } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import type { DevProcessSpec } from '../src/dev/project.js';
import {
  EXIT_CODES,
  runWithCliErrorBoundary,
  SubprocessCliError,
} from '../src/errors/index.js';
import {
  createCapturedTerminalOutput,
  FakeChildProcess,
  SECRET_FIXTURE_LINES,
  SECRET_FIXTURE_VALUES,
  SECRET_STRKEY_FIXTURE,
} from './helpers/index.js';

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
const DEPLOY_ARGS = [
  'node',
  'deploy',
  '--network',
  'testnet',
  '--source',
  'deployer',
];

async function runDeploy(
  child: FakeChildProcess,
  drive: (child: FakeChildProcess) => Promise<void>,
) {
  const captured = createCapturedTerminalOutput();
  const command = createDeployCommand({
    cwd: () => '/workspace',
    output: captured.output,
    resolveConfig: (_cwd, overrides) => overrides,
    resolvePlan: () => [DEPLOY_SPEC],
    spawnProcess: () => child,
  });

  const exitCode = runWithCliErrorBoundary(async () => {
    await command.parseAsync(DEPLOY_ARGS);
  }, captured.output);
  await drive(child);

  return { exitCode: await exitCode, captured };
}

function expectNoSecrets(text: string): void {
  for (const secret of SECRET_FIXTURE_VALUES) {
    expect(text).not.toContain(secret);
  }
}

describe('deploy stdout/stderr secret non-reflection', () => {
  it('redacts secret-like stdout and stderr lines on success', async () => {
    const { exitCode, captured } = await runDeploy(
      new FakeChildProcess(),
      (child) =>
        child.finish(0, {
          stdout: [...SECRET_FIXTURE_LINES.map((line) => `${line}\n`)],
          stderr: [...SECRET_FIXTURE_LINES.map((line) => `${line}\n`)],
        }),
    );

    expect(exitCode).toBe(EXIT_CODES.success);
    expectNoSecrets(captured.stdoutText());
    expectNoSecrets(captured.stderrText());
    expect(captured.stdoutText()).toContain(
      '[stellar:deploy] signing with [REDACTED] for tx',
    );
    expect(captured.stderrText()).toContain('[stellar:deploy] Secret key:');
  });

  it('redacts a secret split across subprocess output chunks', async () => {
    const { captured } = await runDeploy(new FakeChildProcess(), (child) =>
      child.finish(0, {
        stderr: [
          `leaked ${SECRET_STRKEY_FIXTURE.slice(0, 20)}`,
          `${SECRET_STRKEY_FIXTURE.slice(20, 40)}`,
          `${SECRET_STRKEY_FIXTURE.slice(40)} trailing\n`,
        ],
      }),
    );

    expect(captured.stderrText()).not.toContain(
      SECRET_STRKEY_FIXTURE.slice(0, 20),
    );
    expect(captured.stderrText()).toBe(
      '[stellar:deploy] leaked [REDACTED] trailing\n',
    );
  });

  it('redacts an unterminated final line flushed on exit', async () => {
    const { captured } = await runDeploy(new FakeChildProcess(), (child) =>
      child.finish(0, { stdout: [`Secret key: ${SECRET_STRKEY_FIXTURE}`] }),
    );

    expect(captured.stdoutText()).toContain(
      '[stellar:deploy] Secret key: [REDACTED]',
    );
    expectNoSecrets(captured.stdoutText());
  });

  it('keeps an actionable, secret-free failure when deployment fails', async () => {
    const { exitCode, captured } = await runDeploy(
      new FakeChildProcess(),
      (child) =>
        child.finish(1, {
          stderr: [
            'error: transaction simulation failed: insufficient balance\n',
            ...SECRET_FIXTURE_LINES.map((line) => `${line}\n`),
          ],
        }),
    );
    const stderr = captured.stderrText();

    expect(exitCode).toBe(EXIT_CODES.subprocess);
    expectNoSecrets(stderr);
    expect(stderr).toContain(
      '[stellar:deploy] error: transaction simulation failed: insufficient balance',
    );
    expect(stderr).toContain(
      "Development process 'stellar:deploy' exited unexpectedly with code 1.",
    );
  });

  it('does not surface secret-like spawn error details', async () => {
    const child = new FakeChildProcess();
    const captured = createCapturedTerminalOutput();
    const command = createDeployCommand({
      cwd: () => '/workspace',
      output: captured.output,
      resolveConfig: (_cwd, overrides) => overrides,
      resolvePlan: () => [DEPLOY_SPEC],
      spawnProcess: () => child,
    });
    let thrown: unknown;

    const running = command.parseAsync(DEPLOY_ARGS).catch((error: unknown) => {
      thrown = error;
    });
    await child.fail(
      new Error(`spawn failed: secret=${SECRET_STRKEY_FIXTURE}`),
    );
    await running;

    expect(thrown).toBeInstanceOf(SubprocessCliError);
    const exitCode = await runWithCliErrorBoundary(() => {
      throw thrown;
    }, captured.output);

    expect(exitCode).toBe(EXIT_CODES.subprocess);
    expectNoSecrets(captured.stdoutText() + captured.stderrText());
    expect(captured.stderrText()).toContain(
      "Development process 'stellar:deploy' failed to start.",
    );
  });

  it('does not surface secret-like errors thrown while starting the process', async () => {
    const captured = createCapturedTerminalOutput();
    const command = createDeployCommand({
      cwd: () => '/workspace',
      output: captured.output,
      resolveConfig: (_cwd, overrides) => overrides,
      resolvePlan: () => [DEPLOY_SPEC],
      spawnProcess: () => {
        throw new Error(`ENOENT stellar ${SECRET_STRKEY_FIXTURE}`);
      },
    });

    const exitCode = await runWithCliErrorBoundary(async () => {
      await command.parseAsync(DEPLOY_ARGS);
    }, captured.output);

    expect(exitCode).toBe(EXIT_CODES.subprocess);
    expectNoSecrets(captured.stderrText());
    expect(captured.stderrText()).toContain(
      "Failed to start development process 'stellar:deploy'.",
    );
  });
});
