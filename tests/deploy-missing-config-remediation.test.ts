import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import { PROJECT_CONFIG_FILENAME } from '../src/config/project.js';
import type { ManagedChildProcess } from '../src/dev/orchestrator.js';
import { ValidationCliError } from '../src/errors/index.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';

const NETWORK_REMEDIATION =
  'Deployment network is required. Pass `--network testnet` or set an explicit network in stellarforge.config.json.';
const IDENTITY_REMEDIATION =
  'Deployment identity is required. Pass `--source <identity>` or set a named identity in stellarforge.config.json.';

class FakeChild implements ManagedChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  #exitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;

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

  kill(): boolean {
    return true;
  }

  exitWith(code: number): void {
    this.#exitListener?.(code, null);
  }
}

function writeCargoWorkspace(root: string): void {
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
}

function writeConfig(root: string, value: unknown): void {
  writeFileSync(join(root, PROJECT_CONFIG_FILENAME), JSON.stringify(value));
}

async function takeRejection(running: Promise<unknown>): Promise<unknown> {
  return running.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

describe('deploy missing-configuration remediation', () => {
  it('explains how to supply a missing network without starting work', async () => {
    const captured = createCapturedTerminalOutput();
    let planCalled = false;
    let spawnCalled = false;
    const command = createDeployCommand({
      cwd: () => '/workspace',
      output: captured.output,
      resolveConfig: () => ({}),
      resolvePlan: () => {
        planCalled = true;
        return [];
      },
      spawnProcess: () => {
        spawnCalled = true;
        throw new Error('The deploy subprocess must not start.');
      },
    });

    const error = await takeRejection(command.parseAsync(['node', 'deploy']));

    expect(error).toBeInstanceOf(ValidationCliError);
    expect((error as ValidationCliError).userMessage).toBe(NETWORK_REMEDIATION);
    expect(planCalled).toBe(false);
    expect(spawnCalled).toBe(false);
  });

  it('explains how to supply a missing identity without starting work', async () => {
    const captured = createCapturedTerminalOutput();
    let planCalled = false;
    let spawnCalled = false;
    const command = createDeployCommand({
      cwd: () => '/workspace',
      output: captured.output,
      resolveConfig: () => ({ network: 'testnet' }),
      resolvePlan: () => {
        planCalled = true;
        return [];
      },
      spawnProcess: () => {
        spawnCalled = true;
        throw new Error('The deploy subprocess must not start.');
      },
    });

    const error = await takeRejection(command.parseAsync(['node', 'deploy']));

    expect(error).toBeInstanceOf(ValidationCliError);
    expect((error as ValidationCliError).userMessage).toBe(
      IDENTITY_REMEDIATION,
    );
    expect(planCalled).toBe(false);
    expect(spawnCalled).toBe(false);
  });

  it('uses distinct messages for the missing-network and missing-identity cases', () => {
    expect(NETWORK_REMEDIATION).not.toBe(IDENTITY_REMEDIATION);
  });

  it('reports the missing network for a version-only project configuration', () =>
    withTempDirectory(async (root) => {
      writeConfig(root, { version: 1 });
      let spawnCalled = false;
      const command = createDeployCommand({
        cwd: () => root,
        spawnProcess: () => {
          spawnCalled = true;
          throw new Error('The deploy subprocess must not start.');
        },
      });

      await expect(command.parseAsync(['node', 'deploy'])).rejects.toThrow(
        NETWORK_REMEDIATION,
      );
      expect(spawnCalled).toBe(false);
    }));

  it('reports the missing identity when only the network is configured', () =>
    withTempDirectory(async (root) => {
      writeConfig(root, { version: 1, network: 'testnet' });
      let spawnCalled = false;
      const command = createDeployCommand({
        cwd: () => root,
        spawnProcess: () => {
          spawnCalled = true;
          throw new Error('The deploy subprocess must not start.');
        },
      });

      await expect(command.parseAsync(['node', 'deploy'])).rejects.toThrow(
        IDENTITY_REMEDIATION,
      );
      expect(spawnCalled).toBe(false);
    }));

  it('never falls back to an implicit network default', () =>
    withTempDirectory(async (root) => {
      let spawnCalled = false;
      const command = createDeployCommand({
        cwd: () => root,
        spawnProcess: () => {
          spawnCalled = true;
          throw new Error('The deploy subprocess must not start.');
        },
      });

      await expect(command.parseAsync(['node', 'deploy'])).rejects.toThrow(
        NETWORK_REMEDIATION,
      );
      expect(spawnCalled).toBe(false);
    }));

  it('proceeds once the missing values are supplied on the CLI', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      const child = new FakeChild();
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
      child.exitWith(0);
      await running;

      expect(captured.stdoutText()).toContain(
        'Deploying smart contract to Stellar Testnet.',
      );
    }));
});
