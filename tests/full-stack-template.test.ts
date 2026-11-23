import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createNewCommand } from '../src/commands/new.js';
import { createNpmInvocation } from '../src/process/npm.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';
import {
  assertNoArbitraryProcessKilling,
  assertNoAutomaticPortHopping,
} from './helpers/port-collision.js';

function runNpmScript(projectRoot: string, script: string) {
  const npm = createNpmInvocation(['run', script]);

  return spawnSync(npm.command, [...npm.args], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  });
}

describe('Full Stack template', () => {
  it(
    'generates the documented frontend, backend, and contracts boundaries and passes smoke checks',
    () =>
      withTempDirectory((root) => {
        const captured = createCapturedTerminalOutput();
        const command = createNewCommand({
          cwd: () => root,
          output: captured.output,
        });

        command.parse([
          'node',
          'new',
          'demo-stack',
          '--template',
          'full-stack',
        ]);

        const projectRoot = join(root, 'demo-stack');
        expect(existsSync(join(projectRoot, 'frontend', 'src', 'app.js'))).toBe(
          true,
        );
        expect(
          existsSync(join(projectRoot, 'frontend', 'src', 'index.html')),
        ).toBe(true);
        expect(
          existsSync(join(projectRoot, 'frontend', 'src', 'styles.css')),
        ).toBe(true);
        expect(
          existsSync(join(projectRoot, 'backend', 'src', 'server.js')),
        ).toBe(true);
        expect(existsSync(join(projectRoot, 'contracts', 'README.md'))).toBe(
          true,
        );
        expect(captured.stdoutText()).toContain(
          'Created demo-stack from full-stack',
        );

        const environmentExample = readFileSync(
          join(projectRoot, '.env.example'),
          'utf8',
        );
        expect(environmentExample).toContain('STELLAR_NETWORK=TESTNET');
        expect(environmentExample).not.toMatch(/SECRET|SEED|PRIVATE_KEY/);

        const check = runNpmScript(projectRoot, 'check');
        expect(check.status, check.stderr).toBe(0);

        const test = runNpmScript(projectRoot, 'test');
        expect(test.status, test.stderr).toBe(0);

        const starterMarkup = readFileSync(
          join(projectRoot, 'frontend', 'src', 'index.html'),
          'utf8',
        );
        expect(starterMarkup).toContain('role="status"');
        expect(starterMarkup).toContain('aria-live="polite"');
        expect(starterMarkup).toContain('Retry backend status');

        const generatedReadme = readFileSync(
          join(projectRoot, 'README.md'),
          'utf8',
        );
        expect(generatedReadme).toContain('frontend/');
        expect(generatedReadme).toContain('backend/');
        expect(generatedReadme).toContain('contracts/');
        expect(generatedReadme).toContain('no credentials');
        expect(generatedReadme).toContain('/index.html');
        expect(generatedReadme).toContain('Retry backend status');
        expect(generatedReadme).toContain('before opening a socket');
        // Port-collision guidance (issue SW-196).
        expect(generatedReadme).toContain('EADDRINUSE');
        expect(generatedReadme).toContain('BACKEND_PORT');
        expect(generatedReadme).toContain('netstat -ano');
        expect(generatedReadme).toContain('lsof -i :3000');
        expect(generatedReadme).toContain('taskkill /PID');
        expect(generatedReadme).toContain('kill <pid>');
        // The frontend has no server and no port variable.
        expect(generatedReadme).not.toContain('FRONTEND_PORT');
        expect(generatedReadme).not.toContain('API_PORT');
        assertNoArbitraryProcessKilling(generatedReadme);
        assertNoAutomaticPortHopping(generatedReadme);
      }),
    15_000,
  );
});
