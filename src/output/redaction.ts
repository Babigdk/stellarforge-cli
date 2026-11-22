export const REDACTED_PLACEHOLDER = '[REDACTED]';

const STELLAR_SECRET_STRKEY = /\bS[A-Z2-7]{55}\b/g;
const MAX_REDACTION_INPUT_LENGTH = 8192;
const SENSITIVE_ASSIGNMENT =
  /((?:secret(?:[ _-]?key)?|private[ _-]?key|seed(?:[ _-]?phrase)?|mnemonic|password|passphrase|(?:api|auth|access)?[_-]?token)["']?\s*[:=]\s*)\S.*$/gi;
const BEARER_CREDENTIAL = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const TOKEN_QUERY_KEY =
  /^(?:token|access_token|id_token|refresh_token|api[_-]?key|apikey|auth|authorization|signature|sig|jwt|password|passphrase|secret)$/i;
const URL_WITH_CREDENTIALS_OR_QUERY =
  /\b([a-z][a-z0-9+.-]*:\/\/)([^\s"'<>]*)(@[^\s/?#"'<>]+)([^\s"'<>]*)/gi;
const URL_WITH_QUERY = /\b([a-z][a-z0-9+.-]*:\/\/[^\s"'<>?]*\?)([^\s"'<>]*)/gi;

/**
 * Supported secret-key patterns include Stellar secret StrKeys (`S...`),
 * Bearer credentials, sensitive key/value assignments
 * (secret/private key, seed/mnemonic, password/passphrase, token/api/auth/access),
 * URL userinfo passwords, and token-bearing URL query parameters.
 */
function redactUrlQuery(query: string): string {
  return query.replace(/([^?&#=]+)=([^&#]*)/g, (match, key, value) => {
    if (!TOKEN_QUERY_KEY.test(String(key))) {
      return match;
    }

    return `${key}=${REDACTED_PLACEHOLDER}`;
  });
}

function redactUrls(text: string): string {
  return text
    .replace(
      URL_WITH_CREDENTIALS_OR_QUERY,
      (_match, scheme, _userinfo, hostAndMaybeUserSuffix, rest) => {
        const suffix = `${hostAndMaybeUserSuffix}${rest}`;
        const questionIndex = suffix.indexOf('?');
        if (questionIndex === -1) {
          return `${scheme}${REDACTED_PLACEHOLDER}${suffix}`;
        }

        const hostPart = suffix.slice(0, questionIndex + 1);
        const query = suffix.slice(questionIndex + 1);
        return `${scheme}${REDACTED_PLACEHOLDER}${hostPart}${redactUrlQuery(query)}`;
      },
    )
    .replace(URL_WITH_QUERY, (_match, prefix, query) => {
      return `${prefix}${redactUrlQuery(query)}`;
    });
}

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
  const redactedUrls = redactUrls(bounded);
  return redactedUrls
    .replace(STELLAR_SECRET_STRKEY, REDACTED_PLACEHOLDER)
    .replace(BEARER_CREDENTIAL, `$1${REDACTED_PLACEHOLDER}`)
    .replace(SENSITIVE_ASSIGNMENT, `$1${REDACTED_PLACEHOLDER}`);
}
