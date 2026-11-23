import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import {
  GENERATED_WASM_ARTIFACT_PATH,
  resolveTestnetDeploymentPlan,
} from '../src/deployment/project.js';
import type { ManagedChildProcess } from '../src/dev/orchestrator.js';
import type { DevProcessSpec } from '../src/dev/project.js';
import {
  EXIT_CODES,
  SubprocessCliError,
  ValidationCliError,
  runWithCliErrorBoundary,
} from '../src/errors/index.js';
import {
  createCapturedTerminalOutput,
  createTempDirectoryFixture,
  withTempDirectory,
  writeGeneratedWasmArtifact,
} from './helpers/index.js';

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

class MockDeployProcess implements ManagedChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  #exitListener:
    ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
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
    // End both stdio streams so the supervisor observes the full lifecycle.
    this.stdout.end();
    this.stderr.end();
    this.#exitListener?.(code, signal);
  }

  fail(error: Error): void {
    this.#errorListener?.(error);
  }
}

function writeCargoWorkspace(root: string): void {
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
  writeGeneratedWasmArtifact(root);
}

function artifactPath(root: string): string {
  return join(root, ...GENERATED_WASM_ARTIFACT_PATH.split('/'));
}

function canCreateSymlinks(): boolean {
  const fixture = createTempDirectoryFixture();
  try {
    const target = join(fixture.path, 'probe-target');
    const link = join(fixture.path, 'probe-link');
    mkdirSync(target);
    symlinkSync(target, link, 'junction');
    return true;
  } catch {
    return false;
  } finally {
    fixture.cleanup();
  }
}

const symlinksSupported = canCreateSymlinks();

function deployArgs(): string[] {
  return ['node', 'deploy', '--network', 'testnet', '--source', 'deployer'];
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

      const running = command.parseAsync(deployArgs());
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

      const running = command.parseAsync(deployArgs());
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

      const running = command.parseAsync(deployArgs());
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

  it('passes the exact generated Wasm artifact argument to the Stellar CLI', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      const child = new MockDeployProcess();
      const specs: DevProcessSpec[] = [];
      const command = createDeployCommand({
        cwd: () => root,
        spawnProcess: (spec) => {
          specs.push(spec);
          return child;
        },
      });

      const running = command.parseAsync(deployArgs());
      child.stdout.write(`Contract deployed with ID: ${CONTRACT_ID}\n`);
      child.exitWith(0);
      await running;

      expect(specs).toHaveLength(1);
      expect(specs[0]?.args).toEqual([
        'contract',
        'deploy',
        '--wasm',
        GENERATED_WASM_ARTIFACT_PATH,
        '--source-account',
        'deployer',
        '--network',
        'testnet',
      ]);
      expect(
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source: 'deployer',
        })[0]?.args,
      ).toEqual(specs[0]?.args);
    }));

  it('fails before spawning when the generated Wasm artifact is missing', () =>
    withTempDirectory(async (root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      let spawned = false;
      const command = createDeployCommand({
        cwd: () => root,
        spawnProcess: () => {
          spawned = true;
          return new MockDeployProcess();
        },
      });

      const error = await command.parseAsync(deployArgs()).then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(ValidationCliError);
      expect((error as ValidationCliError).userMessage).toContain(
        'generated Wasm artifact is missing',
      );
      expect((error as ValidationCliError).userMessage).not.toContain(root);
      expect(spawned).toBe(false);
    }));

  it('fails before spawning when the artifact path is a directory', () =>
    withTempDirectory(async (root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      mkdirSync(artifactPath(root), { recursive: true });
      let spawned = false;
      const command = createDeployCommand({
        cwd: () => root,
        spawnProcess: () => {
          spawned = true;
          return new MockDeployProcess();
        },
      });

      const error = await command.parseAsync(deployArgs()).then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(ValidationCliError);
      expect((error as ValidationCliError).userMessage).toContain(
        'non-empty regular file',
      );
      expect(spawned).toBe(false);
    }));

  it.skipIf(!symlinksSupported)(
    'fails before spawning when the artifact escapes the workspace through a symlink',
    () =>
      withTempDirectory(async (root) => {
        const outside = createTempDirectoryFixture();
        try {
          writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
          writeGeneratedWasmArtifact(outside.path);
          symlinkSync(outside.path, join(root, 'target'), 'junction');

          let spawned = false;
          const command = createDeployCommand({
            cwd: () => root,
            spawnProcess: () => {
              spawned = true;
              return new MockDeployProcess();
            },
          });

          const error = await command.parseAsync(deployArgs()).then(
            () => undefined,
            (reason: unknown) => reason,
          );

          expect(error).toBeInstanceOf(ValidationCliError);
          expect((error as ValidationCliError).userMessage).toContain(
            'outside the expected project workspace',
          );
          expect((error as ValidationCliError).userMessage).not.toContain(
            outside.path,
          );
          expect(spawned).toBe(false);
        } finally {
          outside.cleanup();
        }
      }),
  );

  it('fails before spawning when the artifact is older than contract sources', () =>
    withTempDirectory(async (root) => {
      writeCargoWorkspace(root);
      const sourcePath = join(root, 'contracts', 'hello', 'src', 'lib.rs');
      mkdirSync(dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, '#![no_std]\n');
      const newer = new Date(Date.now() + 60_000);
      utimesSync(sourcePath, newer, newer);

      let spawned = false;
      const command = createDeployCommand({
        cwd: () => root,
        spawnProcess: () => {
          spawned = true;
          return new MockDeployProcess();
        },
      });

      const error = await command.parseAsync(deployArgs()).then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(ValidationCliError);
      expect((error as ValidationCliError).userMessage).toContain(
        'artifact is stale',
      );
      expect(spawned).toBe(false);
    }));
});
