export interface NumericVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseSafeIntegerComponent(component: string): number | null {
  if (!/^\d+$/.test(component)) {
    return null;
  }

  const value = Number(component);
  if (!Number.isSafeInteger(value)) {
    return null;
  }

  return value;
}

export function parseNumericVersion(value: string): NumericVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());

  if (!match) return null;

  const major = parseSafeIntegerComponent(match[1]!);
  const minor = parseSafeIntegerComponent(match[2]!);
  const patch = parseSafeIntegerComponent(match[3]!);

  if (major === null || minor === null || patch === null) {
    return null;
  }

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
