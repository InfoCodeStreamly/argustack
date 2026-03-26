/**
 * Unit tests for setupGithubFromFlags and setupGithubInteractive.
 *
 * All external dependencies (octokit, @inquirer/prompts, ora, chalk) are
 * mocked at the module boundary. Interactive paths are exercised by
 * controlling prompt return values and Octokit mock responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GITHUB_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

const mockPasswordFn = vi.fn();
const mockConfirmFn = vi.fn();
const mockSelectFn = vi.fn();

vi.mock('@inquirer/prompts', () => ({
  password: mockPasswordFn,
  confirm: mockConfirmFn,
  select: mockSelectFn,
}));

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
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
let setupGithubFromFlags: typeof import('../../../../src/cli/init/setup-github.js').setupGithubFromFlags;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let setupGithubInteractive: typeof import('../../../../src/cli/init/setup-github.js').setupGithubInteractive;

beforeEach(async () => {
  vi.clearAllMocks();
  const module = await import('../../../../src/cli/init/setup-github.js');
  setupGithubFromFlags = module.setupGithubFromFlags;
  setupGithubInteractive = module.setupGithubInteractive;
});

// ─── setupGithubFromFlags ──────────────────────────────────────────────────

describe('setupGithubFromFlags', () => {
  it('throws when githubToken is missing', () => {
    expect(() => setupGithubFromFlags({ githubOwner: 'org', githubRepo: 'repo' }))
      .toThrow('GitHub requires: --github-token, --github-owner, --github-repo');
  });

  it('throws when githubOwner is missing', () => {
    expect(() => setupGithubFromFlags({ githubToken: 'tok', githubRepo: 'repo' }))
      .toThrow('GitHub requires: --github-token, --github-owner, --github-repo');
  });

  it('throws when githubRepo is missing', () => {
    expect(() => setupGithubFromFlags({ githubToken: 'tok', githubOwner: 'org' }))
      .toThrow('GitHub requires: --github-token, --github-owner, --github-repo');
  });

  it('returns GitHubSetupResult with token, owner, and repo', () => {
    const result = setupGithubFromFlags({
      githubToken: 'ghp_testtoken123',
      githubOwner: 'my-org',
      githubRepo: 'my-repo',
    });

    expect(result).toEqual({
      githubToken: 'ghp_testtoken123',
      githubOwner: 'my-org',
      githubRepo: 'my-repo',
    });
  });

  it('preserves token value unchanged', () => {
    const token = 'ghp_ABCDEF1234567890abcdef';
    const result = setupGithubFromFlags({ githubToken: token, githubOwner: 'org', githubRepo: 'repo' });
    expect(result?.githubToken).toBe(token);
  });
});

// ─── setupGithubInteractive ────────────────────────────────────────────────

describe('setupGithubInteractive', () => {
  it('auto-configures from existing token and single repo', async () => {
    const result = await setupGithubInteractive('ghp_existing', [GITHUB_TEST_IDS.repoFullName]);

    expect(result).not.toBeNull();
    expect(result?.githubToken).toBe('ghp_existing');
    const [expectedOwner, expectedRepo] = GITHUB_TEST_IDS.repoFullName.split('/');
    expect(result?.githubOwner).toBe(expectedOwner);
    expect(result?.githubRepo).toBe(expectedRepo);
  });

  it('uses first repo when multiple repos are passed', async () => {
    const result = await setupGithubInteractive('ghp_token', [GITHUB_TEST_IDS.repoFullName, `${GITHUB_TEST_IDS.repoFullName}-2`]);

    const [expectedOwner, expectedRepo] = GITHUB_TEST_IDS.repoFullName.split('/');
    expect(result?.githubOwner).toBe(expectedOwner);
    expect(result?.githubRepo).toBe(expectedRepo);
  });

  it('skips password prompt when existingToken is provided without repos', async () => {
    mockListForAuthenticatedUser.mockResolvedValue({
      data: [{ full_name: GITHUB_TEST_IDS.repoFullName, private: false, description: null }],
    });
    mockSelectFn.mockResolvedValue(GITHUB_TEST_IDS.repoFullName);

    await setupGithubInteractive('ghp_reused_token');

    expect(mockPasswordFn).not.toHaveBeenCalled();
  });

  it('prompts for token when no existing token is provided', async () => {
    mockPasswordFn.mockResolvedValueOnce('ghp_new_token');
    mockListForAuthenticatedUser.mockResolvedValue({
      data: [{ full_name: GITHUB_TEST_IDS.repoFullName, private: false, description: null }],
    });
    mockSelectFn.mockResolvedValue(GITHUB_TEST_IDS.repoFullName);

    await setupGithubInteractive();

    expect(mockPasswordFn).toHaveBeenCalledOnce();
  });

  it('returns owner and repo split from selected full_name', async () => {
    mockPasswordFn.mockResolvedValueOnce('ghp_tok');
    mockListForAuthenticatedUser.mockResolvedValue({
      data: [{ full_name: GITHUB_TEST_IDS.repoFullName, private: true, description: 'Backend API' }],
    });
    mockSelectFn.mockResolvedValue(GITHUB_TEST_IDS.repoFullName);

    const result = await setupGithubInteractive();

    const [expectedOwner, expectedRepo] = GITHUB_TEST_IDS.repoFullName.split('/');
    expect(result?.githubOwner).toBe(expectedOwner);
    expect(result?.githubRepo).toBe(expectedRepo);
  });

  it('returns null when no repos are accessible', async () => {
    mockPasswordFn.mockResolvedValueOnce('ghp_tok');
    mockListForAuthenticatedUser.mockResolvedValue({ data: [] });

    const result = await setupGithubInteractive();

    expect(result).toBeNull();
  });

  it('returns null when fetching repos fails and user skips', async () => {
    mockPasswordFn.mockResolvedValueOnce('ghp_bad');
    mockListForAuthenticatedUser.mockRejectedValue(new Error('Unauthorized'));
    mockConfirmFn.mockResolvedValueOnce(true);

    const result = await setupGithubInteractive();

    expect(result).toBeNull();
    expect(mockSpinner.fail).toHaveBeenCalledWith('Failed to fetch repositories');
  });

  it('trims token before use', async () => {
    mockListForAuthenticatedUser.mockResolvedValue({
      data: [{ full_name: GITHUB_TEST_IDS.repoFullName, private: false, description: null }],
    });
    mockSelectFn.mockResolvedValue(GITHUB_TEST_IDS.repoFullName);

    const result = await setupGithubInteractive('  ghp_spaced  ', [GITHUB_TEST_IDS.repoFullName]);

    expect(result?.githubToken).toBe('ghp_spaced');
  });
});
