import { describe, it, expect, beforeEach } from 'vitest';
import { PullGitHubUseCase } from '../../../src/use-cases/pull-github.js';
import { FakeGitHubProvider } from '../../fixtures/fakes/fake-github-provider.js';
import { FakeStorage } from '../../fixtures/fakes/fake-storage.js';
import {
  createGitHubBatch,
  createPullRequest,
  createPrReview,
  createPrComment,
  createPrFile,
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
      pullRequests: [createPullRequest({ number: GITHUB_TEST_IDS.prNumber2 })],
      reviews: [createPrReview({ prNumber: GITHUB_TEST_IDS.prNumber2 })],
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
    storage.pullRequests.set(GITHUB_TEST_IDS.prNumber, createPullRequest());
    await storage.saveGitHubBatch(createGitHubBatch());

    github.seedBatches([createEmptyGitHubBatch()]);

    await useCase.execute(repoFullName);

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

  it('incremental since from storage subtracts exactly 60 seconds', async () => {
    const prDate = new Date('2025-06-15T12:01:00.000Z');
    await storage.saveGitHubBatch(createGitHubBatch({
      pullRequests: [createPullRequest({ updatedAt: prDate.toISOString() })],
    }));

    github.seedBatches([createEmptyGitHubBatch()]);

    await useCase.execute(repoFullName);

    const expected = new Date(prDate.getTime() - 60_000);
    expect(github.pullCalls[0]?.since?.getTime()).toBe(expected.getTime());
  });

  it('explicit since overrides storage lastPrUpdated', async () => {
    const storageDate = new Date('2025-03-01T00:00:00.000Z');
    await storage.saveGitHubBatch(createGitHubBatch({
      pullRequests: [createPullRequest({ updatedAt: storageDate.toISOString() })],
    }));

    const explicitSince = new Date('2025-01-01T00:00:00.000Z');
    github.seedBatches([createEmptyGitHubBatch()]);

    await useCase.execute(repoFullName, { since: explicitSince });

    expect(github.pullCalls[0]?.since).toEqual(explicitSince);
  });

  it('does full pull when no storage date and no since', async () => {
    github.seedBatches([createEmptyGitHubBatch()]);

    await useCase.execute(repoFullName);

    expect(github.pullCalls[0]?.since).toBeUndefined();
  });

  it('logs incremental pull message when since is set from storage', async () => {
    const prDate = new Date('2025-06-15T00:00:00.000Z');
    await storage.saveGitHubBatch(createGitHubBatch({
      pullRequests: [createPullRequest({ updatedAt: prDate.toISOString() })],
    }));

    github.seedBatches([createEmptyGitHubBatch()]);

    const messages: string[] = [];
    await useCase.execute(repoFullName, { onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('Incremental pull'))).toBe(true);
  });

  it('logs incremental pull message when explicit since is set', async () => {
    const since = new Date('2025-01-01T00:00:00.000Z');
    github.seedBatches([createEmptyGitHubBatch()]);

    const messages: string[] = [];
    await useCase.execute(repoFullName, { since, onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('Incremental pull'))).toBe(true);
  });

  it('does not log incremental pull message when no since', async () => {
    github.seedBatches([createEmptyGitHubBatch()]);

    const messages: string[] = [];
    await useCase.execute(repoFullName, { onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('Incremental pull'))).toBe(false);
  });

  it('counts comments, files and issueRefs across batches', async () => {
    const batch1 = createGitHubBatch();
    const batch2 = createGitHubBatch({
      pullRequests: [createPullRequest({ number: GITHUB_TEST_IDS.prNumber2 })],
      reviews: [],
      comments: [createPrComment({ prNumber: GITHUB_TEST_IDS.prNumber2 }), createPrComment({ prNumber: GITHUB_TEST_IDS.prNumber2 })],
      files: [createPrFile({ prNumber: GITHUB_TEST_IDS.prNumber2 }), createPrFile({ prNumber: GITHUB_TEST_IDS.prNumber2 })],
      issueRefs: [
        { prNumber: GITHUB_TEST_IDS.prNumber2, repoFullName, issueKey: GITHUB_TEST_IDS.issueRefKey },
        { prNumber: GITHUB_TEST_IDS.prNumber2, repoFullName, issueKey: GITHUB_TEST_IDS.issueRefKey2 },
      ],
    });

    github.seedBatches([batch1, batch2]);
    github.seedReleases([]);

    const result = await useCase.execute(repoFullName);

    expect(result.prsCount).toBe(2);
    expect(result.commentsCount).toBe(3);
    expect(result.filesCount).toBe(3);
    expect(result.issueRefsCount).toBe(3);
  });

  it('saves each batch separately to storage', async () => {
    const batch1 = createGitHubBatch();
    const batch2 = createGitHubBatch({ pullRequests: [createPullRequest({ number: GITHUB_TEST_IDS.prNumber2 })], reviews: [], comments: [], files: [], issueRefs: [] });

    github.seedBatches([batch1, batch2]);
    github.seedReleases([]);

    await useCase.execute(repoFullName);

    expect(storage.savedGitHubBatches).toHaveLength(2);
  });

  it('pulls releases and saves them separately from PR batches', async () => {
    const releases = [createRelease(), createRelease({ id: GITHUB_TEST_IDS.releaseId + 1, tagName: 'v1.1.0' })];

    github.seedBatches([createEmptyGitHubBatch()]);
    github.seedReleases(releases);

    const result = await useCase.execute(repoFullName);

    expect(result.releasesCount).toBe(2);
    expect(storage.savedReleases).toHaveLength(1);
    expect(storage.savedReleases[0]).toHaveLength(2);
  });

  it('logs pulling releases message', async () => {
    github.seedBatches([createEmptyGitHubBatch()]);
    github.seedReleases([createRelease()]);

    const messages: string[] = [];
    await useCase.execute(repoFullName, { onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('releases'))).toBe(true);
  });

  it('progress message includes done summary with exact counts', async () => {
    github.seedBatches([createGitHubBatch()]);
    github.seedReleases([createRelease(), createRelease({ id: GITHUB_TEST_IDS.releaseId + 1, tagName: 'v2.0.0' })]);

    const messages: string[] = [];
    await useCase.execute(repoFullName, { onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('1 PRs') && m.includes('1 reviews') && m.includes('2 releases'))).toBe(true);
  });

  it('returns repoFullName in result unchanged', async () => {
    github.seedBatches([createEmptyGitHubBatch()]);
    github.seedReleases([]);

    const result = await useCase.execute(repoFullName);

    expect(result.repoFullName).toBe(repoFullName);
  });

  it('progress percentage is capped at 100 when prs exceed reported total', async () => {
    const batch = createGitHubBatch({
      pullRequests: [
        createPullRequest({ number: GITHUB_TEST_IDS.prNumber }),
        createPullRequest({ number: GITHUB_TEST_IDS.prNumber2 }),
        createPullRequest({ number: 100 }),
      ],
      reviews: [],
      comments: [],
      files: [],
      issueRefs: [],
    });
    github.seedBatches([batch]);
    github.seedReleases([]);

    const messages: string[] = [];
    await useCase.execute(repoFullName, { onProgress: (msg) => messages.push(msg) });

    const percentMatches = messages.filter((m) => m.includes('%'));
    for (const msg of percentMatches) {
      const pctMatch = /\((\d+)%\)/.exec(msg);
      if (pctMatch) {
        expect(Number(pctMatch[1])).toBeLessThanOrEqual(100);
      }
    }
  });
});
