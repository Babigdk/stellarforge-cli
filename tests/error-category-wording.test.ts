import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXIT_CODES,
  InternalCliError,
  SubprocessCliError,
  ValidationCliError,
  runWithCliErrorBoundary,
} from '../src/errors/index.js';
import { createCapturedTerminalOutput } from './helpers/index.js';

const root = join(import.meta.dirname, '..');
const exitCodeReference = readFileSync(
  join(root, 'docs', 'reference', 'exit-codes.md'),
  'utf8',
);

function expectSafeUserWording(message: string): void {
  expect(message.length).toBeGreaterThan(0);
  expect(message.trim()).toBe(message);
  expect(message.endsWith('.')).toBe(true);
  expect(message).not.toMatch(/[\r\n]/);
  expect(message.startsWith('Error')).toBe(false);
  expect(message).not.toMatch(/\bat\s+\S+:\d+/);
}

describe('CLI error-category wording', () => {
  it('keeps the centralized exit-code contract unchanged', () => {
    expect(EXIT_CODES).toEqual({
      success: 0,
      unexpected: 1,
      validation: 2,
      subprocess: 3,
      internal: 4,
      diagnostic: 5,
    });
  });

  it('keeps the exit-code reference aligned with the source constants', () => {
    expect(exitCodeReference).toContain('| `0` | Success |');
    expect(exitCodeReference).toContain('| `1` | Unexpected failure |');
    expect(exitCodeReference).toContain('| `2` | Validation / usage failure |');
    expect(exitCodeReference).toContain('| `3` | Subprocess failure |');
    expect(exitCodeReference).toContain('| `4` | Internal failure |');
    expect(exitCodeReference).toContain('| `5` | Diagnostic failure |');
  });

  it('uses consistent, safe wording for each error category', () => {
    const validation = new ValidationCliError('Project name is required.');
    const subprocess = new SubprocessCliError(
      'The requested tool exited unsuccessfully.',
    );
    const internal = new InternalCliError();

    expect(validation.name).toBe('ValidationCliError');
    expect(validation.exitCode).toBe(EXIT_CODES.validation);
    expect(subprocess.name).toBe('SubprocessCliError');
    expect(subprocess.exitCode).toBe(EXIT_CODES.subprocess);
    expect(internal.name).toBe('InternalCliError');
    expect(internal.exitCode).toBe(EXIT_CODES.internal);

    const messages = [
      validation.userMessage,
      subprocess.userMessage,
      internal.userMessage,
    ];

    for (const message of messages) {
      expectSafeUserWording(message);
    }

    expect(validation.userMessage).toBe('Project name is required.');
    expect(subprocess.userMessage).toBe(
      'The requested tool exited unsuccessfully.',
    );
    expect(internal.userMessage).toBe(
      'StellarForge encountered an internal error.',
    );
    expect(new Set(messages).size).toBe(3);
  });

  it('renders each category with its stable exit code and no internals', async () => {
    const cases: ReadonlyArray<readonly [Error, number, string]> = [
      [
        new ValidationCliError('Project name is required.'),
        EXIT_CODES.validation,
        'Project name is required.\n',
      ],
      [
        new SubprocessCliError('The requested tool exited unsuccessfully.'),
        EXIT_CODES.subprocess,
        'The requested tool exited unsuccessfully.\n',
      ],
      [
        new InternalCliError(),
        EXIT_CODES.internal,
        'StellarForge encountered an internal error.\n',
      ],
    ];

    for (const [error, expectedCode, expectedLine] of cases) {
      const { output, stdout, stderr } = createCapturedTerminalOutput();
      const exitCode = await runWithCliErrorBoundary(() => {
        throw error;
      }, output);

      expect(exitCode).toBe(expectedCode);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([expectedLine]);
    }
  });

  it('keeps an internal cause while hiding it from rendered output', async () => {
    const { output, stdout, stderr } = createCapturedTerminalOutput();
    const cause = new Error('token=SENTINEL-INTERNAL-CAUSE');
    const error = new InternalCliError({ cause });

    const exitCode = await runWithCliErrorBoundary(() => {
      throw error;
    }, output);

    expect(exitCode).toBe(EXIT_CODES.internal);
    expect(error.cause).toBe(cause);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).not.toContain('SENTINEL-INTERNAL-CAUSE');
  });

  it('hides raw unexpected details and stack traces behind one generic category', async () => {
    const { output, stdout, stderr } = createCapturedTerminalOutput();
    const exitCode = await runWithCliErrorBoundary(() => {
      throw new Error('exploded at /Users/secret/src/main.ts:42');
    }, output);

    expect(exitCode).toBe(EXIT_CODES.unexpected);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['StellarForge encountered an unexpected error.\n']);
    expect(stderr.join('')).not.toMatch(/\bat\s+\S+:\d+/);
  });
});
