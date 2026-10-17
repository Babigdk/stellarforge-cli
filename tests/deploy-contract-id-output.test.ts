import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';
import { MockChildProcess } from './helpers/mock-child-process.js';

const CONTRACT_ID = 'CMOCKCONTRACTID00000000000000000000000000000000000000';

const deployArgs = [
  'node',
  'deploy',
  '--network',
  'testnet',
  '--source',
  'deployer',
];

function writeCargoWorkspace(root: string): void {
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
}

describe('deploy contract-ID output handling', () => {
  it('surfaces the mocked contract ID and completes successfully', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      const child = new MockChildProcess();
      const captured = createCapturedTerminalOutput();
      const command = createDeployCommand({
        cwd: () => root,
        output: captured.output,
        spawnProcess: () => child,
      });

      const running = command.parseAsync(deployArgs);
      child.stdout.write(`Deployed contract ID: ${CONTRACT_ID}\n`);
      child.exitWith(0);
      await running;

      expect(captured.stdoutText()).toContain(
        `[stellar:deploy] Deployed contract ID: ${CONTRACT_ID}`,
      );
      expect(captured.stderrText()).toBe('');
    }));

  it('does not let extra output change a successful exit', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      const child = new MockChildProcess();
      const captured = createCapturedTerminalOutput();
      const command = createDeployCommand({
        cwd: () => root,
        output: captured.output,
        spawnProcess: () => child,
      });

      const running = command.parseAsync(deployArgs);
      child.stdout.write(`Deployed contract ID: ${CONTRACT_ID}\n`);
      child.stdout.write('note: additional informational line\n');
      child.stderr.write('warning: simulated non-fatal notice\n');
      child.stdout.write('error: text that is not fatal\n');
      child.exitWith(0);
      await running;

      expect(captured.stdoutText()).toContain(CONTRACT_ID);
      expect(captured.stderrText()).toContain('simulated non-fatal notice');
    }));

  it('treats error-looking output as non-fatal on a zero exit', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      const child = new MockChildProcess();
      const captured = createCapturedTerminalOutput();
      const command = createDeployCommand({
        cwd: () => root,
        output: captured.output,
        spawnProcess: () => child,
      });

      const running = command.parseAsync(deployArgs);
      child.stdout.write('error: mock warning line\n');
      child.exitWith(0);

      await expect(running).resolves.toBeDefined();
    }));

  it('completes deterministically when an empty deploy output is produced', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      const child = new MockChildProcess();
      const captured = createCapturedTerminalOutput();
      const command = createDeployCommand({
        cwd: () => root,
        output: captured.output,
        spawnProcess: () => child,
      });

      const running = command.parseAsync(deployArgs);
      child.exitWith(0);
      await running;

      expect(captured.stdoutText()).toContain(
        'Deploying smart contract to Stellar Testnet.',
      );
      expect(captured.stdoutText()).not.toContain('[stellar:deploy]');
    }));
});
