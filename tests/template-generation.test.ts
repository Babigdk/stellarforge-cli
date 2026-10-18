import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import { generateProjectFromTemplate } from '../src/generator/template-generation.js';
import type { GenerationContext } from '../src/generator/types.js';
import { withTempDirectory } from './helpers/index.js';

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
      const outside = join(root, 'outside.txt');
      writeFileSync(outside, 'outside');
      symlinkSync(outside, join(templateRoot, 'escape.txt'));

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow('symbolic links are not supported');
      expect(existsSync(join(root, 'demo-app'))).toBe(false);
    }));
});
