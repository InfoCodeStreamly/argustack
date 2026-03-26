/**
 * Tests for SqlJsBoardStore.
 *
 * The SQLite engine (sql.js) and filesystem calls are mocked so tests
 * run without native binaries or disk I/O. An in-memory mock database
 * tracks all SQL statements and supports simple query simulation,
 * allowing thorough coverage of createTask, updateTask, deleteTask,
 * getAllTasks, getTasksByColumn, syncFromFiles, loadPipeline, and
 * savePipeline.
 */

import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineConfig } from '../../../../src/core/board/pipeline.value-object.js';

const { mockDbRun, mockDbExec, mockDbClose } = vi.hoisted(() => ({
  mockDbRun: vi.fn(),
  mockDbExec: vi.fn(),
  mockDbClose: vi.fn(),
}));

vi.mock('sql.js', () => {
  class MockDatabase {
    run = mockDbRun;
    exec = mockDbExec;
    close = mockDbClose;
  }

  const mockSqlJs = vi.fn().mockResolvedValue({ Database: MockDatabase });

  return { default: mockSqlJs };
});

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'generated-uuid-001'),
}));

vi.mock('../../../../src/adapters/board/md-parser.js', () => ({
  parseMdFile: vi.fn(),
}));

import { existsSync, readdirSync } from 'node:fs';
import { parseMdFile } from '../../../../src/adapters/board/md-parser.js';
import { SqlJsBoardStore } from '../../../../src/adapters/board/store.js';

const WORKSPACE_DIR = '/workspace/test-project';

function buildExecRows(
  columns: string[],
  rows: unknown[][],
): { columns: string[]; values: unknown[][] }[] {
  if (rows.length === 0) {return [];}
  return [{ columns, values: rows }];
}

const TASK_COLUMNS = [
  'id', 'title', 'md_path', 'column_name',
  'jira_key', 'assignee', 'created_at', 'updated_at',
];

function taskRow(
  id: string,
  title: string,
  mdPath: string,
  column: string,
  jiraKey: string | null,
  assignee: string | null,
  createdAt: string,
  updatedAt: string,
): unknown[] {
  return [id, title, mdPath, column, jiraKey, assignee, createdAt, updatedAt];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbRun.mockReturnValue(undefined);
  mockDbExec.mockReturnValue([]);
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readdirSync).mockReturnValue([]);
});

describe('SqlJsBoardStore', () => {
  describe('constructor', () => {
    it('creates an instance without throwing', () => {
      expect(() => new SqlJsBoardStore(WORKSPACE_DIR)).not.toThrow();
    });
  });

  describe('initialize', () => {
    it('calls sql.js init function and creates both tables', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      const runCalls = mockDbRun.mock.calls.map((c) => c[0] as string);
      expect(runCalls.some((sql) => sql.includes('board_tasks'))).toBe(true);
      expect(runCalls.some((sql) => sql.includes('board_pipeline'))).toBe(true);
    });

    it('makes the store ready for subsequent operations', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      mockDbExec.mockReturnValue([]);
      await expect(store.getAllTasks()).resolves.toEqual([]);
    });
  });

  describe('getDb guard', () => {
    it('throws when getAllTasks is called before initialize', () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);

      expect(() => store.getAllTasks()).toThrow('BoardStore not initialized');
    });

    it('throws when createTask is called before initialize', () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);

      expect(() =>
        store.createTask({
          title: 'Uninitialized',
          mdPath: 'tasks/task.md',
          column: 'backlog',
          jiraKey: null,
          assignee: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ).toThrow('BoardStore not initialized');
    });
  });

  describe('getAllTasks', () => {
    it('returns empty array when no rows exist', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      mockDbExec.mockReturnValue([]);

      const result = await store.getAllTasks();
      expect(result).toEqual([]);
    });

    it('returns mapped tasks from exec result', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      mockDbExec.mockReturnValue(
        buildExecRows(TASK_COLUMNS, [
          taskRow(
            'uuid-1', 'Task Alpha', 'tasks/Backlog/alpha.md',
            'backlog', TEST_IDS.issueKey, 'alice',
            '2025-01-10T08:00:00.000Z', '2025-01-11T09:00:00.000Z',
          ),
        ]),
      );

      const result = await store.getAllTasks();

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('uuid-1');
      expect(result[0]?.title).toBe('Task Alpha');
      expect(result[0]?.column).toBe('backlog');
      expect(result[0]?.jiraKey).toBe(TEST_IDS.issueKey);
      expect(result[0]?.assignee).toBe('alice');
    });

    it('returns multiple tasks in exec order', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      mockDbExec.mockReturnValue(
        buildExecRows(TASK_COLUMNS, [
          taskRow('id-a', 'First', 'tasks/a.md', 'backlog', null, null, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
          taskRow('id-b', 'Second', 'tasks/b.md', 'done', null, null, '2025-01-02T00:00:00.000Z', '2025-01-02T00:00:00.000Z'),
        ]),
      );

      const result = await store.getAllTasks();

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('id-a');
      expect(result[1]?.id).toBe('id-b');
    });
  });

  describe('getTasksByColumn', () => {
    it('inserts column value via temp table and queries tasks', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      mockDbExec.mockReturnValue(
        buildExecRows(TASK_COLUMNS, [
          taskRow('uuid-2', 'Done task', 'tasks/Done/done.md', 'done', null, null, '2025-01-05T00:00:00.000Z', '2025-01-06T00:00:00.000Z'),
        ]),
      );

      const result = await store.getTasksByColumn('done');

      expect(result).toHaveLength(1);
      expect(result[0]?.column).toBe('done');

      const runCalls = mockDbRun.mock.calls.map((c) => c[0] as string);
      expect(runCalls.some((sql) => sql.includes('INSERT INTO _param'))).toBe(true);
    });

    it('returns empty array when no tasks match the column', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      mockDbExec.mockReturnValue([]);

      const result = await store.getTasksByColumn('nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('createTask', () => {
    it('inserts task and returns it with generated id', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      const newTask = {
        title: 'New feature task',
        mdPath: 'tasks/Backlog/feature.md',
        column: 'backlog',
        jiraKey: TEST_IDS.issueKey2,
        assignee: 'bob',
        createdAt: '2025-02-01T10:00:00.000Z',
        updatedAt: '2025-02-01T10:00:00.000Z',
      };

      const result = await store.createTask(newTask);

      expect(result.id).toBe('generated-uuid-001');
      expect(result.title).toBe('New feature task');
      expect(result.column).toBe('backlog');
      expect(result.jiraKey).toBe(TEST_IDS.issueKey2);
    });

    it('calls db.run with INSERT statement and correct params', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      const createdAt = '2025-03-01T10:00:00.000Z';
      await store.createTask({
        title: 'Test insert',
        mdPath: 'tasks/t.md',
        column: 'backlog',
        jiraKey: null,
        assignee: null,
        createdAt,
        updatedAt: createdAt,
      });

      const insertCall = mockDbRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0]).includes('INSERT INTO board_tasks'),
      );
      expect(insertCall).toBeDefined();
      const params = insertCall?.[1] as unknown[];
      expect(params).toContain('generated-uuid-001');
      expect(params).toContain('Test insert');
    });

    it('returns task with all provided fields intact', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      const task = await store.createTask({
        title: 'Full task',
        mdPath: 'tasks/full.md',
        column: 'review',
        jiraKey: TEST_IDS.issueKey,
        assignee: 'charlie',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      expect(task.mdPath).toBe('tasks/full.md');
      expect(task.assignee).toBe('charlie');
    });
  });

  describe('updateTask', () => {
    it('builds SET clause for all provided fields', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      await store.updateTask('uuid-100', {
        title: 'Updated title',
        column: 'done',
      });

      const updateCall = mockDbRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0]).includes('UPDATE board_tasks'),
      );
      expect(updateCall).toBeDefined();
      const sql = updateCall?.[0] as string;
      expect(sql).toContain('title = ?');
      expect(sql).toContain('column_name = ?');
      expect(sql).toContain('updated_at = ?');
    });

    it('always appends updated_at even when no other fields given', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      await store.updateTask('uuid-200', {});

      const updateCall = mockDbRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0]).includes('UPDATE board_tasks'),
      );
      const sql = updateCall?.[0] as string;
      expect(sql).toContain('updated_at = ?');
    });

    it('includes jira_key in SET when jiraKey is provided', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      await store.updateTask('uuid-300', { jiraKey: TEST_IDS.issueKey2 });

      const updateCall = mockDbRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0]).includes('UPDATE board_tasks'),
      );
      const sql = updateCall?.[0] as string;
      expect(sql).toContain('jira_key = ?');
    });

    it('includes assignee in SET when assignee is provided', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      await store.updateTask('uuid-400', { assignee: 'dave' });

      const updateCall = mockDbRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0]).includes('UPDATE board_tasks'),
      );
      const sql = updateCall?.[0] as string;
      expect(sql).toContain('assignee = ?');
    });

    it('passes the task id as the final parameter in WHERE clause', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      await store.updateTask('target-id-xyz', { title: 'Changed' });

      const updateCall = mockDbRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0]).includes('UPDATE board_tasks'),
      );
      const params = updateCall?.[1] as unknown[];
      expect(params[params.length - 1]).toBe('target-id-xyz');
    });
  });

  describe('deleteTask', () => {
    it('calls db.run with DELETE statement and correct id', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      await store.deleteTask('delete-me-id');

      const deleteCall = mockDbRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0]).includes('DELETE FROM board_tasks'),
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall?.[1]).toEqual(['delete-me-id']);
    });
  });

  describe('syncFromFiles', () => {
    it('skips folder when directory does not exist', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      vi.mocked(existsSync).mockReturnValue(false);

      await store.syncFromFiles('/workspace/tasks');

      const insertCalls = mockDbRun.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0]).includes('INSERT INTO board_tasks'),
      );
      expect(insertCalls).toHaveLength(0);
    });

    it('creates tasks for new markdown files in Backlog folder', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('/Backlog'),
      );
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (String(dir).endsWith('/Backlog')) {return ['feature.md'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      mockDbExec.mockReturnValue([]);

      vi.mocked(parseMdFile).mockReturnValue({
        title: 'New feature',
        frontmatter: {},
        body: '# New feature\n',
      });

      await store.syncFromFiles('/workspace/tasks');

      const insertCalls = mockDbRun.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0]).includes('INSERT INTO board_tasks'),
      );
      expect(insertCalls).toHaveLength(1);
    });

    it('uses column from frontmatter when present', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('/Backlog'),
      );
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (String(dir).endsWith('/Backlog')) {return ['custom-col.md'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      mockDbExec.mockReturnValue([]);

      vi.mocked(parseMdFile).mockReturnValue({
        title: 'Custom column task',
        frontmatter: { column: 'in-progress' },
        body: '# Custom column task\n',
      });

      await store.syncFromFiles('/workspace/tasks');

      const insertCall = mockDbRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0]).includes('INSERT INTO board_tasks'),
      );
      const params = insertCall?.[1] as unknown[];
      expect(params).toContain('in-progress');
    });

    it('skips markdown files that are already in the store', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('/Backlog'),
      );
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (String(dir).endsWith('/Backlog')) {return ['existing.md'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      mockDbExec.mockReturnValue(
        buildExecRows(TASK_COLUMNS, [
          taskRow('existing-id', 'Existing', 'tasks/Backlog/existing.md', 'backlog', null, null, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
        ]),
      );

      await store.syncFromFiles('/workspace/tasks');

      const insertCalls = mockDbRun.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0]).includes('INSERT INTO board_tasks'),
      );
      expect(insertCalls).toHaveLength(0);
    });

    it('assigns done column to files in the Done folder', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('/Done'),
      );
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (String(dir).endsWith('/Done')) {return ['done-task.md'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      mockDbExec.mockReturnValue([]);

      vi.mocked(parseMdFile).mockReturnValue({
        title: 'Done task',
        frontmatter: {},
        body: '# Done task\n',
      });

      await store.syncFromFiles('/workspace/tasks');

      const insertCall = mockDbRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0]).includes('INSERT INTO board_tasks'),
      );
      const params = insertCall?.[1] as unknown[];
      expect(params).toContain('done');
    });

    it('continues processing other files when one folder throws on readdir', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      await expect(store.syncFromFiles('/workspace/tasks')).resolves.toBeUndefined();
    });
  });

  describe('loadPipeline', () => {
    it('returns stored pipeline config when one exists', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      const config: PipelineConfig = {
        columns: [
          { name: 'backlog', displayName: 'Backlog', type: 'system' },
          { name: 'code-review', displayName: 'Code Review', type: 'skill' },
          { name: 'done', displayName: 'Done', type: 'system' },
        ],
        port: 5002,
      };

      mockDbExec.mockReturnValue([
        { columns: ['config_json'], values: [[JSON.stringify(config)]] },
      ]);

      const result = await store.loadPipeline();

      expect(result.columns).toHaveLength(3);
      expect(result.port).toBe(5002);
      expect(result.columns[0]?.name).toBe('backlog');
      expect(result.columns[1]?.name).toBe('code-review');
    });

    it('returns default pipeline config when table is empty', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      mockDbExec.mockReturnValue([]);

      const result = await store.loadPipeline();

      expect(result.columns).toHaveLength(2);
      expect(result.columns[0]?.name).toBe('backlog');
      expect(result.columns[1]?.name).toBe('done');
      expect(result.port).toBe(5002);
    });

    it('default config columns have system type', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      mockDbExec.mockReturnValue([]);

      const result = await store.loadPipeline();

      expect(result.columns.every((c) => c.type === 'system')).toBe(true);
    });
  });

  describe('savePipeline', () => {
    it('calls INSERT OR REPLACE with serialized JSON', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      const config: PipelineConfig = {
        columns: [
          { name: 'backlog', displayName: 'Backlog', type: 'system' },
          { name: 'done', displayName: 'Done', type: 'system' },
        ],
        port: 5003,
      };

      await store.savePipeline(config);

      const saveCall = mockDbRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0]).includes('INSERT OR REPLACE INTO board_pipeline'),
      );
      expect(saveCall).toBeDefined();
      const params = saveCall?.[1] as unknown[];
      const saved = JSON.parse(params[0] as string) as PipelineConfig;
      expect(saved.port).toBe(5003);
      expect(saved.columns).toHaveLength(2);
    });
  });

  describe('close', () => {
    it('calls db.close and nullifies the internal db reference', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();

      await store.close();

      expect(mockDbClose).toHaveBeenCalledOnce();
    });

    it('makes subsequent calls throw because db is null', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await store.initialize();
      await store.close();

      expect(() => store.getAllTasks()).toThrow('BoardStore not initialized');
    });

    it('does not throw when called on an uninitialized store', async () => {
      const store = new SqlJsBoardStore(WORKSPACE_DIR);
      await expect(store.close()).resolves.toBeUndefined();
    });
  });
});
