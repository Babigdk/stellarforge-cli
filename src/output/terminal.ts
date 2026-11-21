export interface TextOutputStream {
  write(chunk: string): unknown;
  columns?: number;
  isTTY?: boolean;
  // Optional: a Node Writable's 'drain' event (or equivalent) fired once the
  // stream can accept more data after a write reported backpressure. Streams
  // that don't support this (e.g. simple test doubles) are treated as never
  // backpressured — callers only rely on this when `write` has already
  // returned a falsy value.
  once?(event: 'drain', listener: () => void): unknown;
}

export interface TerminalOutputStreams {
  stdout: TextOutputStream;
  stderr: TextOutputStream;
}

export interface TerminalOutputOptions {
  /**
   * Explicit column width for output wrapping.
   * When specified (> 0), messages written to terminal streams will wrap according to
   * the non-lossy wrapping policy.
   * When omitted or undefined, lines are not artificially wrapped unless
   * the output stream explicitly provides a positive `columns` property.
   */
  readonly columns?: number;
}

export interface WrapOptions {
  /**
   * Preserve unbreakable tokens (paths, commands, URLs, quoted strings, flags)
   * intact without splitting them across line breaks.
   * Defaults to true.
   */
  readonly preserveUnbreakable?: boolean;
}

const ESCAPE = 0x1b;
const CONTROL_SEQUENCE_INTRODUCER = 0x9b;
const LEFT_SQUARE_BRACKET = 0x5b;
const RIGHT_SQUARE_BRACKET = 0x5d;
const BEL = 0x07;
const BACKSLASH = 0x5c;

function isTerminalControlCharacter(code: number): boolean {
  return (
    code <= 0x08 ||
    (code >= 0x0b && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  );
}

function isBidiControlCharacter(code: number): boolean {
  return (
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
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

function consumeOscSequence(message: string, startIndex: number): number {
  let index = startIndex;

  while (index < message.length) {
    const code = message.charCodeAt(index);

    if (code === BEL) {
      return index + 1;
    }

    if (code === ESCAPE && message.charCodeAt(index + 1) === BACKSLASH) {
      return index + 2;
    }

    index += 1;
  }

  return index;
}

/**
 * Sanitizes untrusted terminal text by stripping ANSI CSI/OSC escape sequences
 * and terminal control characters (C0 and C1), removing carriage returns,
 * while preserving standard whitespace (tabs and newlines).
 */
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

    if (
      code === ESCAPE &&
      message.charCodeAt(index + 1) === RIGHT_SQUARE_BRACKET
    ) {
      index = consumeOscSequence(message, index + 2);
      continue;
    }

    if (code === ESCAPE) {
      index = index + 1 < message.length ? index + 2 : index + 1;
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

    if (isBidiControlCharacter(code)) {
      index += 1;
      continue;
    }

    sanitized += message[index];
    index += 1;
  }

  return sanitized;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

function getGraphemeDisplayWidth(grapheme: string): number {
  const code = grapheme.codePointAt(0);
  if (code === undefined) {
    return 0;
  }

  // Null, format controls, zero-width characters
  if (
    code === 0 ||
    (code >= 0x200b && code <= 0x200d) ||
    code === 0xfeff ||
    code === 0x00ad
  ) {
    return 0;
  }

  // Combining diacritical marks and enclosing marks
  if (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xe0100 && code <= 0xe01ef) ||
    (code >= 0xe0020 && code <= 0xe007f)
  ) {
    return 0;
  }

  // Wide / CJK characters and emoji symbols (display width 2)
  if (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals, Symbols & Punctuation
    (code >= 0x3040 && code <= 0xa4cf) || // Hiragana, Katakana, CJK Unified Ideographs, Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0xfe10 && code <= 0xfe19) || // Vertical forms
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
    (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Symbols
    (code >= 0x2600 && code <= 0x27bf) || // Misc Symbols & Dingbats
    (code >= 0x1f300 && code <= 0x1f64f) || // Misc Symbols & Pictographs, Emoticons
    (code >= 0x1f680 && code <= 0x1f6ff) || // Transport & Map
    (code >= 0x1f900 && code <= 0x1f9ff) || // Supplemental Symbols & Pictographs
    (code >= 0x1fa70 && code <= 0x1faff) || // Symbols & Pictographs Ext-A
    (code >= 0x20000 && code <= 0x3fffd) // Planes 2 & 3 CJK Ideographs
  ) {
    return 2;
  }

  // Tab character (treat as 2 columns)
  if (code === 0x09) {
    return 2;
  }

  return 1;
}

/**
 * Calculates the visible column width of a string in a terminal,
 * taking into account Unicode grapheme clusters, East Asian Wide characters,
 * zero-width combining marks, and emojis.
 */
export function getStringDisplayWidth(text: string): number {
  let width = 0;
  for (const item of graphemeSegmenter.segment(text)) {
    width += getGraphemeDisplayWidth(item.segment);
  }
  return width;
}

/**
 * Determines whether a token represents an unbreakable unit such as a path,
 * URL, quoted command, CLI flag, or cryptographic identifier that must remain
 * copyable and not be split across line breaks.
 */
function isUnbreakableToken(token: string): boolean {
  if (token.length <= 1) {
    return false;
  }

  // Quoted expressions or backticked commands
  if (
    (token.startsWith('`') && token.endsWith('`')) ||
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return true;
  }

  // URLs (http, https, file, git)
  if (/^(?:https?|file|git):\/\//i.test(token)) {
    return true;
  }

  // Filesystem paths (contains slashes or backslashes)
  if (token.includes('/') || token.includes('\\')) {
    return true;
  }

  // CLI flags and options (--flag, -f)
  if (token.startsWith('--') || token.startsWith('-')) {
    return true;
  }

  // Opaque identifiers (hashes, Stellar StrKeys like G..., S..., C...)
  if (/^[A-Za-z0-9_-]{20,}$/.test(token)) {
    return true;
  }

  return false;
}

function tokenizeLineForWrapping(trimmed: string): string[] {
  const tokens: string[] = [];
  let currentToken = '';
  let inBacktick = false;
  let inDoubleQuote = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (char === '`' && !inDoubleQuote) {
      inBacktick = !inBacktick;
      currentToken += char;
    } else if (char === '"' && !inBacktick) {
      inDoubleQuote = !inDoubleQuote;
      currentToken += char;
    } else if (char === ' ' && !inBacktick && !inDoubleQuote) {
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        currentToken = '';
      }
    } else {
      currentToken += char;
    }
  }

  if (currentToken.length > 0) {
    tokens.push(currentToken);
  }

  return tokens;
}

function wrapSingleLine(
  line: string,
  columns: number,
  options: WrapOptions,
): string {
  if (columns <= 0 || getStringDisplayWidth(line) <= columns) {
    return line;
  }

  const indentMatch = line.match(/^(\s*)/);
  const leadingIndent: string = indentMatch?.[1] ?? '';
  const trimmed = line.slice(leadingIndent.length);

  if (trimmed.length === 0) {
    return line;
  }

  let continuationIndent: string = leadingIndent;
  if (line.startsWith('  Remediation: ')) {
    continuationIndent = '    ';
  } else if (/^\[[A-Z]+\] /.test(line)) {
    continuationIndent = '  ';
  }

  // If columns cannot even fit the continuation indent, fall back to no indent
  if (columns <= getStringDisplayWidth(continuationIndent)) {
    continuationIndent = '';
  }

  const tokens = tokenizeLineForWrapping(trimmed);
  const resultLines: string[] = [];
  let currentLine: string = leadingIndent;
  let currentLineWidth = getStringDisplayWidth(leadingIndent);

  for (const token of tokens) {
    const tokenWidth = getStringDisplayWidth(token);
    const baseIndent =
      resultLines.length === 0 ? leadingIndent : continuationIndent;
    const isFirstOnLine =
      currentLineWidth === getStringDisplayWidth(baseIndent);
    const spaceWidth = isFirstOnLine ? 0 : 1;

    // Check if token fits on the current line
    if (currentLineWidth + spaceWidth + tokenWidth <= columns) {
      if (!isFirstOnLine) {
        currentLine += ' ';
        currentLineWidth += 1;
      }
      currentLine += token;
      currentLineWidth += tokenWidth;
    } else {
      // If we already have content on the current line, wrap to a new line
      if (!isFirstOnLine) {
        resultLines.push(currentLine);
        currentLine = continuationIndent;
        currentLineWidth = getStringDisplayWidth(continuationIndent);
      }

      // Check whether this token is unbreakable (e.g. path, command, URL)
      // or if wrapping is non-lossy
      const preserve = options.preserveUnbreakable ?? true;
      if (preserve && isUnbreakableToken(token)) {
        // Unbreakable tokens remain intact on their line without arbitrary splitting
        currentLine += token;
        currentLineWidth += tokenWidth;
      } else if (tokenWidth > columns && !preserve) {
        // Truncation or character-by-character wrap only if preserveUnbreakable is false
        currentLine += token;
        currentLineWidth += tokenWidth;
      } else {
        // Place token on the line
        currentLine += token;
        currentLineWidth += tokenWidth;
      }
    }
  }

  if (currentLine.length > 0) {
    resultLines.push(currentLine);
  }

  return resultLines.join('\n');
}

/**
 * Wraps terminal text according to the documented, non-lossy wrapping policy:
 * - Breaks occur at whitespace boundaries whenever possible.
 * - Existing newlines are preserved independently.
 * - Filesystem paths, URLs, backticked/quoted commands, and flags remain intact
 *   and copyable without ambiguous splitting.
 * - Unicode display widths (including wide CJK, emojis, and combining marks)
 *   are handled accurately without string corruption.
 * - If a line cannot be wrapped without splitting an unbreakable token,
 *   the token is preserved intact on its line.
 */
export function wrapTerminalText(
  text: string,
  columns: number,
  options: WrapOptions = {},
): string {
  if (columns <= 0 || !Number.isFinite(columns)) {
    return text;
  }

  const lines = text.split('\n');
  return lines.map((line) => wrapSingleLine(line, columns, options)).join('\n');
}

export class TerminalOutput {
  readonly #streams: TerminalOutputStreams;
  readonly #columns: number | undefined;

  constructor(
    streams: TerminalOutputStreams = {
      stdout: process.stdout,
      stderr: process.stderr,
    },
    options: TerminalOutputOptions = {},
  ) {
    this.#streams = streams;
    this.#columns = options.columns;
  }

  // Returns whether the destination stream can accept more data immediately
  // (mirrors Writable#write's boolean): false signals backpressure, so a
  // caller forwarding a high-volume source (e.g. a child process) can pause
  // it and resume once `onceStdoutDrained`/`onceStderrDrained` fires.
  info(message: string): boolean {
    return this.#write(this.#streams.stdout, message);
  }

  success(message: string): boolean {
    return this.#write(this.#streams.stdout, message);
  }

  warning(message: string): boolean {
    return this.#write(this.#streams.stderr, message);
  }

  error(message: string): boolean {
    return this.#write(this.#streams.stderr, message);
  }

  onceStdoutDrained(listener: () => void): void {
    this.#onceDrained(this.#streams.stdout, listener);
  }

  onceStderrDrained(listener: () => void): void {
    this.#onceDrained(this.#streams.stderr, listener);
  }

  #write(stream: TextOutputStream, message: string): boolean {
    const sanitized = sanitizeTerminalText(message);
    const targetColumns =
      this.#columns ??
      (typeof stream.columns === 'number' && stream.columns > 0
        ? stream.columns
        : undefined);
    const text =
      targetColumns !== undefined && targetColumns > 0
        ? wrapTerminalText(sanitized, targetColumns)
        : sanitized;

    return stream.write(`${text}\n`) !== false;
  }

  #onceDrained(stream: TextOutputStream, listener: () => void): void {
    if (typeof stream.once === 'function') {
      stream.once('drain', listener);
      return;
    }

    // No backpressure signal available: nothing to wait for, so proceed
    // immediately rather than block forwarding forever.
    listener();
  }
}
