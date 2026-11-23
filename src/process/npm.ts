export interface NpmInvocation {
  readonly command: string;
  readonly args: readonly string[];
}

export type NpmInvocationFailure = 'executable-not-found' | 'permission-denied';

const SUPPORTED_RUNTIME_REMEDIATION =
  'Install a supported Node.js runtime (>=22.13.0 <25) and npm (>=10.9.0), then make sure npm is available on PATH.';

export function createNpmInvocation(args: readonly string[]): NpmInvocation {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
    };
  }

  return {
    command: 'npm',
    args: [...args],
  };
}

export function isNpmInvocation(spec: NpmInvocation): boolean {
  const commandIsNpm =
    spec.command === 'npm' ||
    /(?:^|[\\/])npm(?:\.cmd|\.exe)?$/iu.test(spec.command);
  const usesWindowsLauncher =
    spec.command === 'cmd.exe' &&
    spec.args[0] === '/d' &&
    spec.args[1] === '/s' &&
    spec.args[2] === '/c' &&
    spec.args[3] === 'npm';

  return commandIsNpm || usesWindowsLauncher;
}

function hasCode(error: Error, code: string): boolean {
  return (
    (error as NodeJS.ErrnoException).code === code ||
    new RegExp(`\\b${code}\\b`).test(error.message)
  );
}

export function classifyNpmInvocationError(
  error: unknown,
): NpmInvocationFailure | undefined {
  return classifyNpmInvocationErrorWithDepth(error, 0);
}

function classifyNpmInvocationErrorWithDepth(
  error: unknown,
  depth: number,
): NpmInvocationFailure | undefined {
  if (!(error instanceof Error) || depth > 4) {
    return undefined;
  }

  if (hasCode(error, 'ENOENT')) {
    return 'executable-not-found';
  }

  if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM')) {
    return 'permission-denied';
  }

  if (error.cause instanceof Error) {
    return classifyNpmInvocationErrorWithDepth(error.cause, depth + 1);
  }

  return undefined;
}

export function npmInvocationRemediation(
  failure: NpmInvocationFailure,
): string {
  if (failure === 'executable-not-found') {
    return `Unable to find npm or its supported launcher. ${SUPPORTED_RUNTIME_REMEDIATION}`;
  }

  return `npm or its supported launcher could not be executed. ${SUPPORTED_RUNTIME_REMEDIATION}`;
}
