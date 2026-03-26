/**
 * Tests for BoardColumn value object.
 *
 * BoardColumn enforces a non-empty name constraint, derives a human-readable
 * displayName from the kebab-case column name, and exposes type-predicate
 * helpers used by the pipeline and board renderer.
 */

import { describe, it, expect } from 'vitest';
import { BoardColumn } from '../../../../src/core/board/board-column.value-object.js';

const SYSTEM_COLUMN_NAME = 'backlog';
const SKILL_COLUMN_NAME = 'code-review';

describe('BoardColumn', () => {
  describe('constructor', () => {
    it('stores name and type for a system column', () => {
      const col = new BoardColumn(SYSTEM_COLUMN_NAME, 'system');

      expect(col.name).toBe(SYSTEM_COLUMN_NAME);
      expect(col.type).toBe('system');
    });

    it('stores name and type for a skill column', () => {
      const col = new BoardColumn(SKILL_COLUMN_NAME, 'skill');

      expect(col.name).toBe(SKILL_COLUMN_NAME);
      expect(col.type).toBe('skill');
    });

    it('trims surrounding whitespace from the name', () => {
      const col = new BoardColumn('  backlog  ', 'system');

      expect(col.name).toBe('backlog');
    });

    it('throws when name is empty', () => {
      expect(() => new BoardColumn('', 'system')).toThrow('Column name cannot be empty');
    });

    it('throws when name is whitespace only', () => {
      expect(() => new BoardColumn('   ', 'skill')).toThrow('Column name cannot be empty');
    });
  });

  describe('displayName derivation', () => {
    it('capitalises a single-word name', () => {
      const col = new BoardColumn('backlog', 'system');

      expect(col.displayName).toBe('Backlog');
    });

    it('capitalises each word of a kebab-case name', () => {
      const col = new BoardColumn('code-review', 'skill');

      expect(col.displayName).toBe('Code Review');
    });

    it('capitalises each word of a multi-segment kebab name', () => {
      const col = new BoardColumn('in-progress-review', 'system');

      expect(col.displayName).toBe('In Progress Review');
    });

    it('handles names that are already title-cased', () => {
      const col = new BoardColumn('Done', 'system');

      expect(col.displayName).toBe('Done');
    });
  });

  describe('isSystem', () => {
    it('returns true for a system column', () => {
      const col = new BoardColumn(SYSTEM_COLUMN_NAME, 'system');

      expect(col.isSystem()).toBe(true);
    });

    it('returns false for a skill column', () => {
      const col = new BoardColumn(SKILL_COLUMN_NAME, 'skill');

      expect(col.isSystem()).toBe(false);
    });
  });

  describe('isSkill', () => {
    it('returns true for a skill column', () => {
      const col = new BoardColumn(SKILL_COLUMN_NAME, 'skill');

      expect(col.isSkill()).toBe(true);
    });

    it('returns false for a system column', () => {
      const col = new BoardColumn(SYSTEM_COLUMN_NAME, 'system');

      expect(col.isSkill()).toBe(false);
    });
  });

  describe('skillName', () => {
    it('returns the name when the column is a skill', () => {
      const col = new BoardColumn(SKILL_COLUMN_NAME, 'skill');

      expect(col.skillName()).toBe(SKILL_COLUMN_NAME);
    });

    it('returns null when the column is a system column', () => {
      const col = new BoardColumn(SYSTEM_COLUMN_NAME, 'system');

      expect(col.skillName()).toBeNull();
    });
  });

  describe('equals', () => {
    it('returns true when name and type both match', () => {
      const a = new BoardColumn(SKILL_COLUMN_NAME, 'skill');
      const b = new BoardColumn(SKILL_COLUMN_NAME, 'skill');

      expect(a.equals(b)).toBe(true);
    });

    it('returns false when names differ', () => {
      const a = new BoardColumn('backlog', 'system');
      const b = new BoardColumn('done', 'system');

      expect(a.equals(b)).toBe(false);
    });

    it('returns false when types differ but names match', () => {
      const a = new BoardColumn('review', 'system');
      const b = new BoardColumn('review', 'skill');

      expect(a.equals(b)).toBe(false);
    });

    it('is symmetric', () => {
      const a = new BoardColumn('backlog', 'system');
      const b = new BoardColumn('backlog', 'system');

      expect(a.equals(b)).toBe(b.equals(a));
    });
  });

  describe('toString', () => {
    it('returns the column name', () => {
      const col = new BoardColumn(SKILL_COLUMN_NAME, 'skill');

      expect(col.toString()).toBe(SKILL_COLUMN_NAME);
    });
  });
});
