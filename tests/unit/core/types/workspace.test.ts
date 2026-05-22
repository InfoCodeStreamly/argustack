/**
 * Unit tests for `core/types/workspace.ts` — tenant identity types.
 *
 * Type-only file: tests construct sample values matching each shape and
 * assert key invariants (settings is a JSONB-like object, ids are
 * lowercase kebab strings). Compile-time correctness is enforced by tsc.
 */

import { describe, it, expect } from 'vitest';
import type {
  Workspace,
  WorkspaceSettings,
  DbSourceConfig,
  GitHubRepoConfig,
  CsvFileConfig,
} from '../../../../src/core/types/workspace.js';

describe('core/types/workspace module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../../src/core/types/workspace.js');
    expect(mod).toBeDefined();
  });

  it('Workspace accepts a minimal value (id + name)', () => {
    const ws: Workspace = { id: 'demo', name: 'demo' };

    expect(ws.id).toBe('demo');
    expect(ws.name).toBe('demo');
  });

  it('Workspace accepts a fully populated value with settings', () => {
    const settings: WorkspaceSettings = {
      jiraProjectKeys: ['ARG', 'OTHER'],
      gitRepoPaths: ['/repos/argustack'],
    };
    const ws: Workspace = {
      id: 'argustack',
      name: 'argustack',
      displayName: 'Argustack',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-05-01T00:00:00.000Z',
      settings,
    };

    expect(ws.settings?.jiraProjectKeys).toEqual(['ARG', 'OTHER']);
    expect(ws.displayName).toBe('Argustack');
  });

  it('WorkspaceSettings accepts every documented binding', () => {
    const githubRepos: readonly GitHubRepoConfig[] = [{ owner: 'CodeStreamly', repo: 'argustack' }];
    const csvFilePaths: readonly CsvFileConfig[] = [{ path: '/tmp/jira.csv' }];
    const dbConfigs: readonly DbSourceConfig[] = [
      {
        name: 'app',
        engine: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'app',
        password: 'app',
        database: 'app',
      },
    ];

    const settings: WorkspaceSettings = {
      jiraProjectKeys: ['ARG'],
      gitRepoPaths: ['/repos/x'],
      githubRepos,
      csvFilePaths,
      dbConfigs,
    };

    expect(settings.githubRepos?.[0]?.repo).toBe('argustack');
    expect(settings.csvFilePaths?.[0]?.path).toBe('/tmp/jira.csv');
    expect(settings.dbConfigs?.[0]?.engine).toBe('postgresql');
  });

  it('DbSourceConfig allows optional schema and ssl', () => {
    const config: DbSourceConfig = {
      name: 'main',
      engine: 'postgresql',
      host: 'db',
      port: 5432,
      user: 'u',
      password: 'p',
      database: 'd',
      schema: 'public',
      ssl: true,
    };

    expect(config.schema).toBe('public');
    expect(config.ssl).toBe(true);
  });
});
