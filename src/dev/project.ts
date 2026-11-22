import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationCliError } from '../errors/errors.js';
import { createNpmInvocation } from '../process/npm.js';

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
  const projectRoot = resolveProjectRoot(cwd);
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
