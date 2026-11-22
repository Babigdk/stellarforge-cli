import { describe, expect, it } from 'vitest';
import {
  REDACTED_PLACEHOLDER,
  redactSecretLikeText,
} from '../src/output/index.js';
import {
  sanitizeTerminalText,
  TerminalOutput,
  type TextOutputStream,
} from '../src/output/terminal.js';
import { TERMINAL_FIXTURES } from './fixtures/terminal-output-fixtures.js';
import { SECRET_STRKEY_FIXTURE, TOKEN_FIXTURE } from './helpers/index.js';

function createCaptureStream(target: string[]): TextOutputStream {
  return {
    write(chunk: string) {
      target.push(chunk);
    },
  };
}

function createCapturedOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const output = new TerminalOutput({
    stdout: createCaptureStream(stdout),
    stderr: createCaptureStream(stderr),
  });

  return { output, stdout, stderr };
}

describe('TerminalOutput', () => {
  it('routes informational and success messages to stdout', () => {
    const { output, stdout, stderr } = createCapturedOutput();

    output.info('informational');
    output.success('successful');

    expect(stdout).toEqual(['informational\n', 'successful\n']);
    expect(stderr).toEqual([]);
  });

  it('routes warning and error messages to stderr', () => {
    const { output, stdout, stderr } = createCapturedOutput();

    output.warning('warning');
    output.error('failure');

    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['warning\n', 'failure\n']);
  });

  it('does not require TTY-specific stream properties', () => {
    const { output, stdout } = createCapturedOutput();

    output.info('works in CI');

    expect(stdout).toEqual(['works in CI\n']);
  });
});

describe('sanitizeTerminalText', () => {
  it('blocks ANSI CSI, OSC, and remaining terminal control characters including NUL', () => {
    expect(
      sanitizeTerminalText(
        `safe${TERMINAL_FIXTURES.escapeSequences.ansiColors}${TERMINAL_FIXTURES.escapeSequences.oscTitle}\u0000end`,
      ),
    ).toBe('safe[PASS] Git: git version 2.45.0 detected.Command execution in progressend');
  });

  it('blocks OSC hyperlinks, title changes, cursor movement, screen clearing, and cursor visibility controls', () => {
    const hyperlink = 'start\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007end';
    const screenClear = 'top\u001b[2J\u001b[Hbottom';
    const mixed = [
      TERMINAL_FIXTURES.escapeSequences.oscTitleEsc,
      TERMINAL_FIXTURES.escapeSequences.csiCursorMovement,
      TERMINAL_FIXTURES.escapeSequences.cursorVisibility,
      hyperlink,
      screenClear,
    ].join('');

    const sanitized = sanitizeTerminalText(mixed);

    expect(sanitized).toContain('Command execution in progress');
    expect(sanitized).toContain('line 1');
    expect(sanitized).toContain('line updated');
    expect(sanitized).toContain('Running task...');
    expect(sanitized).toContain('startclickend');
    expect(sanitized).toContain('topbottom');
    expect(sanitized).not.toContain('\u001b');
    expect(sanitized).not.toContain('\u0007');
    expect(sanitized).not.toContain('evil.example');
    expect(sanitized).not.toMatch(/\[[0-9;]*[A-Za-z]/);
  });

  it('neutralizes CR and backspace overwrite tricks', () => {
    expect(sanitizeTerminalText('public\rSECRET')).toBe('publicSECRET');
    expect(sanitizeTerminalText('abc\b\bXY\u0008Z')).toBe('abcXYZ');
  });

  it('preserves ordinary printable Unicode and line breaks while removing control characters', () => {
    const text = [
      TERMINAL_FIXTURES.unicode.emojiMessage,
      TERMINAL_FIXTURES.unicode.cjkMessage,
      TERMINAL_FIXTURES.unicode.combiningMarks,
      'line1\tindented',
      'line2',
    ].join('\n');

    expect(sanitizeTerminalText(`${text}\r\u0000`)).toBe(`${text}`);
  });

  it('is bounded for very long or repeated control sequences', () => {
    const repeated = `prefix${'\u001b[31m'.repeat(5000)}middle${'\u001b]0;'.padEnd(6000, 'x')}tail`;
    const unterminated = `A${'\u001b]8;;https://example.com/'.padEnd(7000, 'a')}B`;

    const repeatedSanitized = sanitizeTerminalText(repeated);
    const unterminatedSanitized = sanitizeTerminalText(unterminated);

    expect(repeatedSanitized).toContain('prefix');
    expect(repeatedSanitized).toContain('middle');
    expect(repeatedSanitized).not.toContain('\u001b');
    expect(unterminatedSanitized.startsWith('A')).toBe(true);
    expect(unterminatedSanitized).not.toContain('\u001b');
  });

  it('keeps secrets redacted after sanitization at the output boundary', () => {
    const untrusted = [
      `\u001b]8;;https://evil.example\u0007token=${TOKEN_FIXTURE}\u001b]8;;\u0007`,
      `secret: ${SECRET_STRKEY_FIXTURE}\r\u001b[2Koverwrite`,
      'https://user:pw@example.com/path?access_token=abc123\u0000',
    ].join('\n');

    const redacted = redactSecretLikeText(untrusted);
    const sanitized = sanitizeTerminalText(redacted);

    expect(redacted).toContain(REDACTED_PLACEHOLDER);
    expect(redacted).not.toContain(TOKEN_FIXTURE);
    expect(redacted).not.toContain(SECRET_STRKEY_FIXTURE);
    expect(redacted).not.toContain('abc123');
    expect(redacted).not.toContain(':pw@');

    expect(sanitized).toContain(REDACTED_PLACEHOLDER);
    expect(sanitized).not.toContain(TOKEN_FIXTURE);
    expect(sanitized).not.toContain(SECRET_STRKEY_FIXTURE);
    expect(sanitized).not.toContain('abc123');
    expect(sanitized).not.toContain(':pw@');
    expect(sanitized).not.toContain('\u001b');
    expect(sanitized).not.toContain('\u0000');
    expect(sanitized).not.toContain('\r');
    expect(sanitized).not.toContain('evil.example');
    expect(sanitized).toContain('\n');
  });

  it('writes sanitized, redaction-safe text through TerminalOutput', () => {
    const { output, stdout } = createCapturedOutput();
    const line = redactSecretLikeText(
      `\u001b[31mAuthorization: Bearer ${TOKEN_FIXTURE}\u001b]0;pw=${TOKEN_FIXTURE}\u0007\r`,
    );

    output.info(sanitizeTerminalText(line));

    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toContain(`Authorization: Bearer ${REDACTED_PLACEHOLDER}`);
    expect(stdout[0]).not.toContain(TOKEN_FIXTURE);
    expect(stdout[0]).not.toContain('\u001b');
    expect(stdout[0]).not.toContain('\r');
  });
});
