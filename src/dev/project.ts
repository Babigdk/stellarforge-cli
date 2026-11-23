import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ValidationCliError } from '../errors/errors.js';
import { GENERATED_MARKER_FILENAME } from '../generator/template-generation.js';
import { createNpmInvocation } from '../process/npm.js';

export const MAX_PROJECT_ROOT_SEARCH_DEPTH = 8;

const PROJECT_MANIFEST_FILENAMES = ['package.json', 'Cargo.toml'] as const;
const PROJECT_BOUNDARY_FILENAMES = ['.git', GENERATED_MARKER_FILENAME] as const;

function containsAny(directory: string, filenames: readonly string[]): boolean {
  return filenames.some((filename) => existsSync(join(directory, filename)));
}

export function discoverProjectRoots(cwd: string): readonly string[] {
  const start = resolve(cwd);
  const roots: string[] = [];
  let current = start;

  for (let depth = 0; depth <= MAX_PROJECT_ROOT_SEARCH_DEPTH; depth += 1) {
    if (
      containsAny(current, PROJECT_MANIFEST_FILENAMES) ||
      existsSync(join(current, GENERATED_MARKER_FILENAME))
    ) {
      roots.push(current);
    }

    if (containsAny(current, PROJECT_BOUNDARY_FILENAMES)) {
      break;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return roots;
}

export function selectProjectRoot(cwd: string, commandName: string): string {
  const start = resolve(cwd);
  const roots = discoverProjectRoots(start);

  if (roots.length === 0) {
    throw new ValidationCliError(
      `No supported StellarForge project root was found for \`stellarforge ${commandName}\`. ` +
        `Run the command from the generated project root or a nested directory inside it. ` +
        `Expected a package.json, Cargo.toml, or ${GENERATED_MARKER_FILENAME} marker.`,
    );
  }

  if (roots.length > 1) {
    const descriptions = roots.map((root) => {
      const fromStart = relative(start, root);
      return fromStart.length === 0 ? '.' : fromStart;
    });

    throw new ValidationCliError(
      `Multiple supported StellarForge project roots were found for \`stellarforge ${commandName}\`: ` +
        `${descriptions.join(', ')}. Run the command from a single generated project root; ` +
        `nested workspaces are not supported.`,
    );
  }

  return roots[0] as string;
}

export interface DevProcessSpec {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export function resolveProjectRoot(cwd: string): string {
  return resolve(cwd);
}

export function resolveProjectPath(
  projectRoot: string,
  ...segments: readonly string[]
): string {
  return resolve(projectRoot, ...segments);
}

interface ProjectPackage {
  readonly name?: unknown;
  readonly scripts?: unknown;
}

function readProjectPackage(projectRoot: string): ProjectPackage {
  const packagePath = resolveProjectPath(projectRoot, 'package.json');

  if (!existsSync(packagePath)) {
    throw new ValidationCliError(
      'No package.json was found. The dev command currently supports generated Node.js StellarForge projects.',
    );
  }

  try {
    return JSON.parse(readFileSync(packagePath, 'utf8')) as ProjectPackage;
  } catch (error) {
    throw new ValidationCliError('package.json is not valid JSON.', {
      cause: error,
    });
  }
}

function selectDevelopmentScript(scripts: Record<string, unknown>): string {
  for (const candidate of ['dev', 'start', 'start:backend']) {
    const value = scripts[candidate];
    // Blank and whitespace-only entries must not be selectable: npm treats
    // them as a successful no-op, so `stellarforge dev` would report a
    // workflow that starts no development process. Skip them.
    if (typeof value === 'string' && value.trim().length > 0) {
      return candidate;
    }
  }

  throw new ValidationCliError(
    'No supported development script with a non-blank value was found. ' +
      'Expected one of: dev, start, start:backend. ' +
      'Add one to package.json "scripts" with a real command, e.g. "dev": "node src/index.ts".',
  );
}

export function resolveDevProcessPlan(cwd: string): readonly DevProcessSpec[] {
  const projectRoot = selectProjectRoot(cwd, 'dev');
  const projectPackage = readProjectPackage(projectRoot);

  if (
    projectPackage.scripts === null ||
    typeof projectPackage.scripts !== 'object' ||
    Array.isArray(projectPackage.scripts)
  ) {
    throw new ValidationCliError('package.json must define a scripts object.');
  }

  const script = selectDevelopmentScript(
    projectPackage.scripts as Record<string, unknown>,
  );
  const label =
    typeof projectPackage.name === 'string' && projectPackage.name.length > 0
      ? projectPackage.name
      : 'app';

  const npm = createNpmInvocation(['run', script]);

  return [
    {
      label,
      command: npm.command,
      args: npm.args,
      cwd: projectRoot,
    },
  ];
}
