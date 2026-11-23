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
import { orchestrateProjectGeneration } from '../src/generator/orchestrator.js';
import { generateProjectFromTemplate } from '../src/generator/template-generation.js';
import type {
  GenerationContext,
  ProjectGeneratorInput,
} from '../src/generator/types.js';
import {
  planProjectDestination,
  validateProjectInput,
} from '../src/generator/validation.js';
import {
  createTempDirectoryFixture,
  withTempDirectory,
} from './helpers/temp-directory.js';

function canCreateSymlinks(): boolean {
  const fixture = createTempDirectoryFixture();
  try {
    const target = join(fixture.path, 'probe-target');
    const link = join(fixture.path, 'probe-link');
    mkdirSync(target);
    symlinkSync(target, link, 'junction');
    return true;
  } catch {
    return false;
  } finally {
    fixture.cleanup();
  }
}

const symlinksSupported = canCreateSymlinks();

function canCreateFileSymlinks(): boolean {
  const fixture = createTempDirectoryFixture();
  try {
    symlinkSync(
      join(fixture.path, 'probe-target'),
      join(fixture.path, 'probe-link'),
    );
    return true;
  } catch {
    return false;
  } finally {
    fixture.cleanup();
  }
}

const fileSymlinksSupported = canCreateFileSymlinks();

function createMinimalTemplate(root: string): string {
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
  return templateRoot;
}

function createContext(
  cwd: string,
  destination: string,
  projectName = 'demo-app',
): GenerationContext {
  return {
    input: {
      projectName,
      cwd,
      templateId: 'basic-app',
    },
    destination: {
      projectName,
      destination,
    },
    template: {
      templateId: 'basic-app',
    },
  };
}

function stagingLeftovers(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name: string) =>
    name.startsWith('.stellarforge-'),
  );
}

describe('generator symlink-ancestor containment (SW-032)', () => {
  it.skipIf(!symlinksSupported)(
    'rejects template generation when destination parent is a symlink pointing outside root before writes',
    () =>
      withTempDirectory((root) => {
        const outsideFixture = createTempDirectoryFixture();
        try {
          const templateRoot = createMinimalTemplate(root);
          const outside = outsideFixture.path;
          const preExistingFile = join(outside, 'canary.txt');
          writeFileSync(preExistingFile, 'untouched-canary-content');

          const escapeLink = join(root, 'escape-link');
          symlinkSync(outside, escapeLink, 'junction');

          const destination = join(escapeLink, 'demo-app');
          const context = createContext(root, destination);

          expect(() =>
            generateProjectFromTemplate(context, { templateRoot }),
          ).toThrow(ValidationCliError);

          // Acceptance criterion: rejected before writes
          expect(existsSync(join(outside, 'demo-app'))).toBe(false);
          expect(readFileSync(preExistingFile, 'utf8')).toBe(
            'untouched-canary-content',
          );
          expect(stagingLeftovers(root)).toEqual([]);
          expect(stagingLeftovers(outside)).toEqual([]);
        } finally {
          outsideFixture.cleanup();
        }
      }),
  );

  it.skipIf(!symlinksSupported)(
    'rejects destination planning when destination parent is a symlink escaping root',
    () =>
      withTempDirectory((root) => {
        const outsideFixture = createTempDirectoryFixture();
        try {
          const escapeLink = join(root, 'escape-link');
          symlinkSync(outsideFixture.path, escapeLink, 'junction');

          // Planning from within the symlink directory escaping root
          const input = validateProjectInput({
            cwd: escapeLink,
            projectName: 'demo-app',
          });

          expect(() => planProjectDestination(input)).toThrow(
            ValidationCliError,
          );
        } finally {
          outsideFixture.cleanup();
        }
      }),
  );

  it.skipIf(!symlinksSupported)(
    'rejects template generation when deeply nested ancestor is an escaping symlink',
    () =>
      withTempDirectory((root) => {
        const outsideFixture = createTempDirectoryFixture();
        try {
          const templateRoot = createMinimalTemplate(root);
          const outside = outsideFixture.path;
          mkdirSync(join(outside, 'nested', 'child'), { recursive: true });

          const escapeLink = join(root, 'escape-link');
          symlinkSync(outside, escapeLink, 'junction');

          const destination = join(escapeLink, 'nested', 'child', 'demo-app');
          const context = createContext(root, destination);

          expect(() =>
            generateProjectFromTemplate(context, { templateRoot }),
          ).toThrow(ValidationCliError);

          expect(existsSync(join(outside, 'nested', 'child', 'demo-app'))).toBe(
            false,
          );
          expect(stagingLeftovers(root)).toEqual([]);
          expect(stagingLeftovers(outside)).toEqual([]);
        } finally {
          outsideFixture.cleanup();
        }
      }),
  );

  it.skipIf(!symlinksSupported)(
    'rejects template generation when empty destination already exists inside an escaping symlink ancestor',
    () =>
      withTempDirectory((root) => {
        const outsideFixture = createTempDirectoryFixture();
        try {
          const templateRoot = createMinimalTemplate(root);
          const outside = outsideFixture.path;
          const preExistingEmpty = join(outside, 'demo-app');
          mkdirSync(preExistingEmpty);

          const escapeLink = join(root, 'escape-link');
          symlinkSync(outside, escapeLink, 'junction');

          const destination = join(escapeLink, 'demo-app');
          const context = createContext(root, destination);

          expect(() =>
            generateProjectFromTemplate(context, { templateRoot }),
          ).toThrow(ValidationCliError);

          // Acceptance criterion: pre-existing directory is not touched / written into
          expect(readdirSync(preExistingEmpty)).toEqual([]);
          expect(stagingLeftovers(root)).toEqual([]);
          expect(stagingLeftovers(outside)).toEqual([]);
        } finally {
          outsideFixture.cleanup();
        }
      }),
  );

  it.skipIf(!symlinksSupported)(
    'allows template generation when destination ancestor is a contained symlink inside root',
    () =>
      withTempDirectory((root) => {
        const templateRoot = createMinimalTemplate(root);
        const containedTarget = join(root, 'contained-target');
        mkdirSync(containedTarget);

        const containedLink = join(root, 'contained-link');
        symlinkSync(containedTarget, containedLink, 'junction');

        const destination = join(containedLink, 'demo-app');
        const context = createContext(root, destination);

        // Acceptance criterion: valid contained destinations still work
        const result = generateProjectFromTemplate(context, { templateRoot });

        expect(result.destination).toBe(destination);
        expect(existsSync(join(destination, 'package.json'))).toBe(true);
        expect(
          existsSync(join(containedTarget, 'demo-app', 'package.json')),
        ).toBe(true);
        expect(
          readFileSync(join(destination, 'package.json'), 'utf8'),
        ).toContain('"name":"demo-app"');
        expect(stagingLeftovers(root)).toEqual([]);
        expect(stagingLeftovers(containedTarget)).toEqual([]);
      }),
  );

  it.skipIf(!symlinksSupported)(
    'allows destination planning when destination ancestor is a contained symlink inside root',
    () =>
      withTempDirectory((root) => {
        const containedTarget = join(root, 'contained-target');
        mkdirSync(containedTarget);

        const containedLink = join(root, 'contained-link');
        symlinkSync(containedTarget, containedLink, 'junction');

        const input = validateProjectInput({
          cwd: containedLink,
          projectName: 'demo-app',
        });

        const plan = planProjectDestination(input);
        expect(plan.destination).toBe(join(containedLink, 'demo-app'));
      }),
  );

  it.skipIf(!symlinksSupported)(
    'allows template generation when pre-existing empty destination is inside a contained symlink',
    () =>
      withTempDirectory((root) => {
        const templateRoot = createMinimalTemplate(root);
        const containedTarget = join(root, 'contained-target');
        mkdirSync(join(containedTarget, 'demo-app'), { recursive: true });

        const containedLink = join(root, 'contained-link');
        symlinkSync(containedTarget, containedLink, 'junction');

        const destination = join(containedLink, 'demo-app');
        const context = createContext(root, destination);

        const result = generateProjectFromTemplate(context, { templateRoot });

        expect(result.destination).toBe(destination);
        expect(
          readFileSync(
            join(containedTarget, 'demo-app', 'package.json'),
            'utf8',
          ),
        ).toContain('"name":"demo-app"');
        expect(stagingLeftovers(root)).toEqual([]);
      }),
  );

  it.skipIf(!symlinksSupported)(
    'rejects full generator orchestration when symlink ancestor escape is attempted',
    () =>
      withTempDirectory((root) => {
        const outsideFixture = createTempDirectoryFixture();
        try {
          const templateRoot = createMinimalTemplate(root);
          const outside = outsideFixture.path;
          const canary = join(outside, 'canary.txt');
          writeFileSync(canary, 'protected-canary');

          const escapeLink = join(root, 'escape-link');
          symlinkSync(outside, escapeLink, 'junction');

          const input: ProjectGeneratorInput = {
            projectName: 'demo-app',
            cwd: escapeLink,
            templateId: 'basic-app',
          };

          expect(() =>
            orchestrateProjectGeneration(input, {
              validate: validateProjectInput,
              planDestination: planProjectDestination,
              selectTemplate: () => ({ templateId: 'basic-app' }),
              generate: (context) =>
                generateProjectFromTemplate(context, { templateRoot }),
            }),
          ).toThrow(ValidationCliError);

          expect(existsSync(join(outside, 'demo-app'))).toBe(false);
          expect(readFileSync(canary, 'utf8')).toBe('protected-canary');
          expect(stagingLeftovers(root)).toEqual([]);
          expect(stagingLeftovers(outside)).toEqual([]);
        } finally {
          outsideFixture.cleanup();
        }
      }),
  );
});

describe('bundled template source symlink policy (SW-131)', () => {
  it.skipIf(!symlinksSupported && !fileSymlinksSupported)(
    'rejects a dangling symlink entry before writing the generated project',
    () =>
      withTempDirectory((root) => {
        const templateRoot = createMinimalTemplate(root);

        if (fileSymlinksSupported) {
          symlinkSync(
            join(templateRoot, 'missing-target.txt'),
            join(templateRoot, 'dangling.txt'),
          );
        } else {
          symlinkSync(
            join(root, 'missing-target-dir'),
            join(templateRoot, 'dangling-dir'),
            'junction',
          );
        }

        expect(() =>
          generateProjectFromTemplate(
            createContext(root, join(root, 'demo-app')),
            { templateRoot },
          ),
        ).toThrow('Template symbolic links are not supported.');
        expect(existsSync(join(root, 'demo-app'))).toBe(false);
        expect(stagingLeftovers(root)).toEqual([]);
      }),
  );

  it.skipIf(!symlinksSupported)(
    'rejects a symlink whose resolved target escapes the template root',
    () =>
      withTempDirectory((root) => {
        const templateRoot = createMinimalTemplate(root);
        const outside = createTempDirectoryFixture();
        try {
          const outsideFile = join(outside.path, 'secret.txt');
          writeFileSync(outsideFile, 'outside-template-content');
          symlinkSync(outsideFile, join(templateRoot, 'escape.txt'));

          expect(() =>
            generateProjectFromTemplate(
              createContext(root, join(root, 'demo-app')),
              { templateRoot },
            ),
          ).toThrow(ValidationCliError);
          expect(existsSync(join(root, 'demo-app'))).toBe(false);
          expect(stagingLeftovers(root)).toEqual([]);
          expect(stagingLeftovers(outside.path)).toEqual([]);
        } finally {
          outside.cleanup();
        }
      }),
  );

  it('continues to generate regular files and directories', () =>
    withTempDirectory((root) => {
      const templateRoot = createMinimalTemplate(root);
      const destination = join(root, 'demo-app');

      const result = generateProjectFromTemplate(
        createContext(root, destination),
        { templateRoot },
      );

      expect(result.destination).toBe(destination);
      expect(readFileSync(join(destination, 'package.json'), 'utf8')).toContain(
        '"name":"demo-app"',
      );
      expect(
        readFileSync(join(destination, 'src', 'index.ts'), 'utf8'),
      ).toContain('"demo-app"');
    }));
});
