# Requirements Document

## Introduction

StellarForge CLI reads a project-root file `stellarforge.config.json` on every command invocation.
The file carries a `version` field that guards the schema contract between the config file and the CLI release that reads it.

Currently, the validator treats every version value other than `1` with the same generic error regardless of whether the value is missing, non-numeric, or a valid integer that belongs to a future schema the current CLI does not understand.
This is a problem for users who write a config file on a newer CLI and then try to run commands on an older CLI release: the error message gives no actionable guidance.

This feature introduces a **forward-version rejection policy** that:
- preserves all existing version-1 behaviour unchanged,
- distinguishes a structurally invalid `version` field (missing, wrong type, non-integer, non-positive) from a structurally valid but unsupported future version integer,
- emits an actionable error message for future versions that tells the user to upgrade the CLI,
- documents the versioning policy and upgrade guidance in `docs/reference/configuration.md`, and
- adds tests covering future, missing, and malformed version values.

No automatic migration, config rewrite command, or new schema version beyond 1 is introduced here.

---

## Glossary

- **Schema_Validator**: The `validateStellarForgeConfig` function in `src/config/schema.ts` that accepts a parsed JSON value and either returns a typed `StellarForgeConfig` or throws a `ValidationCliError`.
- **Version_Field**: The `version` property in `stellarforge.config.json`.
- **Version_1**: The only currently supported schema version. Its accepted fields are `version`, `network`, and `identity`.
- **Future_Version**: A `version` integer value greater than `1`.
- **Malformed_Version**: A `version` field that is absent, `null`, a boolean, a string, a float, an array, an object, or an integer ≤ 0.
- **CLI**: The `stellarforge` command-line program.
- **ValidationCliError**: The error class in `src/errors/errors.ts` that exits the process with code `2`.
- **Config_File**: The file `stellarforge.config.json` located at the project root.

---

## Requirements

### Requirement 1: Version-1 behaviour remains unchanged

**User Story:** As a developer using a version-1 config file, I want the CLI to continue loading and validating my config exactly as before, so that upgrading to this release does not break any existing project.

#### Acceptance Criteria

1. THE Schema_Validator SHALL accept a JSON object whose `version` field equals the integer `1` and produce a `StellarForgeConfig` whose `version`, `network`, and `identity` fields equal the input values exactly.
2. WHEN a valid version-1 Config_File is loaded via `loadProjectConfig`, THE Schema_Validator SHALL return a `StellarForgeConfig` with `version: 1`, a `network` value drawn from the allowed set (`"mainnet"`, `"testnet"`, `"futurenet"`, `"local"`) matching the input, and an `identity` value matching the input alias string.
3. THE Schema_Validator SHALL accept a bare `{"version": 1}` object with no other fields present (yielding `undefined` for optional fields), and SHALL accept `{"version": 1, "network": "<any allowed network>"}` and `{"version": 1, "identity": "<any valid alias>"}` and the full combination of all three fields.
4. THE Schema_Validator SHALL continue to reject version-1 configs that contain fields other than `version`, `network`, and `identity`; that contain sensitive field names matching the redaction list; that supply a `network` value outside the allowed set; or that supply an `identity` value that is not a valid alias string — and SHALL do so with error messages byte-for-byte identical to those produced before this change.

---

### Requirement 2: Future schema versions produce an actionable error

**User Story:** As a developer whose config file was written for a newer CLI version, I want a clear error that tells me to upgrade the CLI, so that I understand what went wrong and what to do next rather than receiving a generic schema-version error.

#### Acceptance Criteria

1. WHEN the Version_Field is an integer greater than the highest schema version supported by the running CLI, THE Schema_Validator SHALL throw a `ValidationCliError`.
2. WHEN the Version_Field is an integer greater than the highest schema version supported by the running CLI, THE Schema_Validator SHALL produce an error message that contains the word "upgrade" and the string "stellarforge", so the user has an actionable remediation.
3. WHEN the Version_Field is an integer greater than the highest schema version supported by the running CLI, THE Schema_Validator SHALL include the detected version number in the error message so the user can confirm which version was read.
4. WHEN the Version_Field is an integer greater than the highest schema version supported by the running CLI, THE Schema_Validator SHALL NOT include phrases suggesting the config file should be checked or rewritten, because the config file is correct and the CLI is the stale party.

---

### Requirement 3: Malformed version fields are rejected with a consistent, non-reflective error

**User Story:** As an operator validating project configs in CI, I want all structurally invalid version fields to produce a predictable error, so that my pipelines can rely on stable exit codes and message patterns without leaking raw config values.

#### Acceptance Criteria

1. IF the Version_Field is absent from the Config_File, THEN THE Schema_Validator SHALL throw a `ValidationCliError` whose message contains the string `"version"` and the string `"required"`.
2. IF the Version_Field is `null`, a boolean, a string, an array, or an object, THEN THE Schema_Validator SHALL throw a `ValidationCliError` whose message contains the string `"version"` and the string `"must be a positive integer"`. The message MAY describe the received type but SHALL NOT include the literal submitted value.
3. IF the Version_Field is a numeric value for which `Number.isInteger(value) === false` or `value < 1` (covering floats, `0`, and negative integers), THEN THE Schema_Validator SHALL throw a `ValidationCliError` whose message contains the string `"version"` and the string `"must be a positive integer"`.
4. THE Schema_Validator SHALL NOT include the literal string representation of the submitted value in any Malformed_Version error message.
5. All Malformed_Version errors SHALL be thrown as `ValidationCliError` instances, which by class contract exit the process with code `2`.

---

### Requirement 4: Documentation explains the versioning policy and upgrade path

**User Story:** As a developer consulting the CLI reference docs, I want a clear explanation of when and why I need to upgrade the CLI, so that I can self-serve when I encounter a schema-version error.

#### Acceptance Criteria

1. THE `docs/reference/configuration.md` document SHALL contain a section headed "Schema versioning policy" that explains `version` is a compatibility guard and that an older CLI rejects an unknown future version rather than silently misinterpreting it.
2. THE `docs/reference/configuration.md` document SHALL state that when the CLI reports a future-version error, the user must upgrade the CLI to a release that supports the config's schema version.
3. THE `docs/reference/configuration.md` document SHALL state that schema version `1` is the only version currently supported.
4. THE `docs/reference/configuration.md` document SHALL document the error message text emitted for a future-version integer so operators can identify it in CI output.
5. THE `docs/reference/configuration.md` document SHALL document the error message text emitted for a missing `version` field and for a wrong-type or non-positive-integer `version` field, so operators can distinguish all three version-field failure modes in CI output.

---

### Requirement 5: Tests cover future, missing, and malformed version values

**User Story:** As a contributor maintaining schema validation, I want automated tests that cover all three invalid version categories, so that regressions in version-rejection behaviour are caught before release.

#### Acceptance Criteria

1. THE test suite SHALL include a test that passes `{ version: 2 }` to `validateStellarForgeConfig` and asserts that it throws a `ValidationCliError` whose message contains both `"upgrade"` and `"stellarforge"`.
2. THE test suite SHALL include tests for both `{ version: 2 }` and `{ version: 999 }` passed to `validateStellarForgeConfig`, asserting that each throws a `ValidationCliError` (both inputs are mandatory, not optional representatives).
3. THE test suite SHALL include a test that passes `{}` (a config object without a `version` field) to `validateStellarForgeConfig` and asserts that it throws a `ValidationCliError` whose message contains both `"version"` and `"required"`.
4. THE test suite SHALL include individual tests for each of the following Malformed_Version inputs passed to `validateStellarForgeConfig`: a string (e.g., `"1"`), a float (e.g., `1.5`), `null`, `0`, and a negative integer (e.g., `-1`) — asserting that each throws a `ValidationCliError` whose message contains both `"version"` and `"must be a positive integer"`.
5. THE test suite SHALL include a test that, for a future-version input (e.g., `{ version: 2 }`), asserts the error message contains the string `"2"` (the version number is included for actionability) and does NOT contain a sentinel string (e.g., `"SENTINEL_VALUE_NOT_IN_MESSAGE"`) that was never submitted — confirming the message is deterministic and not a raw value echo of unrelated input.
6. THE test suite SHALL include an integration-level test that writes `{ "version": 2 }` as a Config_File to a temporary directory, calls `loadProjectConfig` pointing at that directory, and asserts that it throws a `ValidationCliError` whose message contains `"upgrade"`.
