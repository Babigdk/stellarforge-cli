import { describe, expect, it } from 'vitest';
import {
  REDACTED_PLACEHOLDER,
  redactSecretLikeText,
} from '../src/output/index.js';
import {
  SECRET_FIXTURE_LINES,
  SECRET_FIXTURE_VALUES,
  SECRET_STRKEY_FIXTURE,
} from './helpers/index.js';

describe('secret-like text redaction', () => {
  it.each(SECRET_FIXTURE_LINES)('redacts %j', (line) => {
    const redacted = redactSecretLikeText(line);

    expect(redacted).toContain(REDACTED_PLACEHOLDER);
    for (const secret of SECRET_FIXTURE_VALUES) {
      expect(redacted).not.toContain(secret);
    }
  });

  it('keeps the sensitive label so the line stays understandable', () => {
    expect(redactSecretLikeText(`Secret key: ${SECRET_STRKEY_FIXTURE}`)).toBe(
      `Secret key: ${REDACTED_PLACEHOLDER}`,
    );
    expect(redactSecretLikeText('mnemonic=one two three')).toBe(
      `mnemonic=${REDACTED_PLACEHOLDER}`,
    );
  });

  it.each([
    'Contract deployed: CABC1234567890',
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'error: insufficient balance for account alice',
    'Compiling soroban-sdk v22.0.0',
    'tokens remaining: 3',
    'Using network testnet',
  ])('leaves non-secret line %j unchanged', (line) => {
    expect(redactSecretLikeText(line)).toBe(line);
  });
});
