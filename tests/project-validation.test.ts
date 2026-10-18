import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationCliError } from '../src/errors/errors.js';
import {
  planProjectDestination,
  validateProjectInput,
} from '../src/generator/validation.js';
import { withTempDirectory } from './helpers/index.js';

describe('project input validation', () => {
  it.each([
    '../escape',
    '..\\escape',
    '/tmp/escape',
    'C:\\temp\\escape',
    'C:/temp/escape',
    '.',
    '..',
    '.hidden',
    'nested/project',
    'nested\\project',
  ])('rejects path-like or traversal project name %j', (projectName) => {
    expect(() =>
      validateProjectInput({ projectName, cwd: '/workspace' }),
    ).toThrow(ValidationCliError);
  });

  it.each(['CON', 'prn', 'AUX.txt', 'COM1', 'lpt9.log'])(
    'rejects Windows reserved device name %j',
    (projectName) => {
      expect(() =>
        validateProjectInput({ projectName, cwd: '/workspace' }),
      ).toThrow('reserved Windows device name');
    },
  );

  it.each(['demo', 'demo-app', 'demo_app', 'demo.app', 'Demo123'])(
    'accepts safe single-segment project name %j',
    (projectName) => {
      const validated = validateProjectInput({
        projectName,
        cwd: './workspace/..',
      });

      expect(validated.projectName).toBe(projectName);
      expect(validated.cwd).toBe(resolve('./workspace/..'));
    },
  );

  it.each([
    '   ',
    '\t',
    '\n',
    '\r\n',
    '\u00A0',
    '\u200B',
    '\u0000',
    'de mo',
    'de\tmo',
    'de\nmo',
    'demo\u0000',
    'demo\u200B',
  ])('rejects ambiguous whitespace/control input %j', (projectName) => {
    expect(() =>
      validateProjectInput({ projectName, cwd: '/workspace' }),
    ).toThrow(ValidationCliError);
  });

  it.each(['  demo  ', '\tdemo', 'demo\n', 'demo\u00A0'])(
    'normalizes surrounding whitespace in %j to a single segment',
    (projectName) => {
      const validated = validateProjectInput({
        projectName,
        cwd: '/workspace',
      });

      expect(validated.projectName).toBe('demo');
    },
  );
});

describe('project destination planning', () => {
  it('plans a direct child without creating it', () =>
    withTempDirectory((path) => {
      const validated = validateProjectInput({
        projectName: 'demo',
        cwd: path,
      });
      const plan = planProjectDestination(validated);

      expect(plan).toEqual({
        projectName: 'demo',
        destination: join(path, 'demo'),
      });
    }));

  it('allows an existing empty destination directory', () =>
    withTempDirectory((path) => {
      const destination = join(path, 'demo');
      mkdirSync(destination);

      const plan = planProjectDestination(
        validateProjectInput({ projectName: 'demo', cwd: path }),
      );

      expect(plan.destination).toBe(destination);
    }));

  it('refuses an existing non-empty destination directory', () =>
    withTempDirectory((path) => {
      const destination = join(path, 'demo');
      mkdirSync(destination);
      writeFileSync(join(destination, 'existing.txt'), 'do not overwrite');

      expect(() =>
        planProjectDestination(
          validateProjectInput({ projectName: 'demo', cwd: path }),
        ),
      ).toThrow('will not overwrite existing files');
    }));

  it('refuses a destination occupied by a file', () =>
    withTempDirectory((path) => {
      writeFileSync(join(path, 'demo'), 'existing file');

      expect(() =>
        planProjectDestination(
          validateProjectInput({ projectName: 'demo', cwd: path }),
        ),
      ).toThrow('is not a directory');
    }));
});
