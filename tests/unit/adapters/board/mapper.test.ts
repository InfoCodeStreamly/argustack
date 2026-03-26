import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';
/**
 * Tests for the board mapper module.
 *
 * Verifies bidirectional conversion between SQLite row format
 * (snake_case, flat columns) and the BoardTaskData domain type
 * (camelCase). Pure unit tests — no external dependencies.
 */

import { describe, it, expect } from 'vitest';
import {
  rowToTaskData,
  taskDataToRow,
  type SqliteTaskRow,
} from '../../../../src/adapters/board/mapper.js';
import type { BoardTaskData } from '../../../../src/core/types/board.js';

const TASK_ID = 'task-uuid-001';
const TASK_TITLE = 'Implement authentication';
const TASK_MD_PATH = 'tasks/Backlog/auth.md';
const TASK_COLUMN = 'backlog';
const TASK_JIRA_KEY = TEST_IDS.issueKey;
const TASK_ASSIGNEE = 'alice';
const TASK_CREATED_AT = '2025-01-15T10:00:00.000Z';
const TASK_UPDATED_AT = '2025-01-16T12:00:00.000Z';

function createRow(overrides?: Partial<SqliteTaskRow>): SqliteTaskRow {
  return {
    id: TASK_ID,
    title: TASK_TITLE,
    md_path: TASK_MD_PATH,
    column_name: TASK_COLUMN,
    jira_key: TASK_JIRA_KEY,
    assignee: TASK_ASSIGNEE,
    created_at: TASK_CREATED_AT,
    updated_at: TASK_UPDATED_AT,
    ...overrides,
  };
}

function createTaskData(overrides?: Partial<BoardTaskData>): BoardTaskData {
  return {
    id: TASK_ID,
    title: TASK_TITLE,
    mdPath: TASK_MD_PATH,
    column: TASK_COLUMN,
    jiraKey: TASK_JIRA_KEY,
    assignee: TASK_ASSIGNEE,
    createdAt: TASK_CREATED_AT,
    updatedAt: TASK_UPDATED_AT,
    ...overrides,
  };
}

describe('board mapper', () => {
  describe('rowToTaskData', () => {
    it('maps all fields from SQLite row to BoardTaskData', () => {
      const row = createRow();
      const result = rowToTaskData(row);

      expect(result.id).toBe(TASK_ID);
      expect(result.title).toBe(TASK_TITLE);
      expect(result.mdPath).toBe(TASK_MD_PATH);
      expect(result.column).toBe(TASK_COLUMN);
      expect(result.jiraKey).toBe(TASK_JIRA_KEY);
      expect(result.assignee).toBe(TASK_ASSIGNEE);
      expect(result.createdAt).toBe(TASK_CREATED_AT);
      expect(result.updatedAt).toBe(TASK_UPDATED_AT);
    });

    it('maps null jira_key to null jiraKey', () => {
      const row = createRow({ jira_key: null });
      const result = rowToTaskData(row);

      expect(result.jiraKey).toBeNull();
    });

    it('maps null assignee to null assignee', () => {
      const row = createRow({ assignee: null });
      const result = rowToTaskData(row);

      expect(result.assignee).toBeNull();
    });

    it('maps both nullable fields as null simultaneously', () => {
      const row = createRow({ jira_key: null, assignee: null });
      const result = rowToTaskData(row);

      expect(result.jiraKey).toBeNull();
      expect(result.assignee).toBeNull();
    });

    it('preserves exact timestamp strings without modification', () => {
      const isoTimestamp = '2025-03-15T08:30:00.000Z';
      const row = createRow({ created_at: isoTimestamp, updated_at: isoTimestamp });
      const result = rowToTaskData(row);

      expect(result.createdAt).toBe(isoTimestamp);
      expect(result.updatedAt).toBe(isoTimestamp);
    });

    it('maps snake_case column_name to camelCase column', () => {
      const row = createRow({ column_name: 'in-progress' });
      const result = rowToTaskData(row);

      expect(result.column).toBe('in-progress');
    });

    it('maps snake_case md_path to camelCase mdPath', () => {
      const row = createRow({ md_path: 'tasks/ToDo/new-task.md' });
      const result = rowToTaskData(row);

      expect(result.mdPath).toBe('tasks/ToDo/new-task.md');
    });
  });

  describe('taskDataToRow', () => {
    it('maps all fields from BoardTaskData to SQLite row', () => {
      const task = createTaskData();
      const result = taskDataToRow(task);

      expect(result.id).toBe(TASK_ID);
      expect(result.title).toBe(TASK_TITLE);
      expect(result.md_path).toBe(TASK_MD_PATH);
      expect(result.column_name).toBe(TASK_COLUMN);
      expect(result.jira_key).toBe(TASK_JIRA_KEY);
      expect(result.assignee).toBe(TASK_ASSIGNEE);
      expect(result.created_at).toBe(TASK_CREATED_AT);
      expect(result.updated_at).toBe(TASK_UPDATED_AT);
    });

    it('maps null jiraKey to null jira_key', () => {
      const task = createTaskData({ jiraKey: null });
      const result = taskDataToRow(task);

      expect(result.jira_key).toBeNull();
    });

    it('maps null assignee to null assignee', () => {
      const task = createTaskData({ assignee: null });
      const result = taskDataToRow(task);

      expect(result.assignee).toBeNull();
    });

    it('maps camelCase mdPath to snake_case md_path', () => {
      const task = createTaskData({ mdPath: 'tasks/Done/closed.md' });
      const result = taskDataToRow(task);

      expect(result.md_path).toBe('tasks/Done/closed.md');
    });

    it('maps camelCase column to snake_case column_name', () => {
      const task = createTaskData({ column: 'review' });
      const result = taskDataToRow(task);

      expect(result.column_name).toBe('review');
    });
  });

  describe('round-trip conversion', () => {
    it('row → taskData → row preserves all values', () => {
      const original = createRow();
      const taskData = rowToTaskData(original);
      const restored = taskDataToRow(taskData);

      expect(restored).toEqual(original);
    });

    it('taskData → row → taskData preserves all values', () => {
      const original = createTaskData();
      const row = taskDataToRow(original);
      const restored = rowToTaskData(row);

      expect(restored).toEqual(original);
    });

    it('round-trip preserves null nullable fields', () => {
      const original = createRow({ jira_key: null, assignee: null });
      const taskData = rowToTaskData(original);
      const restored = taskDataToRow(taskData);

      expect(restored.jira_key).toBeNull();
      expect(restored.assignee).toBeNull();
    });
  });
});
