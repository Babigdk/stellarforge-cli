import { describe, expect, it } from 'vitest';
import {
  EXIT_CODES,
  ValidationCliError,
  handleCliError,
} from '../src/errors/index.js';
import {
  sanitizeTerminalText,
  TerminalOutput,
  type TextOutputStream,
} from '../src/output/terminal.js';

type CaptureStream = TextOutputStream & { isTTY?: boolean };

function createCaptureStream(target: string[], isTTY?: boolean): CaptureStream {
  const stream: CaptureStream = {
    write(chunk: string) {
      target.push(chunk);
    },
  };

  if (isTTY !== undefined) {
    stream.isTTY = isTTY;
  }

  return stream;
}

function createOutput(): {
  readonly output: TerminalOutput;
  readonly stdout: string[];
  readonly stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    output: new TerminalOutput({
      stdout: createCaptureStream(stdout, false),
      stderr: createCaptureStream(stderr, false),
    }),
    stdout,
    stderr,
  };
}

describe('non-TTY output readability', () => {
  it('writes plain, newline-terminated lines without TTY decorations', () => {
    const { output, stdout, stderr } = createOutput();

    output.info('first line');
    output.success('second line');
    output.warning('third line');
    output.error('fourth line');

    expect(stdout).toEqual(['first line\n', 'second line\n']);
    expect(stderr).toEqual(['third line\n', 'fourth line\n']);
  });

  it('does not require TTY-specific stream properties', () => {
    const stdout: string[] = [];
    const output = new TerminalOutput({
      stdout: createCaptureStream(stdout),
      stderr: createCaptureStream([]),
    });

    expect(() => output.info('works without isTTY')).not.toThrow();
    expect(stdout).toEqual(['works without isTTY\n']);
  });

  it('neutralizes ANSI and terminal control characters in non-TTY output', () => {
    const { output, stdout } = createOutput();

    output.info('start\u001b[31mred\u001b[0m\u0000end');

    expect(stdout).toEqual(['startredend\n']);
  });

  it('preserves tabs and newlines while removing carriage returns', () => {
    expect(sanitizeTerminalText('one\ttwo\nthree\rfour')).toBe(
      'one\ttwo\nthreefour',
    );
  });

  it('produces stable output for repeated and multi-line messages', () => {
    const { output, stdout } = createOutput();

    output.info('line one\nline two');
    output.info('line one\nline two');

    expect(stdout).toEqual(['line one\nline two\n', 'line one\nline two\n']);
  });

  it('writes a bare newline for an empty message', () => {
    const { output, stdout } = createOutput();

    output.info('');

    expect(stdout).toEqual(['\n']);
  });

  it('does not change exit semantics when rendering to a non-TTY stream', () => {
    const { output, stdout, stderr } = createOutput();

    const exitCode = handleCliError(
      new ValidationCliError('Project name is required.'),
      output,
    );

    expect(exitCode).toBe(EXIT_CODES.validation);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['Project name is required.\n']);
  });
});
