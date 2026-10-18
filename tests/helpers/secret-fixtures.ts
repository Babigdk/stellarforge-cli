/*
 * Synthetic, non-functional secret-like fixtures. They match the shapes the
 * CLI must never reflect but are not real keys for any network.
 */
export const SECRET_STRKEY_FIXTURE =
  'SC' + 'FIXTURE2SECRET7NOTREAL'.padEnd(54, 'A');
export const SECOND_SECRET_STRKEY_FIXTURE =
  'SD' + 'ANOTHER2FIXTURE7SEED'.padEnd(54, 'B');
export const MNEMONIC_FIXTURE =
  'fixture alpha bravo charlie delta echo foxtrot golf hotel india juliet klo';
export const TOKEN_FIXTURE = 'tok_FIXTURE_DO_NOT_REFLECT_123';
export const PASSWORD_FIXTURE = 'hunter2-FIXTURE-PASSWORD';

export const SECRET_FIXTURE_VALUES = [
  SECRET_STRKEY_FIXTURE,
  SECOND_SECRET_STRKEY_FIXTURE,
  MNEMONIC_FIXTURE,
  TOKEN_FIXTURE,
  PASSWORD_FIXTURE,
] as const;

/** Subprocess lines that embed each fixture in a realistic shape. */
export const SECRET_FIXTURE_LINES = [
  `Secret key: ${SECRET_STRKEY_FIXTURE}`,
  `signing with ${SECOND_SECRET_STRKEY_FIXTURE} for tx`,
  `seed phrase: ${MNEMONIC_FIXTURE}`,
  `mnemonic=${MNEMONIC_FIXTURE}`,
  `Authorization: Bearer ${TOKEN_FIXTURE}`,
  `ACCESS_TOKEN=${TOKEN_FIXTURE}`,
  `password = ${PASSWORD_FIXTURE}`,
  `{"Secret":"${SECRET_STRKEY_FIXTURE}"}`,
  `{"password":"${PASSWORD_FIXTURE}"}`,
] as const;
