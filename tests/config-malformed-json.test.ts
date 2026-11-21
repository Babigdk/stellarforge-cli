import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
} from '../src/config/project.js';
import { ValidationCliError } from '../src/errors/index.js';
import { withTempDirectory } from './helpers/index.js';

const INVALID_JSON_MESSAGE = 'stellarforge.config.json is not valid JSON.';

const malformedJson = [
  '{',
  '{"version": 1',
  '{"version": 1,}',
  '{"version": 1 "network": "testnet"}',
  '{"version": 1,,}',
  'not json at all',
  '',
  '   ',
  '<xml/>',
  '{"version": 1}\n{',
  '[1, 2, 3',
];

const sentinelContents = [
  '{"secret": "SENTINEL-JSON"',
  '{SENTINEL-JSON',
  '[SENTINEL-JSON',
];

describe('configuration malformed-JSON handling', () => {
  it.each(malformedJson)(
    'rejects malformed JSON content %j with a stable message',
    (content) =>
      withTempDirectory((root) => {
        writeFileSync(join(root, PROJECT_CONFIG_FILENAME), content);

        expect(() => loadProjectConfig(root)).toThrow(INVALID_JSON_MESSAGE);
        expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);
      }),
  );

  it('produces the same position-independent message for every malformed input', () =>
    withTempDirectory((root) => {
      const messages = malformedJson.map((content) => {
        writeFileSync(join(root, PROJECT_CONFIG_FILENAME), content);

        try {
          loadProjectConfig(root);
          return 'NO-ERROR';
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationCliError);
          return (error as Error).message;
        }
      });

      expect(new Set(messages).size).toBe(1);
      expect(messages[0]).toBe(INVALID_JSON_MESSAGE);
    }));

  it('does not echo raw malformed content or parser positions', () =>
    withTempDirectory((root) => {
      for (const content of sentinelContents) {
        writeFileSync(join(root, PROJECT_CONFIG_FILENAME), content);

        try {
          loadProjectConfig(root);
          throw new Error('Expected malformed JSON to fail.');
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationCliError);

          const message = (error as Error).message;
          expect(message).not.toContain('SENTINEL-JSON');
          expect(message).not.toMatch(/\bposition\b/i);
          expect(message).not.toMatch(/\bline\b/i);
          expect(message).not.toMatch(/\bcolumn\b/i);
        }
      }
    }));

  it.each(['null', '[]', '"text"', '1', 'true'])(
    'rejects valid JSON that is not an object: %j',
    (content) =>
      withTempDirectory((root) => {
        writeFileSync(join(root, PROJECT_CONFIG_FILENAME), content);

        expect(() => loadProjectConfig(root)).toThrow(
          'must contain a JSON object',
        );
      }),
  );

  it('still loads a valid configuration file', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, network: 'testnet' }),
      );

      expect(loadProjectConfig(root)).toEqual({
        version: 1,
        network: 'testnet',
      });
    }));
});

describe('configuration duplicate-key rejection (SW-216)', () => {
  it.each([
    ['version', '{"version": 1, "version": 1, "network": "testnet"}'],
    [
      'network',
      '{"version": 1, "network": "testnet", "identity": "deployer", "network": "futurenet"}',
    ],
    [
      'identity',
      '{"version": 1, "identity": "deployer", "deployer2": "x", "identity": "other"}',
    ],
  ] as const)('rejects a duplicate top-level %s key', (_key, content) =>
    withTempDirectory((root) => {
      writeFileSync(join(root, PROJECT_CONFIG_FILENAME), content);

      expect(() => loadProjectConfig(root)).toThrow(/duplicate key/);
      expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);
    }),
  );

  it('rejects duplicates even when both values are identical', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        '{"version": 1, "version": 1, "network": "testnet"}',
      );

      expect(() => loadProjectConfig(root)).toThrow('duplicate key "version"');
    }));

  it('rejects escape-equivalent duplicate keys', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        '{"version": 1, "network": "testnet", "networ\\u006b": "mainnet"}',
      );

      expect(() => loadProjectConfig(root)).toThrow('duplicate key "network"');
    }));

  it('rejects duplicate keys at deeper nesting levels', () =>
    withTempDirectory((root) => {
      const docs = [
        '{"version": 1, "extra": {"a": 1, "a": 2}}',
        '{"version": 1, "extra": [{"a": 1, "a": 2}]}',
        '{"version": 1, "a": {"b": {"c": 1}, "b": {"d": 2}}}',
      ];

      for (const content of docs) {
        writeFileSync(join(root, PROJECT_CONFIG_FILENAME), content);

        expect(() => loadProjectConfig(root)).toThrow('duplicate key');
        expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);
      }
    }));

  it('identifies the duplicate key without echoing any value', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        '{"version": 1, "password": "SENTINEL-DUP-VALUE-xyz-123", "password": "testnet", "network": "testnet"}',
      );

      expect(() => loadProjectConfig(root)).toThrow('duplicate key "password"');
      expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);

      try {
        loadProjectConfig(root);
        throw new Error('expected duplicate key error');
      } catch (error) {
        expect((error as Error).message).not.toContain('SENTINEL-DUP-VALUE');
      }
    }));

  it('stops at the first duplicate error regardless of document ordering', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        '{"b": 1, "a": 1, "a": 2, "b": 2}',
      );

      expect(() => loadProjectConfig(root)).toThrow('duplicate key "a"');
    }));

  it('bounds the duplicate-key message for pathological keys', () =>
    withTempDirectory((root) => {
      const key = 'k'.repeat(500);
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        `{"version": 1, "${key}": 1, "${key}": 2}`,
      );

      expect(() => loadProjectConfig(root)).toThrow('duplicate key');

      try {
        loadProjectConfig(root);
        throw new Error('expected duplicate key error');
      } catch (error) {
        expect((error as Error).message.length).toBeLessThan(200);
      }
    }));

  it('still loads a valid configuration file after the duplicate-key rule was added', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({
          version: 1,
          network: 'testnet',
          identity: 'deployer',
        }),
      );

      expect(loadProjectConfig(root)).toEqual({
        version: 1,
        network: 'testnet',
        identity: 'deployer',
      });
    }));
});
describe('invalid UTF-8 bytes in the project configuration (SW-218)', () => {
  const INVALID_UTF8_MESSAGE = 'stellarforge.config.json is not valid UTF-8.';

  it.each([
    { name: 'stray continuation byte', bytes: [0x80] },
    { name: 'lone 0xFF lead byte', bytes: [0xff] },
    {
      name: 'invalid byte inside an ASCII string',
      bytes: [
        0x7b, 0x22, 0x76, 0x22, 0x3a, 0x22, 0x74, 0x65, 0x80, 0x73, 0x74, 0x22,
        0x7d,
      ],
    },
    {
      name: 'truncated 3-byte sequence',
      bytes: [0x7b, 0x22, 0x76, 0x22, 0x3a, 0x20, 0x22, 0xe2, 0x82],
    },
    {
      name: 'truncated 2-byte sequence',
      bytes: [0x7b, 0x22, 0x76, 0x22, 0x3a, 0x20, 0xc3],
    },
    {
      name: 'overlong encoding',
      bytes: [0x7b, 0x22, 0x76, 0x22, 0x3a, 0x20, 0xc0, 0xaf],
    },
    {
      name: 'encoded surrogate',
      bytes: [0x7b, 0x22, 0x76, 0x22, 0x3a, 0x20, 0xed, 0xa0, 0x80],
    },
    {
      name: 'stray continuation among ASCII',
      bytes: [0x7b, 0x22, 0x41, 0x80, 0x42, 0x22, 0x7d],
    },
  ])('rejects %s before JSON parsing', ({ bytes }) =>
    withTempDirectory((root) => {
      writeFileSync(join(root, PROJECT_CONFIG_FILENAME), Buffer.from(bytes));

      expect(() => loadProjectConfig(root)).toThrow(INVALID_UTF8_MESSAGE);
      expect(() => loadProjectConfig(root)).toThrow(ValidationCliError);
    }),
  );

  it('keeps the malformed-JSON message stable for UTF-8-valid content', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        Buffer.from([0x7b, 0x22, 0x76, 0x22, 0x3a, 0x20, 0x22, 0x36, 0x22]), // {"v": "6" (truncated)
      );

      expect(() => loadProjectConfig(root)).toThrow(
        'stellarforge.config.json is not valid JSON.',
      );
    }));

  it('accepts UTF-8-encoded non-ASCII text that reaches the schema layer', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        Buffer.from('{"version": 1, "extra": "héllo wörld"}'),
      );

      // The schema rejects the unsupported field, proving valid UTF-8 got
      // past decoding and reached validation rather than failing at it.
      expect(() => loadProjectConfig(root)).toThrow('unsupported field');
      expect(() => loadProjectConfig(root)).not.toThrow(INVALID_UTF8_MESSAGE);
    }));

  it('never echoes the invalid bytes or the file content', () =>
    withTempDirectory((root) => {
      const sentinel = 'SENTINEL-UTF8-DO_NOT_REFLECT-0xFF';
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        Buffer.from(`{"version": 1, "secret": "${sentinel}"`, 'utf8'),
      );
      const bytes = readFileSync(join(root, PROJECT_CONFIG_FILENAME));
      bytes[12] = 0xff;
      writeFileSync(join(root, PROJECT_CONFIG_FILENAME), bytes);

      try {
        loadProjectConfig(root);
        throw new Error('expected invalid UTF-8 to fail');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain('SENTINEL-UTF8');
        expect(message).not.toContain('ff');
        expect(message).not.toMatch(/\bposition\b|\bline\b|\bcolumn\b/i);
      }
    }));
});
describe('UTF-8 BOM handling in the project configuration (SW-217)', () => {
  it('accepts a configuration with exactly one leading BOM', () =>
    withTempDirectory((root) => {
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        Buffer.concat([
          bom,
          Buffer.from(
            JSON.stringify({
              version: 1,
              network: 'testnet',
              identity: 'deployer',
            }),
            'utf8',
          ),
        ]),
      );

      expect(loadProjectConfig(root)).toEqual({
        version: 1,
        network: 'testnet',
        identity: 'deployer',
      });
    }));

  it('keeps a non-BOM configuration unchanged', () =>
    withTempDirectory((root) => {
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ version: 1, network: 'testnet' }),
      );

      expect(loadProjectConfig(root)).toEqual({
        version: 1,
        network: 'testnet',
      });
    }));

  it('does not corrupt a BOM-prefixed malformed document', () =>
    withTempDirectory((root) => {
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        Buffer.concat([bom, Buffer.from('{"version": 1,', 'utf8')]),
      );

      expect(() => loadProjectConfig(root)).toThrow(
        'stellarforge.config.json is not valid JSON.',
      );
    }));

  it('rejects two leading BOMs with the stable malformed-JSON error', () =>
    withTempDirectory((root) => {
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      writeFileSync(
        join(root, PROJECT_CONFIG_FILENAME),
        Buffer.concat([
          bom,
          bom,
          Buffer.from(
            JSON.stringify({ version: 1, network: 'testnet' }),
            'utf8',
          ),
        ]),
      );

      expect(() => loadProjectConfig(root)).toThrow(
        'stellarforge.config.json is not valid JSON.',
      );
    }));
});
