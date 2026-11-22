import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
} from '../src/config/project.js';
import { validateStellarForgeConfig } from '../src/config/schema.js';
import { ValidationCliError } from '../src/errors/index.js';
import { withTempDirectory } from './helpers/index.js';

function expectValidationErrorWith(
  value: unknown,
  substrings: readonly string[],
): ValidationCliError {
  try {
    validateStellarForgeConfig(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationCliError);
    const validationError = error as ValidationCliError;

    for (const substring of substrings) {
      expect(validationError.message).toContain(substring);
    }

    return validationError;
  }

  throw new Error('Expected validateStellarForgeConfig to throw.');
}

describe('config schema version policy', () => {
  it.each([2, 999])(
    'rejects future version %i with an actionable upgrade message',
    (version) => {
      const error = expectValidationErrorWith({ version }, [
        'upgrade',
        'stellarforge',
        String(version),
      ]);

      expect(error.message).not.toContain('rewrite');
      expect(error.message).not.toContain('must declare');
    },
  );

  it('includes the detected version without echoing unrelated values', () => {
    const error = expectValidationErrorWith({ version: 2 }, ['2']);

    expect(error.message).not.toContain('SENTINEL_VALUE_NOT_IN_MESSAGE');
  });

  it('requires a version field', () => {
    expectValidationErrorWith({}, ['version', 'required']);
  });

  it.each(['1', 1.5, null, 0, -1])(
    'rejects malformed version %j with the type-constraint message',
    (version) => {
      const error = expectValidationErrorWith({ version }, [
        'version',
        'must be a positive integer',
      ]);

      expect(error.message).not.toContain(String(version));
    },
  );

  it.each([true, false, [], {}])(
    'rejects wrong-type version %j with the type-constraint message',
    (version) => {
      expectValidationErrorWith({ version }, [
        'version',
        'must be a positive integer',
      ]);
    },
  );

  it('propagates the future-version error through loadProjectConfig', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 2 }),
      );

      expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);

      try {
        loadProjectConfig(root);
      } catch (error) {
        expect((error as ValidationCliError).message).toContain('upgrade');
      }
    }));

  // Feature: config-schema-version-migration, Property 1: version-1 round trip
  it('round-trips every valid version-1 field combination', () => {
    fc.assert(
      fc.property(
        fc.record({
          version: fc.constant(1 as const),
          network: fc.option(
            fc.constantFrom(
              'testnet' as const,
              'futurenet' as const,
              'mainnet' as const,
            ),
            { nil: undefined },
          ),
          identity: fc.option(fc.constantFrom('deployer', 'team-deployer'), {
            nil: undefined,
          }),
        }),
        (config) => {
          const result = validateStellarForgeConfig(config);

          expect(result.version).toBe(1);
          expect(result.network).toBe(config.network);
          expect(result.identity).toBe(config.identity);
        },
      ),
    );
  });

  // Feature: config-schema-version-migration, Property 2: future version actionable error
  it('reports an actionable error for every future integer version', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2 }), (version) => {
        const error = expectValidationErrorWith({ version }, [
          'upgrade',
          'stellarforge',
          String(version),
        ]);

        expect(error.message).not.toContain('rewrite');
      }),
    );
  });

  // Feature: config-schema-version-migration, Property 3: absent version required error
  it('requires a version regardless of other present fields', () => {
    fc.assert(
      fc.property(
        fc.record({
          network: fc.option(
            fc.constantFrom(
              'testnet' as const,
              'futurenet' as const,
              'mainnet' as const,
            ),
            { nil: undefined },
          ),
        }),
        (config) => {
          expectValidationErrorWith(config, ['version', 'required']);
        },
      ),
    );
  });

  // Feature: config-schema-version-migration, Property 4: malformed version type-constraint error
  it('rejects malformed versions without echoing the submitted value', () => {
    const malformedVersionArb = fc.oneof(
      fc.constant(null),
      fc.boolean(),
      fc.stringMatching(/^x{1,12}$/),
      fc.array(fc.constant('SENTINEL'), { minLength: 1 }),
      fc.constant({}),
      fc.double({ noInteger: true }),
      fc.constant(0),
      fc.integer({ max: -1 }),
    );

    fc.assert(
      fc.property(malformedVersionArb, (version) => {
        const error = expectValidationErrorWith({ version }, [
          'version',
          'must be a positive integer',
        ]);

        expect(error.message).not.toContain(String(version));
      }),
    );
  });
});
