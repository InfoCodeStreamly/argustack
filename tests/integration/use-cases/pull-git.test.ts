import { describe, it, expect, beforeEach } from 'vitest';
import { PullGitUseCase } from '../../../src/use-cases/pull-git.js';
import { FakeGitProvider } from '../../fixtures/fakes/fake-git-provider.js';
import { FakeStorage } from '../../fixtures/fakes/fake-storage.js';
import {
  createCommitBatch,
  createCommit,
  createCommitFile,
  GIT_TEST_IDS,
} from '../../fixtures/shared/test-constants.js';

describe('PullGitUseCase', () => {
  let git: FakeGitProvider;
  let storage: FakeStorage;
  let useCase: PullGitUseCase;

  const repoPath = GIT_TEST_IDS.repoPath;

  beforeEach(() => {
    git = new FakeGitProvider();
    storage = new FakeStorage();
    useCase = new PullGitUseCase(git, storage);
  });

  it('initializes storage before pull', async () => {
    git.seedBatches([createCommitBatch({ commits: [], files: [], issueRefs: [] })]);
    await useCase.execute(repoPath);
    expect(storage.initialized).toBe(true);
  });

  it('pulls commits and saves to storage', async () => {
    git.seedBatches([createCommitBatch()]);

    const result = await useCase.execute(repoPath);

    expect(result.repoPath).toBe(repoPath);
    expect(result.commitsCount).toBe(1);
    expect(result.filesCount).toBe(1);
    expect(result.issueRefsCount).toBe(1);
    expect(storage.savedCommitBatches).toHaveLength(1);
  });

  it('accumulates counts across multiple batches', async () => {
    const batch1 = createCommitBatch();
    const batch2 = createCommitBatch({
      commits: [createCommit({ hash: GIT_TEST_IDS.commitHash2 })],
      files: [
        createCommitFile({ commitHash: GIT_TEST_IDS.commitHash2, filePath: 'src/a.ts' }),
        createCommitFile({ commitHash: GIT_TEST_IDS.commitHash2, filePath: 'src/b.ts' }),
      ],
      issueRefs: [],
    });

    git.seedBatches([batch1, batch2]);

    const result = await useCase.execute(repoPath);

    expect(result.commitsCount).toBe(2);
    expect(result.filesCount).toBe(3);
    expect(result.issueRefsCount).toBe(1);
    expect(storage.savedCommitBatches).toHaveLength(2);
  });

  it('handles empty batches', async () => {
    git.seedBatches([createCommitBatch({ commits: [], files: [], issueRefs: [] })]);

    const result = await useCase.execute(repoPath);

    expect(result.commitsCount).toBe(0);
    expect(result.filesCount).toBe(0);
    expect(result.issueRefsCount).toBe(0);
  });

  it('passes since parameter to provider', async () => {
    git.seedBatches([createCommitBatch({ commits: [], files: [], issueRefs: [] })]);
    const since = new Date('2025-01-01');

    await useCase.execute(repoPath, { since });

    expect(git.pullCalls[0]?.since).toEqual(since);
  });

  it('uses incremental since from storage (minus 60s)', async () => {
    const commitDate = new Date('2025-06-15T00:00:00.000Z');
    await storage.saveCommitBatch(createCommitBatch({
      commits: [createCommit({ committedAt: commitDate.toISOString() })],
    }));

    git.seedBatches([createCommitBatch({ commits: [], files: [], issueRefs: [] })]);

    await useCase.execute(repoPath);

    const expected = new Date(commitDate.getTime() - 60_000);
    expect(git.pullCalls[0]?.since).toEqual(expected);
  });

  it('calls onProgress with percentage when count available', async () => {
    git.seedBatches([createCommitBatch()]);

    const messages: string[] = [];
    await useCase.execute(repoPath, {
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.some((m) => m.includes('1/1 commits (100%)'))).toBe(true);
    expect(messages.some((m) => m.includes('(1 total)'))).toBe(true);
  });

  it('calls onProgress without percentage when count unavailable', async () => {
    // Remove getCommitCount to simulate unavailable count
    git.getCommitCount = undefined as unknown as typeof git.getCommitCount;

    git.seedBatches([createCommitBatch()]);

    const messages: string[] = [];
    await useCase.execute(repoPath, {
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.some((m) => m.includes('1 commits...'))).toBe(true);
    expect(messages.some((m) => m.includes('%'))).toBe(false);
  });
});
