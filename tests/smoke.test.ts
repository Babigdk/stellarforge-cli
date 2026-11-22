import { describe, expect, it } from 'vitest';

import { STELLARFORGE_CLI_NAME } from '../src/index.js';
import { EXIT_CODES } from '../src/errors/errors.js';

describe('StellarForge CLI package foundation', () => {
  it('exports the CLI identity from the source module', () => {
    expect(STELLARFORGE_CLI_NAME).toBe('StellarForge CLI');
  });

  it('documents a stable non-zero cancellation exit code', () => {
    expect(EXIT_CODES.cancelled).toBe(130);
  });
});
