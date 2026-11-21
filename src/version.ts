import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export class CliVersionResolutionError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'Unable to resolve StellarForge CLI version from package metadata.',
      options,
    );
    this.name = 'CliVersionResolutionError';
  }
}

export interface CliPackageMetadata {
  /** The package version, e.g. `0.1.0`. */
  readonly version: string;
  /** The package description used for the root command help body. */
  readonly description: string;
  /** The single executable name exposed by `bin`, e.g. `stellarforge`. */
  readonly executable: string;
}

function loadPackageMetadata(): unknown {
  return require('../package.json');
}

/**
 * Resolves the CLI package metadata from the installed package manifest.
 *
 * The manifest is the single source of truth for the CLI's identity: the
 * executable name (from `bin`), the description shown in root help, and the
 * version reported by `--version`. A portion of the value is validated and
 * throws {@link CliVersionResolutionError} when the manifest is unusable.
 */
export function resolveCliMetadata(
  loader: () => unknown = loadPackageMetadata,
): CliPackageMetadata {
  let metadata: unknown;

  try {
    metadata = loader();
  } catch (cause) {
    throw new CliVersionResolutionError({ cause });
  }

  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string' ||
    metadata.version.trim().length === 0
  ) {
    throw new CliVersionResolutionError();
  }

  if (
    !('description' in metadata) ||
    typeof metadata.description !== 'string' ||
    metadata.description.trim().length === 0
  ) {
    throw new CliVersionResolutionError();
  }

  let executable: string | undefined;

  if ('bin' in metadata) {
    const bin = metadata.bin;

    if (typeof bin === 'string') {
      // npm's single-string form names the executable after the package
      // name with any scope prefix removed.
      const name =
        'name' in metadata && typeof metadata.name === 'string'
          ? metadata.name
          : '';
      executable = name.startsWith('@') ? name.split('/').pop() : name;
    } else if (bin !== null && typeof bin === 'object' && !Array.isArray(bin)) {
      const entries = Object.entries(bin as Record<string, unknown>);
      const first = entries[0];
      if (
        entries.length === 1 &&
        first !== undefined &&
        typeof first[0] === 'string' &&
        first[0].trim().length > 0
      ) {
        executable = first[0];
      }
    }
  }

  if (executable === undefined || executable.trim().length === 0) {
    throw new CliVersionResolutionError();
  }

  return {
    version: metadata.version.trim(),
    description: metadata.description.trim(),
    executable: executable.trim(),
  };
}

export function resolveCliVersion(
  loader: () => unknown = loadPackageMetadata,
): string {
  const metadata = resolveCliMetadata(loader);
  return metadata.version;
}
