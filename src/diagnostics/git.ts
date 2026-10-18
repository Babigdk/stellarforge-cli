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

      if (classifyCommandResult(result) !== 'ok') {
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
          message: 'Git returned an unrecognized version.',
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
