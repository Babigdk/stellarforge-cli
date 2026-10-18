import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { ValidationCliError } from '../errors/errors.js';
import type {
  DestinationPlan,
  ProjectGeneratorInput,
  ValidatedProjectInput,
} from './types.js';

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const SAFE_PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface DestinationFileSystem {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  entries(path: string): readonly string[];
}

const nodeFileSystem: DestinationFileSystem = {
  exists: existsSync,
  isDirectory(path) {
    return statSync(path).isDirectory();
  },
  entries: readdirSync,
};

function validateProjectName(projectName: string): string {
  const normalized = projectName.trim();

  if (normalized.length === 0) {
    throw new ValidationCliError('Project name must not be empty.');
  }

  if (normalized === '.' || normalized === '..') {
    throw new ValidationCliError(
      'Project name must identify a new child directory, not `.` or `..`.',
    );
  }

  if (
    isAbsolute(normalized) ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new ValidationCliError(
      'Project name must be a single directory name and must not contain a path.',
    );
  }

  if (!SAFE_PROJECT_NAME.test(normalized)) {
    throw new ValidationCliError(
      'Project name may contain only letters, numbers, dots, underscores, and hyphens, and must start with a letter or number.',
    );
  }

  if (normalized.endsWith('.') || normalized.endsWith(' ')) {
    throw new ValidationCliError(
      'Project name must not end with a dot or space.',
    );
  }

  if (WINDOWS_RESERVED_NAME.test(normalized)) {
    throw new ValidationCliError(
      'Project name conflicts with a reserved Windows device name.',
    );
  }

  return normalized;
}

export function validateProjectInput(
  input: ProjectGeneratorInput,
): ValidatedProjectInput {
  const projectName = validateProjectName(input.projectName);
  const cwd = resolve(input.cwd);

  return {
    projectName,
    cwd,
    ...(input.templateId === undefined ? {} : { templateId: input.templateId }),
  };
}

function assertDestinationWithinRoot(root: string, destination: string): void {
  const relativeDestination = relative(root, destination);

  if (
    relativeDestination.length === 0 ||
    relativeDestination === '..' ||
    relativeDestination.startsWith(
      `..${process.platform === 'win32' ? '\\' : '/'}`,
    ) ||
    isAbsolute(relativeDestination)
  ) {
    throw new ValidationCliError(
      'Project destination must remain inside the current working directory.',
    );
  }
}

export function planProjectDestination(
  input: ValidatedProjectInput,
  fileSystem: DestinationFileSystem = nodeFileSystem,
): DestinationPlan {
  const root = resolve(input.cwd);
  const destination = resolve(root, input.projectName);

  assertDestinationWithinRoot(root, destination);

  if (fileSystem.exists(destination)) {
    if (!fileSystem.isDirectory(destination)) {
      throw new ValidationCliError(
        `Destination already exists and is not a directory: ${destination}.`,
      );
    }

    if (fileSystem.entries(destination).length > 0) {
      throw new ValidationCliError(
        `Destination directory is not empty: ${destination}. StellarForge will not overwrite existing files.`,
      );
    }
  }

  return {
    projectName: input.projectName,
    destination,
  };
}
