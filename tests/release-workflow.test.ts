import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

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
    expect(workflow.match(/id-token: write/g)).toHaveLength(1);
    expect(workflow).toContain('environment: npm-release');
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
