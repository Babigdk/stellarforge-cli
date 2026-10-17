import { afterEach, describe, expect, it } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import { validateProjectInput } from '../src/generator/validation.js';

const RESERVED_MESSAGE = 'reserved Windows device name';
const TRAILING_MESSAGE = 'must not end with a dot or space';

const DEVICE_NAMES = [
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
] as const;

function alternatingCase(value: string): string {
  return [...value]
    .map((character, index) =>
      index % 2 === 0 ? character.toLowerCase() : character.toUpperCase(),
    )
    .join('');
}

function casings(name: string): readonly string[] {
  return [name, name.toLowerCase(), alternatingCase(name)];
}

function validate(projectName: string): string {
  return validateProjectInput({ projectName, cwd: '/workspace' }).projectName;
}

function expectRejected(projectName: string, message: RegExp | string): void {
  expect(() => validate(projectName)).toThrow(ValidationCliError);
  expect(() => validate(projectName)).toThrow(message);
}

const BARE_AND_EXTENSION_VARIANTS = DEVICE_NAMES.flatMap((name) =>
  casings(name).flatMap((cased) => [
    cased,
    `${cased}.txt`,
    `${cased}.tar.gz`,
    `${cased}.a.b.c`,
  ]),
);

const TRAILING_DOT_VARIANTS = DEVICE_NAMES.flatMap((name) =>
  casings(name).flatMap((cased) => [`${cased}.`, `${cased}.txt.`]),
);

const TRAILING_SPACE_VARIANTS = DEVICE_NAMES.flatMap((name) =>
  casings(name).flatMap((cased) => [`${cased} `, `${cased}   `, `${cased}\t`]),
);

const VALID_SIMILAR_NAMES = [
  'console',
  'conn',
  'con-app',
  'con_app',
  'con1',
  'my-con',
  'prnt',
  'printer',
  'auxiliary',
  'aux2',
  'nullable',
  'nul2',
  'com',
  'comm1',
  'com10',
  'com1x',
  'communication',
  'lpt',
  'lpt10',
  'lpt1x',
  'lptx',
  'demo.con',
  'demo.com1',
  'demo-nul',
] as const;

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

afterEach(() => {
  if (originalPlatform !== undefined) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});

describe('Windows reserved device name matrix', () => {
  it('covers every reserved device name family', () => {
    expect(DEVICE_NAMES).toHaveLength(22);
    expect(new Set(DEVICE_NAMES).size).toBe(DEVICE_NAMES.length);
  });

  it.each(BARE_AND_EXTENSION_VARIANTS)(
    'rejects reserved name or reserved name with extension %j',
    (projectName) => {
      expectRejected(projectName, RESERVED_MESSAGE);
    },
  );

  it.each(TRAILING_DOT_VARIANTS)(
    'rejects reserved name with trailing dot %j',
    (projectName) => {
      expectRejected(
        projectName,
        new RegExp(`${RESERVED_MESSAGE}|${TRAILING_MESSAGE}`),
      );
    },
  );

  it.each(TRAILING_SPACE_VARIANTS)(
    'rejects reserved name with trailing whitespace %j',
    (projectName) => {
      expectRejected(projectName, RESERVED_MESSAGE);
    },
  );

  it.each(['CON ', 'nul. ', 'Com1 .', 'LPT9.txt .'])(
    'rejects mixed trailing dot and space variant %j',
    (projectName) => {
      expect(() => validate(projectName)).toThrow(ValidationCliError);
    },
  );

  it.each(['CON .txt', 'AUX .log', 'com1 .x'])(
    'rejects reserved name with an internal space %j',
    (projectName) => {
      expect(() => validate(projectName)).toThrow(ValidationCliError);
    },
  );

  it.each(VALID_SIMILAR_NAMES)(
    'keeps similar but valid name %j accepted',
    (projectName) => {
      expect(validate(projectName)).toBe(projectName);
    },
  );

  it.each(VALID_SIMILAR_NAMES.map((name) => name.toUpperCase()))(
    'keeps upper-case similar but valid name %j accepted',
    (projectName) => {
      expect(validate(projectName)).toBe(projectName);
    },
  );

  it.each(['win32', 'linux', 'darwin'] as const)(
    'asserts the same behavior when the host platform is %s',
    (platform) => {
      stubPlatform(platform);

      for (const projectName of [
        'CON',
        'nul.txt',
        'Com9',
        'lpt1.log',
        'AUX.',
        'prn ',
      ]) {
        expect(() => validate(projectName)).toThrow(ValidationCliError);
      }

      for (const projectName of ['console', 'com10', 'lpt10', 'demo-app']) {
        expect(validate(projectName)).toBe(projectName);
      }
    },
  );
});
