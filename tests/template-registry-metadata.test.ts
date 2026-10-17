import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import * as registry from '../src/generator/template-registry.js';
import {
  getTemplate,
  listTemplates,
  selectTemplate,
  TEMPLATE_IDS,
} from '../src/generator/template-registry.js';
import { resolveBundledTemplateRoot } from '../src/generator/template-sources.js';
import { repositoryRoot } from './helpers/index.js';

const EXPECTED_IDS = [
  'basic-app',
  'full-stack',
  'smart-contract',
  'api-service',
] as const;

const SUPPORTED_MESSAGE =
  'Supported templates: basic-app, full-stack, smart-contract, api-service.';

const UNSUPPORTED_IDENTIFIERS = [
  '',
  ' ',
  'unknown',
  'basic-app ',
  ' basic-app',
  'Basic-App',
  'BASIC-APP',
  'basic_app',
  'basic-app/',
  './basic-app',
  '../basic-app',
  '../outside',
  'templates/basic-app',
  '/tmp/template',
  'C:\\templates\\basic-app',
  'C:/templates/basic-app',
  '\\\\server\\share\\template',
  '~/template',
  'file:///tmp/template',
  'https://example.com/template.git',
  'http://example.com/template.tgz',
  'git+https://example.com/template.git',
  'git@example.com:owner/template.git',
  'github:owner/template',
  'owner/template',
  'npm:stellarforge-template',
  '@scope/stellarforge-template',
  'stellarforge-plugin-custom',
  'plugin:custom',
  'constructor',
  'toString',
  '__proto__',
  'hasOwnProperty',
] as const;

describe('template registry: controlled template set', () => {
  it('exposes exactly the four controlled template IDs in order', () => {
    expect(TEMPLATE_IDS).toEqual(EXPECTED_IDS);
    expect(TEMPLATE_IDS).toHaveLength(4);
  });

  it('lists exactly the controlled template IDs in the same order', () => {
    expect(listTemplates().map((template) => template.id)).toEqual(
      EXPECTED_IDS,
    );
  });

  it('keeps template IDs unique', () => {
    const ids = listTemplates().map((template) => template.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(TEMPLATE_IDS).size).toBe(TEMPLATE_IDS.length);
  });

  it('keeps template display names unique', () => {
    const names = listTemplates().map((template) => template.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps every template ID a lowercase hyphenated slug', () => {
    for (const id of TEMPLATE_IDS) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('returns the same registry entry from getTemplate as from the list', () => {
    for (const template of listTemplates()) {
      expect(getTemplate(template.id)).toBe(template);
    }
  });
});

describe('template registry: metadata completeness', () => {
  it.each(EXPECTED_IDS)('has complete metadata for %s', (id) => {
    const template = getTemplate(id);

    expect(template.id).toBe(id);
    expect(template.name.trim()).toBe(template.name);
    expect(template.name.length).toBeGreaterThan(0);
    expect(template.description.trim()).toBe(template.description);
    expect(template.description.length).toBeGreaterThan(0);
  });

  it('carries only id, name, and description with no path, URL, or plugin fields', () => {
    for (const template of listTemplates()) {
      expect(Object.keys(template).sort()).toEqual([
        'description',
        'id',
        'name',
      ]);
    }
  });

  it('does not export any registration, plugin, or remote-loading entry point', () => {
    const unexpected = Object.keys(registry).filter((name) =>
      /register|plugin|remote|fetch|load|install/i.test(name),
    );

    expect(unexpected).toEqual([]);
  });
});

describe('template registry: bundled source mapping', () => {
  it.each(EXPECTED_IDS)(
    'maps %s to an existing bundled template directory',
    (id) => {
      const root = resolveBundledTemplateRoot(id);

      expect(isAbsolute(root)).toBe(true);
      expect(resolve(root)).toBe(
        resolve(join(repositoryRoot, 'templates', id)),
      );
      expect(existsSync(root)).toBe(true);
      expect(statSync(root).isDirectory()).toBe(true);
      expect(readdirSync(root).length).toBeGreaterThan(0);
    },
  );

  it('maps every template ID to a distinct bundled directory', () => {
    const roots = EXPECTED_IDS.map((id) => resolveBundledTemplateRoot(id));

    expect(new Set(roots).size).toBe(roots.length);
  });

  it('bundles no template directory that is missing from the registry', () => {
    const bundled = readdirSync(join(repositoryRoot, 'templates')).sort();

    expect(bundled).toEqual([...EXPECTED_IDS].sort());
  });

  it.each(['unknown', 'https://example.com/template.git', '../outside'])(
    'refuses to map unregistered identifier %j to a bundled directory',
    (identifier) => {
      expect(() => resolveBundledTemplateRoot(identifier)).toThrow(
        ValidationCliError,
      );
    },
  );
});

describe('template registry: explicit default template', () => {
  it('selects basic-app when no template is requested', () => {
    expect(selectTemplate({ projectName: 'demo', cwd: '/workspace' })).toEqual({
      templateId: 'basic-app',
    });
  });

  it('keeps the default equal to an explicit basic-app request', () => {
    const implicit = selectTemplate({ projectName: 'demo', cwd: '/workspace' });
    const explicit = selectTemplate({
      projectName: 'demo',
      cwd: '/workspace',
      templateId: 'basic-app',
    });

    expect(implicit).toEqual(explicit);
  });

  it('keeps the default a registered template and the first listed entry', () => {
    const { templateId } = selectTemplate({
      projectName: 'demo',
      cwd: '/workspace',
    });

    expect(TEMPLATE_IDS).toContain(templateId);
    expect(listTemplates()[0]?.id).toBe(templateId);
  });

  it('keeps the default independent of project name and working directory', () => {
    for (const input of [
      { projectName: 'a', cwd: '/one' },
      { projectName: 'smart-contract', cwd: '/two' },
      { projectName: 'api-service', cwd: 'relative/path' },
    ]) {
      expect(selectTemplate(input)).toEqual({ templateId: 'basic-app' });
    }
  });

  it('keeps the default stable across repeated calls', () => {
    const results = Array.from({ length: 5 }, () =>
      selectTemplate({ projectName: 'demo', cwd: '/workspace' }),
    );

    expect(new Set(results.map((result) => result.templateId))).toEqual(
      new Set(['basic-app']),
    );
  });

  it.each(EXPECTED_IDS)('selects %s when explicitly requested', (id) => {
    expect(
      selectTemplate({
        projectName: 'demo',
        cwd: '/workspace',
        templateId: id,
      }),
    ).toEqual({ templateId: id });
  });
});

describe('template registry: unsupported identifiers', () => {
  it.each(UNSUPPORTED_IDENTIFIERS)(
    'rejects %j from getTemplate and lists the supported templates',
    (identifier) => {
      expect(() => getTemplate(identifier)).toThrow(ValidationCliError);
      expect(() => getTemplate(identifier)).toThrow(SUPPORTED_MESSAGE);
    },
  );

  it.each(UNSUPPORTED_IDENTIFIERS)(
    'rejects %j from selectTemplate without falling back to the default',
    (identifier) => {
      expect(() =>
        selectTemplate({
          projectName: 'demo',
          cwd: '/workspace',
          templateId: identifier,
        }),
      ).toThrow(ValidationCliError);
    },
  );
});
