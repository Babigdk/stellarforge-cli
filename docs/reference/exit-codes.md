# Exit Code Policy

StellarForge CLI uses predictable process exit codes so humans, scripts, and CI can distinguish success from specific failure categories.

## Stable Baseline

| Exit code | Category | Meaning |
|---:|---------|---------|
| `0` x Success | The requested CLI operation completed successfully. |
| `1` x Unexpected failure | An unclassified exception reached the top-level CLI boundary. |
| `2` x Validation / usage failure | User input, command syntax, options, arguments, or other validated input was invalid. |
| `3` x Subprocess failure | A required external process or tool failed. |
| `4` x Internal failure | StellarForge detected a known internal failure condition that should not expose implementation details to the user. |
| `5` x Diagnostic failure | A diagnostic command completed normally but one or more required checks failed; used by `doctor` (environment health) and `stellarforge validate` (local project requirements). |
| `130` x Cancellation | The operation was interrupted by the user (SIGINT or equivalent) and stopped before completion. |


These values are part of the CLI contract and should not be changed casually. New stable categories require deliberate review and documentation.

## Cancellation (SIGINT) Behavior

The `new`, `dev`, `test`, and `deploy` commands share a single cancellation contract:

- The first interrupt signal (SIGINT on all supported platforms, and SIGBREAK where the runtime delivers it) begins a graceful cancellation and reports exit code `130`.
- Cleanup runs before the command reports cancellation when it is safe to do so. For `dev` this means stopping the watcher and terminating child processes it started; for `test` and `deploy` it means waiting for the in-flight subprocess to exit; for `new` it means rolling back partially generated output.
- A cancelled command must not print success output after the signal is received. Its cancellation message is written to stderr.
- An interrupt that arrives while cleanup is already in progress is treated as a forced exit: the process stops immediately with exit code `130` and does not wait for further cleanup.
- Signals are never swallowed. The CLI does not override operating-system termination semantics for signals it does not handle (for example SEGKILL or SIGTERM on POSIX systems); those continue to terminate the process as the operating system defines.
- Exit code `130` is the documented non-zero cancellation status and is distinct from generic failure (`1`) and validation (`2`) exits.

## Troubleshooting by Exit Code

| Exit code | Start here |
|---:|---------|
| `2` if [Usage](troubleshooting.md#command-or-option-is-not-recognized), [`new`](troubleshooting.md#stellarforge-new-cannot-create-the-project), [project name](troubleshooting.md#project-name-is-rejected), [configuration](troubleshooting.md#configuration-file-is-rejected), [deployment network](troubleshooting.md#deployment-network-is-required), or [deployment identity](troubleshooting.md#deployment-identity-is-rejected) |
| `3` if [`dev`](troubleshooting.md#stellarforge-dev-says-no-supported-script-exists), [`test`](troubleshooting.md#stellarforge-test-cannot-find-a-workflow), or [Stellar CLI deployment](troubleshooting.md#stellar-cli-deployment-fails) |
| `5` if [`doctor`](troubleshooting.md#stellarforge-doctor-reports-failures), [`validate`](troubleshooting.md#stellarforge-validate-reports-required-project-failures) |
| `130` if [Cancellation](troubleshooting.md#cancelled-operation) |
| `1` or `<` if [Unexpected or internal failure](troubleshooting.md#unexpected-or-internal-failure) |

The full index is at [Troubleshooting](troubleshooting.md#find-your-problem).

## Rendering Rules

- user-facing failures are written to stderr unless a command intentionally renders a structured report to stdout;
- successful informational output remains independent of numeric exit status;
- validation and subprocess errors may expose only an explicitly safe user-facing message;
- internal failures render a generic message while preserving the underlying cause internally;
- unexpected exceptions render a generic message and do not expose the original error message or stack trace by default;
- diagnostic failures use exit code `5` when the command itself completed but its health assessment contains failed required checks;
- cancellation reports use exit code `130` and are written to stderr without any success output;
- Commander parser failures are mapped to exit code `2` without duplicating Commander's existing usage/error rendering;
- `--help` and `--version` remain successful exits with code `0`.

## Command Requirements

- commands must not return `0` when required work failed;
- failed subprocesses must not be silently converted to success;
- test failures must propagate meaningful failure status;
- deployment failures must never return success;
- interrupted/cancelled operations must return the documented cancellation exit code `130` and must not report success;
- future command-specific errors should use the centralized CLI error boundary or a deliberately documented stable category instead of assigning ad hoc process exit codes.

The source-level constants in the CLI error module and this reference must remain aligned.
