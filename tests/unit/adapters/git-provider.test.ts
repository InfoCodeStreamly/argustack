/**
 * Unit tests for src/adapters/git/provider.ts
 *
 * GitProvider is a driven adapter that reads a local Git repository through
 * the es-git native bindings. All external dependencies (es-git module and
 * the mapper module) are replaced with vi.mock stubs so these tests exercise
 * only the provider's orchestration logic.
 *
 * The revwalk contract that shapes many test arrangements:
 *   - revwalk.next() is called once at the start of the while-loop guard.
 *   - Inside each loop body, revwalk.next() is called a second time to
 *     fetch the parent SHA. That second result becomes the next iteration's
 *     sha, so effectively two .next() calls are consumed per commit visited.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommitBatch, GitRef, Commit, CommitFile, CommitIssueRef } from '../../../src/core/types/git.js';
import { GIT_TEST_IDS } from '../../fixtures/shared/test-constants.js';

// ─── Module-level mocks ──────────────────────────────────────────────────────

vi.mock('es-git', () => ({
  openRepository: vi.fn(),
}));

vi.mock('../../../src/adapters/git/mapper.js', () => ({
  mapCommit: vi.fn(),
  mapDiffDelta: vi.fn(),
  extractIssueRefs: vi.fn(),
}));

// ─── Type helpers for mocks ───────────────────────────────────────────────────

type MockFn = ReturnType<typeof vi.fn>;

interface MockRevwalk {
  pushHead: MockFn;
  next: MockFn;
}

interface MockDelta {
  status: MockFn;
  newFile: MockFn;
  oldFile: MockFn;
}

interface MockDiff {
  deltas: MockFn;
  stats: MockFn;
}

interface MockTree {
  _brand: 'Tree';
}

interface MockEsCommit {
  time: MockFn;
  tree: MockFn;
  message: MockFn;
}

interface MockRepo {
  revwalk: MockFn;
  getCommit: MockFn;
  diffTreeToTree: MockFn;
  branches: MockFn;
  tagForeach: MockFn;
}

// ─── Dynamic-import holders ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let GitProvider: typeof import('../../../src/adapters/git/provider.js').GitProvider;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let openRepository: typeof import('es-git').openRepository;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let mapCommit: typeof import('../../../src/adapters/git/mapper.js').mapCommit;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let mapDiffDelta: typeof import('../../../src/adapters/git/mapper.js').mapDiffDelta;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let extractIssueRefs: typeof import('../../../src/adapters/git/mapper.js').extractIssueRefs;

// ─── Shared mock repo handle ──────────────────────────────────────────────────

let mockRepo: MockRepo;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.clearAllMocks();

  mockRepo = {
    revwalk: vi.fn(),
    getCommit: vi.fn(),
    diffTreeToTree: vi.fn(),
    branches: vi.fn(),
    tagForeach: vi.fn(),
  };

  const esGitModule = await import('es-git');
  openRepository = esGitModule.openRepository;
  vi.mocked(openRepository).mockResolvedValue(mockRepo as never);

  const mapperModule = await import('../../../src/adapters/git/mapper.js');
  mapCommit = mapperModule.mapCommit;
  mapDiffDelta = mapperModule.mapDiffDelta;
  extractIssueRefs = mapperModule.extractIssueRefs;

  const providerModule = await import('../../../src/adapters/git/provider.js');
  GitProvider = providerModule.GitProvider;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a revwalk mock whose .next() returns the supplied sequence then null. */
function makeRevwalk(shaSequence: (string | null)[]): MockRevwalk {
  const next = vi.fn();
  let callIndex = 0;
  next.mockImplementation(() => {
    const value = shaSequence[callIndex] ?? null;
    callIndex++;
    return value;
  });
  const revwalk: MockRevwalk = { pushHead: vi.fn(), next };
  revwalk.pushHead.mockReturnValue(revwalk);
  return revwalk;
}

/** Builds a minimal es-git commit stub. */
function makeEsCommit(time: Date): MockEsCommit {
  const tree: MockTree = { _brand: 'Tree' };
  return {
    time: vi.fn().mockReturnValue(time),
    tree: vi.fn().mockReturnValue(tree),
    message: vi.fn().mockReturnValue('feat: stub message'),
  };
}

/** Builds an empty diff (no deltas). */
function makeEmptyDiff(): MockDiff {
  const deltas = { next: vi.fn().mockReturnValue({ done: true, value: undefined }) };
  return {
    deltas: vi.fn().mockReturnValue(deltas),
    stats: vi.fn().mockReturnValue({ insertions: BigInt(0), deletions: BigInt(0) }),
  };
}

/** Builds a mapped Commit fixture. */
function makeMappedCommit(hash: string = GIT_TEST_IDS.commitHash): Commit {
  return {
    hash,
    message: 'feat: mapped',
    author: GIT_TEST_IDS.commitAuthor,
    email: GIT_TEST_IDS.commitEmail,
    committedAt: '2025-01-15T10:00:00.000Z',
    parents: [],
    repoPath: GIT_TEST_IDS.repoPath,
  };
}

/** Builds a mapped CommitFile fixture. */
function makeMappedFile(commitHash: string = GIT_TEST_IDS.commitHash): CommitFile {
  return {
    commitHash,
    filePath: 'src/login.ts',
    status: 'added',
    additions: 10,
    deletions: 0,
  };
}

/** Builds a mapped CommitIssueRef fixture. */
function makeMappedRef(commitHash: string = GIT_TEST_IDS.commitHash): CommitIssueRef {
  return { commitHash, issueKey: GIT_TEST_IDS.issueRefKey };
}

// ─── getCommitCount ───────────────────────────────────────────────────────────

describe('GitProvider.getCommitCount', () => {
  it('returns total commit count when no since filter is provided', async () => {
    const recentDate = new Date('2025-01-15T10:00:00Z');
    const olderDate = new Date('2025-01-10T10:00:00Z');

    const esCommit1 = makeEsCommit(recentDate);
    const esCommit2 = makeEsCommit(olderDate);

    const revwalk = makeRevwalk([GIT_TEST_IDS.commitHash, GIT_TEST_IDS.commitHash2, null]);
    mockRepo.revwalk.mockReturnValue(revwalk);
    mockRepo.getCommit
      .mockReturnValueOnce(esCommit1)
      .mockReturnValueOnce(esCommit2);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const count = await provider.getCommitCount();

    expect(count).toBe(2);
  });

  it('stops counting when a commit is older than the since date', async () => {
    const recentDate = new Date('2025-06-01T00:00:00Z');
    const oldDate = new Date('2024-01-01T00:00:00Z');
    const since = new Date('2025-01-01T00:00:00Z');

    const esCommit1 = makeEsCommit(recentDate);
    const esCommit2 = makeEsCommit(oldDate);

    const revwalk = makeRevwalk([GIT_TEST_IDS.commitHash, GIT_TEST_IDS.commitHash2, null]);
    mockRepo.revwalk.mockReturnValue(revwalk);
    mockRepo.getCommit
      .mockReturnValueOnce(esCommit1)
      .mockReturnValueOnce(esCommit2);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const count = await provider.getCommitCount(since);

    expect(count).toBe(1);
  });

  it('returns 0 for an empty repository with no commits', async () => {
    const revwalk = makeRevwalk([null]);
    mockRepo.revwalk.mockReturnValue(revwalk);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const count = await provider.getCommitCount();

    expect(count).toBe(0);
  });
});

// ─── pullCommits ──────────────────────────────────────────────────────────────

describe('GitProvider.pullCommits', () => {
  it('yields a batch containing commits, files, and issueRefs for a single commit', async () => {
    const commitDate = new Date('2025-01-15T10:00:00Z');
    const esCommit = makeEsCommit(commitDate);
    const emptyDiff = makeEmptyDiff();

    const mappedCommit = makeMappedCommit();
    const mappedFile = makeMappedFile();
    const mappedRef = makeMappedRef();

    // revwalk.next() sequence:
    //   call 0 (loop guard): commitHash  → enter loop body
    //   call 1 (parentSha):  null        → no parent, sha = null, loop exits
    const revwalk = makeRevwalk([GIT_TEST_IDS.commitHash, null]);
    mockRepo.revwalk.mockReturnValue(revwalk);
    mockRepo.getCommit.mockReturnValue(esCommit);
    mockRepo.diffTreeToTree.mockReturnValue(emptyDiff);

    vi.mocked(mapCommit).mockReturnValue(mappedCommit);
    vi.mocked(mapDiffDelta).mockReturnValue(mappedFile);
    vi.mocked(extractIssueRefs).mockReturnValue([mappedRef]);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const batches: CommitBatch[] = [];
    for await (const batch of provider.pullCommits()) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.commits).toHaveLength(1);
    expect(batches[0]?.commits[0]).toEqual(mappedCommit);
    expect(batches[0]?.issueRefs).toContainEqual(mappedRef);
  });

  it('stops yielding when a commit date is earlier than the since boundary', async () => {
    const recentDate = new Date('2025-06-01T00:00:00Z');
    const oldDate = new Date('2024-01-01T00:00:00Z');
    const since = new Date('2025-01-01T00:00:00Z');

    const recentEsCommit = makeEsCommit(recentDate);
    const oldEsCommit = makeEsCommit(oldDate);

    const mappedCommit = makeMappedCommit();
    const emptyDiff = makeEmptyDiff();

    // revwalk.next() sequence:
    //   call 0: commitHash  → recent commit, enters body
    //   call 1: commitHash2 → parentSha; sha becomes commitHash2
    //   call 2: loop guard with commitHash2 → old commit, breaks before counting
    const revwalk = makeRevwalk([GIT_TEST_IDS.commitHash, GIT_TEST_IDS.commitHash2, null]);
    mockRepo.revwalk.mockReturnValue(revwalk);
    mockRepo.getCommit
      .mockReturnValueOnce(recentEsCommit)
      .mockReturnValueOnce(recentEsCommit)
      .mockReturnValueOnce(oldEsCommit);
    mockRepo.diffTreeToTree.mockReturnValue(emptyDiff);

    vi.mocked(mapCommit).mockReturnValue(mappedCommit);
    vi.mocked(extractIssueRefs).mockReturnValue([]);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const batches: CommitBatch[] = [];
    for await (const batch of provider.pullCommits(since)) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.commits).toHaveLength(1);
  });

  it('handles diff errors gracefully and continues processing the commit', async () => {
    const commitDate = new Date('2025-01-15T10:00:00Z');
    const esCommit = makeEsCommit(commitDate);
    const mappedCommit = makeMappedCommit();

    // revwalk: single commit, no parent
    const revwalk = makeRevwalk([GIT_TEST_IDS.commitHash, null]);
    mockRepo.revwalk.mockReturnValue(revwalk);
    mockRepo.getCommit.mockReturnValue(esCommit);
    mockRepo.diffTreeToTree.mockImplementation(() => {
      throw new Error('diff unavailable');
    });

    vi.mocked(mapCommit).mockReturnValue(mappedCommit);
    vi.mocked(extractIssueRefs).mockReturnValue([]);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const batches: CommitBatch[] = [];
    for await (const batch of provider.pullCommits()) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.commits).toHaveLength(1);
    expect(batches[0]?.files).toHaveLength(0);
  });

  it('includes diff delta files in the batch when diff succeeds', async () => {
    const commitDate = new Date('2025-01-15T10:00:00Z');
    const esCommit = makeEsCommit(commitDate);
    const mappedCommit = makeMappedCommit();
    const mappedFile = makeMappedFile();

    const mockDelta: MockDelta = {
      status: vi.fn().mockReturnValue('Added'),
      newFile: vi.fn().mockReturnValue({ path: vi.fn().mockReturnValue('src/login.ts') }),
      oldFile: vi.fn().mockReturnValue({ path: vi.fn().mockReturnValue('src/login.ts') }),
    };

    const deltasIterator = {
      next: vi.fn()
        .mockReturnValueOnce({ done: false, value: mockDelta })
        .mockReturnValueOnce({ done: true, value: undefined }),
    };

    const diff: MockDiff = {
      deltas: vi.fn().mockReturnValue(deltasIterator),
      stats: vi.fn().mockReturnValue({ insertions: BigInt(10), deletions: BigInt(0) }),
    };

    const perFileDiff: MockDiff = {
      deltas: vi.fn().mockReturnValue({ next: vi.fn().mockReturnValue({ done: true }) }),
      stats: vi.fn().mockReturnValue({ insertions: BigInt(10), deletions: BigInt(0) }),
    };

    const revwalk = makeRevwalk([GIT_TEST_IDS.commitHash, null]);
    mockRepo.revwalk.mockReturnValue(revwalk);
    mockRepo.getCommit.mockReturnValue(esCommit);
    mockRepo.diffTreeToTree
      .mockReturnValueOnce(diff)
      .mockReturnValue(perFileDiff);

    vi.mocked(mapCommit).mockReturnValue(mappedCommit);
    vi.mocked(mapDiffDelta).mockReturnValue(mappedFile);
    vi.mocked(extractIssueRefs).mockReturnValue([]);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const batches: CommitBatch[] = [];
    for await (const batch of provider.pullCommits()) {
      batches.push(batch);
    }

    expect(batches[0]?.files).toHaveLength(1);
    expect(batches[0]?.files[0]).toEqual(mappedFile);
  });

  it('yields a full batch when commit count reaches BATCH_SIZE then yields remainder', async () => {
    const BATCH_SIZE = 100;
    const totalCommits = BATCH_SIZE + 3;
    const commitDate = new Date('2025-01-15T10:00:00Z');

    const esCommit = makeEsCommit(commitDate);
    const emptyDiff = makeEmptyDiff();
    const mappedCommit = makeMappedCommit();

    // Build a sha sequence: alternating sha values for each commit's two revwalk.next() calls.
    // For each commit i: call(2i) = sha_i, call(2i+1) = sha_{i+1} (parent).
    // The last commit's parent call returns null, ending the loop.
    const shaSequence: (string | null)[] = [];
    for (let i = 0; i < totalCommits; i++) {
      shaSequence.push(`sha${i}`);
    }
    shaSequence.push(null);

    const revwalk = makeRevwalk(shaSequence);
    mockRepo.revwalk.mockReturnValue(revwalk);
    mockRepo.getCommit.mockReturnValue(esCommit);
    mockRepo.diffTreeToTree.mockReturnValue(emptyDiff);

    vi.mocked(mapCommit).mockReturnValue(mappedCommit);
    vi.mocked(extractIssueRefs).mockReturnValue([]);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const batches: CommitBatch[] = [];
    for await (const batch of provider.pullCommits()) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(2);
    expect(batches[0]?.commits).toHaveLength(BATCH_SIZE);
    expect(batches[1]?.commits).toHaveLength(3);
  });

  it('yields a single final batch when total commits are fewer than BATCH_SIZE', async () => {
    const commitDate = new Date('2025-01-15T10:00:00Z');
    const esCommit = makeEsCommit(commitDate);
    const emptyDiff = makeEmptyDiff();
    const mappedCommit = makeMappedCommit();

    // Each commit consumes two revwalk.next() calls:
    //   - the loop guard call (returns the commit sha)
    //   - the parent call inside the body (returns the next sha or null)
    // Sequence ['sha0', 'sha1', null] drives:
    //   iteration 1: guard=sha0, parent=sha1  → sha becomes sha1
    //   iteration 2: guard=sha1, parent=null  → sha becomes null, loop exits
    // Result: 2 commits, well below BATCH_SIZE, all collected in one final batch.
    const shaSequence: (string | null)[] = ['sha0', 'sha1', null];

    const revwalk = makeRevwalk(shaSequence);
    mockRepo.revwalk.mockReturnValue(revwalk);
    mockRepo.getCommit.mockReturnValue(esCommit);
    mockRepo.diffTreeToTree.mockReturnValue(emptyDiff);

    vi.mocked(mapCommit).mockReturnValue(mappedCommit);
    vi.mocked(extractIssueRefs).mockReturnValue([]);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const batches: CommitBatch[] = [];
    for await (const batch of provider.pullCommits()) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.commits).toHaveLength(2);
  });

  it('yields nothing when the repository has no commits', async () => {
    const revwalk = makeRevwalk([null]);
    mockRepo.revwalk.mockReturnValue(revwalk);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const batches: CommitBatch[] = [];
    for await (const batch of provider.pullCommits()) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(0);
  });
});

// ─── getBranches ──────────────────────────────────────────────────────────────

describe('GitProvider.getBranches', () => {
  it('returns a GitRef for each local branch returned by the repository', async () => {
    const branchEntries = [
      { name: 'main' },
      { name: 'feature/login' },
    ];

    let callIndex = 0;
    const branchesIterator = {
      next: vi.fn().mockImplementation(() => {
        const entry = branchEntries[callIndex];
        callIndex++;
        if (entry) {
          return { done: false, value: entry };
        }
        return { done: true, value: undefined };
      }),
    };

    mockRepo.branches.mockReturnValue(branchesIterator);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const refs: GitRef[] = await provider.getBranches();

    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ name: 'main', type: 'branch', hash: '' });
    expect(refs[1]).toEqual({ name: 'feature/login', type: 'branch', hash: '' });
    expect(mockRepo.branches).toHaveBeenCalledWith({ type: 'Local' });
  });

  it('returns an empty array when the repository has no local branches', async () => {
    const branchesIterator = {
      next: vi.fn().mockReturnValue({ done: true, value: undefined }),
    };
    mockRepo.branches.mockReturnValue(branchesIterator);

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const refs: GitRef[] = await provider.getBranches();

    expect(refs).toHaveLength(0);
  });
});

// ─── getTags ──────────────────────────────────────────────────────────────────

describe('GitProvider.getTags', () => {
  it('returns a GitRef for each tag, stripping the refs/tags/ prefix from the name', async () => {
    mockRepo.tagForeach.mockImplementation((callback: (oid: string, name: string) => boolean) => {
      callback(GIT_TEST_IDS.commitHash, 'refs/tags/v1.0.0');
      callback(GIT_TEST_IDS.commitHash2, 'refs/tags/v1.1.0');
    });

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const refs: GitRef[] = await provider.getTags();

    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      name: 'v1.0.0',
      type: 'tag',
      hash: GIT_TEST_IDS.commitHash,
    });
    expect(refs[1]).toEqual({
      name: 'v1.1.0',
      type: 'tag',
      hash: GIT_TEST_IDS.commitHash2,
    });
  });

  it('returns an empty array when the repository has no tags', async () => {
    mockRepo.tagForeach.mockImplementation((_callback: unknown) => {
      // no tags — callback is never invoked
    });

    const provider = new GitProvider(GIT_TEST_IDS.repoPath);
    const refs: GitRef[] = await provider.getTags();

    expect(refs).toHaveLength(0);
  });
});
