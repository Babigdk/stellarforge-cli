import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type Stats,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ValidationCliError } from '../errors/errors.js';
import { GENERATED_MARKER_FILENAME } from '../generator/template-generation.js';
import { createNpmInvocation } from '../process/npm.js';

export const MAX_PROJECT_ROOT_SEARCH_DEPTH = 8;

/**
 * Maximum size of a project `package.json` manifest, in bytes.
 *
 * Dev and test project discovery only need a small amount of metadata (the
 * package name and `scripts` entries). A manifest that exceeds this bound is
 * far more likely to be malformed or hostile than legitimate, so it is
 * rejected before the full file is read or parsed. The limit is shared by both
 * resolvers so a manifest cannot slip through one command but not the other.
 */
export const MAX_PACKAGE_JSON_BYTES = 512 * 1024;

function packageJsonTooLargeMessage(): string {
  return (
    `package.json exceeds the maximum supported size of ` +
    `${MAX_PACKAGE_JSON_BYTES} bytes. Reduce the manifest size before running ` +
    `StellarForge commands, for example by moving large generated content ` +
    `out of package.json.`
  );
}

const PROJECT_MANIFEST_FILENAMES = ['package.json', 'Cargo.toml'] as const;
const PROJECT_BOUNDARY_FILENAMES = ['.git', GENERATED_MARKER_FILENAME] as const;

/**
 * Reports whether a directory entry exists at `path`, without following
 * symbolic links. Unlike `existsSync`, a dangling symlink counts as present:
 * it must reach the manifest policy and be rejected, not silently treated as
 * a missing project manifest.
 */
function hasDirectoryEntry(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function containsAny(directory: string, filenames: readonly string[]): boolean {
  return filenames.some((filename) =>
    hasDirectoryEntry(join(directory, filename)),
  );
}

export function discoverProjectRoots(cwd: string): readonly string[] {
  const start = resolve(cwd);
  const roots: string[] = [];
  let current = start;

  for (let depth = 0; depth <= MAX_PROJECT_ROOT_SEARCH_DEPTH; depth += 1) {
    if (
      containsAny(current, PROJECT_MANIFEST_FILENAMES) ||
      hasDirectoryEntry(join(current, GENERATED_MARKER_FILENAME))
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

function isAbsentEntryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

/**
 * Shared regular-file policy for project manifests. Messages intentionally
 * name only `package.json`: they never include paths, symlink targets, or file
 * contents, which may be attacker-controlled.
 */
function assertRegularPackageJson(metadata: Stats): void {
  if (metadata.isSymbolicLink()) {
    throw new ValidationCliError(
      'package.json must be a regular project file, not a symbolic link.',
    );
  }

  if (!metadata.isFile()) {
    throw new ValidationCliError(
      'package.json must be a regular project file.',
    );
  }
}

/**
 * Inspects the manifest entry without following links. Returns false only when
 * no entry exists; every other non-regular entry is rejected before its
 * contents can be read.
 */
function inspectPackageJsonEntry(packagePath: string): boolean {
  let metadata: Stats;
  try {
    metadata = lstatSync(packagePath);
  } catch (error) {
    if (isAbsentEntryError(error)) {
      return false;
    }

    throw new ValidationCliError('package.json could not be inspected.', {
      cause: error,
    });
  }

  assertRegularPackageJson(metadata);
  return true;
}

/**
 * Dev and test discovery share this check so an absent manifest stays
 * distinguishable from a present-but-invalid one (a symlink, directory, or
 * other non-regular entry) without either resolver reading it.
 */
export function isPackageJsonMissing(packagePath: string): boolean {
  return !inspectPackageJsonEntry(packagePath);
}

/**
 * Reads and parses a `package.json` manifest without ever buffering more than
 * {@link MAX_PACKAGE_JSON_BYTES} bytes of its content.
 *
 * The entry is checked with `lstatSync` before opening and the opened
 * descriptor is checked with `fstatSync` before any bytes are read, so a
 * symlink, directory, or other non-regular file is rejected even if the entry
 * is replaced between the two checks.
 *
 * The bounded read is deliberate: `readFileSync` would allocate the entire
 * file first, letting an oversized manifest exhaust memory before validation
 * runs. At most one byte beyond the limit is read so an oversized file can be
 * rejected without loading its contents.
 */
export function readPackageJsonManifest(packagePath: string): unknown {
  if (!inspectPackageJsonEntry(packagePath)) {
    throw new ValidationCliError('package.json could not be read.');
  }

  const buffer = Buffer.alloc(MAX_PACKAGE_JSON_BYTES + 1);
  let descriptor: number | undefined;
  let bytesRead = 0;

  try {
    descriptor = openSync(packagePath, 'r');
    assertRegularPackageJson(fstatSync(descriptor));

    while (bytesRead < buffer.length) {
      const chunk = readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        null,
      );

      if (chunk === 0) {
        break;
      }

      bytesRead += chunk;
    }
  } catch (error) {
    if (error instanceof ValidationCliError) {
      throw error;
    }

    throw new ValidationCliError('package.json could not be read.', {
      cause: error,
    });
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }

  if (bytesRead > MAX_PACKAGE_JSON_BYTES) {
    throw new ValidationCliError(packageJsonTooLargeMessage());
  }

  try {
    return JSON.parse(buffer.toString('utf8', 0, bytesRead));
  } catch (error) {
    throw new ValidationCliError('package.json is not valid JSON.', {
      cause: error,
    });
  }
}

function readProjectPackage(projectRoot: string): ProjectPackage {
  const packagePath = resolveProjectPath(projectRoot, 'package.json');

  if (isPackageJsonMissing(packagePath)) {
    throw new ValidationCliError(
      'No package.json was found. The dev command currently supports generated Node.js StellarForge projects.',
    );
  }

  return readPackageJsonManifest(packagePath) as ProjectPackage;
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
