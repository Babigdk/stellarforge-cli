import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectProjectRoot, type DevProcessSpec } from '../dev/project.js';
import { ValidationCliError } from '../errors/errors.js';
import { createNpmInvocation } from '../process/npm.js';

interface ProjectPackage {
  readonly name?: unknown;
  readonly scripts?: unknown;
}

function resolveNodeTestPlan(projectRoot: string): DevProcessSpec | undefined {
  const packagePath = resolve(projectRoot, 'package.json');

  if (!existsSync(packagePath)) {
    return undefined;
  }

  let projectPackage: ProjectPackage;
  try {
    projectPackage = JSON.parse(
      readFileSync(packagePath, 'utf8'),
    ) as ProjectPackage;
  } catch (error) {
    throw new ValidationCliError('package.json is not valid JSON.', {
      cause: error,
    });
  }

  if (
    projectPackage.scripts === null ||
    typeof projectPackage.scripts !== 'object' ||
    Array.isArray(projectPackage.scripts)
  ) {
    throw new ValidationCliError('package.json must define a scripts object.');
  }

  const scripts = projectPackage.scripts as Record<string, unknown>;
  if (typeof scripts.test !== 'string') {
    throw new ValidationCliError(
      'This Node.js project does not define a test script. Add a package.json test script before using `stellarforge test`.',
    );
  }

  // npm treats a present-but-empty test script as a successful no-op, which
  // would report success without running any tests.
  if (scripts.test.trim().length === 0) {
    throw new ValidationCliError(
      'This Node.js project defines an empty package.json test script. Add a non-empty test script before using `stellarforge test`.',
    );
  }

  const projectName =
    typeof projectPackage.name === 'string' && projectPackage.name.length > 0
      ? projectPackage.name
      : 'app';

  const npm = createNpmInvocation(['run', 'test']);

  return {
    label: `${projectName}:test`,
    command: npm.command,
    args: npm.args,
    cwd: projectRoot,
  };
}

function resolveCargoTestPlan(projectRoot: string): DevProcessSpec | undefined {
  if (!existsSync(resolve(projectRoot, 'Cargo.toml'))) {
    return undefined;
  }

  return {
    label: 'cargo:test',
    command: process.platform === 'win32' ? 'cargo.exe' : 'cargo',
    args: ['test'],
    cwd: projectRoot,
  };
}

export function resolveTestProcessPlan(cwd: string): readonly DevProcessSpec[] {
  const projectRoot = selectProjectRoot(cwd, 'test');
  const nodePlan = resolveNodeTestPlan(projectRoot);

  if (nodePlan !== undefined) {
    return [nodePlan];
  }

  const cargoPlan = resolveCargoTestPlan(projectRoot);
  if (cargoPlan !== undefined) {
    return [cargoPlan];
  }

  throw new ValidationCliError(
    'No supported StellarForge test workflow was found. Run `stellarforge test` from the generated project root or a nested directory inside it. Expected a package.json test script or a Cargo.toml workspace.',
  );
}
