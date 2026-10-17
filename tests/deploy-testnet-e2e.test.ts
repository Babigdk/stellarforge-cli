import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import type { ManagedChildProcess } from '../src/dev/orchestrator.js';
import {
  EXIT_CODES,
  SubprocessCliError,
  ValidationCliError,
  runWithCliErrorBoundary,
} from '../src/errors/index.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

class MockDeployProcess implements ManagedChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  #exitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  #errorListener: ((error: Error) => void) | undefined;

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
    } else {
      this.#errorListener = listener as (error: Error) => void;
    }

    return this;
  }

  kill(): boolean {
    return true;
  }

  exitWith(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.#exitListener?.(code, signal);
  }

  fail(error: Error): void {
    this.#errorListener?.(error);
  }
}

function writeCargoWorkspace(root: string): void {
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
}

describe('Stellar Testnet deployment end-to-end fixtures', () => {
  it('rejects unsafe source input before any deploy process is started', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      let spawned = false;
      const command = createDeployCommand({
        cwd: () => root,
        spawnProcess: () => {
          spawned = true;
          return new MockDeployProcess();
        },
      });

      await expect(
        command.parseAsync([
          'node',
          'deploy',
          '--network',
          'testnet',
          '--source',
          '../escape-attempt',
        ]),
      ).rejects.toBeInstanceOf(ValidationCliError);
      expect(spawned).toBe(false);
    }));

  it('does not reflect rejected secret-bearing source input', async () => {
    const captured = createCapturedTerminalOutput();
    const command = createDeployCommand({
      cwd: () => '/workspace',
      output: captured.output,
      spawnProcess: () => new MockDeployProcess(),
    });

    const exitCode = await runWithCliErrorBoundary(async () => {
      await command.parseAsync([
        'node',
        'deploy',
        '--network',
        'testnet',
        '--source',
        'seed SENTINEL-DEPLOY-SOURCE words',
      ]);
    }, captured.output);

    expect(exitCode).toBe(EXIT_CODES.validation);
    expect(captured.stderrText()).not.toContain('SENTINEL-DEPLOY-SOURCE');
  });

  it('surfaces a mocked successful deploy with a deterministic contract ID', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      const child = new MockDeployProcess();
      const captured = createCapturedTerminalOutput();
      const command = createDeployCommand({
        cwd: () => root,
        output: captured.output,
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
      child.stdout.write(`Contract deployed with ID: ${CONTRACT_ID}\n`);
      child.exitWith(0);
      await running;

      expect(captured.stdoutText()).toContain(
        'Deploying smart contract to Stellar Testnet.',
      );
      expect(captured.stdoutText()).toContain(
        `[stellar:deploy] Contract deployed with ID: ${CONTRACT_ID}`,
      );
      expect(captured.stderrText()).toBe('');
    }));

  it('does not change exit semantics when extra deploy output is present', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      const child = new MockDeployProcess();
      const captured = createCapturedTerminalOutput();
      const command = createDeployCommand({
        cwd: () => root,
        output: captured.output,
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
      child.stdout.write(`Contract deployed with ID: ${CONTRACT_ID}\n`);
      child.stdout.write('note: extra informational line\n');
      child.stderr.write('warning: simulated non-fatal notice\n');
      child.stdout.write('error-like text that is not fatal\n');
      child.exitWith(0);
      await running;

      expect(captured.stdoutText()).toContain(CONTRACT_ID);
      expect(captured.stderrText()).toContain('simulated non-fatal notice');
    }));

  it('propagates a mocked failed deploy as a subprocess failure', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      const child = new MockDeployProcess();
      const captured = createCapturedTerminalOutput();
      const command = createDeployCommand({
        cwd: () => root,
        output: captured.output,
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
      child.stderr.write('seed=SENTINEL-DEPLOY-OUTPUT\n');
      child.exitWith(1);

      const error = await running.then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(SubprocessCliError);
      expect((error as SubprocessCliError).userMessage).not.toContain(
        'SENTINEL-DEPLOY-OUTPUT',
      );
    }));
});
