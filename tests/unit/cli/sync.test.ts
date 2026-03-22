import { TEST_IDS } from '../../fixtures/shared/test-constants.js';
/**
 * Unit tests for sync CLI functions.
 *
 * Covers the exported init-helpers (syncJiraFromInit, syncGitFromInit,
 * syncGithubFromInit, syncCsvFromInit, syncDbFromInit) and the internal
 * validation inside the registerSyncCommand action.
 *
 * All adapters, use cases, and workspace utilities are mocked at the
 * module boundary so no real I/O or network calls occur.
 *
 * All process.exit spies use try/finally to guarantee mockRestore is
 * called even when an assertion throws — preventing spy leakage between tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkspaceConfig } from '../../fixtures/shared/test-constants.js';

vi.mock('../../../src/workspace/resolver.js', () => ({
  requireWorkspace: vi.fn(() => '/test/workspace'),
}));

vi.mock('../../../src/workspace/config.js', () => ({
  readConfig: vi.fn(),
  getEnabledSources: vi.fn(() => []),
}));

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

vi.mock('ora', () => ({
  default: vi.fn(function () {
    return {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      text: '',
    };
  }),
}));

vi.mock('chalk', () => {
  const identity = (s: string) => s;
  const tagged = Object.assign(identity, {
    red: identity, green: identity, yellow: identity,
    blue: identity, dim: identity, bold: identity, cyan: identity,
  });
  return { default: tagged };
});

vi.mock('../../../src/adapters/postgres/index.js', () => {
  const closeFn = vi.fn().mockResolvedValue(undefined);
  return {
    PostgresStorage: vi.fn(function (this: Record<string, unknown>) {
      this['close'] = closeFn;
    }),
    _closeFn: closeFn,
  };
});

vi.mock('../../../src/use-cases/pull.js', () => {
  const executeFn = vi.fn().mockResolvedValue([
    { projectKey: TEST_IDS.projectKey, issuesCount: 5, commentsCount: 2, changelogsCount: 1 },
  ]);
  return {
    PullUseCase: vi.fn(function (this: Record<string, unknown>) {
      this['execute'] = executeFn;
    }),
    _executeFn: executeFn,
  };
});

vi.mock('../../../src/use-cases/pull-git.js', () => {
  const executeFn = vi.fn().mockResolvedValue({
    commitsCount: 10, filesCount: 20, issueRefsCount: 3,
  });
  return {
    PullGitUseCase: vi.fn(function (this: Record<string, unknown>) {
      this['execute'] = executeFn;
    }),
    _executeFn: executeFn,
  };
});

vi.mock('../../../src/use-cases/pull-github.js', () => {
  const executeFn = vi.fn().mockResolvedValue({
    prsCount: 7, reviewsCount: 4, releasesCount: 1,
  });
  return {
    PullGitHubUseCase: vi.fn(function (this: Record<string, unknown>) {
      this['execute'] = executeFn;
    }),
    _executeFn: executeFn,
  };
});

vi.mock('../../../src/use-cases/pull-db.js', () => {
  const executeFn = vi.fn().mockResolvedValue({
    tablesCount: 12, columnsCount: 80, foreignKeysCount: 5, indexesCount: 15,
  });
  return {
    PullDbUseCase: vi.fn(function (this: Record<string, unknown>) {
      this['execute'] = executeFn;
    }),
    _executeFn: executeFn,
  };
});

vi.mock('../../../src/adapters/jira/index.js', () => ({
  JiraProvider: vi.fn(function () { return {}; }),
}));

vi.mock('../../../src/adapters/git/index.js', () => ({
  GitProvider: vi.fn(function () { return {}; }),
}));

vi.mock('../../../src/adapters/github/index.js', () => ({
  GitHubProvider: vi.fn(function () { return {}; }),
}));

vi.mock('../../../src/adapters/csv/index.js', () => {
  const getProjectsFn = vi.fn().mockResolvedValue([
    { key: TEST_IDS.projectKey, name: TEST_IDS.projectName, id: TEST_IDS.projectId },
  ]);
  return {
    CsvProvider: vi.fn(function (this: Record<string, unknown>) {
      this['getProjects'] = getProjectsFn;
    }),
    _getProjectsFn: getProjectsFn,
  };
});

vi.mock('../../../src/adapters/db/index.js', () => ({
  DbProvider: vi.fn(function () { return {}; }),
}));

vi.mock('../../../src/cli/init/types.js', () => ({
  maskHost: vi.fn((h: string) => h),
}));

interface PullMod { _executeFn: ReturnType<typeof vi.fn> }
interface StorageMod { _closeFn: ReturnType<typeof vi.fn> }
interface CsvMod { _getProjectsFn: ReturnType<typeof vi.fn> }

async function getCloseFn(): Promise<ReturnType<typeof vi.fn>> {
  return ((await import('../../../src/adapters/postgres/index.js')) as unknown as StorageMod)._closeFn;
}
async function getPullExecuteFn(): Promise<ReturnType<typeof vi.fn>> {
  return ((await import('../../../src/use-cases/pull.js')) as unknown as PullMod)._executeFn;
}
async function getPullGitExecuteFn(): Promise<ReturnType<typeof vi.fn>> {
  return ((await import('../../../src/use-cases/pull-git.js')) as unknown as PullMod)._executeFn;
}
async function getPullGithubExecuteFn(): Promise<ReturnType<typeof vi.fn>> {
  return ((await import('../../../src/use-cases/pull-github.js')) as unknown as PullMod)._executeFn;
}
async function getPullDbExecuteFn(): Promise<ReturnType<typeof vi.fn>> {
  return ((await import('../../../src/use-cases/pull-db.js')) as unknown as PullMod)._executeFn;
}
async function getCsvGetProjectsFn(): Promise<ReturnType<typeof vi.fn>> {
  return ((await import('../../../src/adapters/csv/index.js')) as unknown as CsvMod)._getProjectsFn;
}

import {
  syncJiraFromInit,
  syncGitFromInit,
  syncGithubFromInit,
  syncCsvFromInit,
  syncDbFromInit,
  registerSyncCommand,
} from '../../../src/cli/sync.js';
import { requireWorkspace } from '../../../src/workspace/resolver.js';
import { readConfig, getEnabledSources } from '../../../src/workspace/config.js';
import type { Command } from 'commander';

const mockRequireWorkspace = vi.mocked(requireWorkspace);
const mockReadConfig = vi.mocked(readConfig);
const mockGetEnabledSources = vi.mocked(getEnabledSources);

function setEnv(vars: Record<string, string>): void {
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
}

function clearEnv(...keys: string[]): void {
  for (const key of keys) {
    Reflect.deleteProperty(process.env, key);
  }
}

/** Run a test that expects process.exit(1) to be called, always restoring the spy. */
async function withExitSpy(fn: (spy: ReturnType<typeof vi.spyOn>) => Promise<void>): Promise<void> {
  const spy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  try {
    await fn(spy);
  } finally {
    spy.mockRestore();
  }
}

type AsyncAction = (type: string | undefined, options: Record<string, unknown>) => Promise<void>;

function captureRegisterSyncAction(): AsyncAction {
  let captured: AsyncAction | undefined;

  const fakeCmd = {
    description: () => fakeCmd,
    option: () => fakeCmd,
    action(fn: AsyncAction) {
      captured = fn;
      return fakeCmd;
    },
  };

  const fakeProgram = {
    command: () => fakeCmd,
  };

  registerSyncCommand(fakeProgram as unknown as Command);

  if (!captured) {throw new Error('No action was registered');}
  return captured;
}

beforeEach(async () => {
  vi.clearAllMocks();

  mockRequireWorkspace.mockReturnValue('/test/workspace');
  mockReadConfig.mockReturnValue(null);
  mockGetEnabledSources.mockReturnValue([]);

  const closeFn = await getCloseFn();
  const pullExecuteFn = await getPullExecuteFn();
  const pullGitExecuteFn = await getPullGitExecuteFn();
  const pullGithubExecuteFn = await getPullGithubExecuteFn();
  const pullDbExecuteFn = await getPullDbExecuteFn();
  const csvGetProjectsFn = await getCsvGetProjectsFn();

  closeFn.mockResolvedValue(undefined);
  pullExecuteFn.mockResolvedValue([
    { projectKey: TEST_IDS.projectKey, issuesCount: 5, commentsCount: 2, changelogsCount: 1 },
  ]);
  pullGitExecuteFn.mockResolvedValue({ commitsCount: 10, filesCount: 20, issueRefsCount: 3 });
  pullGithubExecuteFn.mockResolvedValue({ prsCount: 7, reviewsCount: 4, releasesCount: 1 });
  pullDbExecuteFn.mockResolvedValue({
    tablesCount: 12, columnsCount: 80, foreignKeysCount: 5, indexesCount: 15,
  });
  csvGetProjectsFn.mockResolvedValue([{ key: TEST_IDS.projectKey, name: TEST_IDS.projectName, id: TEST_IDS.projectId }]);

  clearEnv(
    'JIRA_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECTS',
    'GIT_REPO_PATHS', 'GIT_REPO_PATH',
    'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO',
    'CSV_FILE_PATH',
    'TARGET_DB_HOST', 'TARGET_DB_USER', 'TARGET_DB_NAME',
    'TARGET_DB_ENGINE', 'TARGET_DB_PORT', 'TARGET_DB_PASSWORD',
  );
});

// ─── syncJiraFromInit ────────────────────────────────────────────────────────

describe('syncJiraFromInit', () => {
  it('calls process.exit(1) when Jira credentials are missing', async () => {
    await withExitSpy(async (spy) => {
      await expect(syncJiraFromInit('/test/workspace')).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('calls process.exit(1) when JIRA_URL is missing', async () => {
    setEnv({ JIRA_EMAIL: 'dev@example.com', JIRA_API_TOKEN: 'token' });

    await withExitSpy(async (spy) => {
      await expect(syncJiraFromInit('/test/workspace')).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('returns early when no projects are configured and no project option given', async () => {
    setEnv({
      JIRA_URL: 'https://test.atlassian.net',
      JIRA_EMAIL: 'dev@test.com',
      JIRA_API_TOKEN: 'token123',
    });
    const closeFn = await getCloseFn();

    await expect(syncJiraFromInit('/test/workspace')).resolves.toBeUndefined();
    expect(closeFn).toHaveBeenCalled();
  });

  it('executes PullUseCase when credentials and project are present', async () => {
    setEnv({
      JIRA_URL: 'https://test.atlassian.net',
      JIRA_EMAIL: 'dev@test.com',
      JIRA_API_TOKEN: 'token123',
      JIRA_PROJECTS: 'TEST',
    });
    const pullExecuteFn = await getPullExecuteFn();
    const closeFn = await getCloseFn();

    await syncJiraFromInit('/test/workspace');

    expect(pullExecuteFn).toHaveBeenCalledOnce();
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('calls storage.close in the finally block even when execute throws', async () => {
    setEnv({
      JIRA_URL: 'https://test.atlassian.net',
      JIRA_EMAIL: 'dev@test.com',
      JIRA_API_TOKEN: 'token123',
      JIRA_PROJECTS: 'TEST',
    });
    const pullExecuteFn = await getPullExecuteFn();
    const closeFn = await getCloseFn();
    pullExecuteFn.mockRejectedValue(new Error('Jira API error'));

    await expect(syncJiraFromInit('/test/workspace')).rejects.toThrow('Jira API error');
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('syncs multiple projects when JIRA_PROJECTS is comma-separated', async () => {
    setEnv({
      JIRA_URL: 'https://test.atlassian.net',
      JIRA_EMAIL: 'dev@test.com',
      JIRA_API_TOKEN: 'token123',
      JIRA_PROJECTS: 'TEST,OTHER',
    });
    const pullExecuteFn = await getPullExecuteFn();

    await syncJiraFromInit('/test/workspace');

    expect(pullExecuteFn).toHaveBeenCalledTimes(2);
  });
});

// ─── syncGitFromInit ─────────────────────────────────────────────────────────

describe('syncGitFromInit', () => {
  it('calls process.exit(1) when GIT_REPO_PATHS is not set', async () => {
    await withExitSpy(async (spy) => {
      await expect(syncGitFromInit('/test/workspace')).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('falls back to GIT_REPO_PATH when GIT_REPO_PATHS is not set', async () => {
    setEnv({ GIT_REPO_PATH: '/single/repo' });
    const pullGitExecuteFn = await getPullGitExecuteFn();
    const closeFn = await getCloseFn();

    await syncGitFromInit('/test/workspace');

    expect(pullGitExecuteFn).toHaveBeenCalledOnce();
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('syncs all repo paths from comma-separated GIT_REPO_PATHS', async () => {
    setEnv({ GIT_REPO_PATHS: '/repos/a,/repos/b,/repos/c' });
    const pullGitExecuteFn = await getPullGitExecuteFn();

    await syncGitFromInit('/test/workspace');

    expect(pullGitExecuteFn).toHaveBeenCalledTimes(3);
  });

  it('calls storage.close in finally even when a repo sync throws', async () => {
    setEnv({ GIT_REPO_PATHS: '/repos/a' });
    const pullGitExecuteFn = await getPullGitExecuteFn();
    const closeFn = await getCloseFn();
    pullGitExecuteFn.mockRejectedValue(new Error('not a git repo'));

    await syncGitFromInit('/test/workspace');

    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('continues with remaining repos when one fails', async () => {
    setEnv({ GIT_REPO_PATHS: '/repos/a,/repos/b' });
    const pullGitExecuteFn = await getPullGitExecuteFn();
    pullGitExecuteFn
      .mockRejectedValueOnce(new Error('not a git repo'))
      .mockResolvedValueOnce({ commitsCount: 5, filesCount: 10, issueRefsCount: 1 });

    await syncGitFromInit('/test/workspace');

    expect(pullGitExecuteFn).toHaveBeenCalledTimes(2);
  });
});

// ─── syncGithubFromInit ──────────────────────────────────────────────────────

describe('syncGithubFromInit', () => {
  it('calls process.exit(1) when GitHub credentials are missing', async () => {
    await withExitSpy(async (spy) => {
      await expect(syncGithubFromInit('/test/workspace')).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('calls process.exit(1) when GITHUB_OWNER is missing', async () => {
    setEnv({ GITHUB_TOKEN: 'ghp_token', GITHUB_REPO: 'my-repo' });

    await withExitSpy(async (spy) => {
      await expect(syncGithubFromInit('/test/workspace')).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('executes PullGitHubUseCase when all credentials are present', async () => {
    setEnv({
      GITHUB_TOKEN: 'ghp_testtoken',
      GITHUB_OWNER: 'test-org',
      GITHUB_REPO: 'test-repo',
    });
    const pullGithubExecuteFn = await getPullGithubExecuteFn();
    const closeFn = await getCloseFn();

    await syncGithubFromInit('/test/workspace');

    expect(pullGithubExecuteFn).toHaveBeenCalledOnce();
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('calls storage.close in finally even when execute throws', async () => {
    setEnv({
      GITHUB_TOKEN: 'ghp_testtoken',
      GITHUB_OWNER: 'test-org',
      GITHUB_REPO: 'test-repo',
    });
    const pullGithubExecuteFn = await getPullGithubExecuteFn();
    const closeFn = await getCloseFn();
    pullGithubExecuteFn.mockRejectedValue(new Error('API rate limit'));

    await expect(syncGithubFromInit('/test/workspace')).rejects.toThrow('API rate limit');
    expect(closeFn).toHaveBeenCalledOnce();
  });
});

// ─── syncCsvFromInit ──────────────────────────────────────────────────────────

describe('syncCsvFromInit', () => {
  it('calls process.exit(1) when no CSV file path is given', async () => {
    await withExitSpy(async (spy) => {
      await expect(syncCsvFromInit('/test/workspace')).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('uses CSV_FILE_PATH from environment when no filePath argument provided', async () => {
    setEnv({ CSV_FILE_PATH: '/exports/jira.csv' });
    const pullExecuteFn = await getPullExecuteFn();
    const closeFn = await getCloseFn();

    await syncCsvFromInit('/test/workspace');

    expect(pullExecuteFn).toHaveBeenCalledOnce();
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('uses explicit filePath argument over CSV_FILE_PATH env var', async () => {
    setEnv({ CSV_FILE_PATH: '/exports/old.csv' });
    const { CsvProvider } = await import('../../../src/adapters/csv/index.js');

    await syncCsvFromInit('/test/workspace', '/exports/new.csv');

    const constructorCall = vi.mocked(CsvProvider).mock.calls[0];
    expect(constructorCall?.[0]).toBe('/exports/new.csv');
  });

  it('calls storage.close in finally even when execute throws', async () => {
    setEnv({ CSV_FILE_PATH: '/exports/jira.csv' });
    const pullExecuteFn = await getPullExecuteFn();
    const closeFn = await getCloseFn();
    pullExecuteFn.mockRejectedValue(new Error('CSV parse error'));

    await expect(syncCsvFromInit('/test/workspace')).rejects.toThrow('CSV parse error');
    expect(closeFn).toHaveBeenCalledOnce();
  });
});

// ─── syncDbFromInit ───────────────────────────────────────────────────────────

describe('syncDbFromInit', () => {
  it('calls process.exit(1) when DB credentials are missing', async () => {
    await withExitSpy(async (spy) => {
      await expect(syncDbFromInit('/test/workspace')).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('calls process.exit(1) when only TARGET_DB_HOST is missing', async () => {
    setEnv({ TARGET_DB_USER: 'readonly', TARGET_DB_NAME: 'myapp' });

    await withExitSpy(async (spy) => {
      await expect(syncDbFromInit('/test/workspace')).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('executes PullDbUseCase when all DB credentials are present', async () => {
    setEnv({
      TARGET_DB_HOST: 'prod-db.example.com',
      TARGET_DB_USER: 'readonly',
      TARGET_DB_NAME: 'myapp',
    });
    const pullDbExecuteFn = await getPullDbExecuteFn();
    const closeFn = await getCloseFn();

    await syncDbFromInit('/test/workspace');

    expect(pullDbExecuteFn).toHaveBeenCalledOnce();
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('defaults to postgresql engine when TARGET_DB_ENGINE is not set', async () => {
    setEnv({
      TARGET_DB_HOST: 'prod-db.example.com',
      TARGET_DB_USER: 'readonly',
      TARGET_DB_NAME: 'myapp',
    });
    const { DbProvider } = await import('../../../src/adapters/db/index.js');

    await syncDbFromInit('/test/workspace');

    const constructorCall = vi.mocked(DbProvider).mock.calls[0];
    expect(constructorCall?.[0]).toMatchObject({ engine: 'postgresql' });
  });

  it('calls storage.close in finally even when execute throws', async () => {
    setEnv({
      TARGET_DB_HOST: 'prod-db.example.com',
      TARGET_DB_USER: 'readonly',
      TARGET_DB_NAME: 'myapp',
    });
    const pullDbExecuteFn = await getPullDbExecuteFn();
    const closeFn = await getCloseFn();
    pullDbExecuteFn.mockRejectedValue(new Error('DB connection timeout'));

    await expect(syncDbFromInit('/test/workspace')).rejects.toThrow('DB connection timeout');
    expect(closeFn).toHaveBeenCalledOnce();
  });
});

// ─── registerSyncCommand action ───────────────────────────────────────────────

describe('registerSyncCommand action', () => {
  it('calls process.exit(1) when readConfig returns null', async () => {
    mockReadConfig.mockReturnValue(null);

    await withExitSpy(async (spy) => {
      const action = captureRegisterSyncAction();
      await expect(action(undefined, {})).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('calls process.exit(1) when an unknown source type is specified', async () => {
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);

    await withExitSpy(async (spy) => {
      const action = captureRegisterSyncAction();
      await expect(action('bogussource', {})).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('calls process.exit(1) when specified source is not enabled', async () => {
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);

    await withExitSpy(async (spy) => {
      const action = captureRegisterSyncAction();
      await expect(action('jira', {})).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('calls process.exit(1) when no type is given and no sources are enabled', async () => {
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);
    mockGetEnabledSources.mockReturnValue([]);

    await withExitSpy(async (spy) => {
      const action = captureRegisterSyncAction();
      await expect(action(undefined, {})).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('calls process.exit(1) when requireWorkspace throws', async () => {
    mockRequireWorkspace.mockImplementation(() => {
      throw new Error('Not inside an Argustack workspace');
    });

    await withExitSpy(async (spy) => {
      const action = captureRegisterSyncAction();
      await expect(action(undefined, {})).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('syncs jira when type is "jira" and source is enabled', async () => {
    const config = createWorkspaceConfig({
      sources: { jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['jira'],
    });
    mockReadConfig.mockReturnValue(config);
    setEnv({
      JIRA_URL: 'https://test.atlassian.net',
      JIRA_EMAIL: 'dev@test.com',
      JIRA_API_TOKEN: 'token123',
      JIRA_PROJECTS: 'TEST',
    });
    const pullExecuteFn = await getPullExecuteFn();

    const action = captureRegisterSyncAction();
    await action('jira', {});

    expect(pullExecuteFn).toHaveBeenCalledOnce();
  });

  it('accepts source type case-insensitively', async () => {
    const config = createWorkspaceConfig({
      sources: { jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['jira'],
    });
    mockReadConfig.mockReturnValue(config);
    setEnv({
      JIRA_URL: 'https://test.atlassian.net',
      JIRA_EMAIL: 'dev@test.com',
      JIRA_API_TOKEN: 'token123',
      JIRA_PROJECTS: 'TEST',
    });
    const pullExecuteFn = await getPullExecuteFn();

    const action = captureRegisterSyncAction();
    await action('JIRA', {});

    expect(pullExecuteFn).toHaveBeenCalledOnce();
  });

  it('syncs all enabled sources when no type is specified', async () => {
    const config = createWorkspaceConfig({
      sources: {
        jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' },
        git: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' },
      },
      order: ['jira', 'git'],
    });
    mockReadConfig.mockReturnValue(config);
    mockGetEnabledSources.mockReturnValue(['jira', 'git']);
    setEnv({
      JIRA_URL: 'https://test.atlassian.net',
      JIRA_EMAIL: 'dev@test.com',
      JIRA_API_TOKEN: 'token123',
      JIRA_PROJECTS: 'TEST',
      GIT_REPO_PATHS: '/repos/project',
    });
    const pullExecuteFn = await getPullExecuteFn();
    const pullGitExecuteFn = await getPullGitExecuteFn();

    const action = captureRegisterSyncAction();
    await action(undefined, {});

    expect(pullExecuteFn).toHaveBeenCalledOnce();
    expect(pullGitExecuteFn).toHaveBeenCalledOnce();
  });
});
