export const REDACTED_PLACEHOLDER = '[REDACTED]';

const STELLAR_SECRET_STRKEY = /\bS[A-Z2-7]{55}\b/g;
const SENSITIVE_ASSIGNMENT =
  /((?:secret(?:[ _-]?key)?|private[ _-]?key|seed(?:[ _-]?phrase)?|mnemonic|password|passphrase|(?:api|auth|access)?[_-]?token)["']?\s*[:=]\s*)\S.*$/gi;
const BEARER_CREDENTIAL = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;

/**
 * Replaces secret-like material in a single line of untrusted text.
 *
 * Redaction is intentionally conservative: once a sensitive label such as
 * `secret:` or `mnemonic=` is seen, the remainder of the line is withheld,
 * because multi-word values such as seed phrases cannot be bounded reliably.
 */
export function redactSecretLikeText(line: string): string {
  return line
    .replace(STELLAR_SECRET_STRKEY, REDACTED_PLACEHOLDER)
    .replace(BEARER_CREDENTIAL, `$1${REDACTED_PLACEHOLDER}`)
    .replace(SENSITIVE_ASSIGNMENT, `$1${REDACTED_PLACEHOLDER}`);
}
