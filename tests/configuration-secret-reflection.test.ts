import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
} from '../src/config/project.js';
import {
  EXIT_CODES,
  ValidationCliError,
  runWithCliErrorBoundary,
} from '../src/errors/index.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';

const SECRET_FIELD_NAMES = [
  'privateKey',
  'private_key',
  'private-key',
  'secretKey',
  'secret',
  'seed',
  'seedPhrase',
  'mnemonic',
  'password',
  'PASSWORD',
  'passphrase',
  'token',
  'apiToken',
  'authToken',
  'my_token',
];

const SECRET_MESSAGE =
  'StellarForge project configuration must not contain secret material.';

describe('configuration secret non-reflection', () => {
  it.each(SECRET_FIELD_NAMES)(
    'rejects secret-bearing field %j without echoing its value',
    (field) =>
      withTempDirectory((dir) => {
        const secret = `SENTINEL-SECRET-${field}`;
        writeFileSync(
          join(dir, PROJECT_CONFIG_FILENAME),
          JSON.stringify({ version: 1, [field]: secret }),
        );

        try {
          loadProjectConfig(dir);
          throw new Error('Expected configuration validation to fail.');
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationCliError);

          const message = (error as Error).message;
          expect(message).toContain('must not contain secret material');
          expect(message).not.toContain(secret);
        }
      }),
  );

  it('does not reflect secrets from malformed JSON', () =>
    withTempDirectory((dir) => {
      writeFileSync(
        join(dir, PROJECT_CONFIG_FILENAME),
        '{"version": 1, "privateKey": "SENTINEL-MALFORMED-SECRET"',
      );

      try {
        loadProjectConfig(dir);
        throw new Error('Expected malformed JSON to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationCliError);

        const message = (error as Error).message;
        expect(message).toBe('stellarforge.config.json is not valid JSON.');
        expect(message).not.toContain('SENTINEL-MALFORMED-SECRET');
      }
    }));

  it('rejects an unsupported field without echoing it', () =>
    withTempDirectory((dir) => {
      writeFileSync(
        join(dir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, unsupportedField: 'SENTINEL-UNKNOWN' }),
      );

      try {
        loadProjectConfig(dir);
        throw new Error('Expected configuration validation to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationCliError);

        const message = (error as Error).message;
        expect(message).toContain('unsupported field');
        expect(message).not.toContain('unsupportedField');
        expect(message).not.toContain('SENTINEL-UNKNOWN');
      }
    }));

  it('renders secret validation failures without leaking through the boundary', () =>
    withTempDirectory(async (dir) => {
      const secret = 'SENTINEL-BOUNDARY-SECRET';
      writeFileSync(
        join(dir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, privateKey: secret }),
      );

      const captured = createCapturedTerminalOutput();
      const exitCode = await runWithCliErrorBoundary(() => {
        loadProjectConfig(dir);
      }, captured.output);

      expect(exitCode).toBe(EXIT_CODES.validation);
      expect(captured.stdoutText()).toBe('');
      expect(captured.stderrText()).toContain(SECRET_MESSAGE);
      expect(captured.stderrText()).not.toContain(secret);
    }));
});
