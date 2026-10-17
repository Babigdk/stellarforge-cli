import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

function releaseJobBlock(workflow: string, name: string): string {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) throw new Error(`Release workflow job not found: ${name}`);

  const nextJob = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-z][\w-]*:$/.test(line),
  );
  return lines.slice(start, nextJob === -1 ? undefined : nextJob).join('\n');
}

function releaseJobPermissions(job: string): Record<string, string> {
  const lines = job.split('\n');
  const start = lines.findIndex((line) => line.startsWith('    permissions:'));
  if (start === -1) throw new Error('Release workflow job has no permissions');
  if (lines[start]?.trim() === 'permissions: {}') return {};

  const permissions: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    const entry = /^ {6}([\w-]+):\s*(\S+)\s*$/.exec(line);
    if (!entry) break;
    permissions[entry[1]!] = entry[2]!;
  }
  return permissions;
}

describe('release automation policy', () => {
  const workflow = readFileSync(
    join(root, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  const packageJson = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  ) as {
    private?: boolean;
    publishConfig?: { access?: string };
    files?: string[];
    scripts?: Record<string, string>;
  };

  it('keeps the package publishable and explicitly public', () => {
    expect(packageJson.private).toBe(false);
    expect(packageJson.publishConfig?.access).toBe('public');
    expect(packageJson.files).toContain('dist');
    expect(packageJson.files).toContain('templates');
    expect(packageJson.scripts?.['release:dry-run']).toContain(
      'npm pack --dry-run',
    );
  });

  it('pins release actions and separates OIDC from versioning', () => {
    expect(workflow).toContain(
      'changesets/action/select-mode@ae32849d5ba541f9ae29e40e22a623bc13562f51',
    );
    expect(workflow).toContain(
      'changesets/action/version@ae32849d5ba541f9ae29e40e22a623bc13562f51',
    );
    expect(workflow).toContain(
      'changesets/action/pack@ae32849d5ba541f9ae29e40e22a623bc13562f51',
    );
    expect(workflow).toContain(
      'changesets/action/publish@ae32849d5ba541f9ae29e40e22a623bc13562f51',
    );
    expect(workflow).toContain('environment: npm-release');
  });

  it('limits each job to its intended permissions and publish-only OIDC', () => {
    const jobs = [
      'select-mode',
      'version',
      'pack',
      'publish',
      'publish-disabled',
      'readiness',
    ];
    const permissions = Object.fromEntries(
      jobs.map((name) => [
        name,
        releaseJobPermissions(releaseJobBlock(workflow, name)),
      ]),
    );

    expect(permissions).toEqual({
      'select-mode': { contents: 'read' },
      version: { contents: 'write', 'pull-requests': 'write' },
      pack: { contents: 'read' },
      publish: { contents: 'write', 'id-token': 'write' },
      'publish-disabled': {},
      readiness: { contents: 'read' },
    });
    expect(
      jobs.filter((name) => permissions[name]?.['id-token'] === 'write'),
    ).toEqual(['publish']);
    expect(releaseJobBlock(workflow, 'publish')).toContain(
      '    environment: npm-release',
    );
  });

  it('requires an explicit publication kill switch and contains no npm token secret', () => {
    expect(workflow).toContain("vars.NPM_PUBLISH_ENABLED == 'true'");
    expect(workflow).not.toContain('NPM_TOKEN');
    expect(workflow).not.toContain('NODE_AUTH_TOKEN');
    expect(workflow).toContain('npm@11.5.1');
  });

  it('provides a non-publishing readiness path', () => {
    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).toContain('npm run release:dry-run');
    expect(workflow).toContain('npm run changeset:status');
  });
});
