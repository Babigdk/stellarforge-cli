import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
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
import type { DestinationFileSystem } from '../src/generator/validation.js';
import { withTempDirectory } from './helpers/index.js';

const NOT_EMPTY = 'Destination directory is not empty';
const NO_OVERWRITE = 'will not overwrite existing files';

function plan(root: string, projectName = 'demo') {
  return planProjectDestination(
    validateProjectInput({ projectName, cwd: root }),
  );
}

function snapshot(root: string): readonly string[] {
  const lines: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      const label = relative(root, path).split('\\').join('/');

      if (entry.isDirectory()) {
        lines.push(`${label}/`);
        visit(path);
      } else {
        lines.push(`${label}=${readFileSync(path, 'utf8')}`);
      }
    }
  }

  visit(root);
  return lines;
}

function createTemplate(root: string): string {
  const templateRoot = join(root, 'template');
  mkdirSync(templateRoot);
  writeFileSync(join(templateRoot, 'README.md'), '# {{projectName}}\n');
  return templateRoot;
}

function generationContext(root: string): GenerationContext {
  return {
    input: { projectName: 'demo', cwd: root, templateId: 'basic-app' },
    destination: { projectName: 'demo', destination: join(root, 'demo') },
    template: { templateId: 'basic-app' },
  };
}

function stagingLeftovers(root: string): readonly string[] {
  return readdirSync(root).filter((name) => name.startsWith('.stellarforge-'));
}

interface FakeFileSystem extends DestinationFileSystem {
  readonly calls: string[];
}

function createFakeFileSystem(options: {
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly entries: readonly (readonly string[])[];
}): FakeFileSystem {
  const calls: string[] = [];
  let entryReads = 0;

  return {
    calls,
    exists() {
      calls.push('exists');
      return options.exists;
    },
    isDirectory() {
      calls.push('isDirectory');
      return options.isDirectory;
    },
    entries() {
      calls.push('entries');
      const index = Math.min(entryReads, options.entries.length - 1);
      entryReads += 1;
      return options.entries[index] ?? [];
    },
  };
}

describe('destination collision: existing file', () => {
  it('rejects a regular file at the destination and leaves it untouched', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'demo'), 'original');
      const before = snapshot(root);

      expect(() => plan(root)).toThrow(ValidationCliError);
      expect(() => plan(root)).toThrow('is not a directory');
      expect(snapshot(root)).toEqual(before);
    }));

  it('includes the colliding destination path in the message', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'demo'), 'original');

      expect(() => plan(root)).toThrow(join(root, 'demo'));
    }));

  it('does not collide with sibling files that merely share a prefix', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'demo.txt'), 'sibling');
      writeFileSync(join(root, 'demo-app'), 'sibling');
      mkdirSync(join(root, 'other'));

      expect(plan(root).destination).toBe(join(root, 'demo'));
    }));
});

describe('destination collision: empty and absent directories', () => {
  it('preserves the current policy: an existing empty directory is allowed', () =>
    withTempDirectory((root) => {
      mkdirSync(join(root, 'demo'));

      expect(plan(root)).toEqual({
        projectName: 'demo',
        destination: join(root, 'demo'),
      });
    }));

  it('does not write anything while planning an empty directory', () =>
    withTempDirectory((root) => {
      mkdirSync(join(root, 'demo'));
      const before = snapshot(root);

      plan(root);

      expect(snapshot(root)).toEqual(before);
      expect(readdirSync(join(root, 'demo'))).toEqual([]);
    }));

  it('does not create an absent destination while planning', () =>
    withTempDirectory((root) => {
      plan(root);

      expect(existsSync(join(root, 'demo'))).toBe(false);
      expect(readdirSync(root)).toEqual([]);
    }));
});

describe('destination collision: non-empty directories', () => {
  it.each(['existing.txt', 'package.json', 'README.md'])(
    'refuses a directory containing visible file %s',
    (fileName) =>
      withTempDirectory((root) => {
        const destination = join(root, 'demo');
        mkdirSync(destination);
        writeFileSync(join(destination, fileName), 'keep me');
        const before = snapshot(root);

        expect(() => plan(root)).toThrow(NOT_EMPTY);
        expect(() => plan(root)).toThrow(NO_OVERWRITE);
        expect(snapshot(root)).toEqual(before);
      }),
  );

  it.each(['.gitkeep', '.DS_Store', '.env', '.hidden'])(
    'refuses a directory containing only hidden file %s',
    (fileName) =>
      withTempDirectory((root) => {
        const destination = join(root, 'demo');
        mkdirSync(destination);
        writeFileSync(join(destination, fileName), 'hidden content');
        const before = snapshot(root);

        expect(() => plan(root)).toThrow(NOT_EMPTY);
        expect(snapshot(root)).toEqual(before);
      }),
  );

  it('refuses a directory containing only a hidden directory', () =>
    withTempDirectory((root) => {
      const destination = join(root, 'demo');
      mkdirSync(join(destination, '.git'), { recursive: true });

      expect(() => plan(root)).toThrow(NOT_EMPTY);
      expect(existsSync(join(destination, '.git'))).toBe(true);
    }));

  it('refuses a directory containing only an empty subdirectory', () =>
    withTempDirectory((root) => {
      const destination = join(root, 'demo');
      mkdirSync(join(destination, 'src'), { recursive: true });

      expect(() => plan(root)).toThrow(NOT_EMPTY);
      expect(readdirSync(destination)).toEqual(['src']);
    }));

  it('refuses a directory whose only content is deeply nested', () =>
    withTempDirectory((root) => {
      const nested = join(root, 'demo', 'a', 'b', 'c');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, 'deep.txt'), 'deep');
      const before = snapshot(root);

      expect(() => plan(root)).toThrow(NOT_EMPTY);
      expect(snapshot(root)).toEqual(before);
    }));

  it('refuses a directory with mixed visible, hidden, and nested content', () =>
    withTempDirectory((root) => {
      const destination = join(root, 'demo');
      mkdirSync(join(destination, 'src'), { recursive: true });
      writeFileSync(join(destination, '.gitkeep'), '');
      writeFileSync(join(destination, 'src', 'index.ts'), 'export {};');
      writeFileSync(join(destination, 'notes.txt'), 'notes');
      const before = snapshot(root);

      expect(() => plan(root)).toThrow(NO_OVERWRITE);
      expect(snapshot(root)).toEqual(before);
    }));

  it('names the colliding directory in the refusal message', () =>
    withTempDirectory((root) => {
      const destination = join(root, 'demo');
      mkdirSync(destination);
      writeFileSync(join(destination, 'existing.txt'), 'keep me');

      expect(() => plan(root)).toThrow(destination);
    }));
});

describe('destination collision: no implicit overwrite or force behavior', () => {
  it.each([{ force: true }, { overwrite: true }, { clean: true }])(
    'ignores unsupported override flag %j and still refuses a non-empty directory',
    (flags) =>
      withTempDirectory((root) => {
        const destination = join(root, 'demo');
        mkdirSync(destination);
        writeFileSync(join(destination, 'existing.txt'), 'keep me');
        const input: ProjectGeneratorInput & typeof flags = {
          projectName: 'demo',
          cwd: root,
          ...flags,
        };

        const validated = validateProjectInput(input);

        expect(Object.keys(validated).sort()).toEqual(['cwd', 'projectName']);
        expect(() => planProjectDestination(validated)).toThrow(NO_OVERWRITE);
        expect(readFileSync(join(destination, 'existing.txt'), 'utf8')).toBe(
          'keep me',
        );
      }),
  );

  it('only reads from the file system while planning', () => {
    const fileSystem = createFakeFileSystem({
      exists: true,
      isDirectory: true,
      entries: [[]],
    });

    planProjectDestination(
      validateProjectInput({ projectName: 'demo', cwd: '/workspace' }),
      fileSystem,
    );

    expect(Object.keys(fileSystem).sort()).toEqual([
      'calls',
      'entries',
      'exists',
      'isDirectory',
    ]);
    expect(fileSystem.calls).toEqual(['exists', 'isDirectory', 'entries']);
  });
});

describe('destination collision: deterministic revalidation', () => {
  it('re-reads the destination on every planning call instead of caching', () => {
    const fileSystem = createFakeFileSystem({
      exists: true,
      isDirectory: true,
      entries: [[], ['late-arrival.txt']],
    });
    const validated = validateProjectInput({
      projectName: 'demo',
      cwd: '/workspace',
    });

    expect(planProjectDestination(validated, fileSystem).projectName).toBe(
      'demo',
    );
    expect(() => planProjectDestination(validated, fileSystem)).toThrow(
      NOT_EMPTY,
    );
  });

  it('does not enumerate a destination that is a file', () => {
    const fileSystem = createFakeFileSystem({
      exists: true,
      isDirectory: false,
      entries: [['never-read']],
    });

    expect(() =>
      planProjectDestination(
        validateProjectInput({ projectName: 'demo', cwd: '/workspace' }),
        fileSystem,
      ),
    ).toThrow('is not a directory');
    expect(fileSystem.calls).toEqual(['exists', 'isDirectory']);
  });

  it('does not inspect directory state when the destination is absent', () => {
    const fileSystem = createFakeFileSystem({
      exists: false,
      isDirectory: false,
      entries: [['never-read']],
    });

    planProjectDestination(
      validateProjectInput({ projectName: 'demo', cwd: '/workspace' }),
      fileSystem,
    );

    expect(fileSystem.calls).toEqual(['exists']);
  });

  it('generation refuses a directory that became non-empty after planning', () =>
    withTempDirectory((root) => {
      const templateRoot = createTemplate(root);
      mkdirSync(join(root, 'demo'));
      plan(root);
      writeFileSync(join(root, 'demo', 'late-arrival.txt'), 'keep me');

      expect(() =>
        generateProjectFromTemplate(generationContext(root), { templateRoot }),
      ).toThrow('must be empty before generation');
      expect(readFileSync(join(root, 'demo', 'late-arrival.txt'), 'utf8')).toBe(
        'keep me',
      );
      expect(readdirSync(join(root, 'demo'))).toEqual(['late-arrival.txt']);
      expect(stagingLeftovers(root)).toEqual([]);
    }));

  it('generation refuses a destination that appeared with content after planning', () =>
    withTempDirectory((root) => {
      const templateRoot = createTemplate(root);
      plan(root);
      mkdirSync(join(root, 'demo'));
      writeFileSync(join(root, 'demo', '.hidden'), 'keep me');

      expect(() =>
        generateProjectFromTemplate(generationContext(root), { templateRoot }),
      ).toThrow('must be empty before generation');
      expect(readFileSync(join(root, 'demo', '.hidden'), 'utf8')).toBe(
        'keep me',
      );
      expect(stagingLeftovers(root)).toEqual([]);
    }));

  it('generation refuses a destination that became a file after planning', () =>
    withTempDirectory((root) => {
      const templateRoot = createTemplate(root);
      plan(root);
      writeFileSync(join(root, 'demo'), 'now a file');

      expect(() =>
        generateProjectFromTemplate(generationContext(root), { templateRoot }),
      ).toThrow('not a safe empty directory');
      expect(readFileSync(join(root, 'demo'), 'utf8')).toBe('now a file');
      expect(stagingLeftovers(root)).toEqual([]);
    }));

  it('generation refuses an empty destination that became a link after planning', () =>
    withTempDirectory((root) => {
      const templateRoot = createTemplate(root);
      const elsewhere = join(root, 'elsewhere');
      mkdirSync(elsewhere);
      plan(root);
      symlinkSync(elsewhere, join(root, 'demo'), 'junction');

      expect(() =>
        generateProjectFromTemplate(generationContext(root), { templateRoot }),
      ).toThrow('not a safe empty directory');
      expect(readdirSync(elsewhere)).toEqual([]);
      expect(stagingLeftovers(root)).toEqual([]);
    }));

  it('revalidates between orchestration stages when a collision appears after planning', () =>
    withTempDirectory((root) => {
      const templateRoot = createTemplate(root);
      const input: ProjectGeneratorInput = {
        projectName: 'demo',
        cwd: root,
        templateId: 'basic-app',
      };

      expect(() =>
        orchestrateProjectGeneration(input, {
          validate: validateProjectInput,
          planDestination: (validated) => planProjectDestination(validated),
          selectTemplate() {
            writeFileSync(join(root, 'demo'), 'created after planning');
            return { templateId: 'basic-app' };
          },
          generate: (context) =>
            generateProjectFromTemplate(context, { templateRoot }),
        }),
      ).toThrow(ValidationCliError);
      expect(readFileSync(join(root, 'demo'), 'utf8')).toBe(
        'created after planning',
      );
      expect(stagingLeftovers(root)).toEqual([]);
    }));

  it('allows generation into an empty directory that is still empty after planning', () =>
    withTempDirectory((root) => {
      const templateRoot = createTemplate(root);
      mkdirSync(join(root, 'demo'));
      plan(root);

      const result = generateProjectFromTemplate(generationContext(root), {
        templateRoot,
      });

      expect(result.destination).toBe(join(root, 'demo'));
      expect(readFileSync(join(root, 'demo', 'README.md'), 'utf8')).toBe(
        '# demo\n',
      );
      expect(stagingLeftovers(root)).toEqual([]);
    }));
});
