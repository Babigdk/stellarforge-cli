import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

function usesPullRequestTarget(workflowSource: string): boolean {
  // Matches the trigger as a mapping key or list entry (`pull_request_target:`
  // or `- pull_request_target`), not an incidental mention elsewhere.
  return /(^|\n)\s*(-\s*)?pull_request_target\s*:?/.test(workflowSource);
}

// SW-106: static regression check preventing `pull_request_target` from
// entering repository workflows, since it runs with base-branch secrets
// against untrusted fork content.
describe('pull_request_target prohibition', () => {
  it('finds no pull_request_target trigger in any current workflow', () => {
    const files = readdirSync(workflowsDir).filter(
      (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
    );
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(join(workflowsDir, file), 'utf8');
      expect(usesPullRequestTarget(source)).toBe(false);
    }
  });

  it('flags a fixture workflow that declares pull_request_target', () => {
    const fixture = [
      'name: Fixture',
      'on:',
      '  pull_request_target:',
      '    types: [opened]',
      'jobs: {}',
      '',
    ].join('\n');

    expect(usesPullRequestTarget(fixture)).toBe(true);
  });
});
