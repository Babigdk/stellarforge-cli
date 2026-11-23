import {
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
import {
  ScaffoldingCancelledCliError,
  ValidationCliError,
} from '../errors/errors.js';
import { resolveCliVersion } from '../version.js';
import type {
  GenerationContext,
  ProjectGenerationPreview,
  ProjectGenerationPreviewFile,
  ProjectGenerationResult,
} from './types.js';

const SUBSTITUTION_TOKEN = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;


// npm-packlist always excludes .gitignore files from published packages,
// regardless of the package.json files field. Template gitignore files are
// therefore stored without the leading dot so they survive npm pack. This
// map restores the intended filename when the file is written to the
// generated project.
const DOTFILE_REMAP: Readonly<Record<string, string>> = {
  gitignore: '.gitignore',
};


/** Maximum number of files a template may contain (25× the largest bundled template). */
export const MAX_TEMPLATE_FILE_COUNT = 256;
/** Maximum aggregate bytes of regular files (~55× the largest bundled template). */
export const MAX_TEMPLATE_TOTAL_BYTES = 1024 * 1024;
/** Maximum bytes of a single template file (~46× the largest bundled template file). */
export const MAX_TEMPLATE_FILE_BYTES = 256 * 1024;


export interface TemplateGenerationOptions {
  readonly templateRoot: string;
  /**
   * Overrides the marker's generator version (defaults to the installed CLI
   * version from package metadata). Generation otherwise stays deterministic.
   */
  readonly generatorVersion?: string | undefined;
  readonly dryRun?: boolean;
  readonly isCancelled?: () => boolean;
}

interface TemplateBudget {
  readonly fileCount: number;
  readonly totalBytes: number;
}

/** Filename of the generated project provenance marker. */
export const GENERATED_MARKER_FILENAME = '.stellarforge.json';

/** Package identifier recorded in the generated provenance marker. */
export const GENERATOR_PACKAGE_NAME = '@diginodes/stellarforge-cli';

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);

  return (
    pathFromRoot.length > 0 &&
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

function assertSafeEntryName(name: string): void {
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new ValidationCliError('Template contains an unsafe file path.');
  }
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

function assertNotCancelled(isCancelled?: () => boolean): void {
  if (isCancelled?.()) {
    throw new ScaffoldingCancelledCliError();
  }
}

/**
 * Measures the template tree before any file is written. Exceeding a documented
 * limit fails with a safe aggregate message that never embeds local paths or
 * entry names. Directory payload bytes are never counted — they are
 * platform-dependent; only regular files are measured.
 */
function measureTemplateTree(templateRoot: string): TemplateBudget {
  let fileCount = 0;
  let totalBytes = 0;

  const measure = (relativeDirectory: string): void => {
    const sourceDirectory = resolve(templateRoot, relativeDirectory);
    const entries = readdirSync(sourceDirectory, { withFileTypes: true }).sort(
      (a, b) => {
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
      },
    );

    for (const entry of entries) {
      assertSafeEntryName(entry.name);

      const relativePath = join(relativeDirectory, entry.name);
      const sourcePath = resolve(templateRoot, relativePath);

      if (!isWithin(templateRoot, sourcePath)) {
        throw new ValidationCliError(
          'Template file path escapes the trusted project root.',
        );
      }

      const stats = lstatSync(sourcePath);

      if (stats.isSymbolicLink()) {
        throw new ValidationCliError(
          'Template symbolic links are not supported.',
        );
      }

      if (stats.isDirectory()) {
        measure(relativePath);
        continue;
      }

      if (!stats.isFile()) {
        throw new ValidationCliError(
          'Template contains an unsupported filesystem entry.',
        );
      }

      fileCount += 1;
      totalBytes += stats.size;

      if (fileCount > MAX_TEMPLATE_FILE_COUNT) {
        throw new ValidationCliError(
          `Template exceeds the ${MAX_TEMPLATE_FILE_COUNT}-file generation limit (found more than ${MAX_TEMPLATE_FILE_COUNT} files).`,
        );
      }

      if (stats.size > MAX_TEMPLATE_FILE_BYTES) {
        throw new ValidationCliError(
          `Template contains a file larger than the ${MAX_TEMPLATE_FILE_BYTES}-byte per-file limit.`,
        );
      }

      if (totalBytes > MAX_TEMPLATE_TOTAL_BYTES) {
        throw new ValidationCliError(
          `Template exceeds the ${MAX_TEMPLATE_TOTAL_BYTES}-byte generation limit.`,
        );
      }
    }
  };

  measure('.');

  return { fileCount, totalBytes };
}

/**
 * Pre-flight guardrail: reject templates that exceed the documented budget
 * before any file is read, staged, or promoted.
 */
function assertTemplateBudget(templateRoot: string): void {
  // Bounds are intentionally generous relative to the bundled template
  // inventory (four templates, tens of files, ~kilobytes each) yet small
  // enough to stop accidentally huge or hostile template trees.
  measureTemplateTree(templateRoot);
}

function visitTemplateTree(
  templateRoot: string,
  relativeDirectory: string,
  variables: Readonly<Record<string, string>>,
  visitFile: (
    relativePath: string,
    content: Buffer | string,
    substitutions: readonly string[],
  ) => void,
  visitDirectory: (relativePath: string) => void,
  isCancelled?: () => boolean,
): void {
  assertNotCancelled(isCancelled);
  const sourceDirectory = resolve(templateRoot, relativeDirectory);
  const entries = readdirSync(sourceDirectory, { withFileTypes: true }).sort(
    (a, b) => {
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    },
  );

  for (const entry of entries) {
    assertNotCancelled(isCancelled);
    assertSafeEntryName(entry.name);

    const destinationName = DOTFILE_REMAP[entry.name] ?? entry.name;
    const relativePath = join(relativeDirectory, entry.name);
    const destinationRelativePath = join(relativeDirectory, destinationName);
    const sourcePath = resolve(templateRoot, relativePath);


    if (!isWithin(templateRoot, sourcePath)) {
      throw new ValidationCliError(
        'Template file path escapes the trusted project root.',
      );
    }

    const sourceStat = lstatSync(sourcePath);

    if (sourceStat.isSymbolicLink()) {
      throw new ValidationCliError(
        'Template symbolic links are not supported.',
      );
    }

    if (sourceStat.isDirectory()) {
      visitDirectory(relativePath);
      visitTemplateTree(
        templateRoot,
        relativePath,
        variables,
        visitFile,
        visitDirectory,
        isCancelled,
      );
      continue;
    }

    if (!sourceStat.isFile()) {
      throw new ValidationCliError(
        'Template contains an unsupported filesystem entry.',
      );
    }

    const content = readFileSync(sourcePath);

    if (isBinary(content)) {
      visitFile(destinationRelativePath, content, []);
      continue;
    }

    const rendered = renderText(content.toString('utf8'), variables);
    visitFile(destinationRelativePath, rendered.content, rendered.substitutions);
  }
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

  if (!existsSync(templateRoot) || !lstatSync(templateRoot).isDirectory()) {
    throw new ValidationCliError('Selected template source is unavailable.');
  }

  if (lstatSync(templateRoot).isSymbolicLink()) {
    throw new ValidationCliError(
      'Template source must not be a symbolic link.',
    );
  }

  assertTemplateBudget(templateRoot);

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

  if (options.dryRun) {
    const files: ProjectGenerationPreviewFile[] = [];
    visitTemplateTree(
      templateRoot,
      '.',
      variables,
      (relativePath, _content, substitutions) => {
        files.push({
          path: relativePath.split(sep).join('/'),
          substitutions,
        });
      },
      () => undefined,
      options.isCancelled,
    );

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
    assertNotCancelled(options.isCancelled);
    visitTemplateTree(
      templateRoot,
      '.',
      variables,
      (relativePath, content) => {
        const destinationPath = resolve(stagingRoot, relativePath);
        if (!isWithin(stagingRoot, destinationPath)) {
          throw new ValidationCliError(
            'Template file path escapes the trusted project root.',
          );
        }

        mkdirSync(dirname(destinationPath), { recursive: true });
        writeFileSync(destinationPath, content);
      },
      (relativePath) => {
        const destinationPath = resolve(stagingRoot, relativePath);
        if (!isWithin(stagingRoot, destinationPath)) {
          throw new ValidationCliError(
            'Template file path escapes the trusted project root.',
          );
        }

        mkdirSync(destinationPath, { recursive: false });
      },
      options.isCancelled,
    );

    assertNotCancelled(options.isCancelled);

    // Re-validate immediately before the mutating write phase. The checks
    // above can be invalidated by a concurrent destination replacement while
    // copyTemplateTree was still running (it only writes into the unrelated
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

      assertNotCancelled(options.isCancelled);
      rmdirSync(destination);
      removedExistingDestination = true;
    }

    assertNotCancelled(options.isCancelled);
    // Provenance marker: record only the template identifier and generator
    // version — never user, host, path, or environment information. Kept
    // byte-stable across runs except for the version value itself. Written
    // after final destination safety checks so ancestor-swap races fail as
    // containment/validation errors instead of raw filesystem errors.
    const marker = {
      generator: GENERATOR_PACKAGE_NAME,
      template: context.template.templateId,
      version: options.generatorVersion ?? resolveCliVersion(),
    };
    writeFileSync(
      join(stagingRoot, GENERATED_MARKER_FILENAME),
      `${JSON.stringify(marker, null, 2)}\n`,
      'utf8',
    );

    assertNotCancelled(options.isCancelled);
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
