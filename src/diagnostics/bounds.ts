
/**
 * Bounds constants and utilities for diagnostic text rendering.
 *
 * These values constrain the maximum size of diagnostic messages and
 * remediation hints written to the terminal, preventing excessive output
 * from untrusted or misbehaving tools.
 */

/** Maximum character length for a single diagnostic message. */
export const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 200;

/** Maximum character length for a single diagnostic remediation hint. */
export const MAX_DIAGNOSTIC_REMEDIATION_LENGTH = 200;

const ELLIPSIS = '...';

/**
 * Truncates diagnostic text to a maximum length.
 *
 * Uses Unicode code points to avoid splitting surrogate pairs.
 * Appends an ellipsis when truncation is necessary, provided the
 * maximum length can accommodate it.
 *
 * @param text - Diagnostic text to truncate.
 * @param maxLength - Maximum allowed number of Unicode code points.
 * @returns The original text or its truncated representation.
 * @throws RangeError when maxLength is negative or not a finite integer.
 */
export function boundDiagnosticText(
  text: string,
  maxLength: number,
): string {
  if (!Number.isSafeInteger(maxLength) || maxLength < 0) {
    throw new RangeError('maxLength must be a non-negative safe integer');
  }

  if (text.length === 0 || maxLength === 0) {
    return '';
  }

  const characters = Array.from(text);

  if (characters.length <= maxLength) {
    return text;
  }

  if (maxLength <= ELLIPSIS.length) {
    return ELLIPSIS.slice(0, maxLength);
  }

  return `${characters
    .slice(0, maxLength - ELLIPSIS.length)
    .join('')}${ELLIPSIS}`;
}
