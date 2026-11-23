import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPortableTemplatePaths } from '../src/generator/template-sources.js';
import { generateProjectFromTemplate } from '../src/generator/template-generation.js';
import type { GenerationContext } from '../src/generator/types.js';
import { withTempDirectory } from './helpers/index.js';

const ORIGINAL_PLATFORM = process.platform;

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

function context(root: string): GenerationContext {
  return {
    input: { projectName: 'demo-app', cwd: root, templateId: 'basic-app' },
    destination: {
      projectName: 'demo-app',
      destination: join(root, 'demo-app'),
    },
    template: { templateId: 'basic-app' },
  };
}

function bothPathsAreDistinct(
  first: string,
  second: string,
  firstContent: string,
): boolean {
  return (
    existsSync(first) &&
    existsSync(second) &&
    readFileSync(first, 'utf8') === firstContent
  );
}

describe('portable template path policy (SW-129)', () => {
  it('rejects case-folding collisions before creating any generated file', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      const first = join(templateRoot, 'README.md');
      const second = join(templateRoot, 'readme.md');
      writeFileSync(first, 'first');
      writeFileSync(second, 'second');

      if (!bothPathsAreDistinct(first, second, 'first')) return;

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(/colliding paths 'README\.md' and 'readme\.md'/);
      expect(existsSync(join(root, 'demo-app'))).toBe(false);
    }));

  it('rejects Unicode normalization collisions before creating any generated file', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      const first = join(templateRoot, 'caf\u00E9.txt');
      const second = join(templateRoot, 'cafe\u0301.txt');
      writeFileSync(first, 'first');
      writeFileSync(second, 'second');

      if (!bothPathsAreDistinct(first, second, 'first')) return;

      expect(() =>
        generateProjectFromTemplate(context(root), { templateRoot }),
      ).toThrow(/colliding paths/);
      expect(existsSync(join(root, 'demo-app'))).toBe(false);
    }));

  it('reports identical collision guidance on Linux, macOS, and Windows', () => {
    const paths = ['src/Caf\u00E9.txt', 'src/cafe\u0301.txt'];
    let expectedMessage: string | undefined;

    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      onPlatform(platform);

      let message: string | undefined;
      try {
        assertPortableTemplatePaths(paths);
      } catch (error) {
        message = error instanceof Error ? error.message : undefined;
      }

      expect(message).toBeDefined();
      if (expectedMessage === undefined) {
        expectedMessage = message;
      } else {
        expect(message).toBe(expectedMessage);
      }
    }
  });

  it('keeps valid non-colliding case-distinct paths supported', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(join(templateRoot, 'src'), { recursive: true });
      writeFileSync(join(templateRoot, 'package.json'), '{"name":"demo"}');
      writeFileSync(join(templateRoot, 'src', 'Alpha.ts'), 'alpha');
      writeFileSync(join(templateRoot, 'src', 'beta.ts'), 'beta');

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(
        readFileSync(join(root, 'demo-app', 'src', 'Alpha.ts'), 'utf8'),
      ).toBe('alpha');
      expect(
        readFileSync(join(root, 'demo-app', 'src', 'beta.ts'), 'utf8'),
      ).toBe('beta');
    }));
});
