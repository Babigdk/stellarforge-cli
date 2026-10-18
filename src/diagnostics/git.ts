import {
  classifyCommandResult,
  runCommand,
  type RunCommand,
} from './process.js';
import type { DiagnosticCheck, DiagnosticResult } from './types.js';

function parseGitVersion(output: string): string | null {
  const match = /^git version (\d+\.\d+\.\d+)/i.exec(output.trim());
  return match?.[1] ?? null;
}

export function createGitDiagnostic(
  execute: RunCommand = runCommand,
): DiagnosticCheck {
  return {
    id: 'git',
    label: 'Git',
    run(): DiagnosticResult {
      const result = execute('git', ['--version']);
      const outcome = classifyCommandResult(result);

      if (outcome === 'timeout') {
        return {
          id: 'git',
          label: 'Git',
          status: 'fail',
          message: 'Git timed out while reporting its version.',
          remediation:
            'Check that `git --version` responds promptly and retry the diagnostic.',
        };
      }

      if (outcome !== 'ok') {
        return {
          id: 'git',
          label: 'Git',
          status: 'fail',
          message: 'Git is unavailable or could not be executed.',
          remediation: 'Install Git and ensure `git` is available on PATH.',
        };
      }

      const version = parseGitVersion(result.stdout);

      if (!version) {
        return {
          id: 'git',
          label: 'Git',
          status: 'fail',
          message: 'Git returned an unecognized version.',
          remediation:
            'Verify `git --version` works and reinstall Git if necessary.',
        };
      }

      return {
        id: 'git',
        label: 'Git',
        status: 'pass',
        message: `Version ${version} detected.`,
      };
    },
  };
}
