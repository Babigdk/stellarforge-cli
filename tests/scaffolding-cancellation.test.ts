import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNewCommand } from '../src/commands/new.js';
import {
  EXIT_CODES,
  ScaffoldingCancelledCliError,
  runWithCliErrorBoundary,
} from '../src/errors/index.js';
import { generateProjectFromTemplate } from '../src/generator/template-generation.js';
import type {
  GenerationContext,
  ProjectGeneratorServices,
} from '../src/generator/types.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';

function context(root: string): GenerationContext {
  return {
    input: {
      projectName: 'demo-app',
      cwd: root,
      templateId: 'basic-app',
    },
    destination: {
      projectName: 'demo-app',
      destination: join(root, 'demo-app'),
    },
    template: {
      templateId: 'basic-app',
    },
  };
}

describe('project scaffolding cancellation', () => {
  it('cleans staging artifacts and does not create destination when cancelled during generation', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(join(templateRoot, 'src'), { recursive: true });
      writeFileSync(join(templateRoot, 'a.txt'), 'a');
      writeFileSync(join(templateRoot, 'b.txt'), 'b');
      const keep = join(root, 'keep.txt');
      writeFileSync(keep, 'keep');

      let checks = 0;
      expect(() =>
        generateProjectFromTemplate(context(root), {
          templateRoot,
          isCancelled: () => {
            checks += 1;
            return checks > 3;
          },
        }),
      ).toThrow(ScaffoldingCancelledCliError);

      expect(existsSync(join(root, 'demo-app'))).toBe(false);
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
      expect(readFileSync(keep, 'utf8')).toBe('keep');
    }));

  it('preserves a pre-existing empty destination and user data when cancelled before commit', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'README.md'), 'safe');
      const destination = join(root, 'demo-app');
      mkdirSync(destination);
      const userFile = join(root, 'notes.txt');
      writeFileSync(userFile, 'user data');

      let checks = 0;
      expect(() =>
        generateProjectFromTemplate(context(root), {
          templateRoot,
          isCancelled: () => {
            checks += 1;
            return checks > 6;
          },
        }),
      ).toThrow(ScaffoldingCancelledCliError);

      expect(existsSync(destination)).toBe(true);
      expect(readdirSync(destination)).toEqual([]);
      expect(readFileSync(userFile, 'utf8')).toBe('user data');
      expect(
        readdirSync(root).filter((name) =>
          name.startsWith('.stellarforge-demo-app-'),
        ),
      ).toEqual([]);
    }));

  it('stops before generation and reports non-zero cancellation outcome without success output', async () =>
    withTempDirectory(async (cwd) => {
      const calls: string[] = [];
      const services: ProjectGeneratorServices = {
        validate(input) {
          calls.push('validate');
          return input;
        },
        planDestination(input) {
          calls.push('plan');
          process.emit('SIGINT');
          return {
            projectName: input.projectName,
            destination: join(cwd, 'demo'),
          };
        },
        selectTemplate() {
          calls.push('template');
          return { templateId: 'basic-app' };
        },
        generate() {
          calls.push('generate');
          return {
            projectName: 'demo',
            destination: join(cwd, 'demo'),
            templateId: 'basic-app',
          };
        },
      };

      const captured = createCapturedTerminalOutput();
      const command = createNewCommand({
        services,
        output: captured.output,
        cwd: () => cwd,
      });

      const exitCode = await runWithCliErrorBoundary(async () => {
        await command.parseAsync(['node', 'new', 'demo']);
      }, captured.output);

      expect(calls).toContain('plan');
      expect(calls).not.toContain('generate');
      expect(exitCode).toBe(EXIT_CODES.cancelled);
      expect(captured.stderrText()).toContain('Project scaffolding cancelled.');
      expect(captured.stdoutText()).not.toContain('Created');
      expect(existsSync(join(cwd, 'demo'))).toBe(false);
    }));

  it('rolls back generation work and does not emit success when cancellation is observed during generation', async () =>
    withTempDirectory(async (cwd) => {
      const templateRoot = join(cwd, 'template');
      mkdirSync(templateRoot);
      writeFileSync(join(templateRoot, 'README.md'), 'hello');
      const keep = join(cwd, 'keep.txt');
      writeFileSync(keep, 'keep');

      let checks = 0;
      const services: ProjectGeneratorServices = {
        validate(input) {
          return input;
        },
        planDestination(input) {
          return {
            projectName: input.projectName,
            destination: join(cwd, 'demo'),
          };
        },
        selectTemplate() {
          return { templateId: 'basic-app' };
        },
        generate(context, generationOptions) {
          return generateProjectFromTemplate(context, {
            templateRoot,
            ...(generationOptions?.dryRun === undefined
              ? {}
              : { dryRun: generationOptions.dryRun }),
            isCancelled: () => {
              checks += 1;
              if (checks > 2) {
                process.emit('SIGINT');
              }
              return generationOptions?.isCancelled?.() ?? false;
            },
          });
        },
      };

      const captured = createCapturedTerminalOutput();
      const command = createNewCommand({
        services,
        output: captured.output,
        cwd: () => cwd,
      });

      const exitCode = await runWithCliErrorBoundary(async () => {
        await command.parseAsync(['node', 'new', 'demo']);
      }, captured.output);

      expect(exitCode).toBe(EXIT_CODES.cancelled);
      expect(captured.stderrText()).toContain('Project scaffolding cancelled.');
      expect(captured.stdoutText()).not.toContain('Created');
      expect(existsSync(join(cwd, 'demo'))).toBe(false);
      expect(
        readdirSync(cwd).filter((name) =>
          name.startsWith('.stellarforge-demo-'),
        ),
      ).toEqual([]);
      expect(readFileSync(keep, 'utf8')).toBe('keep');
    }));
});
