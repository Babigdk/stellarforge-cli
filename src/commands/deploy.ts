import { Command } from 'commander';
import {
  resolveProjectConfig,
  type ProjectConfigOverrides,
  type ResolvedProjectConfig,
} from '../config/project.js';
import {
  defaultSpawnProcess,
  superviseDevProcesses,
  type DevOrchestratorOptions,
  type DevProcessSpawner,
} from '../dev/orchestrator.js';
import type { DevProcessSpec } from '../dev/project.js';
import {
  resolveTestnetDeploymentPlan,
  runDeploymentPreflight,
  validateDeploymentOutput,
  DEPLOYMENT_TERMINATION_GRACE_MS,
  DEPLOYMENT_TIMEOUT_MS,
  type DeployedContractData,
  type DeploymentOutput,
  type DeploymentPreflightResult,
  type TestnetDeploymentInput,
} from '../deployment/project.js';
import { ValidationCliError } from '../errors/errors.js';
import { CancellationCliError } from '../errors/boundary.js';
import { TerminalOutput } from '../output/terminal.js';

export interface DeployCommandOptions extends DevOrchestratorOptions {
  readonly cwd?: () => string;
  readonly resolveConfig?: (
    cwd: string,
    overrides: ProjectConfigOverrides,
  ) => ResolvedProjectConfig;
  readonly resolvePlan?: (
    input: TestnetDeploymentInput,
  ) => readonly DevProcessSpec[];
  readonly runPreflight?: (
    input: TestnetDeploymentInput,
  ) => DeploymentPreflightResult;
  readonly validateDeployment?:
    | boolean
    | ((output: DeploymentOutput) => DeployedContractData);
}

interface DeployCommandFlags {
  readonly network?: string;
  readonly source?: string;
  readonly preflight?: boolean;
}

function isCancellationError(error: unknown): boolean {
  if (error instanceof CancellationCliError) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'SIGINT' || code === 'CANCELLED';
 }

export function createDeployCommand(
  options: DeployCommandOptions = {},
): Command {
  const {
    cwd = () => process.cwd(),
    output = new TerminalOutput(),
    resolveConfig = resolveProjectConfig,
    resolvePlan = resolveTestnetDeploymentPlan,
    runPreflight = runDeploymentPreflight,
    validateDeployment,
  } = options;

  return new Command('deploy')
    .description('Deploy a supported StellarForge project to Stellar Testnet.')
    .option(
      '--network <network>',
      'Deployment network. CLI value overrides stellarforge.config.json.',
    )
    .option(
      '--source <identity>',
      'Named Stellar CLI identity alias. CLI value overrides project configuration.',
    )
    .option(
      '--preflight',
      'Validate deployment inputs and project requirements without starting the Stellar CLI.',
    )
    .action(async (flags: DeployCommandFlags) => {
      const projectRoot = cwd();

      const overrides: ProjectConfigOverrides = {
        ...(flags.network === undefined ? {} : { network: flags.network }),
        ...(flags.source === undefined ? {} : { identity: flags.source }),
      };

      const configuration = resolveConfig(projectRoot, overrides);

      const { network, identity } = configuration;

      if (network === undefined) {
        throw new ValidationCliError(
          'Deployment network is required. Pass `--network testnet` or set an explicit network in stellarforge.config.json.',
        );
      }

      if (identity === undefined) {
        throw new ValidationCliError(
          'Deployment identity is required. Pass `--source <identity>` or set a named identity in stellarforge.config.json.',
        );
      }

      // Local-only preflight: no subprocess, no network, no identity echo.
      const preflight = runPreflight({
        cwd: projectRoot,
        network,
        source: identity,
      });
      output.info('Deployment preflight:');
      for (const check of preflight.checks) {
        output.info(`  [${check.passed ? 'PASS' : 'FAIL'}] ${check.label}`);
      }
      if (!preflight.passed) {
        const remediations = preflight.checks
          .filter((check) => !check.passed && check.remediation !== undefined)
          .map((check) => `- ${check.remediation}`);
        throw new ValidationCliError(
          `Deployment preflight failed. Remediation:\n${remediations.join('\n')}`,
        );
      }

      if (flags.preflight) {
        output.info('Preflight only. No Stellar CLI process was started.');
        return;
      }

      const plan = resolvePlan({
        cwd: projectRoot,
        network,
        source: identity,
      });

      output.info('Deploying smart contract to Stellar Testnet.');

      let capturedStdout = '';
      let capturedStderr = '';
      let childExitCode: number | null = 0;

      let effectiveSpawnProcess: DevProcessSpawner | undefined =
        options.spawnProcess;
      if (validateDeployment) {
        const baseSpawner = options.spawnProcess ?? defaultSpawnProcess;
        effectiveSpawnProcess = (spec, env) => {
          const child = baseSpawner(spec, env);
          child.stdout.on('data', (chunk) => {
            capturedStdout += String(chunk);
          });
          child.stderr.on('data', (chunk) => {
            capturedStderr += String(chunk);
          });
          child.once('exit', (code) => {
            childExitCode = code;
          });
          return child;
        };
      }

      try {
        await superviseDevProcesses(plan, {
          ...options,
          output,
          timeoutMs: DEPLOYMENT_TIMEOUT_MS,
          terminationGraceMs: DEPLOYMENT_TERMINATION_GRACE_MS,
          timeoutMessage:
            'Deployment timed out locally after 10 minutes. The remote submission outcome is uncertain; verify the transaction manually before retrying.',
          ...(effectiveSpawnProcess === undefined
            ? {}
            : { spawnProcess: effectiveSpawnProcess }),
        });
      } catch (error) {
        if (isCancellationError(error)) {
          throw new CancellationCliError('deploy');
        }
        throw error;
      }

      if (validateDeployment) {
        const validator =
          typeof validateDeployment === 'function'
            ? validateDeployment
            : validateDeploymentOutput;
        validator({
          stdout: capturedStdout,
          stderr: capturedStderr,
          exitCode: childExitCode,
        });
      }
    });
}
