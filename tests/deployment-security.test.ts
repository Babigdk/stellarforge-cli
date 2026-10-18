import type * as childProcess from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import { EXIT_CODES, runWithCliErrorBoundary } from '../src/errors/index.js';
import {
  createCapturedTerminalOutput,
  FakeChildProcess,
  SECRET_FIXTURE_LINES,
  SECRET_FIXTURE_VALUES,
  SECRET_STRKEY_FIXTURE,
  withTempDirectory,
} from './helpers/index.js';

// Umbrella regression suite for the deployment security boundaries:
// network (Testnet only), source (named aliases only), process (argument
// array, no shell, filtered environment) and output (no secret reflection).
// The real config loader, plan resolver and default spawner run end to end;
// only `node:child_process` is replaced, so the suite stays offline.

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcess>()),
  spawn: spawnMock,
}));

const STELLAR_BINARY = process.platform === 'win32' ? 'stellar.exe' : 'stellar';
const NON_TESTNET_NETWORKS = [
  'mainnet',
  'MAINNET',
  'public',
  'pubnet',
  'futurenet',
  'local',
  'Testnet',
  ' testnet',
  'testnet ',
  'testnet,mainnet',
  '',
];
const UNSAFE_SOURCES = [
  SECRET_STRKEY_FIXTURE,
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'alice --network mainnet',
  '--network=mainnet',
  '-n',
  'alice;rm -rf /',
  '$(whoami)',
  '`id`',
  '../identity',
  'alice/bob',
  'seed phrase words',
  'a'.repeat(65),
];

interface DeployRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface DeployScenario {
  readonly args: readonly string[];
  readonly config?: Record<string, unknown>;
  readonly cargo?: boolean;
  readonly environment?: NodeJS.ProcessEnv;
  readonly childExitCode?: number;
  readonly childStdout?: string[];
  readonly childStderr?: string[];
}

async function runDeployScenario(
  scenario: DeployScenario,
  root: string,
): Promise<DeployRun> {
  if (scenario.cargo ?? true) {
    writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
  }
  if (scenario.config !== undefined) {
    writeFileSync(
      join(root, 'stellarforge.config.json'),
      JSON.stringify(scenario.config),
    );
  }

  spawnMock.mockImplementation(() => {
    const child = new FakeChildProcess();
    void child.finish(scenario.childExitCode ?? 0, {
      ...(scenario.childStdout === undefined
        ? {}
        : { stdout: scenario.childStdout }),
      ...(scenario.childStderr === undefined
        ? {}
        : { stderr: scenario.childStderr }),
    });
    return child;
  });

  const captured = createCapturedTerminalOutput();
  const command = createDeployCommand({
    cwd: () => root,
    output: captured.output,
    environment: scenario.environment ?? { PATH: '/usr/bin' },
  });
  const exitCode = await runWithCliErrorBoundary(async () => {
    await command.parseAsync(['node', 'deploy', ...scenario.args]);
  }, captured.output);

  return {
    exitCode,
    stdout: captured.stdoutText(),
    stderr: captured.stderrText(),
  };
}

function deploy(scenario: DeployScenario): Promise<DeployRun> {
  return withTempDirectory((root) => runDeployScenario(scenario, root));
}

function spawnedArgs(): readonly string[] {
  expect(spawnMock).toHaveBeenCalledTimes(1);
  return spawnMock.mock.calls[0]?.[1] as readonly string[];
}

function expectNoSecrets(text: string): void {
  for (const secret of SECRET_FIXTURE_VALUES) {
    expect(text).not.toContain(secret);
  }
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  // Every spawned invocation, in every scenario, must target Testnet only.
  for (const call of spawnMock.mock.calls) {
    const args = call[1] as readonly string[];
    expect(args.filter((arg) => arg === '--network')).toHaveLength(1);
    expect(args[args.indexOf('--network') + 1]).toBe('testnet');
    expect(args.join(' ')).not.toMatch(/mainnet|futurenet|pubnet|public/i);
  }
});

describe('deployment security regression suite', () => {
  describe('network boundary: Mainnet automation remains impossible', () => {
    it.each(NON_TESTNET_NETWORKS)(
      'rejects CLI network %j before any subprocess starts',
      async (network) => {
        const result = await deploy({
          args: ['--network', network, '--source', 'deployer'],
        });

        expect(result.exitCode).toBe(EXIT_CODES.validation);
        expect(spawnMock).not.toHaveBeenCalled();
        expect(result.stdout).not.toContain('Deploying');
      },
    );

    it.each(['mainnet', 'futurenet'])(
      'rejects configured network %j before any subprocess starts',
      async (network) => {
        const result = await deploy({
          args: ['--source', 'deployer'],
          config: { version: 1, network },
        });

        expect(result.exitCode).toBe(EXIT_CODES.validation);
        expect(result.stderr).toContain(
          'only the explicit `--network testnet`',
        );
        expect(spawnMock).not.toHaveBeenCalled();
      },
    );

    it('rejects a CLI Mainnet override of a Testnet configuration', async () => {
      const result = await deploy({
        args: ['--network', 'mainnet', '--source', 'deployer'],
        config: { version: 1, network: 'testnet', identity: 'deployer' },
      });

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('requires an explicit network instead of defaulting', async () => {
      const result = await deploy({ args: ['--source', 'deployer'] });

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(result.stderr).toContain('Deployment network is required.');
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('ignores Mainnet hints in the environment and pins --network testnet', async () => {
      const result = await deploy({
        args: ['--network', 'testnet', '--source', 'deployer'],
        environment: {
          PATH: '/usr/bin',
          STELLAR_NETWORK: 'mainnet',
          STELLAR_NETWORK_PASSPHRASE:
            'Public Global Stellar Network ; September 2015',
        },
      });

      expect(result.exitCode).toBe(EXIT_CODES.success);
      expect(spawnedArgs()).toEqual([
        'contract',
        'deploy',
        '--source-account',
        'deployer',
        '--network',
        'testnet',
      ]);
    });
  });

  describe('source boundary: only named identity aliases are accepted', () => {
    it.each(UNSAFE_SOURCES)(
      'rejects CLI source %j without echoing it or spawning',
      async (source) => {
        const result = await deploy({
          args: ['--network', 'testnet', '--source', source],
        });

        expect(result.exitCode).toBe(EXIT_CODES.validation);
        expect(spawnMock).not.toHaveBeenCalled();
        expect(result.stderr).toContain('named Stellar CLI identity alias');
        if (source.length > 2) {
          expect(result.stderr).not.toContain(source);
        }
      },
    );

    it('rejects a raw secret identity from configuration without echoing it', async () => {
      const result = await deploy({
        args: ['--network', 'testnet'],
        config: { version: 1, identity: SECRET_STRKEY_FIXTURE },
      });

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(result.stderr).not.toContain(SECRET_STRKEY_FIXTURE);
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it.each(['secretKey', 'private_key', 'seed', 'mnemonic'])(
      'rejects configuration secret field %j without echoing its value',
      async (field) => {
        const result = await deploy({
          args: ['--network', 'testnet', '--source', 'deployer'],
          config: { version: 1, [field]: SECRET_STRKEY_FIXTURE },
        });

        expect(result.exitCode).toBe(EXIT_CODES.validation);
        expect(result.stderr).toContain('must not contain secret material');
        expect(result.stderr).not.toContain(SECRET_STRKEY_FIXTURE);
        expect(spawnMock).not.toHaveBeenCalled();
      },
    );

    it('requires an explicit identity instead of defaulting', async () => {
      const result = await deploy({ args: ['--network', 'testnet'] });

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(result.stderr).toContain('Deployment identity is required.');
      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  describe('process boundary: argument array, no shell, filtered environment', () => {
    it('spawns the Stellar CLI with exact arguments and safe options', () =>
      withTempDirectory(async (root) => {
        const result = await runDeployScenario(
          {
            args: ['--network', 'testnet', '--source', 'deployer'],
            environment: {
              PATH: '/usr/bin',
              HOME: '/home/fixture',
              STELLAR_NETWORK: 'testnet',
              STELLAR_SECRET_KEY: SECRET_STRKEY_FIXTURE,
              STELLAR_ACCOUNT: 'deployer',
              SOROBAN_SECRET_KEY: SECRET_STRKEY_FIXTURE,
              AWS_SECRET_ACCESS_KEY: 'fixture-aws-secret',
              NPM_TOKEN: 'fixture-npm-token',
            },
          },
          root,
        );

        expect(result.exitCode).toBe(EXIT_CODES.success);
        expect(spawnMock).toHaveBeenCalledTimes(1);
        const [command, args, options] = spawnMock.mock.calls[0] as [
          string,
          string[],
          { cwd: string; env: NodeJS.ProcessEnv; shell: boolean },
        ];
        expect(command).toBe(STELLAR_BINARY);
        expect(args).toEqual([
          'contract',
          'deploy',
          '--source-account',
          'deployer',
          '--network',
          'testnet',
        ]);
        expect(options.shell).toBe(false);
        expect(options.cwd).toBe(root);
        expect(options.env).toEqual({
          PATH: '/usr/bin',
          HOME: '/home/fixture',
          STELLAR_NETWORK: 'testnet',
        });
      }));

    it('does not spawn for an unsupported project layout', async () => {
      const result = await deploy({
        args: ['--network', 'testnet', '--source', 'deployer'],
        cargo: false,
      });

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(result.stderr).toContain('No Cargo.toml workspace was found');
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('rejects a non-file configuration path before spawning', () =>
      withTempDirectory(async (root) => {
        mkdirSync(join(root, 'stellarforge.config.json'));
        const result = await runDeployScenario(
          { args: ['--network', 'testnet', '--source', 'deployer'] },
          root,
        );

        expect(result.exitCode).toBe(EXIT_CODES.validation);
        expect(spawnMock).not.toHaveBeenCalled();
      }));
  });

  describe('output boundary: secret-like subprocess output is not reflected', () => {
    it('redacts secrets on both streams of a successful deployment', async () => {
      const lines = SECRET_FIXTURE_LINES.map((line) => `${line}\n`);
      const result = await deploy({
        args: ['--network', 'testnet', '--source', 'deployer'],
        childStdout: [...lines, 'CDEPLOYEDCONTRACTFIXTURE\n'],
        childStderr: lines,
      });

      expect(result.exitCode).toBe(EXIT_CODES.success);
      expectNoSecrets(result.stdout);
      expectNoSecrets(result.stderr);
      expect(result.stdout).toContain(
        '[stellar:deploy] CDEPLOYEDCONTRACTFIXTURE',
      );
    });

    it('keeps an actionable subprocess failure without reflecting secrets', async () => {
      const result = await deploy({
        args: ['--network', 'testnet', '--source', 'deployer'],
        childExitCode: 1,
        childStderr: [
          `error: account not found\nsecret: ${SECRET_STRKEY_FIXTURE}\n`,
        ],
      });

      expect(result.exitCode).toBe(EXIT_CODES.subprocess);
      expectNoSecrets(result.stderr);
      expect(result.stderr).toContain(
        '[stellar:deploy] error: account not found',
      );
      expect(result.stderr).toContain(
        "Development process 'stellar:deploy' exited unexpectedly with code 1.",
      );
    });
  });
});
