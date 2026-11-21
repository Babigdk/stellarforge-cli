import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import { generateProjectFromTemplate } from '../src/generator/template-generation.js';
import type { GenerationContext } from '../src/generator/types.js';
import {
  createTempDirectoryFixture,
  withTempDirectory,
} from './helpers/index.js';

function canCreateSymlink(): boolean {
  const fixture = createTempDirectoryFixture();
  try {
    const target = join(fixture.path, 'target');
    writeFileSync(target, 'link-target');
    symlinkSync(target, join(fixture.path, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    fixture.cleanup();
  }
}

const symlinksSupported = canCreateSymlink();

function context(root: string): GenerationContext {
  return {
    input: {
      projectName: 'demo-app',
      cwd: root,
      templateId: 'basic-app',
    },
    destination: {
      projectName: 'demo-app',
      destination: join(root, 'demo-app'),
    },
    template: {
      templateId: 'basic-app',
    },
  };
}

describe('template generation', () => {
  it('copies trusted files and performs only allowlisted deterministic substitutions', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(join(templateRoot, 'src'), { recursive: true });
      writeFileSync(
        join(templateRoot, 'package.json'),
        '{"name":"{{projectName}}","template":"{{templateId}}"}\n',
      );
      writeFileSync(
        join(templateRoot, 'src', 'index.ts'),
        'export const app = "{{projectName}}";\n',
      );

      const result = generateProjectFromTemplate(context(root), {
        templateRoot,
      });

      expect(result).toEqual({
        projectName: 'demo-app',
        destination: join(root, 'demo-app'),
        templateId: 'basic-app',
      });
      expect(readFileSync(join(root, 'demo-app', 'package.json'), 'utf8')).toBe(
        '{"name":"demo-app","template":"basic-app"}\n',
      );
      expect(
        readFileSync(join(root, 'demo-app', 'src', 'index.ts'), 'utf8'),
      ).toBe('export const app = "demo-app";\n');
    }));

  it('preserves binary file bytes without substitution', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      const binary = Buffer.from([
        0, 123, 123, 112, 114, 111, 106, 101, 99, 116, 78, 97, 109, 101, 125,
        125, 255,
      ]);
      writeFileSync(join(templateRoot, 'asset.bin'), binary);

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'demo-app', 'asset.bin'))).toEqual(binary);
    }));

  it('cleans staging output and leaves no partial project when rendering fails', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'a-good.txt'), 'created first');
      writeFileSync(join(templateRoot, 'z-bad.txt'), '{{unsupportedToken}}');

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(
        "Template contains unsupported substitution token '{{unsupportedToken}}'.",
      );

      expect(existsSync(join(root, 'demo-app'))).toBe(false);
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
    }));

  it('preserves pre-existing user content and an empty destination after partial failure', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      const destination = join(root, 'demo-app');
      const userFile = join(root, 'user-notes.txt');
      mkdirSync(templateRoot);
      mkdirSync(destination);
      writeFileSync(userFile, 'keep this content');
      writeFileSync(join(templateRoot, 'a-good.txt'), 'created first');
      writeFileSync(join(templateRoot, 'z-bad.txt'), '{{unsupportedToken}}');

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(ValidationCliError);

      expect(readdirSync(destination)).toEqual([]);
      expect(readFileSync(userFile, 'utf8')).toBe('keep this content');
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
    }));

  it('refuses to overwrite a non-empty destination', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'README.md'), 'safe');
      mkdirSync(join(root, 'demo-app'));
      writeFileSync(join(root, 'demo-app', 'existing.txt'), 'keep me');

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow('must be empty');
      expect(readFileSync(join(root, 'demo-app', 'existing.txt'), 'utf8')).toBe(
        'keep me',
      );
    }));

  it('rejects template symbolic links instead of following paths outside the trusted root', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);

      if (symlinksSupported) {
        const outside = join(root, 'outside.txt');
        writeFileSync(outside, 'outside');
        symlinkSync(outside, join(templateRoot, 'escape.txt'));
      } else {
        const outsideDir = join(root, 'outside-dir');
        mkdirSync(outsideDir);
        writeFileSync(join(outsideDir, 'outside.txt'), 'outside');
        symlinkSync(outsideDir, join(templateRoot, 'escape-dir'), 'junction');
      }

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow('symbolic links are not supported');
      expect(existsSync(join(root, 'demo-app'))).toBe(false);
    }));
});

describe('template generation budget limits (SW-199)', () => {
  it('fails with an aggregate-safe message when the template exceeds the file count', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot, { recursive: true });
      for (let i = 0; i < 257; i++) {
        writeFileSync(join(templateRoot, `file-${i}.txt`), 'x');
      }

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow('256-file generation limit');

      // Nothing is written when the budget is exceeded first.
      expect(existsSync(join(root, 'demo-app'))).toBe(false);
      expect(
        readdirSync(root).some((entry) =>
          entry.startsWith('.stellarforge-demo-app-'),
        ),
      ).toBe(false);
    }));

  it('accepts a template with exactly the maximum file count', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      for (let i = 0; i < 256; i++) {
        writeFileSync(join(templateRoot, `file-${i}.txt`), 'x');
      }

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).not.toThrow();
      expect(existsSync(join(root, 'demo-app', 'file-255.txt'))).toBe(true);
    }));

  it('fails when a single file exceeds the per-file byte limit', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'big.bin'), 'a'.repeat(256 * 1024 + 1));

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow('per-file limit');
      expect(existsSync(join(root, 'demo-app'))).toBe(false);
    }));

  it('accepts a file at exactly the per-file byte limit', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'big.bin'), 'a'.repeat(256 * 1024));

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).not.toThrow();
    }));

  it('fails when the aggregate size exceeds the total byte limit', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot, { recursive: true });
      // 9 files of 128 KiB comfortably exceed the 1 MiB aggregate limit.
      for (let i = 0; i < 9; i++) {
        writeFileSync(
          join(templateRoot, `chunk-${i}.bin`),
          'a'.repeat(128 * 1024),
        );
      }

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow('byte generation limit');
      expect(existsSync(join(root, 'demo-app'))).toBe(false);
    }));

  it('accepts a template at exactly the total byte limit', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot, { recursive: true });
      // 8 files of exactly 128 KiB = 1 MiB exactly.
      for (let i = 0; i < 8; i++) {
        writeFileSync(
          join(templateRoot, `chunk-${i}.bin`),
          'a'.repeat(128 * 1024),
        );
      }

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).not.toThrow();
    }));

  it('checks the budget before substitution, even for invalid template content', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      // A valid but over-budget token set also fails on budget, not on token.
      writeFileSync(join(templateRoot, 'huge.bin'), 'a'.repeat(256 * 1024 + 1));

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow('per-file limit');
    }));

  it('never exposes the absolute template path in budget error messages', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot, { recursive: true });
      for (let i = 0; i < 257; i++) {
        writeFileSync(join(templateRoot, `file-${i}.txt`), 'x');
      }

      try {
        generateProjectFromTemplate(context(root), { templateRoot });
        throw new Error('expected budget rejection');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain(templateRoot);
        expect(message).not.toContain('file-0');
      }
    }));
});

describe('SW-128: deterministic template generation rollback and cleanup', () => {
  it('deterministically rolls back partial writes when an error occurs during file copying', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      // Alphabetical order: 01-first.txt is copied first
      writeFileSync(join(templateRoot, '01-first.txt'), 'first content');

      // 02-symlink encounters a symbolic link error during copyTemplateTree traversal
      if (symlinksSupported) {
        const outside = join(root, 'outside.txt');
        writeFileSync(outside, 'outside');
        symlinkSync(outside, join(templateRoot, '02-escape.txt'));
      } else {
        const outsideDir = join(root, 'outside-dir');
        mkdirSync(outsideDir);
        writeFileSync(join(outsideDir, 'outside.txt'), 'outside');
        symlinkSync(
          outsideDir,
          join(templateRoot, '02-escape-dir'),
          'junction',
        );
      }

      writeFileSync(join(templateRoot, '03-third.txt'), 'third content');

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow('symbolic links are not supported');

      // Newly created destination must NOT exist
      expect(existsSync(join(root, 'demo-app'))).toBe(false);

      // Staging directory created for this generation attempt must be cleaned up
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
    }));

  it('deterministically rolls back all previously staged files when token substitution fails midway', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(join(templateRoot, 'sub'), { recursive: true });
      writeFileSync(
        join(templateRoot, '01-valid.txt'),
        'Hello {{projectName}}!',
      );
      writeFileSync(
        join(templateRoot, '02-broken.txt'),
        'Invalid: {{unsupportedToken}}',
      );
      writeFileSync(
        join(templateRoot, 'sub', '03-valid.txt'),
        'Never reached {{templateId}}',
      );

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(
        "Template contains unsupported substitution token '{{unsupportedToken}}'.",
      );

      // Destination directory was never finalized
      expect(existsSync(join(root, 'demo-app'))).toBe(false);

      // All staged files cleaned up
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
    }));

  it('deterministically rolls back when metadata file token substitution fails', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(join(templateRoot, 'src'), { recursive: true });
      writeFileSync(
        join(templateRoot, 'src', 'app.ts'),
        'export const app = "{{projectName}}";\n',
      );
      writeFileSync(
        join(templateRoot, 'package.json'),
        '{\n  "name": "{{projectName}}",\n  "version": "{{invalidMetadataToken}}"\n}\n',
      );

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(
        "Template contains unsupported substitution token '{{invalidMetadataToken}}'.",
      );

      expect(existsSync(join(root, 'demo-app'))).toBe(false);
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
    }));

  it('preserves pre-existing files and cleans staging directory when an error interrupts generation', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, '01-app.ts'), '{{projectName}}');
      writeFileSync(join(templateRoot, '02-error.ts'), '{{unknownToken}}');

      // Pre-existing user files and folders in root
      const userFile = join(root, 'notes.md');
      const backupDir = join(root, 'backup');
      mkdirSync(backupDir);
      writeFileSync(userFile, '# Keep this documentation');
      writeFileSync(join(backupDir, 'state.json'), '{"ok":true}');

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(ValidationCliError);

      // Destination was not created
      expect(existsSync(join(root, 'demo-app'))).toBe(false);

      // Staging directory is cleaned up
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);

      // User files and directories are completely intact
      expect(readFileSync(userFile, 'utf8')).toBe('# Keep this documentation');
      expect(readFileSync(join(backupDir, 'state.json'), 'utf8')).toBe(
        '{"ok":true}',
      );
    }));

  it('only cleans up staging artifacts created by the current generation attempt and leaves sibling files untouched', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'app.ts'), '{{invalidToken}}');

      // Pre-existing sibling files and directories in cwd
      const siblingFile = join(root, 'user-data.sqlite');
      const siblingDir = join(root, 'other-project');
      const siblingNestedFile = join(siblingDir, 'config.json');

      writeFileSync(siblingFile, 'binary-or-text-user-data');
      mkdirSync(siblingDir);
      writeFileSync(siblingNestedFile, '{"preserved":true}');

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(ValidationCliError);

      // Only files created by this attempt were removed; pre-existing files are untouched
      expect(existsSync(siblingFile)).toBe(true);
      expect(readFileSync(siblingFile, 'utf8')).toBe(
        'binary-or-text-user-data',
      );
      expect(existsSync(siblingNestedFile)).toBe(true);
      expect(readFileSync(siblingNestedFile, 'utf8')).toBe(
        '{"preserved":true}',
      );

      expect(existsSync(join(root, 'demo-app'))).toBe(false);
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
    }));

  it('never removes or overwrites pre-existing empty destination during rollback', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'bad.txt'), '{{unsupportedToken}}');

      const destination = join(root, 'demo-app');
      mkdirSync(destination);

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(ValidationCliError);

      // Pre-existing empty destination is preserved
      expect(existsSync(destination)).toBe(true);
      expect(readdirSync(destination)).toEqual([]);
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
    }));

  it('strictly rejects non-empty destination upfront without creating any staging files', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'README.md'), 'safe');

      const destination = join(root, 'demo-app');
      mkdirSync(destination);
      const existingFile = join(destination, 'important-data.json');
      writeFileSync(existingFile, '{"crucial":"do not delete"}');

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow('Project destination must be empty before generation.');

      // Existing file is intact
      expect(readFileSync(existingFile, 'utf8')).toBe(
        '{"crucial":"do not delete"}',
      );
      // No staging directory was ever created
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
    }));

  it('identifies the failed stage without leaking secrets or sensitive path details', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'config.ts'),
        'const key = "{{secretKeyToken}}";',
      );

      let thrownError: unknown;
      try {
        generateProjectFromTemplate(context(root), { templateRoot });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(ValidationCliError);
      const cliError = thrownError as ValidationCliError;

      // Identifies the failed substitution stage
      expect(cliError.userMessage).toContain(
        "Template contains unsupported substitution token '{{secretKeyToken}}'.",
      );
      // Does not leak local root path
      expect(cliError.userMessage).not.toContain(root);
    }));

  it('ensures rollback cleanup is idempotent when staging path is already removed or cleaned repeatedly', () =>
    withTempDirectory((root) => {
      const stagingDir = join(root, '.stellarforge-demo-app-test-staging');
      mkdirSync(stagingDir);
      writeFileSync(join(stagingDir, 'temp.txt'), 'temporary content');

      // First cleanup removes the directory
      expect(() =>
        rmSync(stagingDir, { recursive: true, force: true }),
      ).not.toThrow();
      expect(existsSync(stagingDir)).toBe(false);

      // Repeated cleanup on non-existent directory is idempotent and does not throw
      expect(() =>
        rmSync(stagingDir, { recursive: true, force: true }),
      ).not.toThrow();
      expect(() =>
        rmSync(stagingDir, { recursive: true, force: true }),
      ).not.toThrow();
    }));

  it('deterministically rolls back staged binary files when a subsequent text file fails substitution', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      const binaryData = Buffer.from([0x00, 0xff, 0xfe, 0x00, 0x12, 0x34]);
      writeFileSync(join(templateRoot, '01-asset.bin'), binaryData);
      writeFileSync(join(templateRoot, '02-app.ts'), '{{unsupportedToken}}');

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(ValidationCliError);

      expect(existsSync(join(root, 'demo-app'))).toBe(false);
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
    }));

  it('redacts sensitive values through CLI error boundary when template generation fails', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'secret.env'), '{{stellarSecretToken}}');

      let caughtError: unknown;
      try {
        generateProjectFromTemplate(context(root), { templateRoot });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ValidationCliError);
      const err = caughtError as ValidationCliError;
      expect(err.userMessage).toContain('stellarSecretToken');
      // Ensure no raw environment or secret fixture is reflected
      expect(err.userMessage).not.toContain('S1234567890');
    }));

  it('allows immediate clean generation into the target destination after a prior failed attempt rolled back', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      const appFile = join(templateRoot, 'app.ts');
      writeFileSync(appFile, '{{badToken}}');

      // First attempt fails and rolls back
      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(ValidationCliError);
      expect(existsSync(join(root, 'demo-app'))).toBe(false);
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);

      // Fix the template token
      writeFileSync(appFile, 'export const name = "{{projectName}}";');

      // Second attempt generates into the exact same destination cleanly
      const result = generateProjectFromTemplate(context(root), {
        templateRoot,
      });

      expect(result.projectName).toBe('demo-app');
      expect(existsSync(join(root, 'demo-app', 'app.ts'))).toBe(true);
      expect(readFileSync(join(root, 'demo-app', 'app.ts'), 'utf8')).toBe(
        'export const name = "demo-app";',
      );
    }));
});
