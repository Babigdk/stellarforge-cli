# Configuration Reference

StellarForge uses an optional project-root configuration file named `stellarforge.config.json`.

## MVP schema

```json
{
  "version": 1,
  "network": "testnet",
  "identity": "deployer"
}
```

`version` is required and must currently be `1`.

`network` is optional and accepts `testnet`, `futurenet`, or `mainnet`. A configured network does not bypass command-specific restrictions: the MVP deploy command still permits Testnet only.

`identity` is optional and must be the name of an identity already managed by Stellar CLI. StellarForge does not accept raw secret keys, seed phrases, public StrKeys, filesystem paths, tokens, or password-like fields in project configuration.

## Precedence

Where a command exposes a CLI override, the order is:

1. explicit CLI option;
2. project configuration;
3. missing.

StellarForge does not silently default a missing network to Mainnet or any other network.

For example:

```json
{
  "version": 1,
  "network": "testnet",
  "identity": "team-deployer"
}
```

allows:

```bash
stellarforge deploy
```

to use those project settings, while:

```bash
stellarforge deploy --source release-deployer
```

overrides only the identity.

## Loading and validation

The file must:

- live at the project root;
- be a regular file rather than a symbolic link;
- be no larger than 64 KiB;
- be encoded as UTF-8 (a single leading UTF-8 byte-order mark is tolerated);
- contain valid JSON with no duplicate object keys;
- contain no duplicate object keys at any nesting level (escaped-equivalent spellings are treated as the same key);
- contain only supported schema fields.

Validation failures are designed to be actionable without echoing raw file contents or sensitive values.

If the file is rejected, see [Troubleshooting](troubleshooting.md#configuration-file-is-rejected). For deployment settings, see [Deployment network is required](troubleshooting.md#deployment-network-is-required) and [Deployment identity is rejected](troubleshooting.md#deployment-identity-is-rejected).

## Schema versioning policy

The `version` field is a compatibility guard between your config file and the CLI release that reads it. Schema version `1` is the only version currently supported.

An older CLI rejects an unknown future schema version rather than silently misinterpreting it. If StellarForge reports a future-version error, upgrade the CLI to a release that supports the config's schema version; the config file itself is correct and does not need to be rewritten.

Version-related validation failures use these messages, so operators can distinguish them in CI output:

| Failure | Error message |
| --- | --- |
| Future version integer | `This config declares schema version 2, which requires a newer stellarforge CLI. Please upgrade stellarforge to continue.` (the number is the version read from the file) |
| Missing `version` field | `stellarforge.config.json is missing the required "version" field.` |
| Wrong-type, float, or non-positive `version` | `"version" must be a positive integer.` |
