import { describe, it, expect } from 'vitest';
import { groupReviewsByPr, groupFilesByCommit } from '../../../../src/mcp/tools/formatters.js';

describe('formatters', () => {
  describe('groupReviewsByPr', () => {
    it('groups reviews by pr_number', () => {
      const rows = [
        { pr_number: 1, reviewer: 'alice', state: 'APPROVED' },
        { pr_number: 2, reviewer: 'bob', state: 'CHANGES_REQUESTED' },
        { pr_number: 1, reviewer: 'carol', state: 'APPROVED' },
      ];
      const result = groupReviewsByPr(rows);
      expect(result.size).toBe(2);
      expect(result.get(1)).toHaveLength(2);
      expect(result.get(2)).toHaveLength(1);
    });

    it('returns empty map for empty input', () => {
      expect(groupReviewsByPr([]).size).toBe(0);
    });
  });

  describe('groupFilesByCommit', () => {
    it('groups files by commit_hash', () => {
      const rows = [
        { commit_hash: 'abc', file_path: 'a.ts', status: 'added' },
        { commit_hash: 'abc', file_path: 'b.ts', status: 'modified' },
        { commit_hash: 'def', file_path: 'c.ts', status: 'deleted' },
      ];
      const result = groupFilesByCommit(rows);
      expect(result.size).toBe(2);
      expect(result.get('abc')).toHaveLength(2);
      expect(result.get('def')).toHaveLength(1);
    });

    it('returns empty map for empty input', () => {
      expect(groupFilesByCommit([]).size).toBe(0);
    });
  });
});
