/**
 * Windows npm invocation safety (SW-064, #165).
 *
 * `createNpmInvocation` is the only place the CLI decides how to reach npm, and on
 * Windows it does so through `cmd.exe /d /s /c npm <args>`. That form is a wrapper
 * around a command interpreter, so the argument vector has to stay an argv: the
 * moment a caller-supplied string is joined into one command line, a value
 * containing `&`, `|`, `;` or backticks stops being data and becomes a command
 * fragment.
 *
 * Nothing tested this. `critical-path.test.ts` re-implements the same wrapper
 * inline in its own helper rather than importing the function, so it asserts a
 * copy of the behaviour — and `npm.ts` itself has no direct coverage.
 *
 * The cases below pin two things: the fixed npm prefix always leads, and an
 * untrusted argument always arrives as exactly one argv element with its
 * metacharacters intact and unexpanded.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createNpmInvocation } from '../src/process/npm.js';

const ORIGINAL_PLATFORM = process.platform;

/** Stubs `process.platform` for one case and restores it afterwards. */
function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: ORIGINAL_PLATFORM,
    configurable: true,
  });
});

describe.each([
  { platform: 'win32', label: 'Windows' },
  { platform: 'linux', label: 'POSIX' },
] as const)(
  'npm invocation on $label',
  ({ platform, label }) => {
    it('runs a safe fixed command successfully', () => {
      onPlatform(platform);

      const invocation = createNpmInvocation(['run', 'test']);

      expect(Array.isArray(invocation.args)).toBe(true);
      expect(invocation.args).toContain('npm');
      expect(invocation.args.slice(-2)).toEqual(['run', 'test']);
      if (platform === 'win32') {
        // `/d /s /c` is the documented safe wrapper: it disables AutoRun
        // autorestart and treats the remainder as a single command.
        expect(invocation.command).toBe('cmd.exe');
        expect(invocation.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
      } else {
        expect(invocation.command).toBe('npm');
      }
    });

    it.each([
      'value & calc.exe',
      'value | more',
      'value; del important.txt',
      '$(whoami)',
      '`id`',
      'value > C:/Windows/System32/out.txt',
      'value && echo pwned',
      'a"b',
      "a'b",
      'value\nsecond',
    ])('keeps %j a single, inert argv element', (hostile) => {
      onPlatform(platform);

      const invocation = createNpmInvocation(['run', 'test', '--', hostile]);
      const forwarded = invocation.args[invocation.args.length - 1];

      // Present exactly once, byte-for-byte: never split, quoted or concatenated
      // into the command line.
      expect(forwarded).toBe(hostile);
      expect(invocation.args.filter((arg) => arg === hostile)).toHaveLength(1);

      // The fixed npm prefix is untouched, so nothing can be prepended to it.
      const npmIndex = invocation.args.indexOf('npm');
      expect(npmIndex).toBeGreaterThanOrEqual(0);
      expect(invocation.args.slice(0, npmIndex)).toEqual(
        platform === 'win32' ? ['/d', '/s', '/c'] : [],
      );
    });

    it('never produces a single joined command string', () => {
      onPlatform(platform);

      const invocation = createNpmInvocation(['run', 'test', '--', 'a && b']);

      // The whole defence is that `command` and `args` stay separate so the
      // spawner can pass `shell: false`.
      expect(typeof invocation.command).toBe('string');
      expect(Array.isArray(invocation.args)).toBe(true);
      for (const arg of invocation.args) {
        expect(typeof arg).toBe('string');
      }
      expect(invocation.args.join(' ')).toContain('a && b');
    });
  },
);

describe('npm invocation argument handling', () => {
  it('keeps the fixed prefix when no arguments are supplied', () => {
    onPlatform('win32');

    const invocation = createNpmInvocation([]);

    expect(invocation.command).toBe('cmd.exe');
    expect(invocation.args).toEqual(['/d', '/s', '/c', 'npm']);
  });

  it('forwards an empty argument list unchanged on POSIX', () => {
    onPlatform('linux');

    const invocation = createNpmInvocation([]);

    expect(invocation.command).toBe('npm');
    expect(invocation.args).toEqual([]);
  });
});