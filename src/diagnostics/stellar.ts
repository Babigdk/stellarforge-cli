import {
  classifyCommandResult,
  runCommand,
  type RunCommand,
} from './process.js';
import type { DiagnosticCheck, DiagnosticResult } from './types.js';
import { isAtLeast, parseNumericVersion } from './version.js';

// Protocol 27 is the current recommended Mainnet baseline in Stellar's
// software-version matrix. Keep this compatibility floor explicit and review
// it when StellarForge changes its supported network/tooling baseline.
const MINIMUM_STELLAR_CLI = { major: 27, minor: 1, patch: 0 } as const;

function parseStellarVersion(output: string): string | null {
  const value = output.trim();
  const match = /^v?(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value);
  return match?.[1] ?? null;
}

export function createStellarDiagnostic(
  execute: RunCommand = runCommand,
): DiagnosticCheck {
  return {
    id: 'stellar',
    label: 'Stellar CLI',
    run(): DiagnosticResult {
      // `stellar version --only-version` is the official machine-friendly
      // version command. It does not inspect identities, keys, or config.
      const result = execute('stellar', ['version', '--only-version']);

      if (classifyCommandResult(result) !== 'ok') {
        return {
          id: 'stellar',
          label: 'Stellar CLI',
          status: 'fail',
          message: 'Stellar CLI is unavailable or could not be executed.',
          remediation:
            'Install the current Stellar CLI and ensure `stellar` is available on PATH. See https://developers.stellar.org/docs/tools/cli/install-cli.',
        };
      }

      const version = parseStellarVersion(result.stdout);
      const parsed = version ? parseNumericVersion(version) : null;

      if (!version || !parsed) {
        return {
          id: 'stellar',
          label: 'Stellar CLI',
          status: 'fail',
          message: 'Stellar CLI returned an unrecognized version.',
          remediation:
            'Verify `stellar version --only-version` works and reinstall Stellar CLI if necessary.',
        };
      }

      if (!isAtLeast(parsed, MINIMUM_STELLAR_CLI)) {
        return {
          id: 'stellar',
          label: 'Stellar CLI',
          status: 'fail',
          message: `Unsupported Stellar CLI version ${version}.`,
          remediation:
            'Upgrade to Stellar CLI >=27.1.0 before using StellarForge Stellar workflows.',
        };
      }

      return {
        id: 'stellar',
        label: 'Stellar CLI',
        status: 'pass',
        message: `Supported version ${version} detected.`,
      };
    },
  };
}
