import { TextDecoder } from 'node:util';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { ValidationCliError } from '../errors/errors.js';
import {
  validateIdentityAlias,
  validateStellarForgeConfig,
  type StellarForgeConfig,
} from './schema.js';

export const PROJECT_CONFIG_FILENAME = 'stellarforge.config.json';
const MAX_CONFIG_BYTES = 64 * 1024;

/**
 * The file identity fields Node exposes for both directory entries and open
 * descriptors. `dev` + `ino` are the canonical "same file" check; neither is
 * derived from the path, so a replacement entry always reports a different
 * identity even when it has the same name or contents.
 */
export interface ConfigFileMetadata {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  isSymbolicLink(): boolean;
  isFile(): boolean;
}

/**
 * Minimal synchronous filesystem surface used by the config loader.
 * Production uses the `node:fs`-backed default below; tests inject a
 * deterministic boundary to simulate the path being swapped between
 * inspection and reading without relying on timing loops.
 */
export interface ConfigFsBoundary {
  /** Like `lstatSync`: never follows the final symlink. */
  lstat(path: string): ConfigFileMetadata;
  /** Like `fs.openSync(path, flags)`. */
  open(path: string, flags: number): number;
  /** Like `fstatSync`: describes the already-open descriptor. */
  fstat(fd: number): ConfigFileMetadata;
  /** Like `fs.readSync(fd, buffer, offset, length, null)`. */
  read(fd: number, buffer: Buffer, offset: number, length: number): number;
  /** Like `closeSync`. */
  close(fd: number): void;
}

/**
 * `O_NOFOLLOW` is not available on every supported platform (notably
 * Windows). Where it is missing we fall back to a read-only open and rely on
 * the descriptor identity check below instead of silently following a link.
 * That fallback still fails closed: a path replaced by a symlink to a
 * different file yields a different `dev`/`ino` pair and is rejected before
 * any bytes are decoded or parsed.
 */
const O_NOFOLLOW: number =
  typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const CONFIG_OPEN_FLAGS = constants.O_RDONLY | O_NOFOLLOW;

const defaultConfigFsBoundary: ConfigFsBoundary = {
  lstat: (path) => lstatSync(path),
  open: (path, flags) => openSync(path, flags),
  fstat: (fd) => fstatSync(fd),
  read: (fd, buffer, offset, length) =>
    readSync(fd, buffer, offset, length, null),
  close: (fd) => closeSync(fd),
};

/**
 * Best-effort JSON scanner that rejects duplicate object keys, including
 * escaped-equivalent spellings of the same key and duplicates at any depth.
 *
 * The scanner is intentionally fail-open: on any anomaly (unterminated
 * strings, stray tokens, trailing garbage) it stops checking and lets the
 * caller fall through to JSON.parse, which produces the stable, content-free
 * malformed-JSON error. The scanner never echoes values — only the offending
 * key name is reported, JSON-quoted so it cannot inject terminal control
 * sequences.
 */
class ScanAbort extends Error {}

function abort(): never {
  throw new ScanAbort('duplicate-key scan aborted');
}

function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function skipWhitespace(raw: string, index: number): number {
  let position = index;
  while (position < raw.length && isWhitespace(raw[position])) {
    position += 1;
  }
  return position;
}

function decodeJsonString(
  raw: string,
  index: number,
): { text: string; end: number } {
  if (raw[index] !== '"') {
    abort();
  }

  const chars: string[] = [];
  let position = index + 1;

  while (position < raw.length) {
    const char = raw[position];

    if (char === '"') {
      return { text: chars.join(''), end: position + 1 };
    }

    if (char === '\\') {
      const escape = raw[position + 1];

      switch (escape) {
        case '"':
          chars.push('"');
          position += 2;
          break;
        case '\\':
          chars.push('\\');
          position += 2;
          break;
        case '/':
          chars.push('/');
          position += 2;
          break;
        case 'b':
          chars.push('\b');
          position += 2;
          break;
        case 'f':
          chars.push('\f');
          position += 2;
          break;
        case 'n':
          chars.push('\n');
          position += 2;
          break;
        case 'r':
          chars.push('\r');
          position += 2;
          break;
        case 't':
          chars.push('\t');
          position += 2;
          break;
        case 'u': {
          const hex = raw.slice(position + 2, position + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            abort();
          }

          const code = Number.parseInt(hex, 16);

          if (code >= 0xd800 && code <= 0xdbff) {
            const pairHex = raw.slice(position + 6, position + 12);
            const pairMatch = /^\\u([0-9a-fA-F]{4})$/.exec(pairHex);
            if (!pairMatch || pairMatch[1] === undefined) {
              abort();
            }

            const low = Number.parseInt(pairMatch[1], 16);
            if (low < 0xdc00 || low > 0xdfff) {
              abort();
            }

            chars.push(
              String.fromCodePoint(
                0x10000 + (((code - 0xd800) << 10) | (low - 0xdc00)),
              ),
            );
            position += 12;
          } else {
            chars.push(String.fromCodePoint(code));
            position += 6;
          }
          break;
        }
        default:
          abort();
      }
      continue;
    }

    if (char === undefined) {
      abort();
    }

    chars.push(char);
    position += 1;
  }

  abort();
}

const JSON_NUMBER_PREFIX = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Decodes a config file strictly as UTF-8. Invalid byte sequences are
 * rejected before JSON parsing so that corruption is never silently replaced
 * with U+FFFD and never echoes raw bytes in the error message.
 */
function decodeUtf8(bytes: Buffer): string {
  try {
    return utf8Decoder.decode(bytes);
  } catch (cause) {
    throw new ValidationCliError(
      'stellarforge.config.json is not valid UTF-8.',
      { cause },
    );
  }
}

function scanValue(raw: string, index: number): number {
  const position = skipWhitespace(raw, index);

  if (position >= raw.length) {
    abort();
  }

  const char = raw[position];

  if (char === '{') {
    return scanObject(raw, position);
  }

  if (char === '[') {
    return scanArray(raw, position);
  }

  if (char === '"') {
    return decodeJsonString(raw, position).end;
  }

  if (raw.startsWith('true', position)) {
    return position + 4;
  }

  if (raw.startsWith('false', position)) {
    return position + 5;
  }

  if (raw.startsWith('null', position)) {
    return position + 4;
  }

  const match = JSON_NUMBER_PREFIX.exec(raw.slice(position));
  if (match && match[0].length > 0) {
    return position + match[0].length;
  }

  abort();
}

function presentKeyMessage(key: string): string {
  const display =
    key.length <= 64
      ? JSON.stringify(key)
      : `${JSON.stringify(key.slice(0, 64))}...`;
  return `stellarforge.config.json contains a duplicate key ${display}.`;
}

function scanObject(raw: string, index: number): number {
  let position = skipWhitespace(raw, index + 1);

  if (raw[position] === '}') {
    return position + 1;
  }

  const keys = new Set<string>();

  while (true) {
    position = skipWhitespace(raw, position);

    const decoded = decodeJsonString(raw, position);

    if (keys.has(decoded.text)) {
      throw new ValidationCliError(presentKeyMessage(decoded.text));
    }

    keys.add(decoded.text);

    position = skipWhitespace(raw, decoded.end);

    if (raw[position] !== ':') {
      abort();
    }

    position = scanValue(raw, position + 1);
    position = skipWhitespace(raw, position);

    if (raw[position] === ',') {
      position += 1;
      continue;
    }

    if (raw[position] === '}') {
      return position + 1;
    }

    abort();
  }
}

function scanArray(raw: string, index: number): number {
  let position = skipWhitespace(raw, index + 1);

  if (raw[position] === ']') {
    return position + 1;
  }

  while (true) {
    position = scanValue(raw, position);
    position = skipWhitespace(raw, position);

    if (raw[position] === ',') {
      position += 1;
      continue;
    }

    if (raw[position] === ']') {
      return position + 1;
    }

    abort();
  }
}

/**
 * Rejects duplicate object keys in raw config text before parsing. Returns
 * silently when the document is itself malformed (the caller lets JSON.parse
 * report that with the stable malformed-JSON error).
 */
function assertNoDuplicateJsonKeys(raw: string): void {
  try {
    const end = scanValue(raw, 0);

    if (skipWhitespace(raw, end) !== raw.length) {
      abort();
    }
  } catch (error) {
    if (error instanceof ValidationCliError) {
      throw error;
    }

    // Malformed or unsupported document shape: defer to JSON.parse.
  }
}

export interface ProjectConfigOverrides {
  readonly network?: string;
  readonly identity?: string;
}

export interface ResolvedProjectConfig {
  readonly network?: string;
  readonly identity?: string;
}

function configTooLargeMessage(): string {
  return 'stellarforge.config.json is larger than the 64 KiB MVP limit.';
}

/**
 * Shared regular-file policy, applied both to the inspected entry and to the
 * descriptor that is actually read. Messages intentionally name only the
 * config filename: they never echo paths, link targets, or file contents.
 */
function assertRegularConfigFile(metadata: ConfigFileMetadata): void {
  if (metadata.isSymbolicLink()) {
    throw new ValidationCliError(
      'stellarforge.config.json must be a regular project file, not a symbolic link.',
    );
  }

  if (!metadata.isFile()) {
    throw new ValidationCliError(
      'stellarforge.config.json must be a regular project file.',
    );
  }
}

/**
 * The descriptor must describe the very entry that passed validation. Without
 * this check, a path swapped for a symlink on a platform without `O_NOFOLLOW`
 * could redirect the read to a different file that never passed inspection.
 */
function assertSameConfigFile(
  inspected: ConfigFileMetadata,
  opened: ConfigFileMetadata,
): void {
  if (inspected.dev !== opened.dev || inspected.ino !== opened.ino) {
    throw new ValidationCliError(
      'stellarforge.config.json changed while it was being read.',
    );
  }
}

export function loadProjectConfig(
  cwd: string,
  boundary: ConfigFsBoundary = defaultConfigFsBoundary,
): StellarForgeConfig | undefined {
  const projectRoot = resolve(cwd);
  const configPath = resolve(projectRoot, PROJECT_CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    return undefined;
  }

  let metadata: ConfigFileMetadata;
  try {
    metadata = boundary.lstat(configPath);
  } catch (error) {
    throw new ValidationCliError(
      'Unable to inspect stellarforge.config.json.',
      { cause: error },
    );
  }

  assertRegularConfigFile(metadata);

  if (metadata.size > MAX_CONFIG_BYTES) {
    throw new ValidationCliError(configTooLargeMessage());
  }

  // Read from the verified descriptor, never from the path again: replacing
  // the path after `open` cannot redirect these reads. At most one byte past
  // the limit is buffered, so a file that grows after inspection is rejected
  // without allocating its full contents.
  const configBuffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
  let descriptor: number | undefined;
  let bytesRead = 0;

  try {
    descriptor = boundary.open(configPath, CONFIG_OPEN_FLAGS);
    const opened = boundary.fstat(descriptor);
    assertRegularConfigFile(opened);
    assertSameConfigFile(metadata, opened);

    while (bytesRead < configBuffer.length) {
      const chunk = boundary.read(
        descriptor,
        configBuffer,
        bytesRead,
        configBuffer.length - bytesRead,
      );

      if (chunk === 0) {
        break;
      }

      bytesRead += chunk;
    }
  } catch (error) {
    if (error instanceof ValidationCliError) {
      throw error;
    }

    throw new ValidationCliError(
      'Unable to inspect stellarforge.config.json.',
      { cause: error },
    );
  } finally {
    if (descriptor !== undefined) {
      try {
        boundary.close(descriptor);
      } catch {
        // Descriptor cleanup is best-effort; it must not mask a policy error.
      }
    }
  }

  if (bytesRead > MAX_CONFIG_BYTES) {
    throw new ValidationCliError(configTooLargeMessage());
  }

  const configBytes = configBuffer.subarray(0, bytesRead);
  let text = decodeUtf8(configBytes);

  // Tolerate exactly one leading UTF-8 BOM (Windows editor convention). Count
  // the BOM sequences in the raw bytes because `TextDecoder` collapses
  // repeated BOMs and would otherwise hide a duplicated byte-order mark.
  const hasBom =
    configBytes.length >= 3 &&
    configBytes[0] === 0xef &&
    configBytes[1] === 0xbb &&
    configBytes[2] === 0xbf;
  const hasDoubleBom =
    hasBom &&
    configBytes.length >= 6 &&
    configBytes[3] === 0xef &&
    configBytes[4] === 0xbb &&
    configBytes[5] === 0xbf;

  if (hasDoubleBom) {
    // Reject with the stable malformed-JSON error instead of letting the
    // parser accept a duplicate byte-order mark.
    throw new ValidationCliError('stellarforge.config.json is not valid JSON.');
  }

  if (text.charCodeAt(0) === 0xfeff) {
    // TextDecoder consumes one BOM; this guards against a duplicated mark
    // that survived as a second character.
    text = text.slice(1);
  }

  assertNoDuplicateJsonKeys(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ValidationCliError(
      'stellarforge.config.json is not valid JSON.',
      { cause: error },
    );
  }

  return validateStellarForgeConfig(parsed);
}

export function resolveProjectConfig(
  cwd: string,
  overrides: ProjectConfigOverrides = {},
): ResolvedProjectConfig {
  const projectConfig = loadProjectConfig(cwd);

  const identity =
    overrides.identity === undefined
      ? projectConfig?.identity
      : validateIdentityAlias(overrides.identity);
  const network = overrides.network ?? projectConfig?.network;

  return {
    ...(network === undefined ? {} : { network }),
    ...(identity === undefined ? {} : { identity }),
  };
}
