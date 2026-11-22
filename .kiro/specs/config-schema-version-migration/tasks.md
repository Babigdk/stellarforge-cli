# Implementation Plan: Config Schema Version Migration

## Overview

Replace the single `if (value.version !== 1)` branch in `validateStellarForgeConfig` (`src/config/schema.ts`) with three ordered branches (absent → malformed → future), write a new test file covering all three rejection paths plus four property-based tests, and add a "Schema versioning policy" section to `docs/reference/configuration.md`. No other source files change.

## Tasks

- [ ] 1. Install fast-check and update the version-check logic in `src/config/schema.ts`
  - [ ] 1.1 Add fast-check as a dev dependency
    - Run `npm install --save-dev fast-check` in the project root
    - Confirm `fast-check` appears under `devDependencies` in `package.json`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 1.2 Replace the single version branch with three ordered branches
    - Open `src/config/schema.ts`
    - Delete the existing `if (value.version !== 1)` block (which throws `'stellarforge.config.json must declare "version": 1.'`)
    - Insert the three branches in this order, before the `network` / `identity` validation:
      1. **Absent** (`value.version === undefined`): throw `ValidationCliError` with message `stellarforge.config.json is missing the required "version" field.`
      2. **Malformed** (`typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1`): throw `ValidationCliError` with message `"version" must be a positive integer.`
      3. **Future** (`value.version > 1`): throw `ValidationCliError` with message `` `This config declares schema version ${value.version}, which requires a newer stellarforge CLI. Please upgrade stellarforge to continue.` ``
    - Leave every line outside these three new branches byte-for-byte identical to the current file
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 2. Write `tests/config-schema-version.test.ts`
  - [ ] 2.1 Add unit tests for future-version rejection
    - Import `validateStellarForgeConfig` from `../src/config/schema.js` and `ValidationCliError` from `../src/errors/index.js`
    - Test `{ version: 2 }`: asserts `ValidationCliError`, message contains `"upgrade"` and `"stellarforge"`
    - Test `{ version: 999 }`: asserts `ValidationCliError`, message contains `"upgrade"` and `"stellarforge"`
    - Test `{ version: 2 }`: asserts message contains `"2"` and does NOT contain `"SENTINEL_VALUE_NOT_IN_MESSAGE"`
    - _Requirements: 5.1, 5.2, 5.5_

  - [ ] 2.2 Add unit test for absent-version rejection
    - Test `{}`: asserts `ValidationCliError`, message contains `"version"` and `"required"`
    - _Requirements: 5.3_

  - [ ] 2.3 Add unit tests for malformed-version rejection
    - Test each of `"1"`, `1.5`, `null`, `0`, `-1` individually
    - Each asserts `ValidationCliError`, message contains `"version"` and `"must be a positive integer"`
    - _Requirements: 5.4_

  - [ ] 2.4 Add integration test for future-version via `loadProjectConfig`
    - Import `loadProjectConfig`, `PROJECT_CONFIG_FILENAME` from `../src/config/project.js`
    - Import `withTempDirectory` from `./helpers/index.js`
    - Write `{"version":2}` to `PROJECT_CONFIG_FILENAME` in a temp directory, call `loadProjectConfig(dir)`, assert throws `ValidationCliError` with message containing `"upgrade"`
    - _Requirements: 5.6_

  - [ ]* 2.5 Write property test for Property 1 — version-1 round trip
    - Import `fc` from `fast-check`
    - Use `fc.assert(fc.property(...))` with arbitrary valid version-1 objects (combinations of `version: 1`, optional `network` from `'testnet' | 'futurenet' | 'mainnet'`, optional valid `identity`)
    - Assert `result.version === 1`, `result.network === config.network`, `result.identity === config.identity`
    - Tag with comment: `// Feature: config-schema-version-migration, Property 1: version-1 round trip`
    - **Property 1: Version-1 round trip**
    - **Validates: Requirements 1.1, 1.3**

  - [ ]* 2.6 Write property test for Property 2 — future version produces actionable upgrade error
    - Use `fc.integer({ min: 2 })` as the arbitrary
    - Assert `ValidationCliError` is thrown, message includes `'upgrade'`, `'stellarforge'`, and `String(v)`
    - Tag with comment: `// Feature: config-schema-version-migration, Property 2: future version actionable error`
    - **Property 2: Future version produces actionable upgrade error**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ]* 2.7 Write property test for Property 3 — absent version produces required-field error
    - Use `fc.record({ network: fc.option(fc.constantFrom('testnet', 'futurenet', 'mainnet')) })` to generate objects without a `version` field
    - Assert `ValidationCliError` is thrown, message includes `'version'` and `'required'`
    - Tag with comment: `// Feature: config-schema-version-migration, Property 3: absent version required error`
    - **Property 3: Absent version produces required-field error**
    - **Validates: Requirements 3.1**

  - [ ]* 2.8 Write property test for Property 4 — malformed version produces type-constraint error without value echo
    - Build `malformedVersionArb` with `fc.oneof`: `null`, booleans, strings, arrays, records, `fc.double({ noInteger: true })`, `0`, `fc.integer({ max: -1 })`
    - Assert `ValidationCliError` is thrown, message includes `'version'` and `'must be a positive integer'`, message does NOT include `String(v)`
    - Tag with comment: `// Feature: config-schema-version-migration, Property 4: malformed version type-constraint error`
    - **Property 4: Malformed version produces type-constraint error without value echo**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5**

- [ ] 3. Checkpoint — ensure all tests pass
  - Run `npm test` (or `npx vitest run`) and confirm:
    - All new tests in `tests/config-schema-version.test.ts` pass
    - `tests/configuration.test.ts` and `tests/config-network-enum.test.ts` continue to pass without modification
  - Ask the user if any questions arise before proceeding.

- [ ] 4. Add "Schema versioning policy" section to `docs/reference/configuration.md`
  - [ ] 4.1 Append the new section to `docs/reference/configuration.md`
    - Add a `## Schema versioning policy` heading after the existing content
    - Explain that `version` is a compatibility guard: an older CLI rejects an unknown future version rather than silently misinterpreting it
    - State that when the CLI reports a future-version error, the user must upgrade the CLI to a release that supports the config's schema version
    - State that schema version `1` is the only version currently supported
    - Document the exact error message text for all three failure modes:
      - Future version: `` This config declares schema version ${value.version}, which requires a newer stellarforge CLI. Please upgrade stellarforge to continue. ``
      - Absent version: `stellarforge.config.json is missing the required "version" field.`
      - Malformed version: `"version" must be a positive integer.`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 5. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- `src/config/schema.ts` is the **only** source file that changes; `project.ts` and `errors.ts` are untouched
- fast-check is not yet a dev dependency — task 1.1 must complete before any property tests can run
- The three version branches must be ordered absent → malformed → future; reversing the order would cause the `undefined` absent case to be misclassified as malformed
- Error messages are normative: the exact strings must match the values specified in task 1.2 and task 4.1
- The future-version message intentionally echoes the integer version number (actionable info); the malformed-version message must NOT echo the submitted value
- Regression guard: `tests/configuration.test.ts` and `tests/config-network-enum.test.ts` must pass without any edits

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "2.6", "2.7", "2.8"] },
    { "id": 4, "tasks": ["4.1"] }
  ]
}
```
