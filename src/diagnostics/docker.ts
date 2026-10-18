import {
  classifyCommandResult,
  runCommand,
  type CommandOutcome,
  type RunCommand,
} from './process.js';
import type {
  DiagnosticCheck,
  DiagnosticResult,
  DiagnosticStatus,
} from './types.js';

export interface DockerDiagnosticOptions {
  readonly execute?: RunCommand;
  readonly required?: boolean;
}

function unavailableStatus(required: boolean): DiagnosticStatus {
  return required ? 'fail' : 'warn';
}

function parseDockerVersion(output: string): string | null {
  const match = /^Docker version (\d+\.\d+\.\d+)/i.exec(output.trim());
  return match?.[1] ?? null;
}

function timeoutMessage(required: boolean): string {
  return required
    ? 'Docker is required but the Docker CLI timed out.'
    : 'Docker CLI timed out; container-based workflows may be unavailable.';
}

function timeoutRemediation(): string {
  return 'Check that `docker --version` responds promptly and retry the diagnostic.';
}

function classifiedMessage(outcome: CommandOutcome): string {
  switch (outcome) {
    case 'missing-executable':
      return 'Docker CLI is not available; container-based workflows may be unavailable.';
    case 'timed-out':
      return timeoutMessage(false);
    default:
      return 'Docker CLI could not be executed; container-based workflows may be unavailable.';
  }
}

export function createDockerDiagnostic(
  options: DockerDiagnosticOptions = {},
): DiagnosticCheck {
  const execute = options.execute ?? runCommand;
  const required = options.required ?? false;

  return {
    id: 'docker',
    label: 'Docker',
    run(): DiagnosticResult {
      const client = execute('docker', ['--version']);
      const clientOutcome = classifyCommandResult(client);

      if (clientOutcome === 'timed-out') {
        return {
          id: 'docker',
          label: 'Docker',
          status: unavailableStatus(required),
          message: timeoutMessage(required),
          remediation: timeoutRemediation(),
        };
      }

      if (clientOutcome !== 'ok') {
        return {
          id: 'docker',
          label: 'Docker',
          status: unavailableStatus(required),
          message: required
            ? 'Docker is required but the Docker CLI is unavailable.'
            : classifiedMessage(clientOutcome),
          remediation:
            'Install Docker and ensure `docker` is available on PATH if your selected workflow requires containers.',
        };
      }

      const version = parseDockerVersion(client.stdout);

      if (!version) {
        return {
          id: 'docker',
          label: 'Docker',
          status: unavailableStatus(required),
          message: 'Docker returned an unrecognized client version.',
          remediation:
            'Verify `docker --version` works before using container-based workflows.',
        };
      }

      const daemon = execute('docker', [
        'info',
        '--format',
        '{{.ServerVersion}}',
      ]);
      const daemonOutcome = classifyCommandResult(daemon);

      if (daemonOutcome === 'timed-out') {
        return {
          id: 'docker',
          label: 'Docker',
          status: unavailableStatus(required),
          message: required
            ? `Docker ${version} is installed, but the Docker daemon timed out.`
            : `Docker ${version} is installed, but the daemon timed out; container-based workflows may not run.`,
          remediation:
            'Check that `docker info` responds promptly and retry the diagnostic.',
        };
      }

      if (daemonOutcome !== 'ok' || daemon.stdout.trim() === '') {
        return {
          id: 'docker',
          label: 'Docker',
          status: unavailableStatus(required),
          message: required
            ? `Docker ${version} is installed, but the Docker daemon is unavailable.`
            : `Docker ${version} is installed, but the daemon is unavailable; container-based workflows may not run.`,
          remediation:
            'Start the Docker daemon before running workflows that require containers.',
        };
      }

      return {
        id: 'docker',
        label: 'Docker',
        status: 'pass',
        message: `Client ${version} detected and Docker daemon is available.`,
      };
    },
  };
}
