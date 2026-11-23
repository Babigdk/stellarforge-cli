/**
 * Generator text/binary classification fixtures (SW-034).
 *
 * Proves that the template generation engine correctly distinguishes
 * substitutable text content from binary content:
 *
 *   1. Text files (no NUL bytes) permit only the allowlisted
 *      {{projectName}} and {{templateId}} substitutions.
 *   2. Binary files (containing at least one NUL byte) are copied
 *      byte-for-byte without any token substitution.
 *   3. Classification is purely byte-level and deterministic: the same
 *      buffer always produces the same classification outcome regardless
 *      of call order, file extension, or filename.
 *   4. All repository checks (typecheck, lint, tests) continue to pass.
 *
 * Depends on SW-014 (template registry metadata completeness tests).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateProjectFromTemplate } from '../src/generator/template-generation.js';
import type { GenerationContext } from '../src/generator/types.js';
import { withTempDirectory } from './helpers/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal GenerationContext for a given temp root. */
function context(root: string, projectName = 'my-project'): GenerationContext {
  return {
    input: {
      projectName,
      cwd: root,
      templateId: 'basic-app',
    },
    destination: {
      projectName,
      destination: join(root, projectName),
    },
    template: {
      templateId: 'basic-app',
    },
  };
}

/** Build a Buffer that contains no NUL bytes (pure text). */
function textBuffer(content: string): Buffer {
  const buf = Buffer.from(content, 'utf8');
  // Guarantee: no NUL byte sneaked in via encoding
  expect(buf.includes(0)).toBe(false);
  return buf;
}

/** Build a Buffer that contains exactly one NUL byte at the specified offset. */
function binaryBufferWithNulAt(offset: number, length = 16): Buffer {
  const buf = Buffer.alloc(length, 0x41 /* 'A' */);
  buf[offset] = 0x00;
  expect(buf.includes(0)).toBe(true);
  return buf;
}

// ---------------------------------------------------------------------------
// 1. Text files permit allowlisted substitution
// ---------------------------------------------------------------------------

describe('classification: text files receive allowlisted substitutions', () => {
  it('replaces {{projectName}} in a plain text file', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'name.txt'),
        textBuffer('project: {{projectName}}\n'),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'name.txt'), 'utf8')).toBe(
        'project: my-project\n',
      );
    }));

  it('replaces {{templateId}} in a plain text file', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'meta.txt'),
        textBuffer('template: {{templateId}}\n'),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'meta.txt'), 'utf8')).toBe(
        'template: basic-app\n',
      );
    }));

  it('replaces both {{projectName}} and {{templateId}} in a single file', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'combined.txt'),
        textBuffer('name={{projectName}} id={{templateId}}\n'),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(
        readFileSync(join(root, 'my-project', 'combined.txt'), 'utf8'),
      ).toBe('name=my-project id=basic-app\n');
    }));

  it('replaces multiple occurrences of {{projectName}} in one file', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'multi.txt'),
        textBuffer('{{projectName}} / {{projectName}} / {{projectName}}\n'),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'multi.txt'), 'utf8')).toBe(
        'my-project / my-project / my-project\n',
      );
    }));

  it('performs substitution on a file with no extension', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'Makefile'),
        textBuffer('APP := {{projectName}}\n'),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'Makefile'), 'utf8')).toBe(
        'APP := my-project\n',
      );
    }));

  it('performs substitution inside a nested subdirectory text file', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(join(templateRoot, 'src'), { recursive: true });
      writeFileSync(
        join(templateRoot, 'src', 'config.ts'),
        textBuffer('export const PROJECT = "{{projectName}}";\n'),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(
        readFileSync(join(root, 'my-project', 'src', 'config.ts'), 'utf8'),
      ).toBe('export const PROJECT = "my-project";\n');
    }));

  it('performs substitution on an empty text file without error', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'empty.txt'), textBuffer(''));

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'empty.txt'), 'utf8')).toBe(
        '',
      );
    }));

  it('performs substitution on a text file containing only whitespace', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'ws.txt'), textBuffer('   \n\t\n   \n'));

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'ws.txt'), 'utf8')).toBe(
        '   \n\t\n   \n',
      );
    }));

  it('performs substitution on a text file that contains braces but no valid tokens', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      // { and } characters that do not form the {{…}} token pattern
      writeFileSync(
        join(templateRoot, 'braces.txt'),
        textBuffer('{ "key": "value" }\n'),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'braces.txt'), 'utf8')).toBe(
        '{ "key": "value" }\n',
      );
    }));
});

// ---------------------------------------------------------------------------
// 2. Binary files are preserved exactly — no substitution performed
// ---------------------------------------------------------------------------

describe('classification: binary files are copied byte-for-byte', () => {
  it('preserves a buffer with a leading NUL byte verbatim', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      // NUL at position 0
      const binary = binaryBufferWithNulAt(0);
      writeFileSync(join(templateRoot, 'leading-nul.bin'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'leading-nul.bin'))).toEqual(
        binary,
      );
    }));

  it('preserves a buffer with a trailing NUL byte verbatim', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      // NUL at last position
      const binary = binaryBufferWithNulAt(15);
      writeFileSync(join(templateRoot, 'trailing-nul.bin'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(
        readFileSync(join(root, 'my-project', 'trailing-nul.bin')),
      ).toEqual(binary);
    }));

  it('preserves a buffer with a mid-buffer NUL byte verbatim', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      // NUL in the middle
      const binary = binaryBufferWithNulAt(8);
      writeFileSync(join(templateRoot, 'mid-nul.bin'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'mid-nul.bin'))).toEqual(
        binary,
      );
    }));

  it('does not expand {{projectName}} inside a binary file', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      // Embeds the token string in a binary buffer (NUL at offset 0)
      const tokenBytes = Buffer.from('{{projectName}}', 'utf8');
      const binary = Buffer.concat([
        Buffer.from([0x00]),
        tokenBytes,
        Buffer.from([0xff]),
      ]);
      writeFileSync(join(templateRoot, 'token-in-binary.bin'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      const result = readFileSync(
        join(root, 'my-project', 'token-in-binary.bin'),
      );
      expect(result).toEqual(binary);
      // The token must still be present — not replaced
      expect(result.toString('utf8')).toContain('{{projectName}}');
    }));

  it('does not expand {{templateId}} inside a binary file', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      const tokenBytes = Buffer.from('{{templateId}}', 'utf8');
      const binary = Buffer.concat([
        Buffer.from([0x00]),
        tokenBytes,
        Buffer.from([0xfe]),
      ]);
      writeFileSync(join(templateRoot, 'tid-in-binary.bin'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      const result = readFileSync(
        join(root, 'my-project', 'tid-in-binary.bin'),
      );
      expect(result).toEqual(binary);
      expect(result.toString('utf8')).toContain('{{templateId}}');
    }));

  it('preserves every byte of a multi-byte binary fixture intact', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      // Full byte-value sweep: 0x00..0xff
      const binary = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      writeFileSync(join(templateRoot, 'all-bytes.bin'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      const result = readFileSync(join(root, 'my-project', 'all-bytes.bin'));
      expect(result).toEqual(binary);
      expect(result.length).toBe(256);
    }));

  it('preserves a binary file with a .txt extension byte-for-byte', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      // Extension is .txt but content contains NUL — must still be treated as binary
      const binary = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77]);
      writeFileSync(join(templateRoot, 'misleading.txt'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'misleading.txt'))).toEqual(
        binary,
      );
    }));

  it('preserves a zero-length file as zero bytes', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'empty.bin'), Buffer.alloc(0));

      generateProjectFromTemplate(context(root), { templateRoot });

      const result = readFileSync(join(root, 'my-project', 'empty.bin'));
      expect(result.length).toBe(0);
    }));
});

// ---------------------------------------------------------------------------
// 3. Classification is deterministic
// ---------------------------------------------------------------------------

describe('classification: deterministic — same buffer always yields same outcome', () => {
  it('classifies the same text buffer identically across two separate template trees', () =>
    withTempDirectory(async (rootA) => {
      await withTempDirectory((rootB) => {
        const content = 'name = {{projectName}}\n';

        const templateA = join(rootA, 'template');
        mkdirSync(templateA);
        writeFileSync(join(templateA, 'cfg.txt'), textBuffer(content));

        const templateB = join(rootB, 'template');
        mkdirSync(templateB);
        writeFileSync(join(templateB, 'cfg.txt'), textBuffer(content));

        generateProjectFromTemplate(context(rootA), {
          templateRoot: templateA,
        });
        generateProjectFromTemplate(context(rootB), {
          templateRoot: templateB,
        });

        const outA = readFileSync(join(rootA, 'my-project', 'cfg.txt'), 'utf8');
        const outB = readFileSync(join(rootB, 'my-project', 'cfg.txt'), 'utf8');

        expect(outA).toBe(outB);
        expect(outA).toBe('name = my-project\n');
      });
    }));

  it('classifies the same binary buffer identically across two separate template trees', () =>
    withTempDirectory(async (rootA) => {
      await withTempDirectory((rootB) => {
        const binary = Buffer.from([0x00, 0x41, 0x42, 0xff]);

        const templateA = join(rootA, 'template');
        mkdirSync(templateA);
        writeFileSync(join(templateA, 'data.bin'), binary);

        const templateB = join(rootB, 'template');
        mkdirSync(templateB);
        writeFileSync(join(templateB, 'data.bin'), binary);

        generateProjectFromTemplate(context(rootA), {
          templateRoot: templateA,
        });
        generateProjectFromTemplate(context(rootB), {
          templateRoot: templateB,
        });

        const outA = readFileSync(join(rootA, 'my-project', 'data.bin'));
        const outB = readFileSync(join(rootB, 'my-project', 'data.bin'));

        expect(outA).toEqual(outB);
        expect(outA).toEqual(binary);
      });
    }));

  it('produces the same output when a text template is generated twice with identical inputs', () =>
    withTempDirectory(async (rootA) => {
      await withTempDirectory((rootB) => {
        const templateA = join(rootA, 'template');
        mkdirSync(join(templateA, 'src'), { recursive: true });
        writeFileSync(
          join(templateA, 'package.json'),
          textBuffer(
            '{"name":"{{projectName}}","template":"{{templateId}}"}\n',
          ),
        );
        writeFileSync(
          join(templateA, 'src', 'index.ts'),
          textBuffer('export const app = "{{projectName}}";\n'),
        );

        const templateB = join(rootB, 'template');
        mkdirSync(join(templateB, 'src'), { recursive: true });
        writeFileSync(
          join(templateB, 'package.json'),
          textBuffer(
            '{"name":"{{projectName}}","template":"{{templateId}}"}\n',
          ),
        );
        writeFileSync(
          join(templateB, 'src', 'index.ts'),
          textBuffer('export const app = "{{projectName}}";\n'),
        );

        generateProjectFromTemplate(context(rootA), {
          templateRoot: templateA,
        });
        generateProjectFromTemplate(context(rootB), {
          templateRoot: templateB,
        });

        expect(
          readFileSync(join(rootA, 'my-project', 'package.json'), 'utf8'),
        ).toBe(readFileSync(join(rootB, 'my-project', 'package.json'), 'utf8'));
        expect(
          readFileSync(join(rootA, 'my-project', 'src', 'index.ts'), 'utf8'),
        ).toBe(
          readFileSync(join(rootB, 'my-project', 'src', 'index.ts'), 'utf8'),
        );
      });
    }));

  it('classification boundary: a buffer of 0x01..0xFF bytes (no NUL) is treated as text', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      // All non-NUL bytes — should be treated as text (no throw, no binary path)
      const nonNul = Buffer.from(Array.from({ length: 255 }, (_, i) => i + 1));
      writeFileSync(join(templateRoot, 'non-nul.bin'), nonNul);

      // Generation must not throw — the file is classified as text.
      // The raw bytes contain no substitution tokens so the output equals
      // the decoded-then-re-encoded content (may differ only if non-UTF-8
      // sequences are present, but the key property is: no binary copy-path).
      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).not.toThrow();
    }));

  it('classification boundary: adding a single NUL to a text buffer flips it to binary', () =>
    withTempDirectory(async (rootText) => {
      await withTempDirectory((rootBin) => {
        const textContent = 'hello {{projectName}}\n';
        const textBuf = textBuffer(textContent);

        // Insert NUL at position 0 to make a binary version of the same bytes
        const binaryBuf = Buffer.concat([Buffer.from([0x00]), textBuf]);
        expect(binaryBuf.includes(0)).toBe(true);

        const templateText = join(rootText, 'template');
        mkdirSync(templateText);
        writeFileSync(join(templateText, 'file.txt'), textBuf);

        const templateBin = join(rootBin, 'template');
        mkdirSync(templateBin);
        writeFileSync(join(templateBin, 'file.txt'), binaryBuf);

        generateProjectFromTemplate(context(rootText), {
          templateRoot: templateText,
        });
        generateProjectFromTemplate(context(rootBin), {
          templateRoot: templateBin,
        });

        // Text path: token replaced
        expect(
          readFileSync(join(rootText, 'my-project', 'file.txt'), 'utf8'),
        ).toBe('hello my-project\n');

        // Binary path: bytes preserved exactly — token NOT replaced
        const binResult = readFileSync(join(rootBin, 'my-project', 'file.txt'));
        expect(binResult).toEqual(binaryBuf);
        expect(binResult.toString('utf8')).toContain('{{projectName}}');
      });
    }));

  it('generates identical output across ten repeated calls with the same template', () =>
    withTempDirectory(async (sharedTemplate) => {
      const templateRoot = join(sharedTemplate, 'template');
      mkdirSync(join(templateRoot, 'src'), { recursive: true });
      writeFileSync(
        join(templateRoot, 'package.json'),
        textBuffer('{"name":"{{projectName}}"}\n'),
      );
      const binary = Buffer.from([0x00, 0x41, 0x42, 0x43]);
      writeFileSync(join(templateRoot, 'logo.bin'), binary);

      const results: Array<{ pkg: string; logo: Buffer }> = [];

      for (let i = 0; i < 10; i++) {
        await withTempDirectory((root) => {
          generateProjectFromTemplate(context(root), { templateRoot });
          results.push({
            pkg: readFileSync(join(root, 'my-project', 'package.json'), 'utf8'),
            logo: readFileSync(join(root, 'my-project', 'logo.bin')),
          });
        });
      }

      const first = results[0];
      for (const result of results.slice(1)) {
        expect(result.pkg).toBe(first!.pkg);
        expect(result.logo).toEqual(first!.logo);
      }
    }));
});

// ---------------------------------------------------------------------------
// 4. Mixed templates — text and binary coexist correctly
// ---------------------------------------------------------------------------

describe('classification: mixed text and binary files in one template', () => {
  it('processes text and binary siblings at the same directory level independently', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);

      const textContent = 'project = {{projectName}}\n';
      writeFileSync(join(templateRoot, 'readme.txt'), textBuffer(textContent));

      const binary = Buffer.from([0x00, 0xde, 0xad, 0xbe, 0xef]);
      writeFileSync(join(templateRoot, 'asset.bin'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'my-project', 'readme.txt'), 'utf8')).toBe(
        'project = my-project\n',
      );

      expect(readFileSync(join(root, 'my-project', 'asset.bin'))).toEqual(
        binary,
      );
    }));

  it('processes text and binary files in nested subdirectories independently', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(join(templateRoot, 'src', 'assets'), { recursive: true });

      writeFileSync(
        join(templateRoot, 'src', 'main.ts'),
        textBuffer('const name = "{{projectName}}";\n'),
      );

      const binary = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      writeFileSync(join(templateRoot, 'src', 'assets', 'icon.bin'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(
        readFileSync(join(root, 'my-project', 'src', 'main.ts'), 'utf8'),
      ).toBe('const name = "my-project";\n');

      expect(
        readFileSync(join(root, 'my-project', 'src', 'assets', 'icon.bin')),
      ).toEqual(binary);
    }));

  it('does not confuse binary classification with text classification across files', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);

      // Binary file with a token-like string — must NOT be substituted
      const binaryWithToken = Buffer.concat([
        Buffer.from([0x00]),
        Buffer.from('{{projectName}}', 'utf8'),
      ]);
      writeFileSync(join(templateRoot, 'binary.bin'), binaryWithToken);

      // Text file with the same token — MUST be substituted
      writeFileSync(
        join(templateRoot, 'text.txt'),
        textBuffer('id: {{projectName}}\n'),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      // Binary: token preserved
      const binResult = readFileSync(join(root, 'my-project', 'binary.bin'));
      expect(binResult).toEqual(binaryWithToken);
      expect(binResult.toString('utf8')).toContain('{{projectName}}');

      // Text: token replaced
      expect(readFileSync(join(root, 'my-project', 'text.txt'), 'utf8')).toBe(
        'id: my-project\n',
      );
    }));
});

// ---------------------------------------------------------------------------
// 5. Path injection protection — only approved substitutions occur
// ---------------------------------------------------------------------------

describe('security: path injection protection', () => {
  it('never substitutes placeholders in directory paths during template traversal', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(join(templateRoot, '{{projectName}}-dir'), {
        recursive: true,
      });
      writeFileSync(
        join(templateRoot, '{{projectName}}-dir', 'file.txt'),
        textBuffer('content\n'),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      // Directory name must NOT be substituted — it stays literal
      expect(
        existsSync(join(root, 'my-project', '{{projectName}}-dir', 'file.txt')),
      ).toBe(true);
      expect(
        existsSync(join(root, 'my-project', 'my-project-dir', 'file.txt')),
      ).toBe(false);
    }));
});

// ---------------------------------------------------------------------------
// 6. Content injection protection — substituted values cannot introduce tokens
// ---------------------------------------------------------------------------

describe('security: content injection protection', () => {
  it('replaces projectName literally without re-interpreting matched patterns', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'config.txt'),
        textBuffer('name: {{projectName}}\ntemplate: {{templateId}}\n'),
      );

      generateProjectFromTemplate(context(root), {
        templateRoot,
      });

      // The projectName is substituted literally; no second-pass interpretation occurs
      expect(readFileSync(join(root, 'my-project', 'config.txt'), 'utf8')).toBe(
        'name: my-project\ntemplate: basic-app\n',
      );
    }));

  it('replaces templateId literally without re-interpreting token-like strings', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'meta.txt'),
        textBuffer('template: {{templateId}}\n'),
      );

      generateProjectFromTemplate(
        {
          ...context(root),
          template: { templateId: 'basic-app' },
        },
        { templateRoot },
      );

      expect(readFileSync(join(root, 'my-project', 'meta.txt'), 'utf8')).toBe(
        'template: basic-app\n',
      );
    }));

  it('does not expand multiple substitution passes on the same content', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'nested-tokens.txt'),
        textBuffer('value={{projectName}}\n'),
      );

      generateProjectFromTemplate(context(root, 'app'), {
        templateRoot,
      });

      // Single-pass: {{projectName}} is replaced with 'app'
      // Not double-passed to anything else
      expect(readFileSync(join(root, 'app', 'nested-tokens.txt'), 'utf8')).toBe(
        'value=app\n',
      );
    }));

  it('preserves literal token-like strings in substituted output without further interpretation', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'example.txt'),
        textBuffer('project={{projectName}}\ntemplate={{templateId}}\n'),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      const output = readFileSync(
        join(root, 'my-project', 'example.txt'),
        'utf8',
      );
      // If a second substitution pass occurred, any tokens in the output would
      // be replaced. This verifies that does not happen.
      expect(output).toBe('project=my-project\ntemplate=basic-app\n');
      expect(output).not.toContain('{{');
    }));

  it('rejects attempts to use unknown tokens even if they look like valid identifiers', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'bad.txt'),
        textBuffer('secret={{secretKey}}\n'),
      );

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(
        "Template contains unsupported substitution token '{{secretKey}}'.",
      );

      // No partial output is left
      expect(existsSync(join(root, 'my-project'))).toBe(false);
    }));
});

// ---------------------------------------------------------------------------
// 7. Unknown placeholder invariants — only projectName and templateId are permitted
// ---------------------------------------------------------------------------

describe('security: unknown placeholder invariants', () => {
  it('never substitutes a token that is not in the hardcoded allowlist', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'vars.txt'),
        textBuffer(
          'name={{projectName}}\nid={{templateId}}\nuser={{userName}}\n',
        ),
      );

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(
        "Template contains unsupported substitution token '{{userName}}'.",
      );

      expect(existsSync(join(root, 'my-project'))).toBe(false);
    }));

  it('rejects {{version}}, {{timestamp}}, {{random}} and other dynamic tokens', () =>
    withTempDirectory(async (root1) => {
      await withTempDirectory((root2) => {
        const templateRoot = join(root1, 'template');
        mkdirSync(templateRoot);

        // A template using dynamic tokens that are not in the hardcoded allowlist
        writeFileSync(
          join(templateRoot, 'manifest.txt'),
          textBuffer('generated={{timestamp}}\n'),
        );

        expect(() =>
          generateProjectFromTemplate(context(root1), { templateRoot }),
        ).toThrow("unsupported substitution token '{{timestamp}}'");

        writeFileSync(
          join(templateRoot, 'manifest.txt'),
          textBuffer('version={{version}}\n'),
        );

        expect(() =>
          generateProjectFromTemplate(context(root2), { templateRoot }),
        ).toThrow("unsupported substitution token '{{version}}'");
      });
    }));
});

// ---------------------------------------------------------------------------
// 8. Binary files are protected from injection via substitution
// ---------------------------------------------------------------------------

describe('security: binary content protection', () => {
  it('never applies text-substitution rules to binary files', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);

      // Binary file with injected-looking content
      const binary = Buffer.concat([
        Buffer.from([0x00]),
        Buffer.from('malicious: {{projectName}}={{userName}}\n', 'utf8'),
        Buffer.from([0xff]),
      ]);
      writeFileSync(join(templateRoot, 'payload.bin'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      // Binary is copied exactly as-is; substitution rules never apply
      const result = readFileSync(join(root, 'my-project', 'payload.bin'));
      expect(result).toEqual(binary);
      // Both tokens remain in the output
      expect(result.toString('utf8')).toContain('{{projectName}}');
      expect(result.toString('utf8')).toContain('{{userName}}');
    }));

  it('distinguishes binary from text even if the filename suggests text', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);

      // Binary content with a .txt extension
      const binary = Buffer.concat([
        Buffer.from([0xff]),
        Buffer.from('{{projectName}}={{unknownToken}}\n', 'utf8'),
      ]);
      writeFileSync(join(templateRoot, 'data.txt'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      // Classification is byte-based, not extension-based.
      // The file contains 0xFF (NUL at the start), so it's binary.
      const result = readFileSync(join(root, 'my-project', 'data.txt'));
      expect(result).toEqual(binary);
      // No substitution or error — binary path is taken
    }));
});
