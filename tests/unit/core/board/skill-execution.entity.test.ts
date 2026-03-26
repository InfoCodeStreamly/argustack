/**
 * Tests for SkillExecutionEntity.
 *
 * SkillExecutionEntity tracks a single skill run for a board task. All state
 * transitions (appendOutput, complete, fail) return new instances to preserve
 * immutability, allowing the board store to persist each snapshot.
 */

import { describe, it, expect } from 'vitest';
import { SkillExecutionEntity } from '../../../../src/core/board/skill-execution.entity.js';
import type { SkillExecutionData } from '../../../../src/core/types/board.js';

const EXECUTION_ID = 'exec-001';
const TASK_ID = 'task-001';
const SKILL_NAME = 'code-review';
const STARTED_AT = '2025-01-15T10:00:00.000Z';

function makeExecutionData(overrides?: Partial<SkillExecutionData>): SkillExecutionData {
  return {
    id: EXECUTION_ID,
    taskId: TASK_ID,
    skillName: SKILL_NAME,
    status: 'running',
    output: '',
    startedAt: STARTED_AT,
    finishedAt: null,
    ...overrides,
  };
}

describe('SkillExecutionEntity', () => {
  describe('create', () => {
    it('constructs an entity with all supplied fields', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData());

      expect(entity.id).toBe(EXECUTION_ID);
      expect(entity.taskId).toBe(TASK_ID);
      expect(entity.skillName).toBe(SKILL_NAME);
      expect(entity.status).toBe('running');
      expect(entity.output).toBe('');
      expect(entity.startedAt).toBe(STARTED_AT);
      expect(entity.finishedAt).toBeNull();
    });

    it('stores initial output when provided', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData({ output: 'Starting...' }));

      expect(entity.output).toBe('Starting...');
    });

    it('stores a non-null finishedAt when provided', () => {
      const finishedAt = '2025-01-15T10:05:00.000Z';
      const entity = SkillExecutionEntity.create(makeExecutionData({ finishedAt }));

      expect(entity.finishedAt).toBe(finishedAt);
    });

    it('treats undefined finishedAt as null', () => {
      const data = makeExecutionData();
      const entity = SkillExecutionEntity.create({
        ...data,
        finishedAt: undefined as unknown as null,
      });

      expect(entity.finishedAt).toBeNull();
    });
  });

  describe('appendOutput', () => {
    it('returns a new entity with the chunk appended to existing output', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData({ output: 'Line 1\n' }));

      const updated = entity.appendOutput('Line 2\n');

      expect(updated.output).toBe('Line 1\nLine 2\n');
    });

    it('does not mutate the original entity', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData({ output: 'initial' }));

      entity.appendOutput(' extra');

      expect(entity.output).toBe('initial');
    });

    it('preserves all other fields', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData());

      const updated = entity.appendOutput('chunk');

      expect(updated.id).toBe(entity.id);
      expect(updated.taskId).toBe(entity.taskId);
      expect(updated.skillName).toBe(entity.skillName);
      expect(updated.status).toBe(entity.status);
      expect(updated.startedAt).toBe(entity.startedAt);
      expect(updated.finishedAt).toBe(entity.finishedAt);
    });

    it('works correctly when appending to an empty initial output', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData({ output: '' }));

      const updated = entity.appendOutput('first output');

      expect(updated.output).toBe('first output');
    });
  });

  describe('complete', () => {
    it('transitions status to done', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData());

      const completed = entity.complete();

      expect(completed.status).toBe('done');
    });

    it('sets finishedAt to an ISO timestamp', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData());

      const completed = entity.complete();

      expect(completed.finishedAt).not.toBeNull();
      expect(() => new Date(completed.finishedAt ?? '')).not.toThrow();
    });

    it('does not mutate the original entity', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData());

      entity.complete();

      expect(entity.status).toBe('running');
      expect(entity.finishedAt).toBeNull();
    });

    it('preserves id, taskId, skillName, output, and startedAt', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData({ output: 'work done' }));

      const completed = entity.complete();

      expect(completed.id).toBe(EXECUTION_ID);
      expect(completed.taskId).toBe(TASK_ID);
      expect(completed.skillName).toBe(SKILL_NAME);
      expect(completed.output).toBe('work done');
      expect(completed.startedAt).toBe(STARTED_AT);
    });
  });

  describe('fail', () => {
    it('transitions status to error', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData());

      const failed = entity.fail('timeout');

      expect(failed.status).toBe('error');
    });

    it('appends the error message to the existing output', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData({ output: 'partial output' }));

      const failed = entity.fail('connection refused');

      expect(failed.output).toBe('partial output\nconnection refused');
    });

    it('sets finishedAt to an ISO timestamp', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData());

      const failed = entity.fail('crashed');

      expect(failed.finishedAt).not.toBeNull();
      expect(() => new Date(failed.finishedAt ?? '')).not.toThrow();
    });

    it('does not mutate the original entity', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData());

      entity.fail('error message');

      expect(entity.status).toBe('running');
      expect(entity.finishedAt).toBeNull();
    });

    it('appends error even when existing output is empty', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData({ output: '' }));

      const failed = entity.fail('fatal error');

      expect(failed.output).toBe('\nfatal error');
    });

    it('preserves id, taskId, skillName, and startedAt', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData());

      const failed = entity.fail('crash');

      expect(failed.id).toBe(EXECUTION_ID);
      expect(failed.taskId).toBe(TASK_ID);
      expect(failed.skillName).toBe(SKILL_NAME);
      expect(failed.startedAt).toBe(STARTED_AT);
    });
  });

  describe('isRunning', () => {
    it('returns true when status is running', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData({ status: 'running' }));

      expect(entity.isRunning()).toBe(true);
    });

    it('returns false when status is done', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData({ status: 'done' }));

      expect(entity.isRunning()).toBe(false);
    });

    it('returns false when status is error', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData({ status: 'error' }));

      expect(entity.isRunning()).toBe(false);
    });
  });

  describe('toData', () => {
    it('serialises back to a plain SkillExecutionData object', () => {
      const data = makeExecutionData({ output: 'some output', finishedAt: null });
      const entity = SkillExecutionEntity.create(data);

      expect(entity.toData()).toEqual(data);
    });

    it('round-trips correctly after complete transition', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData()).complete();
      const serialised = entity.toData();

      expect(serialised.status).toBe('done');
      expect(serialised.finishedAt).not.toBeNull();
    });

    it('round-trips correctly after fail transition', () => {
      const entity = SkillExecutionEntity.create(makeExecutionData()).fail('boom');
      const serialised = entity.toData();

      expect(serialised.status).toBe('error');
      expect(serialised.output).toContain('boom');
    });
  });
});
