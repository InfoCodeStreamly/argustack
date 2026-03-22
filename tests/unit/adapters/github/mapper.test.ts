import { describe, it, expect } from 'vitest';
import {
  mapPullRequest,
  mapReview,
  mapReviewComment,
  mapPrFile,
  mapRelease,
  extractPrIssueRefs,
} from '../../../../src/adapters/github/mapper.js';
import { GITHUB_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

const REPO = GITHUB_TEST_IDS.repoFullName;

describe('GitHub Mapper', () => {
  describe('mapPullRequest', () => {
    it('maps basic PR fields', () => {
      const raw = {
        number: GITHUB_TEST_IDS.prNumber,
        title: 'feat: login page',
        body: 'Implements login',
        state: 'open',
        user: { login: GITHUB_TEST_IDS.prAuthor },
        head: { ref: 'feature/login' },
        base: { ref: 'main' },
        created_at: '2025-01-10T10:00:00Z',
        updated_at: '2025-01-12T14:00:00Z',
        merged_at: null,
        closed_at: null,
        merge_commit_sha: null,
        labels: [{ name: 'feature' }],
        requested_reviewers: [{ login: GITHUB_TEST_IDS.reviewer }],
        additions: 100,
        deletions: 10,
        changed_files: 5,
      };

      const pr = mapPullRequest(raw, REPO);

      expect(pr.number).toBe(GITHUB_TEST_IDS.prNumber);
      expect(pr.repoFullName).toBe(REPO);
      expect(pr.title).toBe('feat: login page');
      expect(pr.state).toBe('open');
      expect(pr.author).toBe(GITHUB_TEST_IDS.prAuthor);
      expect(pr.headRef).toBe('feature/login');
      expect(pr.baseRef).toBe('main');
      expect(pr.labels).toEqual(['feature']);
      expect(pr.reviewers).toEqual([GITHUB_TEST_IDS.reviewer]);
      expect(pr.additions).toBe(100);
    });

    it('detects merged state from merged_at', () => {
      const raw = {
        number: 1,
        title: 'merged PR',
        body: null,
        state: 'closed',
        user: { login: 'a' },
        head: { ref: 'b' },
        base: { ref: 'main' },
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        merged_at: '2025-01-02T00:00:00Z',
        closed_at: '2025-01-02T00:00:00Z',
        merge_commit_sha: 'abc123',
      };

      const pr = mapPullRequest(raw, REPO);
      expect(pr.state).toBe('merged');
      expect(pr.mergeCommitSha).toBe('abc123');
    });

    it('handles null user', () => {
      const raw = {
        number: 1,
        title: 'no author',
        body: null,
        state: 'open',
        user: null,
        head: { ref: 'x' },
        base: { ref: 'main' },
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        merged_at: null,
        closed_at: null,
        merge_commit_sha: null,
      };

      const pr = mapPullRequest(raw, REPO);
      expect(pr.author).toBeNull();
    });
  });

  describe('mapReview', () => {
    it('maps review fields', () => {
      const raw = {
        id: GITHUB_TEST_IDS.reviewId,
        user: { login: 'reviewer' },
        state: 'APPROVED',
        body: 'LGTM',
        submitted_at: '2025-01-11T10:00:00Z',
      };

      const review = mapReview(raw, GITHUB_TEST_IDS.prNumber, REPO);

      expect(review.prNumber).toBe(GITHUB_TEST_IDS.prNumber);
      expect(review.repoFullName).toBe(REPO);
      expect(review.reviewId).toBe(GITHUB_TEST_IDS.reviewId);
      expect(review.reviewer).toBe('reviewer');
      expect(review.state).toBe('APPROVED');
    });
  });

  describe('mapReviewComment', () => {
    it('maps comment fields', () => {
      const raw = {
        id: GITHUB_TEST_IDS.commentId,
        user: { login: 'commenter' },
        body: 'Nit: rename',
        path: 'src/foo.ts',
        line: 10,
        created_at: '2025-01-11T10:00:00Z',
        updated_at: '2025-01-11T10:00:00Z',
      };

      const comment = mapReviewComment(raw, GITHUB_TEST_IDS.prNumber, REPO);

      expect(comment.commentId).toBe(GITHUB_TEST_IDS.commentId);
      expect(comment.path).toBe('src/foo.ts');
      expect(comment.line).toBe(10);
    });
  });

  describe('mapPrFile', () => {
    it('maps file fields', () => {
      const raw = {
        filename: 'src/login.ts',
        status: 'added',
        additions: 50,
        deletions: 0,
      };

      const file = mapPrFile(raw, GITHUB_TEST_IDS.prNumber, REPO);

      expect(file.filePath).toBe('src/login.ts');
      expect(file.status).toBe('added');
      expect(file.additions).toBe(50);
    });

    it('falls back to modified for unknown status', () => {
      const raw = { filename: 'a.ts', status: 'changed', additions: 0, deletions: 0 };
      const file = mapPrFile(raw, 1, REPO);
      expect(file.status).toBe('modified');
    });
  });

  describe('mapRelease', () => {
    it('maps release fields', () => {
      const raw = {
        id: GITHUB_TEST_IDS.releaseId,
        tag_name: 'v1.0.0',
        name: 'First release',
        body: 'Release notes',
        author: { login: 'releaser' },
        draft: false,
        prerelease: false,
        created_at: '2025-02-01T10:00:00Z',
        published_at: '2025-02-01T10:00:00Z',
      };

      const release = mapRelease(raw, REPO);

      expect(release.tagName).toBe('v1.0.0');
      expect(release.author).toBe('releaser');
      expect(release.draft).toBe(false);
    });
  });

  describe('extractPrIssueRefs', () => {
    it('extracts Jira keys from title and body', () => {
      const refs = extractPrIssueRefs(
        GITHUB_TEST_IDS.prNumber, REPO,
        `${GITHUB_TEST_IDS.issueRefKey} fix`,
        `Also fixes ${GITHUB_TEST_IDS.issueRefKey2}`,
      );
      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.issueKey)).toEqual([GITHUB_TEST_IDS.issueRefKey, GITHUB_TEST_IDS.issueRefKey2]);
    });

    it('deduplicates keys', () => {
      const refs = extractPrIssueRefs(
        1, REPO,
        GITHUB_TEST_IDS.issueRefKey,
        `${GITHUB_TEST_IDS.issueRefKey} again`,
      );
      expect(refs).toHaveLength(1);
    });

    it('handles null body', () => {
      const refs = extractPrIssueRefs(1, REPO, `${GITHUB_TEST_IDS.issueRefKey3} title only`, null);
      expect(refs).toHaveLength(1);
      expect(refs[0]?.issueKey).toBe(GITHUB_TEST_IDS.issueRefKey3);
    });

    it('returns empty for no keys', () => {
      const refs = extractPrIssueRefs(1, REPO, 'no keys here', 'just text');
      expect(refs).toHaveLength(0);
    });
  });
});
