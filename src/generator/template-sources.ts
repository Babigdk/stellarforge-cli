import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationCliError } from '../errors/errors.js';
import { TEMPLATE_IDS, type TemplateId } from './template-registry.js';

const BUNDLED_TEMPLATE_DIRECTORIES: Record<TemplateId, string> =
  Object.fromEntries(TEMPLATE_IDS.map((id) => [id, id])) as Record<
    TemplateId,
    string
  >;

export const GENERATED_FILE_MODE = 0o644;
export const GENERATED_EXECUTABLE_FILE_MODE = 0o755;
export const GENERATED_DIRECTORY_MODE = 0o755;

const EXECUTABLE_BITS = 0o111;

export interface TemplateSourceEntry {
  readonly relativePath: string;
  readonly type: 'file' | 'directory';
  readonly mode: number;
}

export interface TemplateSourceTree {
  readonly root: string;
  readonly entries: readonly TemplateSourceEntry[];
}

export function resolveBundledTemplateRoot(templateId: string): string {
  const directory =
    BUNDLED_TEMPLATE_DIRECTORIES[templateId as TemplateId];

  if (directory === undefined) {
    throw new ValidationCliError(
      'The selected template is not available in this CLI version.',
    );
  }

  return fileURLToPath(
    new URL(`../../templates/${directory}/`, import.meta.url),
  );
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

function portablePathKey(relativePath: string): string {
  return relativePath.split('\\').join('/').normalize('NFD').toLowerCase();
}

export function assertPortableTemplatePaths(
  relativePaths: readonly string[],
): void {
  const seen = new Map<string, string>();

  for (const relativePath of [...new Set(relativePaths)].sort()) {
    const key = portablePathKey(relativePath);
    const previous = seen.get(key);

    if (previous !== undefined && previous !== relativePath) {
      throw new ValidationCliError(
        `Template contains colliding paths '${previous}' and '${relativePath}'.`,
      );
    }

    seen.set(key, relativePath);
  }
}

export function resolveGeneratedFileMode(sourceMode: number): number {
  return (sourceMode & EXECUTABLE_BITS) === 0
    ? GENERATED_FILE_MODE
    : GENERATED_EXECUTABLE_FILE_MODE;
}

function collectEntries(
  root: string,
  relativeDirectory: string,
  entries: TemplateSourceEntry[],
): void {
  const sourceDirectory = resolve(root, relativeDirectory);
  const dirents = readdirSync(sourceDirectory, { withFileTypes: true }).sort(
    (a, b) => {
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    },
  );

  for (const dirent of dirents) {
    assertSafeEntryName(dirent.name);

    const relativePath = join(relativeDirectory, dirent.name);
    const sourcePath = resolve(root, relativePath);

    if (!isWithin(root, sourcePath)) {
      throw new ValidationCliError(
        'Template file path escapes the trusted project root.',
      );
    }

    const stat = lstatSync(sourcePath);

    if (stat.isSymbolicLink() || dirent.isSymbolicLink()) {
      throw new ValidationCliError(
        'Template symbolic links are not supported.',
      );
    }

    const realSourcePath = realpathSync(sourcePath);
    if (!isWithin(root, realSourcePath)) {
      throw new ValidationCliError(
        'Template file path escapes the trusted project root.',
      );
    }

    if (stat.isDirectory() && dirent.isDirectory()) {
      entries.push({
        relativePath,
        type: 'directory',
        mode: stat.mode,
      });
      collectEntries(root, relativePath, entries);
      continue;
    }

    if (!stat.isFile() || !dirent.isFile()) {
      throw new ValidationCliError(
        'Template contains an unsupported filesystem entry.',
      );
    }

    entries.push({
      relativePath,
      type: 'file',
      mode: stat.mode,
    });
  }
}

export function collectTemplateSourceTree(templateRoot: string): TemplateSourceTree {
  const root = resolve(templateRoot);
  const rootStat = lstatSync(root, { throwIfNoEntry: false });

  if (rootStat === undefined) {
    throw new ValidationCliError('Selected template source is unavailable.');
  }

  if (rootStat.isSymbolicLink()) {
    throw new ValidationCliError(
      'Template source must not be a symbolic link.',
    );
  }

  if (!rootStat.isDirectory()) {
    throw new ValidationCliError('Selected template source is unavailable.');
  }

  const realRoot = realpathSync(root);
  const entries: TemplateSourceEntry[] = [];
  collectEntries(realRoot, '.', entries);
  assertPortableTemplatePaths(entries.map((entry) => entry.relativePath));

  return { root: realRoot, entries };
}
