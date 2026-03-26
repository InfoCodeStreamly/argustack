import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';
/**
 * Tests for BoardTaskEntity.
 *
 * BoardTaskEntity is the core domain object for a board task. It wraps
 * BoardTaskData and enforces move rules through the Pipeline value object.
 * All mutations return new instances (immutable pattern).
 */

import { describe, it, expect } from 'vitest';
import { BoardTaskEntity } from '../../../../src/core/board/board-task.entity.js';
import { BoardColumn } from '../../../../src/core/board/board-column.value-object.js';
import { Pipeline, type PipelineConfig } from '../../../../src/core/board/pipeline.value-object.js';
import type { BoardTaskData } from '../../../../src/core/types/board.js';

const TASK_ID = 'task-001';
const TASK_TITLE = 'Implement search indexing';
const MD_PATH = '.argustack/tasks/task-001.md';
const BACKLOG = 'backlog';
const CODE_REVIEW = 'code-review';
const DONE = 'done';
const CREATED_AT = '2025-01-15T10:00:00.000Z';
const UPDATED_AT = '2025-01-15T10:00:00.000Z';

function makeTaskData(overrides?: Partial<BoardTaskData>): BoardTaskData {
  return {
    id: TASK_ID,
    title: TASK_TITLE,
    mdPath: MD_PATH,
    column: BACKLOG,
    jiraKey: null,
    assignee: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makePipeline(
  columns: { name: string; type: 'system' | 'skill' }[],
): Pipeline {
  const config: PipelineConfig = {
    columns: columns.map((c) => ({ name: c.name, displayName: c.name, type: c.type })),
    port: 3000,
  };
  return Pipeline.fromConfig(config, []);
}

describe('BoardTaskEntity', () => {
  describe('create', () => {
    it('constructs an entity with all supplied fields', () => {
      const task = BoardTaskEntity.create(makeTaskData());

      expect(task.id).toBe(TASK_ID);
      expect(task.title.toString()).toBe(TASK_TITLE);
      expect(task.mdPath).toBe(MD_PATH);
      expect(task.column).toBe(BACKLOG);
      expect(task.jiraKey).toBeNull();
      expect(task.assignee).toBeNull();
      expect(task.createdAt).toBe(CREATED_AT);
      expect(task.updatedAt).toBe(UPDATED_AT);
    });

    it('stores jiraKey when provided', () => {
      const task = BoardTaskEntity.create(makeTaskData({ jiraKey: TEST_IDS.issueKey }));

      expect(task.jiraKey).toBe(TEST_IDS.issueKey);
    });

    it('stores assignee when provided', () => {
      const task = BoardTaskEntity.create(makeTaskData({ assignee: TEST_IDS.author }));

      expect(task.assignee).toBe(TEST_IDS.author);
    });

    it('treats undefined jiraKey as null', () => {
      const data = makeTaskData();
      delete (data as Partial<BoardTaskData>).jiraKey;
      const task = BoardTaskEntity.create({ ...data, jiraKey: undefined as unknown as null });

      expect(task.jiraKey).toBeNull();
    });

    it('treats undefined assignee as null', () => {
      const data = makeTaskData();
      const task = BoardTaskEntity.create({ ...data, assignee: undefined as unknown as null });

      expect(task.assignee).toBeNull();
    });
  });

  describe('currentColumn', () => {
    it('returns the column name of the task', () => {
      const task = BoardTaskEntity.create(makeTaskData({ column: CODE_REVIEW }));

      expect(task.currentColumn).toBe(CODE_REVIEW);
    });
  });

  describe('moveTo', () => {
    it('returns a new entity in the target column when the move is allowed', () => {
      const pipeline = makePipeline([
        { name: BACKLOG, type: 'system' },
        { name: CODE_REVIEW, type: 'skill' },
        { name: DONE, type: 'system' },
      ]);
      const task = BoardTaskEntity.create(makeTaskData({ column: BACKLOG }));
      const target = new BoardColumn(CODE_REVIEW, 'skill');

      const moved = task.moveTo(target, pipeline);

      expect(moved.column).toBe(CODE_REVIEW);
    });

    it('does not mutate the original entity', () => {
      const pipeline = makePipeline([
        { name: BACKLOG, type: 'system' },
        { name: DONE, type: 'system' },
      ]);
      const task = BoardTaskEntity.create(makeTaskData({ column: BACKLOG }));
      const target = new BoardColumn(DONE, 'system');

      task.moveTo(target, pipeline);

      expect(task.column).toBe(BACKLOG);
    });

    it('preserves all fields except column and updatedAt after a move', () => {
      const pipeline = makePipeline([
        { name: BACKLOG, type: 'system' },
        { name: DONE, type: 'system' },
      ]);
      const task = BoardTaskEntity.create(makeTaskData({ jiraKey: TEST_IDS.issueKey, assignee: 'alice' }));
      const target = new BoardColumn(DONE, 'system');

      const moved = task.moveTo(target, pipeline);

      expect(moved.id).toBe(task.id);
      expect(moved.title.toString()).toBe(task.title.toString());
      expect(moved.mdPath).toBe(task.mdPath);
      expect(moved.jiraKey).toBe(task.jiraKey);
      expect(moved.assignee).toBe(task.assignee);
      expect(moved.createdAt).toBe(task.createdAt);
    });

    it('updates updatedAt to a new ISO timestamp after a move', () => {
      const pipeline = makePipeline([
        { name: BACKLOG, type: 'system' },
        { name: DONE, type: 'system' },
      ]);
      const task = BoardTaskEntity.create(makeTaskData({ updatedAt: UPDATED_AT }));
      const target = new BoardColumn(DONE, 'system');

      const moved = task.moveTo(target, pipeline);

      expect(moved.updatedAt).not.toBe(UPDATED_AT);
      expect(() => new Date(moved.updatedAt)).not.toThrow();
    });

    it('throws when the target column does not exist in the pipeline', () => {
      const pipeline = makePipeline([
        { name: BACKLOG, type: 'system' },
        { name: DONE, type: 'system' },
      ]);
      const task = BoardTaskEntity.create(makeTaskData({ column: BACKLOG }));
      const nonexistent = new BoardColumn('archive', 'system');

      expect(() => task.moveTo(nonexistent, pipeline)).toThrow(
        'Cannot move to column "archive"',
      );
    });
  });

  describe('toData', () => {
    it('serialises back to a plain BoardTaskData object', () => {
      const data = makeTaskData({ jiraKey: TEST_IDS.issueKey2, assignee: 'bob' });
      const task = BoardTaskEntity.create(data);

      expect(task.toData()).toEqual(data);
    });

    it('serialises title as its string value', () => {
      const task = BoardTaskEntity.create(makeTaskData());

      expect(task.toData().title).toBe(TASK_TITLE);
    });
  });
});
