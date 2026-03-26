/**
 * Tests for TaskTitle value object.
 *
 * TaskTitle enforces a non-empty constraint and a 200-character cap,
 * trimming surrounding whitespace on construction.
 */

import { describe, it, expect } from 'vitest';
import { TaskTitle } from '../../../../src/core/board/task-title.value-object.js';

const VALID_TITLE = 'Implement board column drag-and-drop';
const MAX_LENGTH = 200;

describe('TaskTitle', () => {
  describe('constructor', () => {
    it('stores trimmed value for a normal title', () => {
      const title = new TaskTitle(VALID_TITLE);

      expect(title.value).toBe(VALID_TITLE);
    });

    it('trims leading and trailing whitespace', () => {
      const title = new TaskTitle('  padded title  ');

      expect(title.value).toBe('padded title');
    });

    it('throws when raw string is empty', () => {
      expect(() => new TaskTitle('')).toThrow('Task title cannot be empty');
    });

    it('throws when raw string is whitespace only', () => {
      expect(() => new TaskTitle('   ')).toThrow('Task title cannot be empty');
    });

    it('accepts a single non-whitespace character', () => {
      const title = new TaskTitle('X');

      expect(title.value).toBe('X');
    });

    it('stores value exactly at the maximum allowed length', () => {
      const raw = 'a'.repeat(MAX_LENGTH);
      const title = new TaskTitle(raw);

      expect(title.value).toHaveLength(MAX_LENGTH);
      expect(title.value).toBe(raw);
    });

    it('truncates value that exceeds the maximum allowed length', () => {
      const raw = 'b'.repeat(MAX_LENGTH + 50);
      const title = new TaskTitle(raw);

      expect(title.value).toHaveLength(MAX_LENGTH);
      expect(title.value).toBe(raw.slice(0, MAX_LENGTH));
    });

    it('truncates after trimming whitespace', () => {
      const body = 'c'.repeat(MAX_LENGTH + 10);
      const raw = '  ' + body + '  ';
      const title = new TaskTitle(raw);

      expect(title.value).toHaveLength(MAX_LENGTH);
    });
  });

  describe('equals', () => {
    it('returns true for two titles with the same value', () => {
      const a = new TaskTitle(VALID_TITLE);
      const b = new TaskTitle(VALID_TITLE);

      expect(a.equals(b)).toBe(true);
    });

    it('returns false for two titles with different values', () => {
      const a = new TaskTitle('Title A');
      const b = new TaskTitle('Title B');

      expect(a.equals(b)).toBe(false);
    });

    it('is symmetric', () => {
      const a = new TaskTitle('Same');
      const b = new TaskTitle('Same');

      expect(a.equals(b)).toBe(b.equals(a));
    });
  });

  describe('toString', () => {
    it('returns the stored value', () => {
      const title = new TaskTitle(VALID_TITLE);

      expect(title.toString()).toBe(VALID_TITLE);
    });

    it('returns the truncated value when input exceeded max length', () => {
      const raw = 'd'.repeat(MAX_LENGTH + 1);
      const title = new TaskTitle(raw);

      expect(title.toString()).toHaveLength(MAX_LENGTH);
    });
  });
});
