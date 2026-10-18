import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createDeployCommand } from '../src/commands/deploy.js';
import { createNewCommand } from '../src/commands/new.js';
import { createTestCommand } from '../src/commands/test.js';
import { resolveTestnetDeploymentPlan } from '../src/deployment/project.js';
import type { ManagedChildProcess } from '../src/dev/orchestrator.js';
import type { DevProcessSpec } from '../src/dev/project.js';
import {
  SubprocessCliError,
  ValidationCliError,
} from '../src/errors/errors.js';
import { createNpmInvocation } from '../src/process/npm.js';
import { resolveTestProcessPlan } from '../src/testing/project.js';
import {
  createCapturedTerminalOutput,
  repositoryRoot,
  withTempDirectory,
} from './helpers/index.js';

const PROCESS_TEST_TIMEOUT_MS = 45_000;

const readRepositoryFile = (...segments: string[]): string =>
  readFileSync(join(repositoryRoot, ...segments), 'utf8');

/**
 * Mirrors the documented platform contract exercised by
 * `docs/reference/platform-support.md`: Windows npm shims require a fixed
 * `cmd.exe /d /s /c` wrapper, while POSIX platforms invoke `npm` directly.
 */
function expectedNpmInvocation(args: readonly string[]): {
  readonly command: string;
  readonly args: readonly string[];
} {
  return process.platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args] }
    : { command: 'npm', args: [...args] };
}

const expectedStellarCommand =
  process.platform === 'win32' ? 'stellar.exe' : 'stellar';
const expectedCargoCommand =
  process.platform === 'win32' ? 'cargo.exe' : 'cargo';

class FakeChildProcess implements ManagedChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kills: NodeJS.Signals[] = [];
  #exitListener:
    ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;

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

  kill(signal?: NodeJS.Signals): boolean {
    if (signal !== undefined) {
      this.kills.push(signal);
    }
    return true;
  }

  exit(code: number): void {
    this.#exitListener?.(code, null);
  }
}

const SECRET_PATTERNS = /SECRET_|SECRET KEY|seed phrase/iu;

describe('critical path: cross-platform process invocation contract', () => {
  it('selects the documented npm wrapper for the running platform', () => {
    expect(createNpmInvocation(['run', 'test'])).toEqual(
      expectedNpmInvocation(['run', 'test']),
    );
  });

  it('keeps npm arguments as discrete elements without shell interpolation', () => {
    const metacharacters = 'a&b|c^d%e!f(g)';
    const invocation = createNpmInvocation([
      'run',
      'test',
      '--',
      metacharacters,
    ]);

    expect(
      invocation.args.filter((arg) => arg === metacharacters),
    ).toHaveLength(1);
    for (const arg of ['run', 'test', '--']) {
      expect(invocation.args).toContain(arg);
    }
    expect(invocation.args).not.toContain(
      ['run', 'test', '--', metacharacters].join(' '),
    );
  });

  it('reuses the npm wrapper when resolving a generated Node test workflow', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'fixture-node',
          scripts: { test: 'node --test' },
        }),
      );

      const npm = createNpmInvocation(['run', 'test']);
      expect(resolveTestProcessPlan(root)).toEqual([
        {
          label: 'fixture-node:test',
          command: npm.command,
          args: npm.args,
          cwd: resolve(root),
        },
      ]);
    }));

  it('selects the platform-appropriate Cargo executable for a Cargo workspace', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');

      expect(resolveTestProcessPlan(root)).toEqual([
        {
          label: 'cargo:test',
          command: expectedCargoCommand,
          args: ['test'],
          cwd: resolve(root),
        },
      ]);
    }));
});

describe('critical path: test orchestration', () => {
  it(
    'runs a generated project test workflow end-to-end',
    () =>
      withTempDirectory(async (root) => {
        const generated = createCapturedTerminalOutput();
        createNewCommand({ cwd: () => root, output: generated.output }).parse([
          'node',
          'new',
          'critical-basic',
          '--template',
          'basic-app',
        ]);

        const captured = createCapturedTerminalOutput();
        await createTestCommand({
          cwd: () => join(root, 'critical-basic'),
          output: captured.output,
        }).parseAsync(['node', 'test']);

        expect(captured.stdoutText()).toContain(
          'Running 1 project test workflow.',
        );
        expect(captured.stdoutText()).toContain('[critical-basic:test]');
      }),
    PROCESS_TEST_TIMEOUT_MS,
  );

  it('preserves a non-zero project test result as a subprocess failure', async () => {
    const child = new FakeChildProcess();
    const command = createTestCommand({
      cwd: () => '/workspace',
      output: createCapturedTerminalOutput().output,
      resolvePlan: () => [
        {
          label: 'demo:test',
          command: 'npm',
          args: ['run', 'test'],
          cwd: '/workspace',
        },
      ],
      spawnProcess: () => child,
    });

    const running = command.parseAsync(['node', 'test']);
    child.exit(9);

    await expect(running).rejects.toBeInstanceOf(SubprocessCliError);
    expect(child.kills).toContain('SIGTERM');
  });

  it('rejects unsupported projects with actionable guidance', () =>
    withTempDirectory(async (root) => {
      const command = createTestCommand({
        cwd: () => root,
        output: createCapturedTerminalOutput().output,
      });

      await expect(command.parseAsync(['node', 'test'])).rejects.toBeInstanceOf(
        ValidationCliError,
      );
      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(
        'No supported StellarForge test workflow',
      );
    }));
});

describe('critical path: deployment security', () => {
  it('resolves the exact Testnet-only Stellar deployment plan', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');

      const [spec] = resolveTestnetDeploymentPlan({
        cwd: root,
        network: 'testnet',
        source: 'ci-deployer',
      });

      expect(spec).toEqual({
        label: 'stellar:deploy',
        command: expectedStellarCommand,
        args: [
          'contract',
          'deploy',
          '--source-account',
          'ci-deployer',
          '--network',
          'testnet',
        ],
        cwd: resolve(root),
      });
    }));

  it('rejects every non-Testnet deployment target', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');

      for (const network of ['mainnet', 'pubnet', 'futurenet', 'local']) {
        expect(() =>
          resolveTestnetDeploymentPlan({
            cwd: root,
            network,
            source: 'ci-deployer',
          }),
        ).toThrow(ValidationCliError);
      }
    }));

  it('rejects deployment outside a smart-contract workspace', () =>
    withTempDirectory((root) => {
      expect(() =>
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source: 'ci-deployer',
        }),
      ).toThrow('No Cargo.toml');
    }));

  it('executes the mocked deployment without reflecting secrets', () =>
    withTempDirectory(async (root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');

      const child = new FakeChildProcess();
      const captured = createCapturedTerminalOutput();
      let spawned: DevProcessSpec | undefined;
      const command = createDeployCommand({
        cwd: () => root,
        output: captured.output,
        resolveConfig: () => ({ network: 'testnet', identity: 'ci-deployer' }),
        spawnProcess: (spec) => {
          spawned = spec;
          return child;
        },
      });

      const running = command.parseAsync(['node', 'deploy']);
      child.stdout.write('CFAKECONTRACTID\n');
      child.exit(0);
      await running;

      expect(spawned).toEqual({
        label: 'stellar:deploy',
        command: expectedStellarCommand,
        args: [
          'contract',
          'deploy',
          '--source-account',
          'ci-deployer',
          '--network',
          'testnet',
        ],
        cwd: resolve(root),
      });
      expect(captured.stdoutText()).toContain(
        'Deploying smart contract to Stellar Testnet.',
      );
      expect(captured.stdoutText()).toContain(
        '[stellar:deploy] CFAKECONTRACTID',
      );
      expect(captured.stdoutText()).not.toMatch(SECRET_PATTERNS);
      expect(captured.stderrText()).not.toMatch(SECRET_PATTERNS);
    }));

  it('preserves a failed deployment as a subprocess failure', async () => {
    const child = new FakeChildProcess();
    const command = createDeployCommand({
      cwd: () => '/workspace',
      output: createCapturedTerminalOutput().output,
      resolveConfig: () => ({ network: 'testnet', identity: 'ci-deployer' }),
      resolvePlan: () => [
        {
          label: 'stellar:deploy',
          command: 'stellar',
          args: ['contract', 'deploy', '--network', 'testnet'],
          cwd: '/workspace',
        },
      ],
      spawnProcess: () => child,
    });

    const running = command.parseAsync(['node', 'deploy']);
    child.exit(2);

    await expect(running).rejects.toBeInstanceOf(SubprocessCliError);
  });

  it('requires an explicit network and identity before deploying', () =>
    withTempDirectory(async (root) => {
      const command = createDeployCommand({
        cwd: () => root,
        output: createCapturedTerminalOutput().output,
        resolveConfig: () => ({}),
        spawnProcess: () => new FakeChildProcess(),
      });

      await expect(command.parseAsync(['node', 'deploy'])).rejects.toThrow(
        'Deployment network is required',
      );
    }));
});

describe('critical path: end-to-end generation and E2E wiring', () => {
  it('generates the supported Node and Rust templates offline', () =>
    withTempDirectory((root) => {
      const captured = createCapturedTerminalOutput();
      const command = createNewCommand({
        cwd: () => root,
        output: captured.output,
      });

      command.parse([
        'node',
        'new',
        'critical-basic',
        '--template',
        'basic-app',
      ]);
      expect(existsSync(join(root, 'critical-basic', 'package.json'))).toBe(
        true,
      );
      expect(existsSync(join(root, 'critical-basic', 'src', 'index.js'))).toBe(
        true,
      );

      command.parse([
        'node',
        'new',
        'critical-contract',
        '--template',
        'smart-contract',
      ]);
      expect(existsSync(join(root, 'critical-contract', 'Cargo.toml'))).toBe(
        true,
      );
    }));

  it('keeps the repository E2E smoke path offline, mocked, and secret-free', () => {
    const e2e = readRepositoryFile('scripts', 'e2e-smoke.mjs');

    expect(e2e).toContain("process.platform === 'win32'");
    expect(e2e).toContain('stellarforge.cmd');
    expect(e2e).toContain('shell: false');
    expect(e2e).toContain('fakeStellar');
    expect(e2e).toContain('CFAKECONTRACTID');
    expect(e2e).toContain('SECRET_');
    expect(e2e).toContain('doesNotMatch');
    expect(e2e).not.toMatch(/mainnet|api\.stellar\.org|horizon/iu);
  });

  it('runs the E2E smoke workflow and the supported platform matrix in CI', () => {
    const e2eWorkflow = readRepositoryFile(
      '.github',
      'workflows',
      'e2e-smoke.yml',
    );
    expect(e2eWorkflow).toContain('npm run build');
    expect(e2eWorkflow).toContain('npm link --ignore-scripts');
    expect(e2eWorkflow).toContain('npm run test:e2e');

    const ciWorkflow = readRepositoryFile('.github', 'workflows', 'ci.yml');
    expect(ciWorkflow).toContain('npm run typecheck');
    expect(ciWorkflow).toContain('npm run lint');
    expect(ciWorkflow).toContain('npm run format:check');
    expect(ciWorkflow).toContain('npm test');
    expect(ciWorkflow).toContain('npm run build');
    expect(ciWorkflow).not.toContain('continue-on-error');

    for (const target of [
      'Linux / Node 22',
      'Linux / Node 24',
      'macOS / Node 22',
      'Windows / Node 22',
    ]) {
      expect(ciWorkflow).toContain(target);
    }
  });
});

describe('critical path: supported platform contract', () => {
  it('preserves the documented Node/npm engine range and CLI bin', () => {
    const packageJson = JSON.parse(readRepositoryFile('package.json')) as {
      engines?: { node?: string; npm?: string };
      bin?: Record<string, string>;
      type?: string;
    };

    expect(packageJson.engines?.node).toBe('>=22.13.0 <25');
    expect(packageJson.engines?.npm).toBe('>=10.9.0');
    expect(packageJson.bin?.stellarforge).toBe('dist/cli.js');
    expect(packageJson.type).toBe('module');
  });

  it('preserves the Linux/macOS/Windows support contract', () => {
    const platformSupport = readRepositoryFile(
      'docs',
      'reference',
      'platform-support.md',
    );

    expect(platformSupport).toContain('Node.js >=22.13.0 <25');
    for (const platform of [
      'Linux (GitHub-hosted Ubuntu)',
      'macOS (GitHub-hosted macOS)',
      'Windows (GitHub-hosted Windows)',
    ]) {
      expect(platformSupport).toContain(platform);
    }
    expect(platformSupport).toContain('cmd.exe /d /s /c npm');
    expect(platformSupport).toContain('cargo.exe');
    expect(platformSupport).toContain('stellar.exe');
    expect(platformSupport).toContain('continue-on-error');
  });
});
