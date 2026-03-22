/**
 * Unit tests for src/adapters/git/mapper.ts
 *
 * Tests three pure mapping functions: mapCommit, mapDiffDelta, extractIssueRefs.
 * es-git class instances are replaced with lightweight structural stubs — no vi.mock
 * needed because the mapper only calls methods defined on its inputs.
 */

import { describe, it, expect } from 'vitest';
import type { Commit as EsGitCommit, DiffDelta, DiffFile } from 'es-git';
import { mapCommit, mapDiffDelta, extractIssueRefs } from '../../../src/adapters/git/mapper.js';
import { GIT_TEST_IDS, createCommit, createCommitFile, createCommitIssueRef } from '../../fixtures/shared/test-constants.js';

// ─── Local stub factories (es-git raw types) ─────────────────────────────────

interface EsGitCommitStubOptions {
  id?: string;
  message?: string;
  authorName?: string;
  authorEmail?: string;
  time?: Date;
}

function createMockEsGitCommit(options: EsGitCommitStubOptions = {}): EsGitCommit {
  const {
    id = GIT_TEST_IDS.commitHash,
    message = `feat: implement feature ${GIT_TEST_IDS.issueRefKey}`,
    authorName = GIT_TEST_IDS.commitAuthor,
    authorEmail = GIT_TEST_IDS.commitEmail,
    time = new Date('2025-01-15T10:00:00.000Z'),
  } = options;

  return {
    id: () => id,
    message: () => message,
    author: () => ({ name: authorName, email: authorEmail, timestamp: time.getTime() / 1000 }),
    time: () => time,
  } as unknown as EsGitCommit;
}

interface DiffFileStubOptions {
  filePath?: string | null;
}

function createMockDiffFile(options: DiffFileStubOptions = {}): DiffFile {
  const { filePath = 'src/feature.ts' } = options;
  return {
    path: () => filePath,
    id: () => GIT_TEST_IDS.commitHash,
    size: () => BigInt(0),
    isBinary: () => false,
  } as unknown as DiffFile;
}

interface DiffDeltaStubOptions {
  status?: string;
  newFilePath?: string | null;
  oldFilePath?: string | null;
}

function createMockDiffDelta(options: DiffDeltaStubOptions = {}): DiffDelta {
  const {
    status = 'Modified',
    newFilePath = 'src/feature.ts',
    oldFilePath = 'src/feature.ts',
  } = options;

  return {
    status: () => status,
    newFile: () => createMockDiffFile({ filePath: newFilePath }),
    oldFile: () => createMockDiffFile({ filePath: oldFilePath }),
    flags: () => 0,
    numFiles: () => 1,
  } as unknown as DiffDelta;
}

// ─── mapCommit ────────────────────────────────────────────────────────────────

describe('mapCommit', () => {
  it('maps all fields from es-git commit to core Commit type', () => {
    const esCommit = createMockEsGitCommit();
    const expected = createCommit();

    const result = mapCommit(esCommit, GIT_TEST_IDS.repoPath);

    expect(result.hash).toBe(expected.hash);
    expect(result.message).toBe(`feat: implement feature ${GIT_TEST_IDS.issueRefKey}`);
    expect(result.author).toBe(expected.author);
    expect(result.email).toBe(expected.email);
    expect(result.committedAt).toBe(expected.committedAt);
    expect(result.repoPath).toBe(expected.repoPath);
  });

  it('always produces an empty parents array', () => {
    const esCommit = createMockEsGitCommit();

    const result = mapCommit(esCommit, GIT_TEST_IDS.repoPath);

    expect(result.parents).toEqual([]);
  });

  it('propagates the repoPath argument unchanged', () => {
    const esCommit = createMockEsGitCommit();

    const result = mapCommit(esCommit, GIT_TEST_IDS.repoPath2);

    expect(result.repoPath).toBe(GIT_TEST_IDS.repoPath2);
  });

  it('serialises commit time to ISO 8601 string', () => {
    const fixedDate = new Date('2025-06-01T12:30:00.000Z');
    const esCommit = createMockEsGitCommit({ time: fixedDate });

    const result = mapCommit(esCommit, GIT_TEST_IDS.repoPath);

    expect(result.committedAt).toBe('2025-06-01T12:30:00.000Z');
  });
});

// ─── mapDiffDelta ─────────────────────────────────────────────────────────────

describe('mapDiffDelta', () => {
  it('maps Added status and reads path from newFile', () => {
    const expected = createCommitFile({ status: 'added', filePath: 'src/new.ts' });
    const delta = createMockDiffDelta({ status: 'Added', newFilePath: 'src/new.ts' });

    const result = mapDiffDelta(delta, GIT_TEST_IDS.commitHash, expected.additions, expected.deletions);

    expect(result.status).toBe('added');
    expect(result.filePath).toBe('src/new.ts');
    expect(result.commitHash).toBe(GIT_TEST_IDS.commitHash);
  });

  it('maps Modified status and reads path from newFile', () => {
    const delta = createMockDiffDelta({ status: 'Modified', newFilePath: 'src/existing.ts' });

    const result = mapDiffDelta(delta, GIT_TEST_IDS.commitHash, 5, 2);

    expect(result.status).toBe('modified');
    expect(result.filePath).toBe('src/existing.ts');
  });

  it('maps Deleted status and reads path from oldFile', () => {
    const delta = createMockDiffDelta({
      status: 'Deleted',
      oldFilePath: 'src/removed.ts',
      newFilePath: null,
    });

    const result = mapDiffDelta(delta, GIT_TEST_IDS.commitHash, 0, 30);

    expect(result.status).toBe('deleted');
    expect(result.filePath).toBe('src/removed.ts');
  });

  it('maps Renamed status and reads path from newFile', () => {
    const delta = createMockDiffDelta({
      status: 'Renamed',
      oldFilePath: 'src/old-name.ts',
      newFilePath: 'src/new-name.ts',
    });

    const result = mapDiffDelta(delta, GIT_TEST_IDS.commitHash, 0, 0);

    expect(result.status).toBe('renamed');
    expect(result.filePath).toBe('src/new-name.ts');
  });

  it('falls back to modified for an unrecognised status', () => {
    const delta = createMockDiffDelta({ status: 'Typechange', newFilePath: 'src/something.ts' });

    const result = mapDiffDelta(delta, GIT_TEST_IDS.commitHash, 1, 1);

    expect(result.status).toBe('modified');
  });

  it('falls back to empty string when newFile path is null', () => {
    const delta = createMockDiffDelta({ status: 'Modified', newFilePath: null });

    const result = mapDiffDelta(delta, GIT_TEST_IDS.commitHash, 0, 0);

    expect(result.filePath).toBe('');
  });

  it('falls back to empty string when Deleted oldFile path is null', () => {
    const delta = createMockDiffDelta({ status: 'Deleted', oldFilePath: null });

    const result = mapDiffDelta(delta, GIT_TEST_IDS.commitHash, 0, 0);

    expect(result.filePath).toBe('');
  });

  it('preserves additions and deletions counts', () => {
    const delta = createMockDiffDelta({ status: 'Modified' });

    const result = mapDiffDelta(delta, GIT_TEST_IDS.commitHash, 42, 17);

    expect(result.additions).toBe(42);
    expect(result.deletions).toBe(17);
  });
});

// ─── extractIssueRefs ─────────────────────────────────────────────────────────

describe('extractIssueRefs', () => {
  it('extracts a single issue key from a commit message', () => {
    const expected = createCommitIssueRef();
    const message = `feat: implement login ${GIT_TEST_IDS.issueRefKey}`;

    const result = extractIssueRefs(GIT_TEST_IDS.commitHash, message);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expected);
  });

  it('extracts multiple distinct issue keys from the same message', () => {
    const message = `fix: resolve ${GIT_TEST_IDS.issueRefKey} and ${GIT_TEST_IDS.issueRefKey2} together`;

    const result = extractIssueRefs(GIT_TEST_IDS.commitHash, message);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.issueKey)).toContain(GIT_TEST_IDS.issueRefKey);
    expect(result.map((r) => r.issueKey)).toContain(GIT_TEST_IDS.issueRefKey2);
  });

  it('deduplicates the same key when it appears multiple times', () => {
    const message = `feat: ${GIT_TEST_IDS.issueRefKey} closes ${GIT_TEST_IDS.issueRefKey}`;

    const result = extractIssueRefs(GIT_TEST_IDS.commitHash, message);

    expect(result).toHaveLength(1);
    expect(result[0]?.issueKey).toBe(GIT_TEST_IDS.issueRefKey);
  });

  it('strips leading zeros from the issue number', () => {
    const message = 'fix: closes PROJ-007';

    const result = extractIssueRefs(GIT_TEST_IDS.commitHash, message);

    expect(result).toHaveLength(1);
    expect(result[0]?.issueKey).toBe(GIT_TEST_IDS.issueRefKey3);
  });

  it('returns empty array when message contains no issue keys', () => {
    const message = 'chore: update dependencies';

    const result = extractIssueRefs(GIT_TEST_IDS.commitHash, message);

    expect(result).toEqual([]);
  });

  it('does not match lowercase patterns', () => {
    const message = 'fix: resolve proj-123 issue';

    const result = extractIssueRefs(GIT_TEST_IDS.commitHash, message);

    expect(result).toEqual([]);
  });

  it('does not match single-letter prefixes without digits', () => {
    const message = `chore: A-1 should not match but ${GIT_TEST_IDS.shortPrefixKey} should`;

    const result = extractIssueRefs(GIT_TEST_IDS.commitHash, message);

    expect(result).toHaveLength(1);
    expect(result[0]?.issueKey).toBe(GIT_TEST_IDS.shortPrefixKey);
  });

  it('extracts keys embedded within prose in a full commit message', () => {
    const message = [
      'feat: implement payment module',
      '',
      `Implements the payment flow described in ${GIT_TEST_IDS.multiRefKey1}.`,
      `Also fixes regression reported as ${GIT_TEST_IDS.multiRefKey2} and ${GIT_TEST_IDS.multiRefKey3}.`,
      '',
      'Co-authored-by: Alice <alice@example.com>',
    ].join('\n');

    const result = extractIssueRefs(GIT_TEST_IDS.commitHash, message);

    const keys = result.map((r) => r.issueKey);
    expect(keys).toContain(GIT_TEST_IDS.multiRefKey1);
    expect(keys).toContain(GIT_TEST_IDS.multiRefKey2);
    expect(keys).toContain(GIT_TEST_IDS.multiRefKey3);
    expect(result).toHaveLength(3);
  });

  it('attaches the correct commitHash to every extracted ref', () => {
    const message = `fix: ${GIT_TEST_IDS.issueRefKey} and ${GIT_TEST_IDS.issueRefKey2}`;

    const result = extractIssueRefs(GIT_TEST_IDS.commitHash2, message);

    expect(result.every((r) => r.commitHash === GIT_TEST_IDS.commitHash2)).toBe(true);
  });
});
