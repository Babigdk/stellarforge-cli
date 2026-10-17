export interface NumericVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function parseNumericVersion(value: string): NumericVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());

  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (![major, minor, patch].every(Number.isSafeInteger)) return null;

  return { major, minor, patch };
}

export function compareVersions(
  left: NumericVersion,
  right: NumericVersion,
): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function isAtLeast(
  actual: NumericVersion,
  minimum: NumericVersion,
): boolean {
  return compareVersions(actual, minimum) >= 0;
}
