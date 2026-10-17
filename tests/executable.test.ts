import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildCli,
  builtCliPath,
  repositoryRoot,
  runBuiltCli,
} from './helpers/cli-process.js';

const packageJsonPath = resolve(repositoryRoot, 'package.json');
const DOCTOR_TEST_TIMEOUT_MS = 25_000;

beforeAll(() => {
  buildCli();
});

describe('StellarForge CLI executable', () => {
  it('maps the stellarforge package bin to the compiled CLI entry point', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      bin?: Record<string, string>;
    };

    expect(packageJson.bin?.stellarforge).toBe('dist/cli.js');
  });

  it('preserves the Node.js shebang in the built artifact', () => {
    const builtCli = readFileSync(builtCliPath, 'utf8');

    expect(builtCli.startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('starts successfully without arguments', () => {
    const result = runBuiltCli();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('prints global help successfully', () => {
    const result = runBuiltCli(['--help']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: stellarforge [options] [command]');
    expect(result.stdout).toContain('doctor');
    expect(result.stdout).toContain('-h, --help');
    expect(result.stdout).toContain('-V, --version');
  });

  it(
    'runs default doctor checks safely in the CI toolchain',
    () => {
      const result = runBuiltCli(['doctor']);

      expect([0, 5]).toContain(result.status);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('[PASS] Node.js:');
      expect(result.stdout).toContain('[PASS] npm:');
      expect(result.stdout).toContain('[PASS] Git:');
      expect(result.stdout).toContain('Rust:');
      expect(result.stdout).toContain('Cargo:');
      expect(result.stdout).toContain('Stellar CLI:');
      expect(result.stdout).toContain('Docker:');
      expect(result.stdout).toMatch(
        /Summary: \d+ passed, \d+ warnings, \d+ failed\./,
      );
    },
    DOCTOR_TEST_TIMEOUT_MS,
  );

  it('prints the package version from the built executable', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version: string;
    };
    const result = runBuiltCli(['--version']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  it('maps an unknown option to the validation exit code', () => {
    const result = runBuiltCli(['--definitely-unknown']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "error: unknown option '--definitely-unknown'",
    );
    expect(result.stderr).toContain("Run 'stellarforge --help' for usage.");
    expect(result.stderr).not.toContain(
      'StellarForge encountered an unexpected error.',
    );
  });

  it('maps an unknown positional command to the validation exit code', () => {
    const result = runBuiltCli(['not-a-command']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("error: unknown command 'not-a-command'");
    expect(result.stderr).toContain(
      'Available commands: doctor, new, dev, test, deploy.',
    );
    expect(result.stderr).not.toContain(
      'StellarForge encountered an unexpected error.',
    );
  });

  it('maps an unknown subcommand option to the validation exit code', () => {
    const result = runBuiltCli(['deploy', '--bogus']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      "error: unknown option '--bogus'\n" +
        "Run 'stellarforge deploy --help' for usage.\n",
    );
  });
});
