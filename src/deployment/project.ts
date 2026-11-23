import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  type Dirent,
  type Stats,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { validateIdentityAlias } from '../config/schema.js';
import type { DevProcessSpec } from '../dev/project.js';
import { SubprocessCliError, ValidationCliError } from '../errors/errors.js';
import { redactSecretLikeText } from '../output/redaction.js';

export const DEPLOYMENT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEPLOYMENT_TERMINATION_GRACE_MS = 5 * 1000;
export const GENERATED_WASM_ARTIFACT_PATH =
  'target/wasm32v1-none/release/stellarforge-starter-contract.wasm';

export interface TestnetDeploymentInput {
  readonly cwd: string;
  readonly network: string;
  readonly source: string;
}

export interface DeploymentPreflightCheck {
  readonly label: string;
  readonly passed: boolean;
  readonly remediation?: string;
}

export interface DeploymentPreflightResult {
  readonly passed: boolean;
  readonly checks: readonly DeploymentPreflightCheck[];
}

/**
 * Local-only preflight validation. Performs no subprocess spawns and no
 * network requests. Never echoes the identity alias, config values, or paths.
 */
export function runDeploymentPreflight(
  input: TestnetDeploymentInput,
): DeploymentPreflightResult {
  const projectRoot = resolve(input.cwd);
  const checks: DeploymentPreflightCheck[] = [];

  const networkOk = input.network === 'testnet';
  checks.push({
    label: 'Network is testnet',
    passed: networkOk,
    ...(networkOk
      ? {}
      : {
          remediation:
            'StellarForge deploy supports only the explicit `--network testnet` target in the MVP.',
        }),
  });

  let identityOk = true;
  let identityRemediation =
    'Pass `--source <identity>` with a valid named Stellar CLI identity alias.';
  try {
    validateIdentityAlias(input.source);
  } catch (error) {
    identityOk = false;
    identityRemediation =
      error instanceof Error
        ? error.message
        : 'Pass `--source <identity>` with a valid named Stellar CLI identity alias.';
  }
  checks.push({
    label: 'Identity alias is valid',
    passed: identityOk,
    ...(identityOk
      ? {}
      : {
          remediation: identityRemediation,
        }),
  });

  const cargoOk = existsSync(resolve(projectRoot, 'Cargo.toml'));
  checks.push({
    label: 'Cargo.toml workspace present',
    passed: cargoOk,
    ...(cargoOk
      ? {}
      : {
          remediation:
            'No Cargo.toml workspace was found. Run deploy from a generated Stellar smart-contract project root containing Cargo.toml.',
        }),
  });

  let artifactOk = false;
  let artifactRemediation: string | undefined;
  if (cargoOk) {
    try {
      validateGeneratedWasmArtifact(projectRoot);
      artifactOk = true;
    } catch (error) {
      artifactOk = false;
      artifactRemediation =
        error instanceof Error
          ? error.message
          : 'Run `stellar contract build` before deploying.';
    }
  }
  checks.push({
    label: 'Generated Wasm artifact is ready',
    passed: artifactOk,
    ...(artifactOk
      ? {}
      : {
          remediation:
            artifactRemediation ??
            'Run `stellar contract build` before deploying.',
        }),
  });

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function readStat(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function collectContractSourceStats(projectRoot: string): readonly Stats[] {
  const stats: Stats[] = [];
  const manifestStat = readStat(resolve(projectRoot, 'Cargo.toml'));
  if (manifestStat !== undefined) {
    stats.push(manifestStat);
  }

  const visit = (directory: string): void => {
    let entries: readonly Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (entry.isFile()) {
        const entryStat = readStat(entryPath);
        if (entryStat !== undefined) {
          stats.push(entryStat);
        }
      }
    }
  };

  visit(resolve(projectRoot, 'contracts'));
  return stats;
}

function isCanonicalArtifactLocation(
  realProjectRoot: string,
  realArtifactPath: string,
): boolean {
  const relativePath = relative(realProjectRoot, realArtifactPath);
  return (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath) &&
    relativePath.split(/[\\/]/).join('/') === GENERATED_WASM_ARTIFACT_PATH
  );
}

function validateGeneratedWasmArtifact(projectRoot: string): void {
  const artifactPath = resolve(projectRoot, GENERATED_WASM_ARTIFACT_PATH);
  const artifactStat = readStat(artifactPath);

  if (artifactStat === undefined) {
    throw new ValidationCliError(
      `The generated Wasm artifact is missing at ${GENERATED_WASM_ARTIFACT_PATH}. Run \`stellar contract build\` before deploying.`,
    );
  }
  if (artifactStat.isSymbolicLink()) {
    throw new ValidationCliError(
      'The generated Wasm artifact must be a regular build output, not a symbolic link.',
    );
  }
  if (!artifactStat.isFile() || artifactStat.size === 0) {
    throw new ValidationCliError(
      `The generated Wasm artifact at ${GENERATED_WASM_ARTIFACT_PATH} is not a non-empty regular file. Run \`stellar contract build\` before deploying.`,
    );
  }

  try {
    accessSync(artifactPath, constants.R_OK);
  } catch {
    throw new ValidationCliError(
      `The generated Wasm artifact at ${GENERATED_WASM_ARTIFACT_PATH} is not readable. Rebuild it with \`stellar contract build\`.`,
    );
  }

  let realProjectRoot: string;
  let realArtifactPath: string;
  try {
    realProjectRoot = realpathSync(projectRoot);
    realArtifactPath = realpathSync(artifactPath);
  } catch {
    throw new ValidationCliError(
      'The generated Wasm artifact could not be verified. Run `stellar contract build` before deploying.',
    );
  }

  if (!isCanonicalArtifactLocation(realProjectRoot, realArtifactPath)) {
    throw new ValidationCliError(
      'The generated Wasm artifact is outside the expected project workspace.',
    );
  }

  for (const sourceStat of collectContractSourceStats(projectRoot)) {
    if (sourceStat.mtimeMs > artifactStat.mtimeMs) {
      throw new ValidationCliError(
        'The generated Wasm artifact is stale. Run `stellar contract build` after the latest contract source changes.',
      );
    }
  }
}

export function resolveTestnetDeploymentPlan(
  input: TestnetDeploymentInput,
): readonly DevProcessSpec[] {
  if (input.network !== 'testnet') {
    throw new ValidationCliError(
      'StellarForge deploy supports only the explicit `--network testnet` target in the MVP.',
    );
  }

  validateIdentityAlias(input.source);

  const projectRoot = resolve(input.cwd);
  if (!existsSync(resolve(projectRoot, 'Cargo.toml'))) {
    throw new ValidationCliError(
      'No Cargo.toml workspace was found. MVP deployment currently supports generated Stellar smart-contract projects only.',
    );
  }

  validateGeneratedWasmArtifact(projectRoot);

  return [
    {
      label: 'stellar:deploy',
      command: process.platform === 'win32' ? 'stellar.exe' : 'stellar',
      args: [
        'contract',
        'deploy',
        '--wasm',
        GENERATED_WASM_ARTIFACT_PATH,
        '--source-account',
        input.source,
        '--network',
        'testnet',
      ],
      cwd: projectRoot,
    },
  ];
}

/**
 * Canonical Stellar Contract ID StrKey grammar.
 *
 * A valid Stellar Contract ID is exactly 56 characters:
 * - leading uppercase 'C'
 * - followed by exactly 55 characters from the RFC 4648 Base32 alphabet: [A-Z2-7]
 */
export const STELLAR_CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;

/**
 * Single-token pattern matching candidate contract identifiers
 * used to identify malformed, truncated, or misplaced key material on stdout.
 */
const STRKEY_OR_CANDIDATE_TOKEN = /^[A-Za-z0-9_=-]+$/;

export interface DeployedContractData {
  readonly contractId: string;
}

export type DeploymentContractData = DeployedContractData;

export interface DeploymentOutput {
  readonly stdout: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
}

/**
 * Type guard for a valid canonical Stellar Contract ID string.
 */
export function isValidContractId(candidate: unknown): candidate is string {
  return (
    typeof candidate === 'string' && STELLAR_CONTRACT_ID_REGEX.test(candidate)
  );
}

/**
 * Validates that candidate is a valid canonical Stellar Contract ID.
 * Throws SubprocessCliError if invalid.
 */
export function validateContractId(candidate: unknown): string {
  if (!isValidContractId(candidate)) {
    throw new SubprocessCliError(
      'Deployment output did not contain a valid Stellar contract ID.',
    );
  }
  return candidate;
}

/**
 * Hardens parsing of deployment output so a contract ID is accepted only
 * from the expected Stellar CLI output form and malformed or ambiguous text
 * cannot be mistaken for success.
 */
export function parseDeploymentOutput(
  output: string | DeploymentOutput,
): DeployedContractData {
  const stdout = typeof output === 'string' ? output : output.stdout;
  const exitCode = typeof output === 'string' ? 0 : output.exitCode;

  // Non-zero subprocess exit can never be treated as deployment success.
  if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
    throw new SubprocessCliError(
      `Development process 'stellar:deploy' exited unexpectedly with code ${exitCode}.`,
    );
  }

  if (exitCode === null) {
    throw new SubprocessCliError(
      "Development process 'stellar:deploy' terminated unexpectedly.",
    );
  }

  const lines = stdout.split(/\r?\n|\r/);
  const validIds: string[] = [];
  const malformedOrConflictingCandidates: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }

    // Official supported output format: the standalone contract ID on its own line
    if (STELLAR_CONTRACT_ID_REGEX.test(trimmed)) {
      validIds.push(trimmed);
      continue;
    }

    // Identify candidate single-token values that are malformed, truncated, or misplaced StrKeys
    if (STRKEY_OR_CANDIDATE_TOKEN.test(trimmed)) {
      if (/^[CGSM]/i.test(trimmed) || trimmed.length === 56) {
        malformedOrConflictingCandidates.push(redactSecretLikeText(trimmed));
      }
    }
  }

  if (malformedOrConflictingCandidates.length > 0) {
    throw new SubprocessCliError(
      'Deployment failed: Stellar CLI output contained a malformed, truncated, or invalid contract ID.',
    );
  }

  if (validIds.length === 0) {
    throw new SubprocessCliError(
      'Deployment failed: Stellar CLI output did not contain a valid contract ID in the expected format.',
    );
  }

  if (validIds.length > 1) {
    throw new SubprocessCliError(
      'Deployment failed: Stellar CLI output contained multiple or conflicting contract IDs.',
    );
  }

  const contractId = validIds[0]!;
  return { contractId };
}

/**
 * Validates deployment output and returns structured contract data.
 */
export function validateDeploymentOutput(
  output: string | DeploymentOutput,
): DeployedContractData {
  return parseDeploymentOutput(output);
}
