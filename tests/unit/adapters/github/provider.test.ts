import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GITHUB_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

vi.mock('../../../../src/adapters/github/client.js', () => ({
  createGitHubClient: vi.fn(),
}));

vi.mock('../../../../src/adapters/github/mapper.js', () => ({
  mapPullRequest: vi.fn((raw: { number: number }) => ({
    number: raw.number,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    title: 'mapped PR',
    body: 'body',
    state: 'open',
    author: GITHUB_TEST_IDS.prAuthor,
    createdAt: '2025-01-10T10:00:00Z',
    updatedAt: '2025-01-12T14:00:00Z',
    mergedAt: null,
    closedAt: null,
    mergeCommitSha: null,
    headRef: 'feature/x',
    baseRef: 'main',
    labels: [],
    reviewers: [],
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    rawJson: {},
  })),
  mapReview: vi.fn((_raw: unknown, prNumber: number) => ({
    prNumber,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    reviewId: GITHUB_TEST_IDS.reviewId,
    reviewer: GITHUB_TEST_IDS.reviewer,
    state: 'APPROVED',
    body: 'LGTM',
    submittedAt: '2025-01-11T10:00:00Z',
  })),
  mapReviewComment: vi.fn((_raw: unknown, prNumber: number) => ({
    prNumber,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    commentId: GITHUB_TEST_IDS.commentId,
    author: GITHUB_TEST_IDS.reviewer,
    body: 'Nit',
    path: 'src/foo.ts',
    line: 10,
    createdAt: '2025-01-11T10:00:00Z',
    updatedAt: '2025-01-11T10:00:00Z',
  })),
  mapPrFile: vi.fn((_raw: unknown, prNumber: number) => ({
    prNumber,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    filePath: 'src/foo.ts',
    status: 'added',
    additions: 50,
    deletions: 0,
  })),
  mapRelease: vi.fn((raw: { id: number }) => ({
    id: raw.id,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    tagName: 'v1.0.0',
    name: 'Release',
    body: 'Notes',
    author: GITHUB_TEST_IDS.prAuthor,
    draft: false,
    prerelease: false,
    createdAt: '2025-02-01T10:00:00Z',
    publishedAt: '2025-02-01T10:00:00Z',
    rawJson: {},
  })),
  extractPrIssueRefs: vi.fn(() => []),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let GitHubProvider: typeof import('../../../../src/adapters/github/provider.js').GitHubProvider;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createGitHubClient: typeof import('../../../../src/adapters/github/client.js').createGitHubClient;

const CREDS = {
  token: 'ghp_test',
  owner: 'test-org',
  repo: 'test-repo',
};

type MockFn = ReturnType<typeof vi.fn>;

interface MockOctokit {
  rest: {
    search: { issuesAndPullRequests: MockFn };
    pulls: {
      list: MockFn;
      listReviews: MockFn;
      listReviewComments: MockFn;
      listFiles: MockFn;
    };
    repos: { listReleases: MockFn };
  };
  paginate: MockFn & {
    iterator: MockFn;
  };
}

function createMockOctokit(): MockOctokit {
  const paginate = vi.fn() as MockFn & { iterator: MockFn };
  paginate.iterator = vi.fn();

  return {
    rest: {
      search: { issuesAndPullRequests: vi.fn() },
      pulls: {
        list: vi.fn(),
        listReviews: vi.fn(),
        listReviewComments: vi.fn(),
        listFiles: vi.fn(),
      },
      repos: { listReleases: vi.fn() },
    },
    paginate,
  };
}

let mockOctokit: MockOctokit;

beforeEach(async () => {
  vi.clearAllMocks();

  mockOctokit = createMockOctokit();

  const clientModule = await import('../../../../src/adapters/github/client.js');
  createGitHubClient = clientModule.createGitHubClient;
  vi.mocked(createGitHubClient).mockReturnValue(mockOctokit as never);

  const providerModule = await import('../../../../src/adapters/github/provider.js');
  GitHubProvider = providerModule.GitHubProvider;
});

describe('GitHubProvider', () => {
  describe('constructor', () => {
    it('has name "GitHub API"', () => {
      const provider = new GitHubProvider(CREDS);
      expect(provider.name).toBe('GitHub API');
    });

    it('creates Octokit client with token', () => {
      new GitHubProvider(CREDS);
      expect(createGitHubClient).toHaveBeenCalledWith(CREDS.token);
    });
  });

  describe('getPrCount', () => {
    it('returns total_count from search API', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: { total_count: 42 },
      });

      const provider = new GitHubProvider(CREDS);
      const count = await provider.getPrCount();

      expect(count).toBe(42);
    });

    it('includes date filter in query when since provided', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: { total_count: 10 },
      });

      const provider = new GitHubProvider(CREDS);
      await provider.getPrCount(new Date('2025-01-01T00:00:00Z'));

      const call = mockOctokit.rest.search.issuesAndPullRequests.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call['q']).toContain('updated:>=2025-01-01');
    });
  });

  describe('pullPullRequests', () => {
    it('yields batch with PRs, reviews, comments, and files', async () => {
      const rawPr = {
        number: GITHUB_TEST_IDS.prNumber,
        updated_at: '2025-01-12T14:00:00Z',
      };

      mockOctokit.paginate.iterator.mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield { data: [rawPr] };
        })(),
      );

      mockOctokit.paginate
        .mockResolvedValueOnce([{ id: GITHUB_TEST_IDS.reviewId }])
        .mockResolvedValueOnce([{ id: GITHUB_TEST_IDS.commentId }])
        .mockResolvedValueOnce([{ filename: 'src/foo.ts' }]);

      const provider = new GitHubProvider(CREDS);
      const batches: unknown[] = [];
      for await (const batch of provider.pullPullRequests()) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(1);

      const batch = batches[0] as Record<string, unknown[]>;
      expect(batch['pullRequests']).toHaveLength(1);
      expect(batch['reviews']).toHaveLength(1);
      expect(batch['comments']).toHaveLength(1);
      expect(batch['files']).toHaveLength(1);
    });

    it('stops when PR is older than since date', async () => {
      const oldPr = {
        number: GITHUB_TEST_IDS.prNumber,
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockOctokit.paginate.iterator.mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield { data: [oldPr] };
        })(),
      );

      const provider = new GitHubProvider(CREDS);
      const batches: unknown[] = [];
      for await (const batch of provider.pullPullRequests(new Date('2025-01-01'))) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(0);
    });

    it('yields empty when no PRs exist', async () => {
      mockOctokit.paginate.iterator.mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield { data: [] };
        })(),
      );

      const provider = new GitHubProvider(CREDS);
      const batches: unknown[] = [];
      for await (const batch of provider.pullPullRequests()) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(0);
    });
  });

  describe('pullReleases', () => {
    it('returns mapped releases', async () => {
      mockOctokit.paginate.mockResolvedValue([
        { id: GITHUB_TEST_IDS.releaseId },
        { id: GITHUB_TEST_IDS.releaseId + 1 },
      ]);

      const provider = new GitHubProvider(CREDS);
      const releases = await provider.pullReleases();

      expect(releases).toHaveLength(2);
      expect(releases[0]?.tagName).toBe('v1.0.0');
    });

    it('returns empty array when no releases', async () => {
      mockOctokit.paginate.mockResolvedValue([]);

      const provider = new GitHubProvider(CREDS);
      const releases = await provider.pullReleases();

      expect(releases).toHaveLength(0);
    });
  });
});
