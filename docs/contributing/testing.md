# Testing Guidelines

StellarForge CLI uses Vitest for its automated TypeScript test suite. Tests should be deterministic, isolated, and safe to run from a clean checkout or CI environment.

## Test Categories

### Unit tests

Use unit tests for pure functions, error mapping, parsers, validation, and other logic that does not need a real process or filesystem boundary.

Keep unit tests close to the behavior they exercise and inject collaborators where practical instead of mutating global process state.

### Integration tests

Use integration tests when behavior depends on a compiled CLI artifact, filesystem effects, or a child process boundary.

The existing executable suite is the reference pattern for testing the built `dist/cli.js` artifact.

## Shared Helpers

Reusable test infrastructure lives under `tests/helpers/`.

- `temp-directory.ts` creates unique OS temp directories and provides deterministic cleanup, including cleanup when an action throws.
- `captured-output.ts` creates an injected `TerminalOutput` with in-memory stdout/stderr capture without replacing global process streams.
- `cli-process.ts` builds and invokes the compiled CLI using argument arrays with `shell: false`.

Prefer these helpers over duplicating fixture setup in individual test files.

## Filesystem Isolation

Tests that write files should use `createTempDirectoryFixture()` or `withTempDirectory()` instead of repository paths, user home directories, or shared static temp paths.

Every fixture must be cleaned deterministically. `withTempDirectory()` is preferred when cleanup should be guaranteed through a `finally` boundary.

## Process Tests

Use `runBuiltCli()` for compiled executable behavior. Do not construct shell command strings from test input.

Process tests should assert the relevant combination of:

- exit status;
- stdout;
- stderr;
- filesystem effects, when applicable.

## Network Policy

The default test suite must not require live network access. Tests should not contact Stellar RPC, Horizon, npm registries, GitHub, or other remote services unless a future explicitly separated integration-test policy authorizes it.

Network-facing code should be tested through injected or controlled boundaries whenever possible.

## Performance Benchmarks

`tests/generator-benchmark.test.ts` provides the bounded local benchmark harness for project generation. It measures all four bundled generation paths (`basic-app`, `full-stack`, `smart-contract`, `api-service`) through the same trusted template pipeline used by `stellarforge new`.

The harness is deliberately scoped to template rendering only. It performs no dependency installation, no Git initialization, and no network access, so the reported timings reflect local generator cost rather than registry or install latency. Each timed iteration generates into an isolated temporary directory that is removed afterwards.

The suite reports wall-clock statistics (mean, median, p95, min, max, standard deviation, and coefficient of variation) plus generated file counts and byte totals for each template. Report structure is deterministic: the environment metadata, iteration counts, template ordering, and artifact measurements are stable, so two runs on the same machine can be compared for regressions. Absolute timing is not asserted in CI because it varies by host.

Run just the harness locally:

```bash
npx vitest run tests/generator-benchmark.test.ts
```

Deepen the run for a more stable baseline by raising the bounded iteration count through an environment variable:

```bash
STELLARFORGE_BENCHMARK_ITERATIONS=20 npx vitest run tests/generator-benchmark.test.ts
```

The iteration count is clamped to a safe maximum so the harness always stays bounded. Capture the printed report as the comparison baseline for later runs on the same platform.

## Running Tests

From a clean checkout:

```bash
npm ci
npm test
```

`npm run test:e2e` builds and exercises the compiled CLI with temporary project directories and a fake Stellar executable; it does not contact live services. `npm run benchmark:doctor` runs five baseline samples and a timeout scenario with temporary fake PATH executables. It reports min/median/max timings without machine-dependent pass thresholds and requires a POSIX environment.

Before opening a pull request, run the full local validation set documented in the installation and contribution guides.
