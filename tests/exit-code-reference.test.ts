import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODES } from '../src/errors/errors.js';

const REFERENCE = readFileSync(
  join(process.cwd(), 'docs', 'reference', 'exit-codes.md'),
  'utf8',
);

function documentedCodes(markdown: string): Map<number, string> {
  const codes = new Map<number, string>();
  const rowPattern = /^\|\s*`(\d+)`\s*\|\s*([^|]+?)\s*\|/gm;

  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(markdown)) !== null) {
    codes.set(Number(match[1]), match[2].trim());
  }

  return codes;
}

describe('exit-code reference conformance', () => {
  const codes = documentedCodes(REFERENCE);

  it('documents every stable exit code from the source constants', () => {
    for (const value of Object.values(EXIT_CODES)) {
      expect(codes.has(value)).toBe(true);
    }
  });

  it('keeps source constants aligned with the published policy', () => {
    expect(EXIT_CODES).toEqual({
      success: 0,
      unexpected: 1,
      validation: 2,
      subprocess: 3,
      internal: 4,
      diagnostic: 5,
    });
  });

  it('labels each documented code with a non-empty category', () => {
    for (const value of Object.values(EXIT_CODES)) {
      expect((codes.get(value) ?? '').length).toBeGreaterThan(0);
    }
  });

  it('documents help/version success and Commander parser mapping', () => {
    expect(REFERENCE).toContain('--help');
    expect(REFERENCE).toContain('--version');
    expect(REFERENCE).toContain('Commander parser failures');
  });
});
