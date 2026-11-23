/**
 * SW-220 — Malformed package-script metadata matrix for the dev resolver.
 *
 * Covers every invalid shape of the `scripts` object itself and of individual
 * script values (null, array, primitive, non-string) so that invalid metadata
 * cannot reach npm.  Valid-script regression guards are included at the end of
 * each section to confirm the happy path is unaffected.
 *
 * Precedence rule (documented here as the single authoritative statement):
 *   dev  >  start  >  start:backend
 *   Each candidate is evaluated left-to-right.  A candidate is accepted only
 *   when its value is a string with at least one non-whitespace character.
 *   Non-string values (null, boolean, number, array, object) are **skipped**,
 *   not rejected immediately, so a later candidate with a valid string can
 *   still be selected.  Rejection only happens when no candidate survives.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import { createNpmInvocation } from '../src/process/npm.js';
import { resolveDevProcessPlan } from '../src/dev/project.js';
import { withTempDirectory } from './helpers/index.js';

// ---------------------------------------------------------------------------
// Local helper – keeps test bodies concise and prevents accidental test
// pollution through JSON.stringify type coercion.
// ---------------------------------------------------------------------------
function writePackage(root: string, value: unknown): void {
  writeFileSync(
    join(root, 'package.json'),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Malformed `scripts` *object* shapes
//
// These cases all trigger the "must define a scripts object" guard that runs
// before selectDevelopmentScript is called.  They are explicitly distinct from
// "missing or blank script values": a missing scripts key and a null scripts
// value both cause the same guard to fire, but for different structural
// reasons.
// ---------------------------------------------------------------------------
describe('dev resolver — malformed scripts object shapes (SW-220)', () => {
  it.each([
    { label: 'null', value: null },
    { label: 'boolean true', value: true },
    { label: 'boolean false', value: false },
    { label: 'number 0', value: 0 },
    { label: 'number 42', value: 42 },
    { label: 'string "start"', value: 'start' },
    { label: 'array []', value: [] },
    { label: 'array of script names', value: ['dev', 'start'] },
  ])(
    'rejects scripts: $label before process-plan creation',
    ({ value }) =>
      withTempDirectory((root) => {
        writePackage(root, { name: 'demo', scripts: value });

        expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);
        expect(() => resolveDevProcessPlan(root)).toThrow(/scripts object/);
      }),
  );

  it('rejects a scripts value of null with an actionable message', () =>
    withTempDirectory((root) => {
      writePackage(root, { name: 'demo', scripts: null });

      expect(() => resolveDevProcessPlan(root)).toThrow(
        'package.json must define a scripts object.',
      );
    }));

  it('rejects a scripts array with the same error category as null', () =>
    withTempDirectory((root) => {
      writePackage(root, { name: 'demo', scripts: ['start'] });

      expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);
      expect(() => resolveDevProcessPlan(root)).toThrow(
        'package.json must define a scripts object.',
      );
    }));

  it('distinguishes a missing scripts key from an invalid scripts value', () =>
    withTempDirectory((root) => {
      // Missing key: scripts is undefined — not a scripts-object error per se,
      // but it must still be rejected before any spawn.
      writePackage(root, { name: 'demo' });
      expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);
      expect(() => resolveDevProcessPlan(root)).toThrow(/scripts/i);

      // Null value: structurally different from missing, same error category.
      writePackage(root, { name: 'demo', scripts: null });
      expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);
      expect(() => resolveDevProcessPlan(root)).toThrow(
        'package.json must define a scripts object.',
      );
    }));

  it('rejects all invalid scripts shapes before any child process can start', () =>
    withTempDirectory((root) => {
      const invalidScripts: unknown[] = [
        null,
        true,
        false,
        0,
        'start',
        [],
        ['dev'],
      ];

      for (const scripts of invalidScripts) {
        writePackage(root, { name: 'demo', scripts });

        let spawned = false;
        const fakeSpawn = (): void => {
          spawned = true;
        };

        try {
          resolveDevProcessPlan(root);
          fakeSpawn();
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationCliError);
        }

        expect(spawned).toBe(false);
      }
    }));

  // Positive regression guard — a valid scripts object must still resolve.
  it('still resolves a valid scripts object after the guard was added', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'demo',
        scripts: { dev: 'node src/index.js' },
      });

      const plan = resolveDevProcessPlan(root);

      expect(plan).toHaveLength(1);
      const npm = createNpmInvocation(['run', 'dev']);
      expect(plan[0]).toMatchObject({ command: npm.command, args: npm.args });
    }));
});

// ---------------------------------------------------------------------------
// Section 2 — Non-string selected script *values*
//
// Once the scripts object passes the guard, each candidate key's value is
// checked independently.  Non-string values are **skipped** (not an
// immediate error) so that lower-precedence candidates can still be used.
// Rejection occurs only when every candidate fails selection.
//
// These cases are distinct from "blank or whitespace-only" string values:
// a blank string is a string; a number, boolean, array, object, or null is
// not a string at all.
// ---------------------------------------------------------------------------
describe('dev resolver — non-string individual script values (SW-220)', () => {
  // Matrix of non-string types that must all be skipped.
  const nonStringValues: Array<{ label: string; value: unknown }> = [
    { label: 'null', value: null },
    { label: 'boolean true', value: true },
    { label: 'boolean false', value: false },
    { label: 'number 0', value: 0 },
    { label: 'number 42', value: 42 },
    { label: 'negative number', value: -1 },
    { label: 'float', value: 3.14 },
    { label: 'empty array', value: [] },
    { label: 'array of strings', value: ['node', 'dev.js'] },
    { label: 'plain object', value: { command: 'node dev.js' } },
  ];

  it.each(nonStringValues)(
    'skips a $label dev value and falls through to start when start is valid',
    ({ value }) =>
      withTempDirectory((root) => {
        writePackage(root, {
          name: 'demo',
          scripts: { dev: value, start: 'node start.js' },
        });

        const plan = resolveDevProcessPlan(root);

        expect(plan).toHaveLength(1);
        const npm = createNpmInvocation(['run', 'start']);
        expect(plan[0]).toMatchObject({ command: npm.command, args: npm.args });
      }),
  );

  it.each(nonStringValues)(
    'skips a $label start value and falls through to start:backend',
    ({ value }) =>
      withTempDirectory((root) => {
        writePackage(root, {
          name: 'demo',
          scripts: {
            dev: null,
            start: value,
            'start:backend': 'node backend.js',
          },
        });

        const plan = resolveDevProcessPlan(root);

        expect(plan).toHaveLength(1);
        const npm = createNpmInvocation(['run', 'start:backend']);
        expect(plan[0]).toMatchObject({ command: npm.command, args: npm.args });
      }),
  );

  it.each(nonStringValues)(
    'rejects all candidates when every script value is $label',
    ({ value }) =>
      withTempDirectory((root) => {
        writePackage(root, {
          name: 'demo',
          scripts: {
            dev: value,
            start: value,
            'start:backend': value,
          },
        });

        expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);
        expect(() => resolveDevProcessPlan(root)).toThrow(
          'No supported development script',
        );
      }),
  );

  it('rejects all three candidates when each has a different non-string type', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'demo',
        scripts: {
          dev: 42,
          start: ['node', 'start.js'],
          'start:backend': { command: 'node backend.js' },
        },
      });

      expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);
      expect(() => resolveDevProcessPlan(root)).toThrow(
        /No supported development script/,
      );
    }));

  it('distinguishes non-string values from blank string values in error reporting', () =>
    withTempDirectory((root) => {
      // Blank strings → specific guidance mentioning "non-blank value".
      writePackage(root, {
        name: 'demo',
        scripts: { dev: '', start: '   ', 'start:backend': '\n' },
      });
      expect(() => resolveDevProcessPlan(root)).toThrow(
        /non-blank value.*dev, start, start:backend/,
      );

      // Non-string values → same final error category (ValidationCliError /
      // "No supported development script") but reached via the skip path.
      writePackage(root, {
        name: 'demo',
        scripts: { dev: 42, start: null, 'start:backend': [] },
      });
      expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);
      expect(() => resolveDevProcessPlan(root)).toThrow(
        'No supported development script',
      );
    }));

  it('never includes non-string script text in the npm argv when a later candidate is valid', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'demo',
        scripts: {
          dev: ['node', 'dev.js'],
          start: 'node start.js',
        },
      });

      const [spec] = resolveDevProcessPlan(root);

      // The array value must never appear in args.
      expect(spec?.args).not.toContain('node');
      expect(spec?.args).not.toContain('dev.js');

      const npm = createNpmInvocation(['run', 'start']);
      expect(spec).toMatchObject({ command: npm.command, args: npm.args });
    }));

  it('rejects before process-plan creation when all values are non-string', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'demo',
        scripts: { dev: 0, start: false, 'start:backend': null },
      });

      let planCreated = false;

      try {
        const plan = resolveDevProcessPlan(root);
        planCreated = plan.length > 0;
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationCliError);
      }

      expect(planCreated).toBe(false);
    }));

  // Positive regression guard — valid string values must resolve unchanged.
  it('resolves valid string script values unchanged after the skip logic', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'my-app',
        scripts: {
          dev: 'node src/index.ts',
          start: 'node dist/index.js',
          'start:backend': 'node backend/index.js',
        },
      });

      const plan = resolveDevProcessPlan(root);

      expect(plan).toHaveLength(1);
      // dev wins the precedence race.
      const npm = createNpmInvocation(['run', 'dev']);
      expect(plan[0]).toMatchObject({
        label: 'my-app',
        command: npm.command,
        args: npm.args,
      });
    }));
});

// ---------------------------------------------------------------------------
// Section 3 — Interaction between malformed shapes and precedence
//
// Verifies that the skip/reject distinction is consistent when malformed
// shapes appear in combination with valid candidates at different positions.
// ---------------------------------------------------------------------------
describe('dev resolver — malformed-shape and precedence interaction (SW-220)', () => {
  it('skips a null dev and selects start when start:backend is also non-string', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'demo',
        scripts: {
          dev: null,
          start: 'node start.js',
          'start:backend': 42,
        },
      });

      const [spec] = resolveDevProcessPlan(root);

      const npm = createNpmInvocation(['run', 'start']);
      expect(spec).toMatchObject({ command: npm.command, args: npm.args });
    }));

  it('skips null dev and array start to select start:backend', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'demo',
        scripts: {
          dev: null,
          start: ['node', 'start.js'],
          'start:backend': 'node backend.js',
        },
      });

      const [spec] = resolveDevProcessPlan(root);

      const npm = createNpmInvocation(['run', 'start:backend']);
      expect(spec).toMatchObject({ command: npm.command, args: npm.args });
    }));

  it('rejects when dev is a number, start is an object, and start:backend is an array', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'demo',
        scripts: {
          dev: 1,
          start: { cmd: 'node start.js' },
          'start:backend': ['node', 'backend.js'],
        },
      });

      expect(() => resolveDevProcessPlan(root)).toThrow(ValidationCliError);
      expect(() => resolveDevProcessPlan(root)).toThrow(
        /No supported development script/,
      );
    }));

  it('still prefers a valid dev over a valid start when both are present alongside non-string others', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'demo',
        scripts: {
          dev: 'node dev.js',
          start: 'node start.js',
          'start:backend': null,
        },
      });

      const [spec] = resolveDevProcessPlan(root);

      const npm = createNpmInvocation(['run', 'dev']);
      expect(spec).toMatchObject({ command: npm.command, args: npm.args });
    }));

  it('errors are actionable: message names the missing candidates and points to package.json', () =>
    withTempDirectory((root) => {
      writePackage(root, {
        name: 'demo',
        scripts: {
          dev: 0,
          start: false,
          'start:backend': [],
        },
      });

      expect(() => resolveDevProcessPlan(root)).toThrow(
        /No supported development script/,
      );
      expect(() => resolveDevProcessPlan(root)).toThrow(
        /dev, start, start:backend/,
      );
      expect(() => resolveDevProcessPlan(root)).toThrow(/package\.json/);
    }));
});
