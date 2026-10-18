#!/usr/bin/env node

import { runWithCliErrorBoundary } from './errors/index.js';
import { EXIT_CODES } from './errors/errors.js';
import { runCli } from './main.js';

const boundaryExitCode = await runWithCliErrorBoundary(() => runCli());
if (boundaryExitCode !== EXIT_CODES.success) {
  process.exitCode = boundaryExitCode;
}
