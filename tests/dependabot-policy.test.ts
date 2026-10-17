import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const config = readFileSync(join(root, '.github', 'dependabot.yml'), 'utf8');
const policy = readFileSync(
  join(root, 'docs', 'contributing', 'dependency-policy.md'),
  'utf8',
);

describe('Dependabot grouping policy alignment', () => {
  type UpdateBlock = {
    ecosystem: string;
    body: string;
    groupName: string;
  };

  const configBlocks = config.split(/\n\s*-\s*package-ecosystem:/).slice(1);

  const blocks: UpdateBlock[] = configBlocks.map((segment) => {
    const lines = segment.split('\n');
    const firstLine = lines[0];
    const rest = lines.slice(1);
    const ecosystem = firstLine?.trim() ?? '';
    const body = rest.join('\n');

    // Extract group name (npm-minor-and-patch or github-actions-minor-and-patch)
    let groupName = '';
    if (ecosystem === 'npm') {
      if (body.includes('npm-minor-and-patch')) {
        groupName = 'npm-minor-and-patch';
      }
    } else if (ecosystem === 'github-actions') {
      if (body.includes('github-actions-minor-and-patch')) {
        groupName = 'github-actions-minor-and-patch';
      }
    }

    return {
      ecosystem,
      body,
      groupName,
    };
  });

  it('defines npm and GitHub Actions update policies', () => {
    const ecosystems = blocks.map((b) => b.ecosystem);
    expect(ecosystems).toContain('npm');
    expect(ecosystems).toContain('github-actions');
  });

  it('uses weekly Monday cadence in Africa/Lagos with documented times and limits', () => {
    expect(config).toContain('interval: weekly');
    expect(config).toContain('day: monday');
    expect(config).toContain('timezone: Africa/Lagos');
    expect(config).toContain("time: '08:00'");
    expect(config).toContain("time: '08:30'");
    expect(config).toContain('open-pull-requests-limit: 5');
  });

  it('groups minor and patch updates only, isolating major updates', () => {
    for (const block of blocks) {
      expect(block.body).toMatch(/minor/);
      expect(block.body).toMatch(/patch/);
      // Major must not appear under update-types (or at all in the context of grouped updates)
      expect(block.body).not.toMatch(/- major\b/);
    }

    // Cross-check: no grouped major updates anywhere in the config
    expect(config).not.toMatch(/update-types:\s*[\s\S]*?- major\b/);
  });

  it('names the expected Dependabot groups', () => {
    const groupNames = blocks.map((b) => b.groupName);
    expect(groupNames).toContain('npm-minor-and-patch');
    expect(groupNames).toContain('github-actions-minor-and-patch');
  });

  it('does not introduce auto-merge for Dependabot PRs', () => {
    expect(config).not.toMatch(/auto-merge|automerge|auto_merge/i);
    expect(policy).toMatch(/No auto-merge policy is enabled/i);
  });

  it('documents the Dependabot policy accurately in the dependency policy', () => {
    expect(policy).toContain('npm-minor-and-patch');
    expect(policy).toContain('github-actions-minor-and-patch');
    expect(policy).toMatch(
      /weekly on Mondays in the `Africa\/Lagos` timezone/i,
    );
    expect(policy).toContain('08:00');
    expect(policy).toContain('08:30');
    expect(policy).toMatch(/open pull-requests? limit of 5/i);
    expect(policy).toMatch(/major updates are intentionally excluded/i);
  });
});
