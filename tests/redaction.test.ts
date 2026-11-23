import { describe, expect, it } from 'vitest';
import { formatDiagnosticCommand, redactDiagnosticCommandArgs } from '../src/diagnostics/process.js';
import {
  REDACTED_PLACEHOLDER,
  redactSecretLikeText,
} from '../src/output/index.js';
import {
  SECRET_FIXTURE_LINES,
  SECRET_FIXTURE_VALUES,
  SECRET_STRKEY_FIXTURE,
  TOKEN_FIXTURE,
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
    'https://example.com/path?foo=bar&limit=10',
    'https://user@example.com/path',
  ])('leaves non-secret line %j unchanged', (line) => {
    expect(redactSecretLikeText(line)).toBe(line);
  });

  it('redacts URL userinfo passwords while preserving host and path context', () => {
    const redacted = redactSecretLikeText(
      'POST https://alice:super-secret@example.com:8443/v1/path?keep=1',
    );

    expect(redacted).toBe(
      `POST https://${REDACTED_PLACEHOLDER}@example.com:8443/v1/path?keep=1`,
    );
    expect(redacted).not.toContain('alice:super-secret');
    expect(redacted).not.toContain('super-secret');
    expect(redacted).toContain('@example.com:8443/v1/path?keep=1');
  });

  it('redacts token-bearing query parameters case-insensitively', () => {
    const redacted = redactSecretLikeText(
      'fetch https://api.example.com/v1?Token=abc&Access_Token=def&foo=bar&API-KEY=ghi&signature=jkl&jwt=mno',
    );

    expect(redacted).toContain(`Token=${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(`Access_Token=${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(`API-KEY=${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(`signature=${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(`jwt=${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain('foo=bar');
    expect(redacted).not.toContain('=abc');
    expect(redacted).not.toContain('=def');
    expect(redacted).not.toContain('=ghi');
    expect(redacted).not.toContain('=jkl');
    expect(redacted).not.toContain('=mno');
  });

  it('redacts URL passwords and token query keys together', () => {
    const redacted = redactSecretLikeText(
      'curl https://user:pw@example.test/callback?access_token=topsecret&state=ok',
    );

    expect(redacted).toBe(
      `curl https://${REDACTED_PLACEHOLDER}@example.test/callback?access_token=${REDACTED_PLACEHOLDER}&state=ok`,
    );
  });

  it('does not echo command arguments containing secrets', () => {
    const args = [
      '--token',
      TOKEN_FIXTURE,
      `--header=Authorization: Bearer ${TOKEN_FIXTURE}`,
      `https://user:${TOKEN_FIXTURE}@example.com/path?refresh_token=${TOKEN_FIXTURE}&page=1`,
    ];

    const redactedArgs = redactDiagnosticCommandArgs(args);
    const command = formatDiagnosticCommand('stellar', args);

    for (const arg of redactedArgs) {
      expect(arg).not.toContain(TOKEN_FIXTURE);
    }
    expect(command).toContain('stellar');
    expect(command).not.toContain(TOKEN_FIXTURE);
    expect(command).toContain(REDACTED_PLACEHOLDER);
    expect(command).toContain('page=1');
  });

  it('redacts nested errors and stdout/stderr style paths', () => {
    const nested = JSON.stringify({
      error: {
        message: `request failed: ${SECRET_STRKEY_FIXTURE}`,
        cause: {
          stderr: `Authorization: Bearer ${TOKEN_FIXTURE}`,
          stdout: `POST https://u:p@example.com?token=${TOKEN_FIXTURE}`,
        },
      },
    });

    const redacted = redactSecretLikeText(nested);

    expect(redacted).not.toContain(SECRET_STRKEY_FIXTURE);
    expect(redacted).not.toContain(TOKEN_FIXTURE);
    expect(redacted).not.toContain(':p@');
    expect(redacted).toContain(REDACTED_PLACEHOLDER);
  });
});