# ADR-0005: Project Configuration Contract

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decision owners:** StellarForge Core Team

## Context

StellarForge commands increasingly need project-scoped settings such as the selected Stellar network and the named Stellar CLI identity used for deployment. Those settings must be deterministic, testable, safe to load in developer machines and CI, and compatible with the security baseline.

Executable JavaScript or TypeScript configuration would introduce code-execution risk. Environment-variable precedence would also make effective behavior less visible for the MVP. Raw signing material must not become ordinary project configuration.

## Decision

The MVP project configuration file is a single root-level file named `stellarforge.config.json`.

The schema is versioned and intentionally small:

```json
{
  "version": 1,
  "network": "testnet",
  "identity": "deployer"
}
```

Supported fields are:

- `version`: required and currently must equal `1`;
- `network`: optional and must be one of `testnet`, `futurenet`, or `mainnet`;
- `identity`: optional and must be a named Stellar CLI identity alias.

No raw secret keys, seed phrases, mnemonic material, access tokens, passwords, private keys, or arbitrary extension fields are accepted.

## Precedence

For commands that expose an explicit CLI override, effective configuration is resolved as:

1. explicit CLI option;
2. `stellarforge.config.json`;
3. missing.

There is no implicit network default. In particular, StellarForge must never silently select Mainnet.

The presence of `mainnet` in the configuration schema does not authorize every command to use Mainnet. Commands retain their own safety boundary. The MVP `deploy` command remains Testnet-only and rejects other networks after configuration resolution.

## Loading Rules

- configuration is loaded only from the current project root;
- the file must be a regular file and must not be a symbolic link;
- the MVP file-size limit is 64 KiB;
- configuration is encoded as UTF-8 (a single leading byte-order mark is tolerated);
- configuration is parsed as JSON and never executed;
- duplicate object keys at any nesting level (including escaped-equivalent spellings) are rejected before schema validation, so no value can come from an ambiguous document;
- malformed or invalid configuration produces actionable errors;
- errors must not include raw configuration contents or secret values.

## Consequences

### Positive

- project behavior is deterministic and visible in source control;
- configuration parsing cannot execute project code;
- command-line overrides remain explicit and testable;
- network-sensitive behavior cannot silently fall through to Mainnet;
- secret-bearing configuration is rejected early.

### Trade-offs

- the MVP does not support environment-specific config files or environment-variable precedence;
- advanced network/custom-RPC configuration is deferred;
- schema additions require deliberate compatibility and security review.

## Follow-up

Future schema versions may add non-secret network metadata or command-specific configuration. Any extension involving credentials, RPC authentication, remote configuration, or executable plugins requires separate security review.
