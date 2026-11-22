import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNewCommand } from '../src/commands/new.js';
import { validateStellarForgeConfig } from '../src/config/schema.js';
import { resolveDevProcessPlan } from '../src/dev/project.js';
import { EXIT_CODES } from '../src/errors/index.js';
import {
  TEMPLATE_IDS,
  getTemplate,
  type TemplateId,
} from '../src/generator/template-registry.js';
import { createNpmInvocation } from '../src/process/npm.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';

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
    const block = /```json\r?\n([\s\S]*?)```/.exec(quickStart);
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

describe('public documentation link integrity (SW-203)', () => {
  function walkMarkdown(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'dist'
      ) {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkMarkdown(path));
      else if (entry.name.endsWith('.md')) out.push(path);
    }
    return out;
  }

  // The public surface under test: the front door, everything under docs/,
  // and the generated template READMEs that ship to npm. Paths are relative
  // to the repository root for readable failure messages.
  const publicDocs = [
    'README.md',
    ...walkMarkdown(join(root, 'docs')).map((path) =>
      path.slice(root.length + 1),
    ),
    ...walkMarkdown(join(root, 'templates')).map((path) =>
      path.slice(root.length + 1),
    ),
  ].sort();

  function stripCodeFences(text: string): string {
    const lines = text.split('\n');
    let inFence = false;
    return lines
      .map((line) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
          inFence = !inFence;
          return '';
        }
        return inFence ? '' : line;
      })
      .join('\n');
  }

  function slugify(headings: string): Set<string> {
    // A GitHub-compatible heading slugger: strips inline markup, lowercases,
    // drops everything outside letters/numbers/spaces/underscores/hyphens,
    // converts spaces to hyphens, and disambiguates duplicates with -N.
    const counts = new Map<string, number>();
    const anchors = new Set<string>();

    for (const raw of headings.split(/\r?\n/)) {
      const match = raw.trimEnd().match(/^(#{1,6})\s+(.*)$/);
      if (!match || !match[2]) {
        continue;
      }

      let slug = (match[2] ?? '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`*_~]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N} _-]/gu, '')
        .replace(/\s+/g, '-');

      const occurrences = counts.get(slug) ?? 0;
      counts.set(slug, occurrences + 1);
      if (occurrences > 0) {
        slug = `${slug}-${occurrences}`;
      }
      anchors.add(slug);
    }

    return anchors;
  }

  function lineNumberOf(text: string, index: number): number {
    return text.slice(0, index).split('\n').length;
  }

  const EXTERNAL_SCHEME = /^(https?:|mailto:|ftp:|tel:|data:|javascript:)/i;
  const LINK_RE = /\[([^\]]*)\]\(([^)\s]+?)(\s+"[^"]*")?\)/g;

  it('covers the documented public surface deterministically', () => {
    expect(publicDocs.length).toBeGreaterThan(0);
    expect(publicDocs).toContain('README.md');
    for (const templateId of [
      'basic-app',
      'full-stack',
      'smart-contract',
      'api-service',
    ]) {
      expect(
        publicDocs.some((path) =>
          path
            .replace(/\\/g, '/')
            .includes(`templates/${templateId}/README.md`),
        ),
      ).toBe(true);
    }
    expect([...publicDocs].sort()).toEqual(publicDocs);
  });

  it('resolves every relative link and local anchor without network access', () => {
    const anchorCache = new Map<string, Set<string>>();
    const anchorsFor = (absolutePath: string) => {
      let cached = anchorCache.get(absolutePath);
      if (!cached) {
        cached = slugify(readFileSync(absolutePath, 'utf8'));
        anchorCache.set(absolutePath, cached);
      }
      return cached;
    };

    const failures: string[] = [];

    for (const rel of publicDocs) {
      const normalized = join(root, rel);
      const text = readFileSync(normalized, 'utf8');
      const scanned = stripCodeFences(text);
      const baseDir = join(root, dirname(rel));

      for (const match of scanned.matchAll(LINK_RE)) {
        const rawTarget = match[2] ?? '';
        const index = match.index ?? 0;
        const line = lineNumberOf(scanned, index);

        if (EXTERNAL_SCHEME.test(rawTarget) || rawTarget.startsWith('//')) {
          // External URLs are explicitly out of scope and never fetched.
          continue;
        }

        let target: string;
        try {
          target = decodeURIComponent(rawTarget);
        } catch {
          // A percent sequence we cannot decode is itself broken.
          failures.push(`${rel}:${line} undecodable link target: ${rawTarget}`);
          continue;
        }

        const [pathPart = '', anchor] = target.split('#', 2);

        if (pathPart === '') {
          if (anchor && !anchorsFor(normalized).has(anchor)) {
            failures.push(`${rel}:${line} unknown local anchor: #${anchor}`);
          }
          continue;
        }

        const targetPath = resolve(baseDir, pathPart ?? '');

        if (!existsSync(targetPath)) {
          failures.push(`${rel}:${line} unresolved link target: ${pathPart}`);
          continue;
        }

        if (anchor && targetPath.endsWith('.md')) {
          if (!anchorsFor(targetPath).has(anchor)) {
            failures.push(
              `${rel}:${line} unknown anchor #${anchor} in ${pathPart}`,
            );
          }
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});

describe('generated template README command smoke', () => {
  const EXTERNAL_TOOLS = ['rustup', 'cargo', 'stellar', 'cp'] as const;
  const SMOKE_MARKER = 'Offline smoke coverage';
  const COMMAND_LOG_ENV = 'SF_SMOKE_COMMAND_LOG';
  const MOCK_WASM = 'target/wasm32v1-none/release/smoke.wasm';
  const MOCK_IDENTITY = 'smoke-identity';

  interface CommandInvocation {
    readonly command: string;
    readonly args: readonly string[];
  }

  interface StartCriteria {
    readonly port?: number;
    readonly readyOutput?: string;
    readonly env?: NodeJS.ProcessEnv;
  }

  function readTemplateReadme(templateId: TemplateId): string {
    return readFileSync(
      join(root, 'templates', templateId, 'README.md'),
      'utf8',
    );
  }

  function normalizeCommand(command: string): string {
    return command
      .replace(/\\\r?\n/g, ' ')
      .trim()
      .split(/\s+/)
      .join(' ');
  }

  function bashCommands(templateId: TemplateId): string[] {
    const commands: string[] = [];

    for (const block of readTemplateReadme(templateId).matchAll(
      /```bash\r?\n([\s\S]*?)```/g,
    )) {
      const joined = (block[1] ?? '').replace(/\\\r?\n/g, ' ');

      for (const line of joined.split(/\r?\n/)) {
        const command = normalizeCommand(line);
        if (command.length > 0 && !command.startsWith('#')) {
          commands.push(command);
        }
      }
    }

    return commands;
  }

  function npmScript(command: string): string | undefined {
    return /^npm (?:run )?([A-Za-z][\w:-]*)$/.exec(command)?.[1];
  }

  function externalTool(
    command: string,
  ): (typeof EXTERNAL_TOOLS)[number] | undefined {
    const name = command.split(/\s+/, 1)[0];
    return EXTERNAL_TOOLS.find((tool) => tool === name);
  }

  function failure(
    templateId: TemplateId,
    command: string,
    detail: string,
  ): string {
    return `template "${templateId}", command "${command}": ${detail}`;
  }

  function shellInvocation(
    command: string,
    args: readonly string[],
  ): CommandInvocation {
    if (process.platform === 'win32') {
      return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] };
    }

    return { command, args: [...args] };
  }

  function assertSucceeded(
    templateId: TemplateId,
    command: string,
    result: SpawnSyncReturns<string>,
  ): void {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

    expect(
      result.status,
      failure(
        templateId,
        command,
        `status ${String(result.status)}, signal ${String(result.signal)}\n${output}`,
      ),
    ).toBe(0);
  }

  function generateTemplate(parent: string, templateId: TemplateId): string {
    const projectName = `smoke-${templateId}`;
    const command = createNewCommand({
      cwd: () => parent,
      output: createCapturedTerminalOutput().output,
    });

    command.parse(['node', 'new', projectName, '--template', templateId]);

    return join(parent, projectName);
  }

  async function reserveLoopbackPort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => {
          if (typeof address === 'object' && address !== null) {
            resolvePort(address.port);
            return;
          }

          reject(new Error('Unable to reserve a loopback port for smoke.'));
        });
      });
    });
  }

  async function isHealthy(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  function stopProcess(child: ChildProcess): void {
    if (child.pid === undefined) {
      return;
    }

    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      });
      return;
    }

    child.kill('SIGTERM');
  }

  async function runStartInvocation(
    invocation: CommandInvocation,
    label: string,
    templateId: TemplateId,
    projectRoot: string,
    criteria: StartCriteria,
  ): Promise<string> {
    const child = spawn(invocation.command, [...invocation.args], {
      cwd: projectRoot,
      env: criteria.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    const deadline = Date.now() + 20_000;

    try {
      while (Date.now() < deadline) {
        if (child.exitCode !== null) {
          if (child.exitCode === 0 && criteria.port === undefined) {
            return output;
          }

          throw new Error(
            failure(
              templateId,
              label,
              `exited with code ${child.exitCode} before readiness\n${output}`,
            ),
          );
        }

        const readyByOutput =
          criteria.readyOutput !== undefined &&
          output.includes(criteria.readyOutput);
        const readyByHttp =
          criteria.port !== undefined && (await isHealthy(criteria.port));

        if (readyByOutput || readyByHttp) {
          return output;
        }

        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      }

      throw new Error(
        failure(
          templateId,
          label,
          `timed out waiting for readiness\n${output}`,
        ),
      );
    } finally {
      stopProcess(child);
    }
  }

  function createToolMocks(parent: string): {
    readonly binDir: string;
    readonly logPath: string;
  } {
    const binDir = join(parent, 'mock-bin');
    mkdirSync(binDir, { recursive: true });
    const logPath = join(parent, 'external-commands.log');
    const recorderPath = join(binDir, 'record-command.js');

    writeFileSync(
      recorderPath,
      [
        "import { appendFileSync } from 'node:fs';",
        `appendFileSync(process.env.${COMMAND_LOG_ENV}, \`\${process.argv.slice(2).join(' ')}\\n\`);`,
        '',
      ].join('\n'),
    );

    for (const tool of EXTERNAL_TOOLS) {
      if (process.platform === 'win32') {
        writeFileSync(
          join(binDir, `${tool}.cmd`),
          `@echo off\r\nnode "${recorderPath}" ${tool} %*\r\nexit /b %errorlevel%\r\n`,
        );
        continue;
      }

      const scriptPath = join(binDir, tool);
      writeFileSync(
        scriptPath,
        `#!/bin/sh\nexec node "${recorderPath}" ${tool} "$@"\n`,
        { mode: 0o755 },
      );
      chmodSync(scriptPath, 0o755);
    }

    return { binDir, logPath };
  }

  function substitutePlaceholders(command: string): string {
    return command
      .replace(/<path-to-generated-wasm>/g, MOCK_WASM)
      .replace(/<local-identity>/g, MOCK_IDENTITY);
  }

  function runMockedCommand(
    templateId: TemplateId,
    command: string,
    projectRoot: string,
    env: NodeJS.ProcessEnv,
  ): void {
    const [tool, ...args] = substitutePlaceholders(command).split(/\s+/);
    const invocation = shellInvocation(tool ?? '', args);
    const result = spawnSync(invocation.command, [...invocation.args], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      shell: false,
      timeout: 15_000,
    });

    assertSucceeded(templateId, command, result);
  }

  it('parses every documented command and classifies it as local or external', () => {
    for (const templateId of TEMPLATE_IDS) {
      const commands = bashCommands(templateId);

      expect(
        commands.length,
        failure(templateId, 'README', 'no bash commands documented'),
      ).toBeGreaterThan(0);

      for (const command of commands) {
        const classified =
          npmScript(command) !== undefined ||
          externalTool(command) !== undefined ||
          command === 'node --env-file=.env src/start.js';

        expect(
          classified,
          failure(templateId, command, 'unclassified documented command'),
        ).toBe(true);
      }
    }
  });

  it('identifies the template and command in failure output', () => {
    const result = {
      status: 7,
      signal: null,
      stdout: '',
      stderr: 'boom',
    } as unknown as SpawnSyncReturns<string>;

    expect(() => assertSucceeded('basic-app', 'npm run check', result)).toThrow(
      'template "basic-app", command "npm run check"',
    );
  });

  it('executes every documented npm script in a freshly generated project', async () => {
    for (const templateId of TEMPLATE_IDS) {
      const documentedScripts = bashCommands(templateId)
        .map((command) => npmScript(command))
        .filter((script): script is string => script !== undefined);
      if (documentedScripts.length === 0) {
        continue;
      }

      await withTempDirectory(async (parent) => {
        const projectRoot = generateTemplate(parent, templateId);
        const manifest = JSON.parse(
          readFileSync(join(projectRoot, 'package.json'), 'utf8'),
        ) as { scripts: Record<string, string> };

        for (const script of documentedScripts) {
          expect(
            manifest.scripts[script],
            failure(
              templateId,
              `npm run ${script}`,
              'script is missing from generated package.json',
            ),
          ).toBeDefined();
        }

        for (const script of ['check', 'test']) {
          if (!documentedScripts.includes(script)) {
            continue;
          }

          const invocation = shellInvocation('npm', ['run', script]);
          const result = spawnSync(invocation.command, [...invocation.args], {
            cwd: projectRoot,
            encoding: 'utf8',
            shell: false,
            timeout: 30_000,
          });

          assertSucceeded(templateId, `npm run ${script}`, result);
        }

        const startScript = documentedScripts.find(
          (script) => script === 'start' || script === 'start:backend',
        );
        if (startScript === undefined) {
          return;
        }

        const port =
          templateId === 'basic-app' ? undefined : await reserveLoopbackPort();
        const envName =
          templateId === 'api-service' ? 'API_PORT' : 'BACKEND_PORT';
        const criteria: StartCriteria = {
          ...(port === undefined ? {} : { port }),
          ...(templateId === 'api-service'
            ? { readyOutput: 'listening on http://127.0.0.1:' }
            : {}),
          ...(port === undefined
            ? {}
            : { env: { ...process.env, [envName]: String(port) } }),
        };
        const output = await runStartInvocation(
          shellInvocation('npm', ['run', startScript]),
          `npm run ${startScript}`,
          templateId,
          projectRoot,
          criteria,
        );

        if (templateId === 'basic-app') {
          expect(
            output,
            failure(
              templateId,
              `npm run ${startScript}`,
              'missing public Testnet endpoints',
            ),
          ).toContain('horizon-testnet.stellar.org');
        }
      });
    }
  }, 180_000);

  it(
    'executes the documented --env-file start command with a temporary .env',
    async () =>
      withTempDirectory(async (parent) => {
        const templateId: TemplateId = 'api-service';
        const command = 'node --env-file=.env src/start.js';
        expect(bashCommands(templateId)).toContain(command);

        const projectRoot = generateTemplate(parent, templateId);
        const port = await reserveLoopbackPort();
        const example = readFileSync(join(projectRoot, '.env.example'), 'utf8');
        writeFileSync(
          join(projectRoot, '.env'),
          example.replace(/^API_PORT=.*$/m, `API_PORT=${port}`),
        );

        const output = await runStartInvocation(
          {
            command: process.execPath,
            args: ['--env-file=.env', 'src/start.js'],
          },
          command,
          templateId,
          projectRoot,
          { port, readyOutput: 'listening on http://127.0.0.1:' },
        );

        expect(output).toContain(`listening on http://127.0.0.1:${port}`);
      }),
    60_000,
  );

  it('runs documented external-tool commands through safe mocks', async () => {
    for (const templateId of TEMPLATE_IDS) {
      const externalCommands = bashCommands(templateId).filter(
        (command) => externalTool(command) !== undefined,
      );
      if (externalCommands.length === 0) {
        continue;
      }

      await withTempDirectory(async (parent) => {
        const projectRoot = generateTemplate(parent, templateId);
        const mocks = createToolMocks(parent);
        const env = {
          ...process.env,
          PATH: `${mocks.binDir}${delimiter}${process.env.PATH ?? ''}`,
          [COMMAND_LOG_ENV]: mocks.logPath,
        };

        for (const command of externalCommands) {
          runMockedCommand(templateId, command, projectRoot, env);
        }

        const logged = readFileSync(mocks.logPath, 'utf8')
          .trim()
          .split(/\r?\n/);

        expect(
          logged,
          failure(templateId, 'mock log', 'unexpected tool invocations'),
        ).toEqual(
          externalCommands.map((command) => substitutePlaceholders(command)),
        );
      });
    }
  }, 120_000);

  it(
    'confirms documented local commands need no install step',
    () =>
      withTempDirectory((parent) => {
        for (const templateId of TEMPLATE_IDS) {
          if (!bashCommands(templateId).some((command) => npmScript(command))) {
            continue;
          }

          const projectRoot = generateTemplate(parent, templateId);
          const manifest = JSON.parse(
            readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
          ) as { dependencies?: unknown; devDependencies?: unknown };

          expect(
            manifest.dependencies,
            failure(templateId, 'npm install', 'unexpected runtime dependency'),
          ).toBeUndefined();
          expect(
            manifest.devDependencies,
            failure(templateId, 'npm install', 'unexpected dev dependency'),
          ).toBeUndefined();
        }
      }),
    180_000,
  );

  it('marks external tooling and the offline smoke boundary in every README', () => {
    for (const templateId of TEMPLATE_IDS) {
      expect(
        readTemplateReadme(templateId),
        failure(templateId, 'README', `missing "${SMOKE_MARKER}" section`),
      ).toContain(SMOKE_MARKER);
    }

    const smartContractReadme = readTemplateReadme('smart-contract');
    expect(smartContractReadme).toContain('safe command mocks');
    expect(smartContractReadme).toContain(
      'no contract is built or deployed by the offline smoke test',
    );
    expect(smartContractReadme).not.toMatch(
      /offline smoke test (?:successfully )?deployed/i,
    );
    expect(readTemplateReadme('api-service')).toContain(
      'does not require `cp` to be installed',
    );
  });

  it('cleans up generated project directories on failure', async () => {
    let captured = '';

    await expect(
      withTempDirectory(async (parent) => {
        captured = parent;
        const projectRoot = generateTemplate(parent, 'basic-app');
        expect(existsSync(join(projectRoot, 'README.md'))).toBe(true);
        throw new Error('deliberate smoke failure');
      }),
    ).rejects.toThrow('deliberate smoke failure');

    expect(existsSync(captured)).toBe(false);
  });
});
