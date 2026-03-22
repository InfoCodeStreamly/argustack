/**
 * Unit tests for setupGitFromFlags and setupGitInteractive.
 *
 * The node:fs, node:child_process, @inquirer/prompts, ora, chalk, and octokit
 * modules are all mocked at the module boundary. Interactive paths are exercised
 * by controlling the sequence of prompt return values.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GITHUB_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

const mockInputFn = vi.fn();
const mockPasswordFn = vi.fn();
const mockConfirmFn = vi.fn();
const mockCheckboxFn = vi.fn();
const mockSelectFn = vi.fn();

vi.mock('@inquirer/prompts', () => ({
  input: mockInputFn,
  password: mockPasswordFn,
  confirm: mockConfirmFn,
  checkbox: mockCheckboxFn,
  select: mockSelectFn,
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
}));

const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  text: '',
};

vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

const mockListForAuthenticatedUser = vi.fn();
const mockOctokit = vi.fn(function (this: Record<string, unknown>) {
  this.rest = {
    repos: { listForAuthenticatedUser: mockListForAuthenticatedUser },
  };
});

vi.mock('octokit', () => ({
  Octokit: mockOctokit,
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let setupGitFromFlags: typeof import('../../../../src/cli/init/setup-git.js').setupGitFromFlags;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let setupGitInteractive: typeof import('../../../../src/cli/init/setup-git.js').setupGitInteractive;

beforeEach(async () => {
  vi.clearAllMocks();
  const module = await import('../../../../src/cli/init/setup-git.js');
  setupGitFromFlags = module.setupGitFromFlags;
  setupGitInteractive = module.setupGitInteractive;
});

// ─── setupGitFromFlags ─────────────────────────────────────────────────────

describe('setupGitFromFlags', () => {
  it('throws when gitRepo flag is missing', () => {
    expect(() => setupGitFromFlags({})).toThrow('Git requires: --git-repo');
  });

  it('returns gitRepoPaths from a single path', () => {
    const result = setupGitFromFlags({ gitRepo: '/home/user/project' });
    expect(result?.gitRepoPaths).toEqual(['/home/user/project']);
  });

  it('splits multiple comma-separated paths', () => {
    const result = setupGitFromFlags({ gitRepo: '/repo/one, /repo/two, /repo/three' });
    expect(result?.gitRepoPaths).toEqual(['/repo/one', '/repo/two', '/repo/three']);
  });

  it('filters out empty segments from path list', () => {
    const result = setupGitFromFlags({ gitRepo: '/repo/one,,/repo/two' });
    expect(result?.gitRepoPaths).toEqual(['/repo/one', '/repo/two']);
  });

  it('trims whitespace from individual paths', () => {
    const result = setupGitFromFlags({ gitRepo: '  /repo/a , /repo/b  ' });
    expect(result?.gitRepoPaths).toEqual(['/repo/a', '/repo/b']);
  });

  it('does not include githubToken in result when not provided', () => {
    const result = setupGitFromFlags({ gitRepo: '/repo' });
    expect(result).not.toHaveProperty('githubToken');
  });
});

// ─── setupGitInteractive ───────────────────────────────────────────────────

describe('setupGitInteractive', () => {
  it('returns null when user skips after the git clone flow adds no paths', async () => {
    mockListForAuthenticatedUser.mockResolvedValue({ data: [] });

    mockSelectFn.mockResolvedValueOnce('github');
    mockPasswordFn.mockResolvedValueOnce('ghp_no_repos');
    mockConfirmFn.mockResolvedValueOnce(true);

    const result = await setupGitInteractive();
    expect(result).toBeNull();
  });

  it('returns GitSetupResult for a valid local path', async () => {
    const { existsSync } = await import('node:fs');
    vi.mocked(existsSync).mockImplementation((p: unknown) =>
      typeof p === 'string' && p.endsWith('.git'),
    );

    mockSelectFn.mockResolvedValueOnce('local');
    mockInputFn.mockResolvedValueOnce('/home/user/myproject');
    mockConfirmFn.mockResolvedValueOnce(false);

    const result = await setupGitInteractive();

    expect(result).not.toBeNull();
    expect(result?.gitRepoPaths.length).toBeGreaterThan(0);
  });

  it('includes githubToken in result when GitHub clone flow is used', async () => {
    mockListForAuthenticatedUser.mockResolvedValue({
      data: [
        {
          full_name: GITHUB_TEST_IDS.repoFullName,
          clone_url: 'https://github.com/org/repo.git',
          private: false,
          description: null,
        },
      ],
    });

    const proc = {
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (code: number) => void) => {
        if (event === 'close') {cb(0);}
      }),
    };
    mockSpawn.mockReturnValue(proc);

    mockSelectFn.mockResolvedValueOnce('github');
    mockPasswordFn.mockResolvedValueOnce('ghp_test_token');
    mockCheckboxFn.mockResolvedValue([{ cloneUrl: 'https://github.com/org/repo.git', fullName: GITHUB_TEST_IDS.repoFullName }]);
    mockInputFn.mockResolvedValueOnce('/home/user/repo');

    const result = await setupGitInteractive();

    expect(result?.githubToken).toBe('ghp_test_token');
  });

  it('returns null when GitHub token fetch fails and user skips', async () => {
    mockListForAuthenticatedUser.mockRejectedValue(new Error('Bad credentials'));

    mockSelectFn.mockResolvedValueOnce('github');
    mockPasswordFn.mockResolvedValueOnce('bad-token');
    mockConfirmFn.mockResolvedValueOnce(true);

    const result = await setupGitInteractive();
    expect(result).toBeNull();
  });

  it('returns null when no repos are selected during GitHub clone', async () => {
    mockListForAuthenticatedUser.mockResolvedValue({
      data: [
        {
          full_name: GITHUB_TEST_IDS.repoFullName,
          clone_url: 'https://github.com/org/repo.git',
          private: false,
          description: null,
        },
      ],
    });

    mockSelectFn.mockResolvedValueOnce('github');
    mockPasswordFn.mockResolvedValueOnce('ghp_test_token');
    mockCheckboxFn.mockResolvedValue([]);
    mockConfirmFn.mockResolvedValueOnce(true);

    const result = await setupGitInteractive();
    expect(result).toBeNull();
  });
});
