import type * as childProcess from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import {
  GENERATED_WASM_ARTIFACT_PATH,
  MAX_WASM_ARTIFACT_SIZE_BYTES,
  WASM_MAGIC_HEADER,
} from '../src/deployment/project.js';
import { DETERMINISTIC_LOCALE_ENVIRONMENT } from '../src/dev/environment.js';
import { EXIT_CODES, runWithCliErrorBoundary } from '../src/errors/index.js';
import {
  createCapturedTerminalOutput,
  createTempDirectoryFixture,
  FakeChildProcess,
  SECRET_FIXTURE_LINES,
  SECRET_FIXTURE_VALUES,
  SECRET_STRKEY_FIXTURE,
  withTempDirectory,
  writeGeneratedWasmArtifact,
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

function canCreateSymlink(): boolean {
  const fixture = createTempDirectoryFixture();
  try {
    const target = join(fixture.path, 'target');
    writeFileSync(target, 'link-target');
    symlinkSync(target, join(fixture.path, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    fixture.cleanup();
  }
}

const symlinksSupported = canCreateSymlink();

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
  readonly writeArtifact?: (root: string) => void;
}

async function runDeployScenario(
  scenario: DeployScenario,
  root: string,
): Promise<DeployRun> {
  if (scenario.cargo ?? true) {
    writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
    if (scenario.writeArtifact !== undefined) {
      scenario.writeArtifact(root);
    } else {
      writeGeneratedWasmArtifact(root);
    }
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
        '--wasm',
        GENERATED_WASM_ARTIFACT_PATH,
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
          '--wasm',
          GENERATED_WASM_ARTIFACT_PATH,
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
          ...DETERMINISTIC_LOCALE_ENVIRONMENT,
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

  describe('artifact boundary: Wasm file type and size validation before subprocess invocation', () => {
    function artifactPath(root: string): string {
      return join(root, ...GENERATED_WASM_ARTIFACT_PATH.split('/'));
    }

    it('rejects an empty Wasm artifact (0 bytes) before invoking the Stellar CLI', async () => {
      const result = await deploy({
        args: ['--network', 'testnet', '--source', 'deployer'],
        writeArtifact: (root) => {
          const path = artifactPath(root);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, Buffer.alloc(0));
        },
      });

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(result.stderr).toContain('not a non-empty regular file');
      expect(spawnMock).not.toHaveBeenCalled();
      expect(result.stdout).not.toContain('Deploying');
    });

    it('rejects an oversized Wasm artifact (> 128 KiB) before invoking the Stellar CLI', async () => {
      const oversizedBytes = MAX_WASM_ARTIFACT_SIZE_BYTES + 1;
      const result = await deploy({
        args: ['--network', 'testnet', '--source', 'deployer'],
        writeArtifact: (root) => {
          const path = artifactPath(root);
          mkdirSync(dirname(path), { recursive: true });
          const buf = Buffer.alloc(oversizedBytes);
          WASM_MAGIC_HEADER.copy(buf);
          writeFileSync(path, buf);
        },
      });

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(result.stderr).toContain(
        'exceeds the maximum allowed Soroban contract size',
      );
      expect(result.stderr).toContain('128 KiB');
      expect(spawnMock).not.toHaveBeenCalled();
      expect(result.stdout).not.toContain('Deploying');
    });

    it('accepts a Wasm artifact at exactly the maximum allowed size (128 KiB)', async () => {
      const result = await deploy({
        args: ['--network', 'testnet', '--source', 'deployer'],
        writeArtifact: (root) => {
          const path = artifactPath(root);
          mkdirSync(dirname(path), { recursive: true });
          const buf = Buffer.alloc(MAX_WASM_ARTIFACT_SIZE_BYTES);
          WASM_MAGIC_HEADER.copy(buf);
          writeFileSync(path, buf);
        },
      });

      expect(result.exitCode).toBe(EXIT_CODES.success);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['plain text', Buffer.from('console.log("not a wasm binary");\n')],
      ['JSON', Buffer.from('{"not": "wasm"}')],
      ['shell script', Buffer.from('#!/bin/sh\necho hi\n')],
      ['ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0])],
      ['Mach-O binary', Buffer.from([0xfe, 0xed, 0xfa, 0xce, 0, 0, 0, 1])],
      ['truncated header (< 8 bytes)', Buffer.from([0x00, 0x61, 0x73, 0x6d])],
      [
        'unexpected Wasm version',
        Buffer.from([0x00, 0x61, 0x73, 0x6d, 2, 0, 0, 0]),
      ],
      [
        'inverted magic bytes',
        Buffer.from([0x6d, 0x73, 0x61, 0x00, 1, 0, 0, 0]),
      ],
    ])(
      'rejects unexpected file format %s before invoking the Stellar CLI',
      async (_name, data) => {
        const result = await deploy({
          args: ['--network', 'testnet', '--source', 'deployer'],
          writeArtifact: (root) => {
            const path = artifactPath(root);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, data);
          },
        });

        expect(result.exitCode).toBe(EXIT_CODES.validation);
        expect(result.stderr).toContain('not a valid WebAssembly binary');
        expect(spawnMock).not.toHaveBeenCalled();
        expect(result.stdout).not.toContain('Deploying');
      },
    );

    it('rejects when the artifact path is a directory before invoking the Stellar CLI', async () => {
      const result = await deploy({
        args: ['--network', 'testnet', '--source', 'deployer'],
        writeArtifact: (root) => {
          mkdirSync(artifactPath(root), { recursive: true });
        },
      });

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(result.stderr).toContain('not a non-empty regular file');
      expect(spawnMock).not.toHaveBeenCalled();
      expect(result.stdout).not.toContain('Deploying');
    });

    it.skipIf(!symlinksSupported)(
      'rejects a symlinked artifact file before invoking the Stellar CLI',
      async () => {
        const result = await deploy({
          args: ['--network', 'testnet', '--source', 'deployer'],
          writeArtifact: (root) => {
            const path = artifactPath(root);
            mkdirSync(dirname(path), { recursive: true });
            const realPath = join(root, 'target', 'real.wasm');
            writeFileSync(realPath, WASM_MAGIC_HEADER);
            symlinkSync(realPath, path);
          },
        });

        expect(result.exitCode).toBe(EXIT_CODES.validation);
        expect(result.stderr).toContain('not a symbolic link');
        expect(spawnMock).not.toHaveBeenCalled();
        expect(result.stdout).not.toContain('Deploying');
      },
    );

    it.skipIf(!symlinksSupported)(
      'rejects an artifact target symlink escaping the project root without leaking external paths',
      () =>
        withTempDirectory(async (root) => {
          const outside = createTempDirectoryFixture();
          try {
            writeGeneratedWasmArtifact(outside.path);
            writeFileSync(
              join(root, 'Cargo.toml'),
              '[workspace]\nmembers = []\n',
            );
            symlinkSync(outside.path, join(root, 'target'), 'junction');

            const result = await runDeployScenario(
              {
                args: ['--network', 'testnet', '--source', 'deployer'],
                writeArtifact: () => {
                  // Artifact is already in outside.path via symlinked target
                },
              },
              root,
            );

            expect(result.exitCode).toBe(EXIT_CODES.validation);
            expect(result.stderr).toContain(
              'outside the expected project workspace',
            );
            expect(result.stderr).not.toContain(outside.path);
            expect(spawnMock).not.toHaveBeenCalled();
            expect(result.stdout).not.toContain('Deploying');
          } finally {
            outside.cleanup();
          }
        }),
    );
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
