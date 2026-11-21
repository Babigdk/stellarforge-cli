import { describe, expect, it } from 'vitest';
import {
  sanitizeTerminalText,
  TerminalOutput,
  type TextOutputStream,
} from '../src/output/terminal.js';
import { TERMINAL_FIXTURES } from './fixtures/terminal-output-fixtures.js';

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

  it('neutralizes ANSI CSI and remaining terminal control characters', () => {
    expect(sanitizeTerminalText('safe\u001b[31mred\u001b[0m\u0000text')).toBe(
      'saferedtext',
    );
  });

  it('preserves ordinary tabs and newlines while removing carriage returns', () => {
    expect(sanitizeTerminalText('one\ttwo\nthree\rfour')).toBe(
      'one\ttwo\nthreefour',
    );
  });

  describe('bidi control characters', () => {
    it('strips bidi override and isolate controls that could reorder text', () => {
      const { bidiControls } = TERMINAL_FIXTURES;

      // Deceptive filename: "report.exe" disguised as "report.txt" via RLO
      expect(sanitizeTerminalText(bidiControls.deceptiveFilename)).toBe(
        bidiControls.sanitizedFilename,
      );

      // All bidi control characters should be removed
      expect(sanitizeTerminalText(bidiControls.controlCharacters)).toBe('');

      // Mixed-direction command with RTL text should keep RTL text but strip controls
      expect(sanitizeTerminalText(bidiControls.mixedDirectionCommand)).toBe(
        'Command target executed for العربية and עברית',
      );

      // Safe RTL text (Arabic, Hebrew) should remain readable
      expect(sanitizeTerminalText(bidiControls.safeRtlText)).toBe(
        'StellarForge: مرحبا שלום (سلام)',
      );

      // Directional marks (LRM, RLM, ALM) should be preserved as they don't reorder
      expect(sanitizeTerminalText(bidiControls.directionalMarks)).toBe(
        'a\u200eb\u200fc\u061cd',
      );
    });
  });
});
