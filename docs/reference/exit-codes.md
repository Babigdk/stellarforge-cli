# Exit Code Policy

StellarForge CLI uses predictable process exit codes so humans, scripts, and CI can distinguish success from specific failure categories.

## Stable Baseline

| Exit code | Category | Meaning |
|---:|---|---|
| `0` | Success | The requested CLI operation completed successfully. |
| `1` | Unexpected failure | An unclassified exception reached the top-level CLI boundary. |
| `2` | Validation / usage failure | User input, command syntax, options, arguments, or other validated input was invalid. |
| `3` | Subprocess failure | A required external process or tool failed. |
| `4` | Internal failure | StellarForge detected a known internal failure condition that should not expose implementation details to the user. |
| `5` | Diagnostic failure | A diagnostic command completed normally but one or more required health checks failed. |

These values are part of the CLI contract and should not be changed casually. New stable categories require deliberate review and documentation.

## Troubleshooting by Exit Code

| Exit code | Start here |
|---:|---|
| `2` | [Usage](troubleshooting.md#command-or-option-is-not-recognized), [`new`](troubleshooting.md#stellarforge-new-cannot-create-the-project), [project name](troubleshooting.md#project-name-is-rejected), [configuration](troubleshooting.md#configuration-file-is-rejected), [deployment network](troubleshooting.md#deployment-network-is-required), or [deployment identity](troubleshooting.md#deployment-identity-is-rejected) |
| `3` | [`dev`](troubleshooting.md#stellarforge-dev-says-no-supported-script-exists), [`test`](troubleshooting.md#stellarforge-test-cannot-find-a-workflow), or [Stellar CLI deployment](troubleshooting.md#stellar-cli-deployment-fails) |
| `5` | [`doctor`](troubleshooting.md#stellarforge-doctor-reports-failures) |
| `1` or `4` | [Unexpected or internal failure](troubleshooting.md#unexpected-or-internal-failure) |

The full index is at [Troubleshooting](troubleshooting.md#find-your-problem).

## Rendering Rules

- user-facing failures are written to stderr unless a command intentionally renders a structured report to stdout;
- successful informational output remains independent of numeric exit status;
- validation and subprocess errors may expose only an explicitly safe user-facing message;
- internal failures render a generic message while preserving the underlying cause internally;
- unexpected exceptions render a generic message and do not expose the original error message or stack trace by default;
- diagnostic failures use exit code `5` when the command itself completed but its health assessment contains failed required checks;
- Commander parser failures are mapped to exit code `2` without duplicating Commander's existing usage/error rendering;
- `--help` and `--version` remain successful exits with code `0`.

## Command Requirements

- commands must not return `0` when required work failed;
- failed subprocesses must not be silently converted to success;
- test failures must propagate meaningful failure status;
- deployment failures must never return success;
- interrupted/cancelled-operation semantics will be documented when cancellation support is implemented;
- future command-specific errors should use the centralized CLI error boundary or a deliberately documented stable category instead of assigning ad hoc process exit codes.

The source-level constants in the CLI error module and this reference must remain aligned.
