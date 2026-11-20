import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateProjectFromTemplate } from '../src/generator/template-generation.js';
import type { GenerationContext } from '../src/generator/types.js';
import { withTempDirectory } from './helpers/index.js';

function context(root: string): GenerationContext {
  return {
    input: { projectName: 'demo-app', cwd: root, templateId: 'basic-app' },
    destination: {
      projectName: 'demo-app',
      destination: join(root, 'demo-app'),
    },
    template: { templateId: 'basic-app' },
  };
}

function createTemplate(root: string): {
  readonly templateRoot: string;
  readonly executable: string;
  readonly regular: string;
} {
  const templateRoot = join(root, 'template');
  mkdirSync(templateRoot);
  const executable = join(templateRoot, 'run.sh');
  const regular = join(templateRoot, 'README.md');

  writeFileSync(executable, '#!/bin/sh\necho ok\n');
  writeFileSync(regular, '# {{projectName}}\n');

  return { templateRoot, executable, regular };
}

describe('generated-file permission policy (SW-130)', () => {
  it.skipIf(process.platform === 'win32')(
    'preserves executable assets and constrains regular file modes on POSIX',
    () =>
      withTempDirectory((root) => {
        const { templateRoot, executable, regular } = createTemplate(root);
        chmodSync(executable, 0o755);
        chmodSync(regular, 0o666);

        generateProjectFromTemplate(context(root), { templateRoot });

        const generatedExecutable = join(root, 'demo-app', 'run.sh');
        const generatedRegular = join(root, 'demo-app', 'README.md');

        expect(statSync(generatedExecutable).mode & 0o777).toBe(0o755);
        expect(statSync(generatedRegular).mode & 0o777).toBe(0o644);
        expect(statSync(generatedRegular).mode & 0o022).toBe(0);
      }),
  );

  it.skipIf(process.platform === 'win32')(
    'does not copy privileged or group/world write bits from source metadata',
    () =>
      withTempDirectory((root) => {
        const { templateRoot, executable } = createTemplate(root);
        chmodSync(executable, 0o4777);

        generateProjectFromTemplate(context(root), { templateRoot });

        expect(
          statSync(join(root, 'demo-app', 'run.sh')).mode & 0o7777,
        ).toBe(0o755);
      }),
  );

  it('keeps generated npm project metadata usable after installation', () =>
    withTempDirectory((root) => {
      const templateRoot = join(root, 'template');
      mkdirSync(templateRoot);
      writeFileSync(
        join(templateRoot, 'package.json'),
        JSON.stringify({
          name: '{{projectName}}',
          private: true,
          scripts: { check: 'node --check src/index.js', test: 'node --test' },
        }),
      );

      generateProjectFromTemplate(context(root), { templateRoot });

      const generatedPackage = JSON.parse(
        readFileSync(join(root, 'demo-app', 'package.json'), 'utf8'),
      ) as {
        readonly name?: unknown;
        readonly scripts?: Record<string, unknown>;
      };
      expect(generatedPackage.name).toBe('demo-app');
      expect(generatedPackage.scripts?.check).toBe('node --check src/index.js');
      expect(generatedPackage.scripts?.test).toBe('node --test');
    }));

  it('generates successfully on Windows without POSIX chmod support', () =>
    withTempDirectory((root) => {
      const { templateRoot } = createTemplate(root);

      generateProjectFromTemplate(context(root), { templateRoot });

      expect(readFileSync(join(root, 'demo-app', 'run.sh'), 'utf8')).toContain(
        'echo ok',
      );
    }));
});
