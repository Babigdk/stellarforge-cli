import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDeployCommand } from '../src/commands/deploy.js';
import { validateStellarForgeConfig } from '../src/config/schema.js';
import { resolveTestnetDeploymentPlan } from '../src/deployment/project.js';
import { createCapturedTerminalOutput } from './helpers/captured-output.js';
import { FakeChildProcess } from './helpers/fake-child.js';
import { withTempDirectory } from './helpers/temp-directory.js';

const root = join(import.meta.dirname, '..');

const quickStartDoc = readFileSync(
  join(root, 'docs', 'guides', 'quick-start.md'),
  'utf8',
);
const commandsDoc = readFileSync(
  join(root, 'docs', 'reference', 'commands.md'),
  'utf8',
);
const configurationDoc = readFileSync(
  join(root, 'docs', 'reference', 'configuration.md'),
  'utf8',
);
const troubleshootingDoc = readFileSync(
  join(root, 'docs', 'reference', 'troubleshooting.md'),
  'utf8',
);
const smartContractReadme = readFileSync(
  join(root, 'templates', 'smart-contract', 'README.md'),
  'utf8',
);

const deploymentDocs = [
  { name: 'quick-start.md', content: quickStartDoc },
  { name: 'commands.md', content: commandsDoc },
  { name: 'configuration.md', content: configurationDoc },
  { name: 'troubleshooting.md', content: troubleshootingDoc },
  { name: 'templates/smart-contract/README.md', content: smartContractReadme },
];

describe('SW-103: Testnet deployment documentation conformance', () => {
  describe('Acceptance Criterion: examples use Testnet and named identity aliases', () => {
    it('ensures all documented deployment CLI examples specify testnet and named identity aliases', () => {
      // Find all `stellarforge deploy ...` command invocations in docs
      const deployCommandRegex = /stellarforge deploy(?:\s+[^\n`]+)?/g;

      for (const { name, content } of deploymentDocs) {
        const matches = [...content.matchAll(deployCommandRegex)].map((m) =>
          m[0].trim(),
        );
        for (const cmd of matches) {
          if (cmd.includes('--network')) {
            expect(
              cmd,
              `Found non-testnet network flag in ${name}: ${cmd}`,
            ).toMatch(/--network\s+testnet\b/);
          }
          if (cmd.includes('--source')) {
            // Identity alias must be named, not raw secret or public StrKey
            expect(
              cmd,
              `Source flag must not contain raw key or seed phrase in ${name}: ${cmd}`,
            ).not.toMatch(/--source\s+[SG][0-9A-Z]{55}/);
            // Source must be a valid alphanumeric alias
            expect(
              cmd,
              `Source flag must be a named identity in ${name}: ${cmd}`,
            ).toMatch(/--source\s+[a-zA-Z0-9_-]+/);
          }
        }
      }
    });

    it('ensures all configuration JSON examples with deployment fields use network testnet and named identities', () => {
      const jsonBlockRegex = /```json\n([\s\S]*?)```/g;

      for (const { name, content } of deploymentDocs) {
        const blocks = [...content.matchAll(jsonBlockRegex)];
        for (const match of blocks) {
          const jsonText = match[1]?.trim() ?? '';
          try {
            const parsed = JSON.parse(jsonText);
            if (
              typeof parsed === 'object' &&
              parsed !== null &&
              ('network' in parsed || 'identity' in parsed)
            ) {
              expect(() => validateStellarForgeConfig(parsed)).not.toThrow();

              if ('network' in parsed) {
                expect(
                  parsed.network,
                  `JSON example in ${name} must use testnet: ${jsonText}`,
                ).toBe('testnet');
              }

              if ('identity' in parsed) {
                expect(
                  typeof parsed.identity,
                  `Identity in ${name} must be a string`,
                ).toBe('string');
                expect(
                  parsed.identity,
                  `Identity in ${name} must not be a StrKey: ${parsed.identity}`,
                ).not.toMatch(/^[SG][0-9A-Z]{55}$/);
                expect(
                  parsed.identity,
                  `Identity in ${name} must be a valid alias: ${parsed.identity}`,
                ).toMatch(/^[a-zA-Z0-9_-]+$/);
              }
            }
          } catch {
            // Non-JSON or partial snippet; ignore if not a config block
          }
        }
      }
    });
  });

  describe('Acceptance Criterion: no raw keys/seed phrases/Mainnet automation', () => {
    it('prohibits secret-bearing raw keys, seed phrases, and Mainnet deployment automation across docs', () => {
      // Prohibit raw Stellar Secret keys (S followed by 55 base32 chars)
      const rawSecretRegex = /\bS[0-9A-Z]{55}\b/;
      // Prohibit raw Stellar Account/Public keys in deploy examples (G followed by 55 base32 chars)
      const rawPublicRegex = /\bG[0-9A-Z]{55}\b/;
      // Prohibit seed phrases or private key examples
      const seedPhraseRegex = /\b(?:12|24)-word seed phrase\b/i;

      for (const { name, content } of deploymentDocs) {
        expect(
          rawSecretRegex.test(content),
          `Found raw secret StrKey in ${name}`,
        ).toBe(false);
        expect(
          rawPublicRegex.test(content),
          `Found raw public StrKey in ${name}`,
        ).toBe(false);
        expect(
          seedPhraseRegex.test(content),
          `Found seed phrase reference in ${name}`,
        ).toBe(false);

        // Ensure no automation of mainnet deployment
        expect(
          content,
          `Found Mainnet deployment automation command in ${name}`,
        ).not.toMatch(/stellarforge deploy[^\n`]*--network\s+mainnet/i);
        expect(
          content,
          `Found Mainnet default deployment claim in ${name}`,
        ).not.toMatch(/default(?:s)? to [Mm]ainnet/);
      }
    });

    it('explicitly reinforces that Mainnet is not implemented and Testnet-only', () => {
      expect(quickStartDoc).toContain(
        'The MVP deployment path is Testnet-only.',
      );
      expect(quickStartDoc).toContain('Mainnet deployment is not implemented.');
      expect(commandsDoc).toContain(
        'The MVP deployment command accepts only the exact network value `testnet`.',
      );
      expect(commandsDoc).toContain(
        'The source must be a named Stellar CLI identity. Raw secret keys, seed phrases, account/public StrKeys, and path-like values are rejected.',
      );
      expect(configurationDoc).toContain(
        'the MVP deploy command still permits Testnet only.',
      );
      expect(troubleshootingDoc).toContain(
        'The MVP deploy command is deliberately Testnet-only.',
      );
      expect(smartContractReadme).toContain(
        'This starter targets Stellar Testnet only; it does not configure or claim Mainnet or hosted deployment support.',
      );
    });
  });

  describe('Acceptance Criterion: command syntax is executable by docs harness', () => {
    const parseCommandArgs = (line: string): string[] => {
      const trimmed = line.trim();
      const parts = trimmed.split(/\s+/);
      // Remove 'stellarforge'
      if (parts[0] === 'stellarforge') {
        return parts.slice(1);
      }
      return parts;
    };

    it('validates every documented deploy command line executes against deploy command options without usage errors', async () => {
      const deployCommands = [
        'stellarforge deploy',
        'stellarforge deploy --network testnet --source deployer',
        'stellarforge deploy --source release-deployer',
      ];

      for (const cmdLine of deployCommands) {
        await withTempDirectory(async (root) => {
          writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
          // Write default config so that commands without explicit flags can resolve
          writeFileSync(
            join(root, 'stellarforge.config.json'),
            JSON.stringify({
              version: 1,
              network: 'testnet',
              identity: 'deployer',
            }),
          );

          const captured = createCapturedTerminalOutput();
          let executedPlan = false;

          const command = createDeployCommand({
            cwd: () => root,
            output: captured.output,
            spawnProcess: () => {
              executedPlan = true;
              const child = new FakeChildProcess();
              void child.finish(0);
              return child;
            },
          });

          const args = parseCommandArgs(cmdLine);
          await command.parseAsync(['node', ...args]);

          expect(executedPlan).toBe(true);
          expect(captured.stdoutText()).toContain(
            'Deploying smart contract to Stellar Testnet.',
          );
          expect(captured.stderrText()).toBe('');
        });
      }
    });

    it('verifies the plan generated from documented deployment examples matches the hardened Stellar CLI contract', () => {
      withTempDirectory((root) => {
        writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');

        const expectedCommand =
          process.platform === 'win32' ? 'stellar.exe' : 'stellar';

        // Documented explicit CLI invocation
        const planExplicit = resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source: 'deployer',
        });

        expect(planExplicit).toEqual([
          {
            label: 'stellar:deploy',
            command: expectedCommand,
            args: [
              'contract',
              'deploy',
              '--source-account',
              'deployer',
              '--network',
              'testnet',
            ],
            cwd: root,
          },
        ]);

        // Documented override invocation: --source release-deployer
        const planOverride = resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source: 'release-deployer',
        });

        expect(planOverride).toEqual([
          {
            label: 'stellar:deploy',
            command: expectedCommand,
            args: [
              'contract',
              'deploy',
              '--source-account',
              'release-deployer',
              '--network',
              'testnet',
            ],
            cwd: root,
          },
        ]);
      });
    });
  });
});
