/**
 * Unit tests for createGitHubClient.
 *
 * Verifies that the factory function produces an Octokit instance configured
 * with the supplied auth token. The octokit package is mocked at the module
 * boundary so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOctokit = vi.fn(function (this: Record<string, unknown>, _config: unknown) {
  Object.assign(this, { rest: { repos: {} } });
});

vi.mock('octokit', () => ({
  Octokit: mockOctokit,
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createGitHubClient: typeof import('../../../../src/adapters/github/client.js').createGitHubClient;

beforeEach(async () => {
  vi.clearAllMocks();
  const module = await import('../../../../src/adapters/github/client.js');
  createGitHubClient = module.createGitHubClient;
});

describe('createGitHubClient', () => {
  it('constructs Octokit with the provided auth token', () => {
    createGitHubClient('ghp_test_token');

    expect(mockOctokit).toHaveBeenCalledOnce();
    const [config] = mockOctokit.mock.calls[0] as [{ auth: string }];
    expect(config.auth).toBe('ghp_test_token');
  });

  it('returns the constructed Octokit instance', () => {
    const result = createGitHubClient('ghp_any');

    expect(result).toBeInstanceOf(mockOctokit);
  });

  it('creates a fresh client per call with different tokens', () => {
    createGitHubClient('token-one');
    createGitHubClient('token-two');

    expect(mockOctokit).toHaveBeenCalledTimes(2);
    const [firstConfig] = mockOctokit.mock.calls[0] as [{ auth: string }];
    const [secondConfig] = mockOctokit.mock.calls[1] as [{ auth: string }];
    expect(firstConfig.auth).toBe('token-one');
    expect(secondConfig.auth).toBe('token-two');
  });

  it('passes token unchanged including special characters', () => {
    const token = 'github_pat_ABC123_xyz!@#';
    createGitHubClient(token);

    const [config] = mockOctokit.mock.calls[0] as [{ auth: string }];
    expect(config.auth).toBe(token);
  });
});
