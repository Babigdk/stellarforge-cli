import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateStellarForgeConfig } from '../src/config/schema.js';
import { resolveDevProcessPlan } from '../src/dev/project.js';
import { EXIT_CODES } from '../src/errors/index.js';
import {
  TEMPLATE_IDS,
  getTemplate,
} from '../src/generator/template-registry.js';
import { createNpmInvocation } from '../src/process/npm.js';
import { withTempDirectory } from './helpers/index.js';

const root = join(import.meta.dirname, '..');
const quickStart = readFileSync(
  join(root, 'docs', 'guides', 'quick-start.md'),
  'utf8',
);

const templateMatches = [...quickStart.matchAll(/--template ([a-z-]+)/g)];
const documentedTemplateIds = templateMatches.map((match) => match[1] ?? '');

describe('Quick Start documentation', () => {
  it('documents only implemented commands', () => {
    for (const command of [
      'stellarforge new',
      'stellarforge doctor',
      'stellarforge dev',
      'stellarforge test',
      'stellarforge deploy',
    ]) {
      expect(quickStart).toContain(command);
    }

    expect(quickStart).not.toContain('stellarforge add');
    expect(quickStart).not.toContain('remote template');
  });

  it('references only bundled template IDs and documents the default', () => {
    for (const templateId of documentedTemplateIds) {
      expect(TEMPLATE_IDS).toContain(templateId);
    }

    expect(documentedTemplateIds).toContain('api-service');
    expect(documentedTemplateIds).toContain('smart-contract');
    expect(documentedTemplateIds).toContain('full-stack');
    expect(quickStart).toContain('The default template is `basic-app`');
    expect(getTemplate('basic-app').id).toBe('basic-app');
  });

  it('matches the implemented development script selection order', () =>
    withTempDirectory((projectRoot) => {
      const writeScripts = (scripts: Record<string, string>): void => {
        writeFileSync(
          join(projectRoot, 'package.json'),
          JSON.stringify({ name: 'quick-start-app', scripts }),
        );
      };

      expect(quickStart).toContain('`dev`, then `start`, then `start:backend`');

      writeScripts({ dev: 'a', start: 'b', 'start:backend': 'c' });
      expect(resolveDevProcessPlan(projectRoot)[0]?.args).toEqual(
        createNpmInvocation(['run', 'dev']).args,
      );

      writeScripts({ start: 'b', 'start:backend': 'c' });
      expect(resolveDevProcessPlan(projectRoot)[0]?.args).toEqual(
        createNpmInvocation(['run', 'start']).args,
      );

      writeScripts({ 'start:backend': 'c' });
      expect(resolveDevProcessPlan(projectRoot)[0]?.args).toEqual(
        createNpmInvocation(['run', 'start:backend']).args,
      );
    }));

  it('uses a configuration example that matches the schema', () => {
    const block = /```json\n([\s\S]*?)```/.exec(quickStart);
    expect(block).not.toBeNull();

    const json = (block?.[1] ?? '').trim();
    const parsed: unknown = JSON.parse(json);
    expect(() => validateStellarForgeConfig(parsed)).not.toThrow();
    expect(parsed).toMatchObject({ version: 1, network: 'testnet' });
  });

  it('documents accurate Testnet and secret boundaries', () => {
    expect(quickStart).toContain(
      'A failed required diagnostic exits with code `5`.',
    );
    expect(EXIT_CODES.diagnostic).toBe(5);
    expect(quickStart).toContain('The MVP deployment path is Testnet-only.');
    expect(quickStart).toContain('Mainnet deployment is not implemented.');
    expect(quickStart).toContain(
      'Do not place raw secret keys or seed phrases in project configuration.',
    );
    expect(quickStart).not.toContain('defaults to Mainnet');
    expect(quickStart).not.toContain('default network is mainnet');
  });
});
