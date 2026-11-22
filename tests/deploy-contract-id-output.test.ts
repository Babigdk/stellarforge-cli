import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import {
  parseDeploymentOutput,
  validateContractId,
  validateDeploymentOutput,
} from '../src/deployment/project.js';
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
  withTempDirectory,
  writeGeneratedWasmArtifact,
} from './helpers/index.js';
import { MockChildProcess } from './helpers/mock-child-process.js';

const VALID_CONTRACT_ID =
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const SECOND_CONTRACT_ID =
  'CBBDYF3CYMJEJTIVFESQYZTN67GO2R5D5IUABTCUG3HXQSRXCSOROBAN';
const CANONICAL_ACCOUNT_ID =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
  writeGeneratedWasmArtifact(root);
}

function expectNoSecrets(text: string): void {
  for (const secret of SECRET_FIXTURE_VALUES) {
    expect(text).not.toContain(secret);
  }
}

describe('SW-162: validate Stellar CLI deployment output as structured contract data', () => {
  describe('Criterion 1: Only a contract ID in documented output location/format is accepted', () => {
    it('accepts a canonical contract ID on stdout with newline', () => {
      const result = parseDeploymentOutput(`${VALID_CONTRACT_ID}\n`);
      expect(result).toEqual({ contractId: VALID_CONTRACT_ID });
    });

    it('accepts a canonical contract ID on stdout with CRLF line ending', () => {
      const result = parseDeploymentOutput(`${VALID_CONTRACT_ID}\r\n`);
      expect(result).toEqual({ contractId: VALID_CONTRACT_ID });
    });

    it('accepts a canonical contract ID surrounded by blank lines', () => {
      const result = parseDeploymentOutput(`\n\n${VALID_CONTRACT_ID}\n\n`);
      expect(result).toEqual({ contractId: VALID_CONTRACT_ID });
    });

    it('accepts a canonical contract ID with leading/trailing horizontal whitespace', () => {
      const result = parseDeploymentOutput(`  ${VALID_CONTRACT_ID}  \n`);
      expect(result).toEqual({ contractId: VALID_CONTRACT_ID });
    });

    it('validates a standalone contract ID string directly', () => {
      expect(validateContractId(VALID_CONTRACT_ID)).toBe(VALID_CONTRACT_ID);
      expect(validateDeploymentOutput(`${VALID_CONTRACT_ID}\n`)).toEqual({
        contractId: VALID_CONTRACT_ID,
      });
    });

    it('rejects an empty deploy output', () => {
      expect(() => parseDeploymentOutput('')).toThrow(SubprocessCliError);
      expect(() => parseDeploymentOutput('   \n\t\n')).toThrow(
        SubprocessCliError,
      );
    });

    it('rejects arbitrary 56-character string embedded in log messages without standalone ID', () => {
      // SW-091 format or arbitrary log lines must NOT be inferred as success
      expect(() =>
        parseDeploymentOutput(`Deployed contract ID: ${VALID_CONTRACT_ID}\n`),
      ).toThrow(SubprocessCliError);
      expect(() =>
        parseDeploymentOutput(
          `Contract deployed with ID: ${VALID_CONTRACT_ID}\n`,
        ),
      ).toThrow(SubprocessCliError);
    });

    it('rejects contract ID found only on stderr when stdout is empty', () => {
      expect(() =>
        parseDeploymentOutput({
          stdout: '',
          stderr: `${VALID_CONTRACT_ID}\n`,
          exitCode: 0,
        }),
      ).toThrow(SubprocessCliError);
    });
  });

  describe('Criterion 2: Multiple, conflicting, truncated, or malformed IDs fail safely', () => {
    it('rejects multiple conflicting contract IDs on separate lines', () => {
      expect(() =>
        parseDeploymentOutput(`${VALID_CONTRACT_ID}\n${SECOND_CONTRACT_ID}\n`),
      ).toThrow(SubprocessCliError);
    });

    it('rejects duplicate identical contract IDs on separate lines', () => {
      expect(() =>
        parseDeploymentOutput(`${VALID_CONTRACT_ID}\n${VALID_CONTRACT_ID}\n`),
      ).toThrow(SubprocessCliError);
    });

    it.each([
      ['empty string', ''],
      ['single C character', 'C'],
      ['short truncated 10 chars', 'CAAAAAAAAA'],
      ['55 chars, one short', `C${'A'.repeat(54)}`],
    ])('rejects truncated contract ID (%s)', (_, truncated) => {
      expect(() => parseDeploymentOutput(`${truncated}\n`)).toThrow(
        SubprocessCliError,
      );
    });

    it.each([
      ['57 chars, one long', `C${'A'.repeat(56)}`],
      ['lower-case contract ID', VALID_CONTRACT_ID.toLowerCase()],
      ['contains digit 0 (not in Base32)', `C${'0'.repeat(55)}`],
      ['contains digit 1 (not in Base32)', `C${'1'.repeat(55)}`],
      ['contains digit 8 (not in Base32)', `C${'8'.repeat(55)}`],
      ['contains digit 9 (not in Base32)', `C${'9'.repeat(55)}`],
      ['contains symbol -', `C${'-'.repeat(55)}`],
      ['contains symbol _', `C${'_'.repeat(55)}`],
      ['raw G account address', CANONICAL_ACCOUNT_ID],
      ['raw S secret key seed', SECRET_STRKEY_FIXTURE],
      ['raw M muxed address', `M${'A'.repeat(55)}`],
    ])('rejects malformed contract ID (%s)', (_, malformed) => {
      expect(() => parseDeploymentOutput(`${malformed}\n`)).toThrow(
        SubprocessCliError,
      );
    });

    it('rejects output with a valid contract ID and a truncated candidate', () => {
      expect(() =>
        parseDeploymentOutput(`${VALID_CONTRACT_ID}\nCAAAAAAAAA\n`),
      ).toThrow(SubprocessCliError);
    });

    it('rejects output with a valid contract ID and a malformed candidate', () => {
      expect(() =>
        parseDeploymentOutput(
          `${VALID_CONTRACT_ID}\n${CANONICAL_ACCOUNT_ID}\n`,
        ),
      ).toThrow(SubprocessCliError);
    });
  });

  describe('Criterion 3: Non-zero subprocess exit can never be treated as deployment success', () => {
    it.each([1, 2, 127])(
      'rejects exit code %d even when valid contract ID is present on stdout',
      (exitCode) => {
        expect(() =>
          parseDeploymentOutput({
            stdout: `${VALID_CONTRACT_ID}\n`,
            exitCode,
          }),
        ).toThrow(SubprocessCliError);
      },
    );

    it('rejects null exit code (signal termination) even when valid contract ID is on stdout', () => {
      expect(() =>
        parseDeploymentOutput({
          stdout: `${VALID_CONTRACT_ID}\n`,
          exitCode: null,
        }),
      ).toThrow(SubprocessCliError);
    });

    it('preserves typed SubprocessCliError with exit code 3', () => {
      try {
        parseDeploymentOutput({
          stdout: `${VALID_CONTRACT_ID}\n`,
          exitCode: 2,
        });
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(SubprocessCliError);
        expect((error as SubprocessCliError).exitCode).toBe(
          EXIT_CODES.subprocess,
        );
      }
    });
  });

  describe('Criterion 4: Output containing secret-like text is redacted', () => {
    it('redacts secret-like text when malformed candidate is a secret key', () => {
      let thrown: unknown;
      try {
        parseDeploymentOutput(`${SECRET_STRKEY_FIXTURE}\n`);
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(SubprocessCliError);
      const message = (thrown as SubprocessCliError).message;
      expectNoSecrets(message);
    });

    it('redacts secrets on non-zero exit with stderr', () => {
      let thrown: unknown;
      try {
        parseDeploymentOutput({
          stdout: `${VALID_CONTRACT_ID}\n`,
          stderr: `error: failed with secret ${SECRET_STRKEY_FIXTURE}\n`,
          exitCode: 1,
        });
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(SubprocessCliError);
      const message = (thrown as SubprocessCliError).message;
      expectNoSecrets(message);
    });
  });

  describe('Criterion 5: Tests include noisy stdout, warnings, and misleading IDs', () => {
    it('accepts valid contract ID alongside noisy stdout and non-fatal warnings', () => {
      const noisyOutput = [
        'info: connecting to Stellar RPC endpoint...',
        'note: simulating transaction...',
        'warning: estimated resource fees higher than baseline',
        VALID_CONTRACT_ID,
        'info: contract deployment transaction committed',
      ].join('\n');

      const result = parseDeploymentOutput(noisyOutput);
      expect(result).toEqual({ contractId: VALID_CONTRACT_ID });
    });

    it('accepts valid contract ID when noisy warning lines contain misleading candidate IDs', () => {
      const noisyOutputWithMisleadingIds = [
        `warning: replacing previous contract ${SECOND_CONTRACT_ID}`,
        `info: source account was ${CANONICAL_ACCOUNT_ID}`,
        `notice: temporary salt CAAAAAAAAAAAAAAAAA`,
        VALID_CONTRACT_ID,
      ].join('\n');

      const result = parseDeploymentOutput(noisyOutputWithMisleadingIds);
      expect(result).toEqual({ contractId: VALID_CONTRACT_ID });
    });

    it('fails safely when output has only misleading IDs in logs and no standalone contract ID', () => {
      const misleadingOnly = [
        `warning: replacing previous contract ${SECOND_CONTRACT_ID}`,
        `info: source account was ${CANONICAL_ACCOUNT_ID}`,
        'info: deployment completed',
      ].join('\n');

      expect(() => parseDeploymentOutput(misleadingOnly)).toThrow(
        SubprocessCliError,
      );
    });
  });

  describe('deploy command integration with validation', () => {
    it('surfaces the mocked contract ID and completes successfully', () =>
      withTempDirectory(async (root) => {
        writeCargoWorkspace(root);
        const child = new MockChildProcess();
        const captured = createCapturedTerminalOutput();
        const command = createDeployCommand({
          cwd: () => root,
          output: captured.output,
          spawnProcess: () => child,
          validateDeployment: true,
        });

        const running = command.parseAsync(deployArgs);
        child.stdout.write(`${VALID_CONTRACT_ID}\n`);
        child.exitWith(0);
        await running;

        expect(captured.stdoutText()).toContain(
          `[stellar:deploy] ${VALID_CONTRACT_ID}`,
        );
        expect(captured.stderrText()).toBe('');
      }));

    it('does not let extra noisy output change a successful exit with valid contract ID', () =>
      withTempDirectory(async (root) => {
        writeCargoWorkspace(root);
        const child = new MockChildProcess();
        const captured = createCapturedTerminalOutput();
        const command = createDeployCommand({
          cwd: () => root,
          output: captured.output,
          spawnProcess: () => child,
          validateDeployment: true,
        });

        const running = command.parseAsync(deployArgs);
        child.stdout.write(`${VALID_CONTRACT_ID}\n`);
        child.stdout.write('note: additional informational line\n');
        child.stderr.write('warning: simulated non-fatal notice\n');
        child.stdout.write('error: text that is not fatal\n');
        child.exitWith(0);
        await running;

        expect(captured.stdoutText()).toContain(VALID_CONTRACT_ID);
        expect(captured.stderrText()).toContain('simulated non-fatal notice');
      }));

    it('fails safely when an empty deploy output is produced', () =>
      withTempDirectory(async (root) => {
        writeCargoWorkspace(root);
        const child = new MockChildProcess();
        const captured = createCapturedTerminalOutput();
        const command = createDeployCommand({
          cwd: () => root,
          output: captured.output,
          spawnProcess: () => child,
          validateDeployment: true,
        });

        const running = command.parseAsync(deployArgs);
        child.exitWith(0);

        await expect(running).rejects.toBeInstanceOf(SubprocessCliError);
      }));

    it('fails safely when deploy output contains only non-fatal error-looking logs without a contract ID', () =>
      withTempDirectory(async (root) => {
        writeCargoWorkspace(root);
        const child = new MockChildProcess();
        const captured = createCapturedTerminalOutput();
        const command = createDeployCommand({
          cwd: () => root,
          output: captured.output,
          spawnProcess: () => child,
          validateDeployment: true,
        });

        const running = command.parseAsync(deployArgs);
        child.stdout.write('error: mock warning line\n');
        child.exitWith(0);

        await expect(running).rejects.toBeInstanceOf(SubprocessCliError);
      }));

    it('fails safely when multiple conflicting contract IDs are output', () =>
      withTempDirectory(async (root) => {
        writeCargoWorkspace(root);
        const child = new MockChildProcess();
        const captured = createCapturedTerminalOutput();
        const command = createDeployCommand({
          cwd: () => root,
          output: captured.output,
          spawnProcess: () => child,
          validateDeployment: true,
        });

        const running = command.parseAsync(deployArgs);
        child.stdout.write(`${VALID_CONTRACT_ID}\n`);
        child.stdout.write(`${SECOND_CONTRACT_ID}\n`);
        child.exitWith(0);

        await expect(running).rejects.toBeInstanceOf(SubprocessCliError);
      }));

    it('fails safely when a truncated or malformed contract ID is output', () =>
      withTempDirectory(async (root) => {
        writeCargoWorkspace(root);
        const child = new MockChildProcess();
        const captured = createCapturedTerminalOutput();
        const command = createDeployCommand({
          cwd: () => root,
          output: captured.output,
          spawnProcess: () => child,
          validateDeployment: true,
        });

        const running = command.parseAsync(deployArgs);
        child.stdout.write('CAAAAAAAAAA\n');
        child.exitWith(0);

        await expect(running).rejects.toBeInstanceOf(SubprocessCliError);
      }));

    it('redacts secrets on stdout and does not surface them in errors or output', () =>
      withTempDirectory(async (root) => {
        writeCargoWorkspace(root);
        const child = new FakeChildProcess();
        const captured = createCapturedTerminalOutput();
        const command = createDeployCommand({
          cwd: () => root,
          output: captured.output,
          spawnProcess: () => child,
          validateDeployment: true,
        });

        const exitCode = await runWithCliErrorBoundary(async () => {
          const running = command.parseAsync(deployArgs);
          await child.finish(0, {
            stdout: [...SECRET_FIXTURE_LINES.map((line) => `${line}\n`)],
            stderr: [],
          });
          await running;
        }, captured.output);

        expect(exitCode).toBe(EXIT_CODES.subprocess);
        expectNoSecrets(captured.stdoutText());
        expectNoSecrets(captured.stderrText());
      }));
  });
});
