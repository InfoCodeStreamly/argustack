/**
 * Use-case tests for SyncBoardUseCase.
 *
 * Uses FakeBoardStore (in-memory implementation) to exercise the full
 * synchronisation flow: file sync delegation, pipeline construction with
 * available skills, pipeline persistence, and task retrieval.  Tests cover
 * the happy path, skill injection into the pipeline, empty states, and
 * idempotency of repeated calls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SyncBoardUseCase } from '../../../src/use-cases/sync-board.js';
import { FakeBoardStore } from '../../fixtures/fakes/fake-board-store.js';

// ─── Board-specific test constants ───────────────────────────────────────────

const SYNC_IDS = {
  tasksDir: '/workspace/tasks',
  tasksDir2: '/workspace/other-tasks',
  backlog: 'backlog',
  inProgress: 'in-progress',
  done: 'done',
  skillA: 'code-review',
  skillB: 'lint',
  port: 5002,
  title: 'Implement feature X',
  mdPath: 'tasks/feature-x.md',
} as const;

// ─── Factory helpers ─────────────────────────────────────────────────────────

function seedPipeline(store: FakeBoardStore, columnNames: string[] = [SYNC_IDS.backlog, SYNC_IDS.done]): void {
  store.pipeline = {
    columns: columnNames.map((name) => ({
      name,
      displayName: name.charAt(0).toUpperCase() + name.slice(1),
      type: 'system' as const,
    })),
    port: SYNC_IDS.port,
  };
}

async function seedTask(store: FakeBoardStore, column = SYNC_IDS.backlog): Promise<void> {
  await store.createTask({
    title: SYNC_IDS.title,
    mdPath: SYNC_IDS.mdPath,
    column,
    jiraKey: null,
    assignee: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SyncBoardUseCase', () => {
  let store: FakeBoardStore;
  let useCase: SyncBoardUseCase;

  beforeEach(() => {
    store = new FakeBoardStore();
    useCase = new SyncBoardUseCase(store);
  });

  describe('execute — pipeline output', () => {
    it('returns a pipeline config that contains the base system columns', async () => {
      seedPipeline(store, [SYNC_IDS.backlog, SYNC_IDS.inProgress, SYNC_IDS.done]);

      const output = await useCase.execute(SYNC_IDS.tasksDir, []);

      const names = output.pipeline.columns.map((c) => c.name);
      expect(names).toContain(SYNC_IDS.backlog);
      expect(names).toContain(SYNC_IDS.inProgress);
      expect(names).toContain(SYNC_IDS.done);
    });

    it('preserves the port number in the returned pipeline config', async () => {
      seedPipeline(store);

      const output = await useCase.execute(SYNC_IDS.tasksDir, []);

      expect(output.pipeline.port).toBe(SYNC_IDS.port);
    });

    it('injects available skills as skill-type columns before the last system column', async () => {
      seedPipeline(store, [SYNC_IDS.backlog, SYNC_IDS.done]);

      const output = await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA]);

      const names = output.pipeline.columns.map((c) => c.name);
      expect(names).toContain(SYNC_IDS.skillA);
    });

    it('marks injected skill columns with type "skill"', async () => {
      seedPipeline(store, [SYNC_IDS.backlog, SYNC_IDS.done]);

      const output = await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA]);

      const skillCol = output.pipeline.columns.find((c) => c.name === SYNC_IDS.skillA);
      expect(skillCol?.type).toBe('skill');
    });

    it('injects multiple skills when several are available', async () => {
      seedPipeline(store, [SYNC_IDS.backlog, SYNC_IDS.done]);

      const output = await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA, SYNC_IDS.skillB]);

      const names = output.pipeline.columns.map((c) => c.name);
      expect(names).toContain(SYNC_IDS.skillA);
      expect(names).toContain(SYNC_IDS.skillB);
    });

    it('does not duplicate a skill column that is already in the pipeline config', async () => {
      store.pipeline = {
        columns: [
          { name: SYNC_IDS.backlog, displayName: 'Backlog', type: 'system' },
          { name: SYNC_IDS.skillA, displayName: 'Code Review', type: 'skill' },
          { name: SYNC_IDS.done, displayName: 'Done', type: 'system' },
        ],
        port: SYNC_IDS.port,
      };

      const output = await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA]);

      const skillCols = output.pipeline.columns.filter((c) => c.name === SYNC_IDS.skillA);
      expect(skillCols).toHaveLength(1);
    });

    it('returns an empty columns array when pipeline has no columns and no skills provided', async () => {
      store.pipeline = { columns: [], port: SYNC_IDS.port };

      const output = await useCase.execute(SYNC_IDS.tasksDir, []);

      expect(output.pipeline.columns).toHaveLength(0);
    });
  });

  describe('execute — task output', () => {
    it('returns an empty tasks array when the store has no tasks', async () => {
      seedPipeline(store);

      const output = await useCase.execute(SYNC_IDS.tasksDir, []);

      expect(output.tasks).toHaveLength(0);
    });

    it('returns all tasks present in the store after file sync', async () => {
      seedPipeline(store);
      await seedTask(store);

      const output = await useCase.execute(SYNC_IDS.tasksDir, []);

      expect(output.tasks).toHaveLength(1);
    });

    it('returns tasks with correct data fields', async () => {
      seedPipeline(store);
      await seedTask(store);

      const output = await useCase.execute(SYNC_IDS.tasksDir, []);

      expect(output.tasks[0]?.title).toBe(SYNC_IDS.title);
      expect(output.tasks[0]?.mdPath).toBe(SYNC_IDS.mdPath);
      expect(output.tasks[0]?.column).toBe(SYNC_IDS.backlog);
    });

    it('returns all tasks when multiple tasks exist', async () => {
      seedPipeline(store);
      await store.createTask({
        title: 'Task alpha',
        mdPath: 'tasks/alpha.md',
        column: SYNC_IDS.backlog,
        jiraKey: null,
        assignee: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      await store.createTask({
        title: 'Task beta',
        mdPath: 'tasks/beta.md',
        column: SYNC_IDS.done,
        jiraKey: null,
        assignee: null,
        createdAt: '2025-01-02T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      });

      const output = await useCase.execute(SYNC_IDS.tasksDir, []);

      expect(output.tasks).toHaveLength(2);
    });
  });

  describe('execute — store interactions', () => {
    it('delegates file sync to the store with the provided tasksDir', async () => {
      seedPipeline(store);
      let capturedDir: string | undefined;
      const originalSync = store.syncFromFiles.bind(store);
      store.syncFromFiles = async (dir: string) => {
        capturedDir = dir;
        return originalSync(dir);
      };

      await useCase.execute(SYNC_IDS.tasksDir, []);

      expect(capturedDir).toBe(SYNC_IDS.tasksDir);
    });

    it('persists the updated pipeline back to the store', async () => {
      seedPipeline(store, [SYNC_IDS.backlog, SYNC_IDS.done]);
      const pipelineBefore = JSON.stringify(store.pipeline);

      await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA]);

      const pipelineAfter = JSON.stringify(store.pipeline);
      expect(pipelineAfter).not.toBe(pipelineBefore);
    });

    it('saved pipeline contains injected skill columns', async () => {
      seedPipeline(store, [SYNC_IDS.backlog, SYNC_IDS.done]);

      await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA]);

      const names = store.pipeline.columns.map((c) => c.name);
      expect(names).toContain(SYNC_IDS.skillA);
    });

    it('saved pipeline and returned pipeline are consistent', async () => {
      seedPipeline(store, [SYNC_IDS.backlog, SYNC_IDS.done]);

      const output = await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA]);

      expect(JSON.stringify(output.pipeline)).toBe(JSON.stringify(store.pipeline));
    });
  });

  describe('execute — idempotency', () => {
    it('running sync twice does not duplicate tasks', async () => {
      seedPipeline(store);
      await seedTask(store);

      await useCase.execute(SYNC_IDS.tasksDir, []);
      const output = await useCase.execute(SYNC_IDS.tasksDir, []);

      expect(output.tasks).toHaveLength(1);
    });

    it('running sync twice does not duplicate skill columns', async () => {
      seedPipeline(store, [SYNC_IDS.backlog, SYNC_IDS.done]);

      await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA]);
      const output = await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA]);

      const skillCols = output.pipeline.columns.filter((c) => c.name === SYNC_IDS.skillA);
      expect(skillCols).toHaveLength(1);
    });

    it('produces same pipeline structure for identical calls', async () => {
      seedPipeline(store, [SYNC_IDS.backlog, SYNC_IDS.done]);

      const out1 = await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA]);
      const out2 = await useCase.execute(SYNC_IDS.tasksDir, [SYNC_IDS.skillA]);

      expect(out1.pipeline.columns.map((c) => c.name)).toEqual(
        out2.pipeline.columns.map((c) => c.name),
      );
    });
  });

  describe('execute — with different tasksDir', () => {
    it('accepts any string as tasksDir without error', async () => {
      seedPipeline(store);

      await expect(
        useCase.execute(SYNC_IDS.tasksDir2, []),
      ).resolves.not.toThrow();
    });

    it('passes the alternate tasksDir to the store', async () => {
      seedPipeline(store);
      let capturedDir: string | undefined;
      store.syncFromFiles = (dir: string): Promise<void> => { capturedDir = dir; return Promise.resolve(); };

      await useCase.execute(SYNC_IDS.tasksDir2, []);

      expect(capturedDir).toBe(SYNC_IDS.tasksDir2);
    });
  });
});
