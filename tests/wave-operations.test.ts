import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (...path: string[]) => readFileSync(join(root, ...path), 'utf8');

describe('Drips Wave operations policy', () => {
  const contributing = read('CONTRIBUTING.md');
  const claimWorkflow = read('.github', 'workflows', 'wave-claim.yml');
  const staleWorkflow = read('.github', 'workflows', 'wave-stale-prs.yml');
  const readinessWorkflow = read(
    '.github',
    'workflows',
    'wave-pr-readiness.yml',
  );
  const runbook = read('docs', 'contributing', 'drips-wave-operations.md');

  it('requires official Drips application and assignment', () => {
    expect(contributing).toContain(
      'managed through the Drips Wave application',
    );
    expect(contributing).toContain(
      'Wait until a maintainer accepts the application',
    );
    expect(contributing).toContain('one active StellarForge issue at a time');
    expect(contributing).toContain('Closes #123');
  });

  it('does not allow GitHub claim comments to mutate assignments', () => {
    expect(claimWorkflow).toContain(
      'assigned through the Drips application process',
    );
    expect(claimWorkflow).not.toContain('addAssignees');
    expect(claimWorkflow).not.toContain('removeAssignees');
    expect(claimWorkflow).not.toContain("labels: ['Stellar Wave']");
  });

  it('uses Wave-length reminders without automatic closure', () => {
    expect(staleWorkflow).toContain('const WARN_AFTER = 2 * DAY');
    expect(staleWorkflow).toContain('const ESCALATE_AFTER = 4 * DAY');
    expect(staleWorkflow).toContain('lastContributorActivity');
    expect(staleWorkflow).toContain('listReviewComments');
    expect(staleWorkflow).toContain(
      "commit.author?.login !== pr.user.login",
    );
    expect(staleWorkflow).not.toContain('github.rest.pulls.update');
    expect(staleWorkflow).not.toContain("state: 'closed'");
  });

  it('labels only current green assigned Wave PRs for human review', () => {
    for (const name of [
      'CI',
      'CodeQL',
      'Dependency Review',
      'E2E Smoke',
      'Contributor PR Guard',
    ]) {
      expect(readinessWorkflow).toContain(name);
    }
    expect(readinessWorkflow).toContain("const labelName = 'review: ready'");
    expect(readinessWorkflow).toContain("label.name === 'Stellar Wave'");
    expect(readinessWorkflow).toContain('issue.assignees.some');
    expect(readinessWorkflow).toContain(
      'pull.head.sha === run.head_sha',
    );
    expect(readinessWorkflow).not.toContain('pulls.merge');
    expect(readinessWorkflow).not.toContain('enablePullRequestAutoMerge');
  });

  it('documents the approved budget without activating issues', () => {
    expect(runbook).toContain('25,000 points');
    expect(runbook).toContain('17,350');
    expect(runbook).toContain(
      'No repository workflow may bulk-add the `Stellar Wave` label',
    );
  });
});
