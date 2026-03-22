import { describe, it, expect, beforeEach } from 'vitest';
import { PullGitHubUseCase } from '../../../src/use-cases/pull-github.js';
import { FakeGitHubProvider } from '../../fixtures/fakes/fake-github-provider.js';
import { FakeStorage } from '../../fixtures/fakes/fake-storage.js';
import {
  createGitHubBatch,
  createPullRequest,
  createPrReview,
  createRelease,
  createEmptyGitHubBatch,
  GITHUB_TEST_IDS,
} from '../../fixtures/shared/test-constants.js';

describe('PullGitHubUseCase', () => {
  let github: FakeGitHubProvider;
  let storage: FakeStorage;
  let useCase: PullGitHubUseCase;

  const repoFullName = GITHUB_TEST_IDS.repoFullName;

  beforeEach(() => {
    github = new FakeGitHubProvider();
    storage = new FakeStorage();
    useCase = new PullGitHubUseCase(github, storage);
  });

  it('initializes storage before pull', async () => {
    github.seedBatches([createEmptyGitHubBatch()]);
    await useCase.execute(repoFullName);
    expect(storage.initialized).toBe(true);
  });

  it('pulls PRs and saves to storage', async () => {
    github.seedBatches([createGitHubBatch()]);
    github.seedReleases([createRelease()]);

    const result = await useCase.execute(repoFullName);

    expect(result.prsCount).toBe(1);
    expect(result.reviewsCount).toBe(1);
    expect(result.commentsCount).toBe(1);
    expect(result.filesCount).toBe(1);
    expect(result.issueRefsCount).toBe(1);
    expect(result.releasesCount).toBe(1);
    expect(storage.savedGitHubBatches).toHaveLength(1);
    expect(storage.savedReleases).toHaveLength(1);
  });

  it('accumulates multiple batches', async () => {
    const batch1 = createGitHubBatch();
    const batch2 = createGitHubBatch({
      pullRequests: [createPullRequest({ number: 43 })],
      reviews: [createPrReview({ prNumber: 43 })],
      comments: [],
      files: [],
      issueRefs: [],
    });

    github.seedBatches([batch1, batch2]);

    const result = await useCase.execute(repoFullName);

    expect(result.prsCount).toBe(2);
    expect(result.reviewsCount).toBe(2);
    expect(storage.savedGitHubBatches).toHaveLength(2);
  });

  it('passes since parameter to provider', async () => {
    github.seedBatches([createEmptyGitHubBatch()]);
    const since = new Date('2025-01-01');

    await useCase.execute(repoFullName, { since });

    expect(github.pullCalls[0]?.since).toEqual(since);
  });

  it('uses incremental pull from storage when no since provided', async () => {
    storage.pullRequests.set(42, createPullRequest());
    // Manually set last PR updated
    await storage.saveGitHubBatch(createGitHubBatch());

    github.seedBatches([createEmptyGitHubBatch()]);

    await useCase.execute(repoFullName);

    // Should have used a since date (the last PR updated_at minus 60s)
    const pullCall = github.pullCalls[0];
    expect(pullCall?.since).toBeDefined();
  });

  it('calls onProgress callback', async () => {
    github.seedBatches([createGitHubBatch()]);
    github.seedReleases([]);

    const messages: string[] = [];
    await useCase.execute(repoFullName, {
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes('PRs'))).toBe(true);
  });

  it('shows percentage when PR count available', async () => {
    github.seedBatches([createGitHubBatch()]);
    github.seedReleases([]);

    const messages: string[] = [];
    await useCase.execute(repoFullName, {
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.some((m) => m.includes('1/1 PRs (100%)'))).toBe(true);
    expect(messages.some((m) => m.includes('(1 total)'))).toBe(true);
  });

  it('shows count without percentage when PR count unavailable', async () => {
    const bareGithub = new FakeGitHubProvider();
    bareGithub.getPrCount = undefined as unknown as typeof bareGithub.getPrCount;
    const bareUseCase = new PullGitHubUseCase(bareGithub, storage);

    bareGithub.seedBatches([createGitHubBatch()]);
    bareGithub.seedReleases([]);

    const messages: string[] = [];
    await bareUseCase.execute(repoFullName, {
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.some((m) => m.includes('1 PRs...'))).toBe(true);
    expect(messages.some((m) => m.includes('%'))).toBe(false);
  });
});
