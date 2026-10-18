import {
  classifyCommandResult,
  runCommand,
  type RunCommand,
} from './process.js';
import type { DiagnosticCheck, DiagnosticResult } from './types.js';
import { isAtLeast, parseNumericVersion } from './version.js';

const MINIMUM_RUST = { major: 1, minor: 84, patch: 0 } as const;

function parseToolVersion(
  output: string,
  tool: 'rustc' | 'cargo',
): string | null {
  const match = new RegExp(`^${tool} (\\d+\\.\\d+\\.\\d+)`, 'i').exec(
    output.trim(),
  );
  return match?.[1] ?? null;
}

export function createRustDiagnostic(
  execute: RunCommand = runCommand,
): DiagnosticCheck {
  return {
    id: 'rust',
    label: 'Rust',
    run(): DiagnosticResult {
      const result = execute('rustc', ['--version']);

      if (classifyCommandResult(result) !== 'ok') {
        return {
          id: 'rust',
          label: 'Rust',
          status: 'fail',
          message: 'Rust is unavailable or could not be executed.',
          remediation:
            'Install Rust >=1.84.0 and ensure `rustc` is available on PATH.',
        };
      }

      const version = parseToolVersion(result.stdout, 'rustc');
      const parsed = version ? parseNumericVersion(version) : null;

      if (!version || !parsed) {
        return {
          id: 'rust',
          label: 'Rust',
          status: 'fail',
          message: 'Rust returned an unrecognized version.',
          remediation:
            'Verify `rustc --version` works and reinstall Rust if necessary.',
        };
      }

      if (!isAtLeast(parsed, MINIMUM_RUST)) {
        return {
          id: 'rust',
          label: 'Rust',
          status: 'fail',
          message: `Unsupported Rust version ${version}.`,
          remediation:
            'Upgrade to Rust >=1.84.0 before building Stellar smart contracts.',
        };
      }

      return {
        id: 'rust',
        label: 'Rust',
        status: 'pass',
        message: `Supported version ${version} detected.`,
      };
    },
  };
}

export function createCargoDiagnostic(
  execute: RunCommand = runCommand,
): DiagnosticCheck {
  return {
    id: 'cargo',
    label: 'Cargo',
    run(): DiagnosticResult {
      const result = execute('cargo', ['--version']);

      if (classifyCommandResult(result) !== 'ok') {
        return {
          id: 'cargo',
          label: 'Cargo',
          status: 'fail',
          message: 'Cargo is unavailable or could not be executed.',
          remediation: 'Install Cargo and ensure `cargo` is available on PATH.',
        };
      }

      const version = parseToolVersion(result.stdout, 'cargo');

      if (!version || !parseNumericVersion(version)) {
        return {
          id: 'cargo',
          label: 'Cargo',
          status: 'fail',
          message: 'Cargo returned an unrecognized version.',
          remediation:
            'Verify `cargo --version` works and reinstall Cargo if necessary.',
        };
      }

      return {
        id: 'cargo',
        label: 'Cargo',
        status: 'pass',
        message: `Version ${version} detected.`,
      };
    },
  };
}
