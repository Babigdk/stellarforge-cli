import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ValidationCliError } from '../errors/errors.js';
import {
  collectTemplateSourceTree,
  GENERATED_DIRECTORY_MODE,
  resolveGeneratedFileMode,
  type TemplateSourceTree,
} from './template-sources.js';
import type {
  GenerationContext,
  ProjectGenerationPreview,
  ProjectGenerationPreviewFile,
  ProjectGenerationResult,
} from './types.js';

const SUBSTITUTION_TOKEN = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;

export interface TemplateGenerationOptions {
  readonly templateRoot: string;
  readonly dryRun?: boolean;
}

/** Filename of the generated project provenance marker. */
export const GENERATED_MARKER_FILENAME = '.stellarforge.json';

/** Package identifier recorded in the generated provenance marker. */
export const GENERATOR_PACKAGE_NAME = '@diginodes/stellarforge-cli';

interface RenderedTemplateFile {
  readonly relativePath: string;
  readonly content: Buffer | string;
  readonly substitutions: readonly string[];
  readonly mode: number;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);

  return (
    pathFromRoot.length > 0 &&
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

function renderText(
  input: string,
  variables: Readonly<Record<string, string>>,
): { readonly content: string; readonly substitutions: readonly string[] } {
  const substitutions = new Set<string>();
  const content = input.replace(SUBSTITUTION_TOKEN, (_match, key: string) => {
    const value = variables[key];

    if (value === undefined) {
      throw new ValidationCliError(
        `Template contains unsupported substitution token '{{${key}}}'.`,
      );
    }

    substitutions.add(`{{${key}}} -> ${value}`);
    return value;
  });

  return { content, substitutions: [...substitutions] };
}

function isBinary(content: Buffer): boolean {
  return content.includes(0);
}

function renderTemplateFiles(
  tree: TemplateSourceTree,
  variables: Readonly<Record<string, string>>,
): readonly RenderedTemplateFile[] {
  return tree.entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => {
      const content = readFileSync(join(tree.root, entry.relativePath));

      if (isBinary(content)) {
        return {
          relativePath: entry.relativePath,
          content,
          substitutions: [],
          mode: entry.mode,
        };
      }

      const rendered = renderText(content.toString('utf8'), variables);
      return {
        relativePath: entry.relativePath,
        content: rendered.content,
        substitutions: rendered.substitutions,
        mode: entry.mode,
      };
    });
}

function resolveStagingPath(stagingRoot: string, relativePath: string): string {
  const destinationPath = resolve(stagingRoot, relativePath);

  if (!isWithin(stagingRoot, destinationPath)) {
    throw new ValidationCliError(
      'Template file path escapes the trusted project root.',
    );
  }

  return destinationPath;
}

function writeRenderedFile(
  destinationPath: string,
  file: RenderedTemplateFile,
): void {
  if (process.platform === 'win32') {
    writeFileSync(destinationPath, file.content);
    return;
  }

  const mode = resolveGeneratedFileMode(file.mode);
  writeFileSync(destinationPath, file.content, { mode });
  chmodSync(destinationPath, mode);
}

function assertDestinationContainment(root: string, destination: string): void {
  const destinationParent = dirname(destination);

  if (!isWithin(destinationParent, destination)) {
    throw new ValidationCliError(
      'Project destination escapes its validated parent directory.',
    );
  }

  if (existsSync(root)) {
    try {
      const realRoot = realpathSync(root);
      let existing = destination;
      while (!existsSync(existing)) {
        const parent = dirname(existing);
        if (parent === existing) break;
        existing = parent;
      }

      if (existsSync(existing)) {
        const realExisting = realpathSync(existing);
        const rel = relative(realRoot, realExisting);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
          throw new ValidationCliError(
            'Project destination escapes its validated parent directory.',
          );
        }
      }
    } catch (error) {
      if (error instanceof ValidationCliError) throw error;
    }
  }

  let current = destination;
  while (current !== dirname(current)) {
    const parent = dirname(current);
    if (existsSync(current) && existsSync(parent)) {
      try {
        const realCurrent = realpathSync(current);
        const realParent = realpathSync(parent);
        const rel = relative(realParent, realCurrent);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
          throw new ValidationCliError(
            'Project destination escapes its validated parent directory.',
          );
        }
      } catch (error) {
        if (error instanceof ValidationCliError) throw error;
      }
    }
    current = parent;
  }
}

export function generateProjectFromTemplate(
  context: GenerationContext,
  options: TemplateGenerationOptions,
): ProjectGenerationResult | ProjectGenerationPreview {
  const templateRoot = resolve(options.templateRoot);
  const destination = resolve(context.destination.destination);
  const destinationParent = dirname(destination);
  const root = resolve(context.input.cwd);

  const tree = collectTemplateSourceTree(templateRoot);
  assertDestinationContainment(root, destination);

  const destinationExisted = existsSync(destination);

  if (destinationExisted) {
    const destinationStat = lstatSync(destination);

    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
      throw new ValidationCliError(
        'Project destination is not a safe empty directory.',
      );
    }

    if (readdirSync(destination).length > 0) {
      throw new ValidationCliError(
        'Project destination must be empty before generation.',
      );
    }
  }

  const realDestinationParentAtStart = existsSync(destinationParent)
    ? realpathSync(destinationParent)
    : undefined;

  const variables = {
    projectName: context.input.projectName,
    templateId: context.template.templateId,
  };
  const renderedFiles = renderTemplateFiles(tree, variables);

  if (options.dryRun) {
    const files: ProjectGenerationPreviewFile[] = renderedFiles.map((file) => ({
      path: file.relativePath.split(sep).join('/'),
      substitutions: file.substitutions,
    }));

    return {
      dryRun: true,
      projectName: context.input.projectName,
      destination,
      templateId: context.template.templateId,
      files,
    };
  }

  const stagingRoot = mkdtempSync(
    join(destinationParent, `.stellarforge-${context.input.projectName}-`),
  );
  let removedExistingDestination = false;

  try {
    for (const entry of tree.entries) {
      if (entry.type !== 'directory') continue;

      const destinationPath = resolveStagingPath(
        stagingRoot,
        entry.relativePath,
      );
      mkdirSync(destinationPath, {
        recursive: true,
        mode: GENERATED_DIRECTORY_MODE,
      });
    }

    for (const file of renderedFiles) {
      const destinationPath = resolveStagingPath(
        stagingRoot,
        file.relativePath,
      );

      mkdirSync(dirname(destinationPath), {
        recursive: true,
        mode: GENERATED_DIRECTORY_MODE,
      });
      writeRenderedFile(destinationPath, file);
    }

    // Re-validate immediately before the mutating write phase. The checks
    // above can be invalidated by a concurrent destination replacement while
    // staging was still running (it only writes into the unrelated
    // staging directory, never into `destination`), so this closes the
    // time-of-check/time-of-use gap rather than relying on the earlier check.
    assertDestinationContainment(root, destination);

    if (
      realDestinationParentAtStart !== undefined &&
      (!existsSync(destinationParent) ||
        realpathSync(destinationParent) !== realDestinationParentAtStart)
    ) {
      throw new ValidationCliError(
        'Project destination escapes its validated parent directory.',
      );
    }

    if (existsSync(destination)) {
      const destinationStat = lstatSync(destination);

      if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
        throw new ValidationCliError(
          'Project destination is not a safe empty directory.',
        );
      }

      if (readdirSync(destination).length > 0) {
        throw new ValidationCliError(
          'Project destination must be empty before generation.',
        );
      }

      rmdirSync(destination);
      removedExistingDestination = true;
    }

    renameSync(stagingRoot, destination);
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });

    if (removedExistingDestination && !existsSync(destination)) {
      mkdirSync(destination);
    }

    throw error;
  }

  return {
    projectName: context.input.projectName,
    destination,
    templateId: context.template.templateId,
  };
}
