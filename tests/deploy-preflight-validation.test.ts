import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import { resolveProjectConfig } from '../src/config/project.js';
import type { DevProcessSpec } from '../src/dev/project.js';
import {
  GENERATED_WASM_ARTIFACT_PATH,
  resolveTestnetDeploymentPlan,
  runDeploymentPreflight,
} from '../src/deployment/project.js';
import { EXIT_CODES, runWithCliErrorBoundary } from '../src/errors/index.js';
import {
  createCapturedTerminalOutput,
  FakeChildProcess,
  SECRET_STRKEY_FIXTURE,
  withTempDirectory,
  writeGeneratedWasmArtifact,
} from './helpers/index.js';

function writeValidProject(root: string): void {
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
  writeGeneratedWasmArtifact(root);
}

function writeConfig(root: string, value: unknown | string): void {
  writeFileSync(
    join(root, 'stellarforge.config.json'),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

async function runInvalidDeploy(
  root: string,
  args: readonly string[],
): Promise<{
  readonly exitCode: number;
  readonly executor: ReturnType<typeof vi.fn>;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const captured = createCapturedTerminalOutput();
  const executor = vi.fn(() => {
    throw new Error('The Stellar CLI subprocess must not start.');
  });
  const command = createDeployCommand({
    cwd: () => root,
    output: captured.output,
    environment: { PATH: '/usr/bin' },
    spawnProcess: executor,
  });

  const exitCode = await runWithCliErrorBoundary(async () => {
    await command.parseAsync(['node', 'deploy', ...args]);
  }, captured.output);

  return {
    exitCode,
    executor,
    stdout: captured.stdoutText(),
    stderr: captured.stderrText(),
  };
}

function expectZeroSubprocessSideEffects(result: {
  readonly exitCode: number;
  readonly executor: ReturnType<typeof vi.fn>;
  readonly stdout: string;
}): void {
  expect(result.exitCode).toBe(EXIT_CODES.validation);
  expect(result.executor).not.toHaveBeenCalled();
  expect(result.stdout).not.toContain('Deploying smart contract');
}

describe('SW-161: deploy validation before subprocess side effects', () => {
  describe('invalid CLI input', () => {
    it.each([
      ['--network', 'mainnet', '--source', 'deployer'],
      ['--network', 'TESTNET', '--source', 'deployer'],
      ['--source', 'deployer'],
      ['--network', 'testnet'],
      ['--network', 'testnet', '--source', '../escape-attempt'],
      ['--network', 'testnet', '--source', SECRET_STRKEY_FIXTURE],
    ])('rejects %j before invoking the executor', async (...args) => {
      await withTempDirectory(async (root) => {
        writeValidProject(root);
        expectZeroSubprocessSideEffects(await runInvalidDeploy(root, args));
      });
    });
  });

  describe('invalid configuration', () => {
    it.each([
      ['malformed JSON', '{'],
      ['duplicate keys', '{"version":1,"version":1}'],
      [
        'secret-bearing field',
        { version: 1, secretKey: SECRET_STRKEY_FIXTURE },
      ],
      ['unsupported network', { version: 1, network: 'mainnet' }],
      ['raw identity', { version: 1, identity: SECRET_STRKEY_FIXTURE }],
    ])('rejects %s before invoking the executor', async (_name, config) => {
      await withTempDirectory(async (root) => {
        writeValidProject(root);
        writeConfig(root, config);
        expectZeroSubprocessSideEffects(
          await runInvalidDeploy(root, [
            '--network',
            'testnet',
            '--source',
            'deployer',
          ]),
        );
      });
    });
  });

  describe('invalid project state', () => {
    it('rejects a missing Cargo workspace before invoking the executor', async () =>
      withTempDirectory(async (root) => {
        expectZeroSubprocessSideEffects(
          await runInvalidDeploy(root, [
            '--network',
            'testnet',
            '--source',
            'deployer',
          ]),
        );
      }));

    it('rejects a missing generated Wasm artifact before invoking the executor', async () =>
      withTempDirectory(async (root) => {
        writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
        expectZeroSubprocessSideEffects(
          await runInvalidDeploy(root, [
            '--network',
            'testnet',
            '--source',
            'deployer',
          ]),
        );
      }));

    it('rejects stale generated Wasm output before invoking the executor', async () =>
      withTempDirectory(async (root) => {
        writeValidProject(root);
        const sourcePath = join(root, 'contracts', 'hello', 'src', 'lib.rs');
        mkdirSync(dirname(sourcePath), { recursive: true });
        writeFileSync(sourcePath, '#![no_std]\n');
        const artifactPath = join(
          root,
          ...GENERATED_WASM_ARTIFACT_PATH.split('/'),
        );
        const staleTime = new Date(Date.now() - 60_000);
        utimesSync(artifactPath, staleTime, staleTime);

        expectZeroSubprocessSideEffects(
          await runInvalidDeploy(root, [
            '--network',
            'testnet',
            '--source',
            'deployer',
          ]),
        );
      }));
  });

  it('supports validation-only preflight without invoking the executor', async () =>
    withTempDirectory(async (root) => {
      writeValidProject(root);
      const result = await runInvalidDeploy(root, [
        '--network',
        'testnet',
        '--source',
        'deployer',
        '--preflight',
      ]);

      expect(result.exitCode).toBe(EXIT_CODES.success);
      expect(result.executor).not.toHaveBeenCalled();
      expect(result.stdout).toContain('Deployment preflight:');
      expect(result.stdout).toContain('Preflight only');
    }));

  it('invokes the executor exactly once only after config, preflight, and plan validation', async () =>
    withTempDirectory(async (root) => {
      writeValidProject(root);
      const captured = createCapturedTerminalOutput();
      const child = new FakeChildProcess();
      const order: string[] = [];
      const executor = vi.fn(() => {
        order.push('executor');
        return child;
      });
      const command = createDeployCommand({
        cwd: () => root,
        output: captured.output,
        environment: { PATH: '/usr/bin' },
        resolveConfig: (cwd, overrides) => {
          order.push('config');
          return resolveProjectConfig(cwd, overrides);
        },
        runPreflight: (input) => {
          order.push('preflight');
          return runDeploymentPreflight(input);
        },
        resolvePlan: (input) => {
          order.push('plan');
          return resolveTestnetDeploymentPlan(input);
        },
        spawnProcess: executor,
      });

      const running = command.parseAsync([
        'node',
        'deploy',
        '--network',
        'testnet',
        '--source',
        'deployer',
      ]);
      await child.finish(0);
      await running;

      expect(order).toEqual(['config', 'preflight', 'plan', 'executor']);
      expect(executor).toHaveBeenCalledTimes(1);
    }));

  it.each([
    {
      name: 'both CLI values override configuration',
      config: { version: 1, network: 'mainnet', identity: 'config-deployer' },
      args: ['--network', 'testnet', '--source', 'cli-deployer'],
      expectedSource: 'cli-deployer',
    },
    {
      name: 'partial CLI identity override retains the configured network',
      config: { version: 1, network: 'testnet', identity: 'config-deployer' },
      args: ['--source', 'cli-deployer'],
      expectedSource: 'cli-deployer',
    },
  ])(
    'preserves CLI precedence: $name',
    async ({ config, args, expectedSource }) =>
      withTempDirectory(async (root) => {
        writeValidProject(root);
        writeConfig(root, config);
        const captured = createCapturedTerminalOutput();
        const child = new FakeChildProcess();
        const executor = vi.fn(() => child);
        const command = createDeployCommand({
          cwd: () => root,
          output: captured.output,
          environment: { PATH: '/usr/bin' },
          spawnProcess: executor,
        });

        const running = command.parseAsync(['node', 'deploy', ...args]);
        await child.finish(0);
        await running;

        expect(executor).toHaveBeenCalledTimes(1);
        const spec = executor.mock.calls[0]?.[0] as DevProcessSpec;
        expect(spec.args).toContain(expectedSource);
        expect(spec.args).not.toContain('config-deployer');
        expect(spec.args).toEqual([
          'contract',
          'deploy',
          '--wasm',
          GENERATED_WASM_ARTIFACT_PATH,
          '--source-account',
          expectedSource,
          '--network',
          'testnet',
        ]);
      }),
  );
});
