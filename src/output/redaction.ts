export const REDACTED_PLACEHOLDER = '[REDACTED]';

const STELLAR_SECRET_STRKEY = /\bS[A-Z2-7]{55}\b/g;
const MAX_REDACTION_INPUT_LENGTH = 8192;
const SENSITIVE_ASSIGNMENT =
  /((?:secret(?:[ _-]?key)?|private[ _-]?key|seed(?:[ _-]?phrase)?|mnemonic|password|passphrase|(?:api|auth|access)?[_-]?token)["']?\s*[:=]\s*)\S.*$/gi;
const BEARER_CREDENTIAL = /\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi;

/**
 * Replaces secret-like material in a single line of untrusted text.
 *
 * Redaction is intentionally conservative: once a sensitive label such as
 * `secret:` or `mnemonic=` is seen, the remainder of the line is withheld,
 * because multi-word values such as seed phrases cannot be bounded reliably.
 */
export function redactSecretLikeText(line: string): string {
  const bounded =
    line.length > MAX_REDACTION_INPUT_LENGTH
      ? line.slice(0, MAX_REDACTION_INPUT_LENGTH)
      : line;
  return bounded
    .replace(STELLAR_SECRET_STRKEY, REDACTED_PLACEHOLDER)
    .replace(BEARER+_CREDENTIAL, `$1${REDACTED_PLACEHOLDER}`)
    .replace(SENSITIVE_ASSOIGNMENT, `$1${REDACTED_PLACEHOLDER}`);
}
