export interface TextOutputStream {
  write(chunk: string): unknown;
}

export interface TerminalOutputStreams {
  stdout: TextOutputStream;
  stderr: TextOutputStream;
}

const ESCAPE = 0x1b;
const CONTROL_SEQUENCE_INTRODUCER = 0x9b;
const LEFT_SQUARE_BRACKET = 0x5b;

function isTerminalControlCharacter(code: number): boolean {
  return (
    code <= 0x08 ||
    (code >= 0x0b && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  );
}

function consumeCsiSequence(message: string, startIndex: number): number {
  let index = startIndex;

  while (index < message.length) {
    const code = message.charCodeAt(index);

    if (code >= 0x40 && code <= 0x7e) {
      return index + 1;
    }

    index += 1;
  }

  return index;
}

export function sanitizeTerminalText(message: string): string {
  let sanitized = '';
  let index = 0;

  while (index < message.length) {
    const code = message.charCodeAt(index);

    if (
      code === ESCAPE &&
      message.charCodeAt(index + 1) === LEFT_SQUARE_BRACKET
    ) {
      index = consumeCsiSequence(message, index + 2);
      continue;
    }

    if (code === CONTROL_SEQUENCE_INTRODUCER) {
      index = consumeCsiSequence(message, index + 1);
      continue;
    }

    if (isTerminalControlCharacter(code)) {
      index += 1;
      continue;
    }

    sanitized += message[index];
    index += 1;
  }

  return sanitized;
}

export class TerminalOutput {
  readonly #streams: TerminalOutputStreams;

  constructor(
    streams: TerminalOutputStreams = {
      stdout: process.stdout,
      stderr: process.stderr,
    },
  ) {
    this.#streams = streams;
  }

  info(message: string): void {
    this.#write(this.#streams.stdout, message);
  }

  success(message: string): void {
    this.#write(this.#streams.stdout, message);
  }

  warning(message: string): void {
    this.#write(this.#streams.stderr, message);
  }

  error(message: string): void {
    this.#write(this.#streams.stderr, message);
  }

  #write(stream: TextOutputStream, message: string): void {
    stream.write(`${sanitizeTerminalText(message)}\n`);
  }
}
