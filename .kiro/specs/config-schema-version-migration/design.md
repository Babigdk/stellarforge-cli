# Design Document: Config Schema Version Migration

## Overview

`validateStellarForgeConfig` in `src/config/schema.ts` currently collapses all non-1 version values into a single error branch. This design replaces that branch with three distinct code paths:

1. **Future version** (integer > 1): actionable upgrade message.
2. **Absent version**: required-field message.
3. **Malformed version** (wrong type, float, zero, negative): type-constraint message.

No new schema versions are introduced. No config rewrite or migration logic is added. All existing version-1 validation logic, field ordering, and error messages stay byte-for-byte identical.

The change also adds a "Schema versioning policy" section to `docs/reference/configuration.md` and a new test file `tests/config-schema-version.test.ts`.

---

## Architecture

The feature is a pure logic extension inside the existing validation layer. The call graph is unchanged:

```
CLI command
  └── loadProjectConfig(cwd)         [src/config/project.ts]
        └── validateStellarForgeConfig(parsed)  [src/config/schema.ts]
              └── ValidationCliError            [src/errors/errors.ts]
```

`project.ts` and `errors.ts` require no changes. All new behaviour lives in `schema.ts`.

---

## Components and Interfaces

### `validateStellarForgeConfig` — updated version-check logic

**Current behaviour** (single branch):

```ts
if (value.version !== 1) {
  throw new ValidationCliError(
    'stellarforge.config.json must declare "version": 1.',
  );
}
```

**Replacement** (three branches, ordered absent → malformed → future):

```ts
// 1. Absent
if (value.version === undefined) {
  throw new ValidationCliError(
    'stellarforge.config.json is missing the required "version" field.',
  );
}

// 2. Malformed: wrong type, float, zero, or negative
if (
  typeof value.version !== 'number' ||
  !Number.isInteger(value.version) ||
  value.version < 1
) {
  throw new ValidationCliError(
    '"version" must be a positive integer.',
  );
}

// 3. Future version (valid integer > 1)
if (value.version > 1) {
  throw new ValidationCliError(
    `This config declares schema version ${value.version}, which requires a newer stellarforge CLI. ` +
    `Please upgrade stellarforge to continue.`,
  );
}
```

The existing `network` and `identity` validation that follows this block is unchanged.

### `StellarForgeConfig` type

No change. The `readonly version: 1` literal type remains correct because the validator's return type is `StellarForgeConfig`, which is only reached after confirming `value.version === 1`.

### Error messages (normative)

| Condition | Required substrings | Prohibited content |
|---|---|---|
| Future version integer | `"upgrade"`, `"stellarforge"`, the version number as digits | phrases suggesting the config is wrong |
| Version field absent | `"version"`, `"required"` | — |
| Wrong type / float / ≤ 0 | `"version"`, `"must be a positive integer"` | literal submitted value |

### `docs/reference/configuration.md`

A new section "Schema versioning policy" is appended. It explains:
- the guard contract (older CLI rejects unknown future versions),
- the upgrade action,
- version 1 as the only currently supported version,
- the exact error message text for all three failure modes.

### `tests/config-schema-version.test.ts`

New test file. Imports `validateStellarForgeConfig` from `../src/config/schema.js` and `ValidationCliError` from `../src/errors/index.js`. Integration tests use `withTempDirectory` from `./helpers/index.js` and `loadProjectConfig`, `PROJECT_CONFIG_FILENAME` from `../src/config/project.js`. Follows Vitest conventions (`describe`, `it`, `it.each`, `expect`).

---

## Data Models

No new data types. The existing types are unchanged:

```ts
// src/config/schema.ts (unchanged)
export interface StellarForgeConfig {
  readonly version: 1;
  readonly network?: StellarForgeNetwork;
  readonly identity?: string;
}
```

The `version` field in the raw parsed JSON is typed as `unknown` during validation (it enters as `Record<string, unknown>[version]`), which is correct — the new conditional chain narrows it progressively.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Version-1 round trip

*For any* valid version-1 config object (with any combination of allowed `network` and `identity` values), calling `validateStellarForgeConfig` should return a `StellarForgeConfig` whose `version`, `network`, and `identity` fields equal the corresponding input values exactly.

**Validates: Requirements 1.1, 1.3**

---

### Property 2: Future version produces actionable upgrade error

*For any* integer greater than 1 supplied as the `version` field, `validateStellarForgeConfig` should throw a `ValidationCliError` whose message contains the word `"upgrade"`, the string `"stellarforge"`, and the string representation of that integer.

**Validates: Requirements 2.1, 2.2, 2.3**

---

### Property 3: Absent version produces required-field error

*For any* object that is a valid JSON record but has no `version` field (regardless of what other fields are present), `validateStellarForgeConfig` should throw a `ValidationCliError` whose message contains both `"version"` and `"required"`.

**Validates: Requirements 3.1**

---

### Property 4: Malformed version produces type-constraint error without value echo

*For any* value supplied as `version` that is not a positive integer — covering `null`, booleans, strings, arrays, objects, floats, zero, and negative integers — `validateStellarForgeConfig` should throw a `ValidationCliError` whose message contains both `"version"` and `"must be a positive integer"`, and whose message does NOT contain the string representation of the submitted value.

**Validates: Requirements 3.2, 3.3, 3.4, 3.5**

---

## Error Handling

All errors thrown by this feature are `ValidationCliError` instances, which the class contract guarantees will exit the process with code `2`. No new error classes or exit codes are needed.

The validator deliberately does not echo the submitted version value in malformed-version messages (Requirement 3.4). The future-version message includes the integer version number because that is the actionable information the user needs to identify which CLI release to install; it is not a reflection of arbitrary user-controlled string input.

The order of version-check branches matters:

1. **Absent check first** (`=== undefined`): ensures the subsequent numeric checks do not evaluate `undefined` as a number.
2. **Malformed check second**: covers all non-positive-integer numerics and wrong types.
3. **Future-version check third**: by this point the value is guaranteed to be an integer ≥ 1; only `> 1` reaches this branch.
4. **Implicit version-1 path**: the existing `network`/`identity` validation proceeds unchanged.

The surrounding field-allowlist check (sensitive fields, unknown fields) runs before the version check, as today, so those error paths are unaffected.

---

## Testing Strategy

### Unit tests — `tests/config-schema-version.test.ts`

**Future-version tests** (Requirement 5.1, 5.2, 5.5):
- `{ version: 2 }` → throws `ValidationCliError`; message contains `"upgrade"` and `"stellarforge"`.
- `{ version: 999 }` → throws `ValidationCliError`; message contains `"upgrade"` and `"stellarforge"`.
- `{ version: 2 }` → message contains `"2"`; message does NOT contain `"SENTINEL_VALUE_NOT_IN_MESSAGE"`.

**Absent-version test** (Requirement 5.3):
- `{}` → throws `ValidationCliError`; message contains `"version"` and `"required"`.

**Malformed-version tests** (Requirement 5.4):
- Each of `"1"`, `1.5`, `null`, `0`, `-1` → throws `ValidationCliError`; message contains `"version"` and `"must be a positive integer"`.

**Integration test** (Requirement 5.6):
- Write `{"version":2}` to a temp file, call `loadProjectConfig(dir)`, verify throws `ValidationCliError` with message containing `"upgrade"`.

### Property-based tests — `tests/config-schema-version.test.ts`

The project uses Vitest. For property-based testing, use [fast-check](https://fast-check.dev/) — a TypeScript-native PBT library that integrates directly with Vitest via `fc.assert(fc.property(...))`. Each `fc.assert` call runs 100+ iterations by default.

**Property 1 — Version-1 round trip**:
```
// Feature: config-schema-version-migration, Property 1: version-1 round trip
fc.assert(fc.property(
  fc.constantFrom('testnet', 'futurenet', 'mainnet').chain(network =>
    fc.record({
      version: fc.constant(1 as const),
      network: fc.constant(network),
    })
  ),
  (config) => {
    const result = validateStellarForgeConfig(config);
    return result.version === 1 && result.network === config.network;
  }
));
```

**Property 2 — Future version produces actionable upgrade error**:
```
// Feature: config-schema-version-migration, Property 2: future version actionable error
fc.assert(fc.property(
  fc.integer({ min: 2 }),
  (v) => {
    try {
      validateStellarForgeConfig({ version: v });
      return false;
    } catch (e) {
      return e instanceof ValidationCliError
        && e.message.includes('upgrade')
        && e.message.includes('stellarforge')
        && e.message.includes(String(v));
    }
  }
));
```

**Property 3 — Absent version produces required-field error**:
```
// Feature: config-schema-version-migration, Property 3: absent version required error
fc.assert(fc.property(
  fc.record({
    network: fc.option(fc.constantFrom('testnet', 'futurenet', 'mainnet')),
  }),
  (obj) => {
    try {
      validateStellarForgeConfig(obj); // no version field
      return false;
    } catch (e) {
      return e instanceof ValidationCliError
        && e.message.includes('version')
        && e.message.includes('required');
    }
  }
));
```

**Property 4 — Malformed version produces type-constraint error without value echo**:
```
// Feature: config-schema-version-migration, Property 4: malformed version type-constraint error
const malformedVersionArb = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.string(),
  fc.array(fc.anything()),
  fc.record({}),
  fc.double({ noInteger: true }),      // floats
  fc.constant(0),
  fc.integer({ max: -1 }),             // negative integers
);
fc.assert(fc.property(
  malformedVersionArb,
  (v) => {
    try {
      validateStellarForgeConfig({ version: v });
      return false;
    } catch (e) {
      return e instanceof ValidationCliError
        && e.message.includes('version')
        && e.message.includes('must be a positive integer')
        && !e.message.includes(String(v));  // no value echo
    }
  }
));
```

Each property test should be tagged with the comment format above so it can be traced back to the design.

### Regression guard

The existing tests in `tests/configuration.test.ts` and `tests/config-network-enum.test.ts` cover version-1 acceptance and all other field-level validations. They must continue to pass without modification, confirming Requirement 1.4 (messages unchanged).
