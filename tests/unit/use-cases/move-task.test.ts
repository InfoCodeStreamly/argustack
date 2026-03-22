import { TEST_IDS } from '../../fixtures/shared/test-constants.js';
/**
 * Use-case tests for MoveTaskUseCase.
 *
 * Uses FakeBoardStore and FakeSkillRunner (in-memory implementations) to
 * exercise the full orchestration path without hitting real storage or a
 * real skill runner.  Tests cover: happy-path move, skill-column trigger,
 * skill runner unavailability, streaming output callback, and all error
 * branches (task not found, column not found, column not in pipeline).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MoveTaskUseCase } from '../../../src/use-cases/move-task.js';
import { FakeBoardStore } from '../../fixtures/fakes/fake-board-store.js';
import { FakeSkillRunner } from '../../fixtures/fakes/fake-skill-runner.js';

// ─── Board-specific test constants ───────────────────────────────────────────

const BOARD_IDS = {
  taskId: 'task-001',
  taskId2: 'task-002',
  backlog: 'backlog',
  inProgress: 'in-progress',
  done: 'done',
  skillCol: 'code-review',
  unknownCol: 'non-existent',
  mdPath: 'tasks/task-001.md',
  mdPath2: 'tasks/task-002.md',
  title: 'Implement feature A',
  title2: 'Fix regression B',
} as const;

// ─── Factory helpers ─────────────────────────────────────────────────────────

function seedStandardPipeline(store: FakeBoardStore): void {
  store.pipeline = {
    columns: [
      { name: BOARD_IDS.backlog, displayName: 'Backlog', type: 'system' },
      { name: BOARD_IDS.inProgress, displayName: 'In Progress', type: 'system' },
      { name: BOARD_IDS.done, displayName: 'Done', type: 'system' },
    ],
    port: 5002,
  };
}

function seedSkillPipeline(store: FakeBoardStore): void {
  store.pipeline = {
    columns: [
      { name: BOARD_IDS.backlog, displayName: 'Backlog', type: 'system' },
      { name: BOARD_IDS.skillCol, displayName: 'Code Review', type: 'skill' },
      { name: BOARD_IDS.done, displayName: 'Done', type: 'system' },
    ],
    port: 5002,
  };
}

async function seedTask(store: FakeBoardStore, overrides?: Partial<{
  id: string;
  title: string;
  mdPath: string;
  column: string;
  jiraKey: string | null;
  assignee: string | null;
}>) {
  const created = await store.createTask({
    title: overrides?.title ?? BOARD_IDS.title,
    mdPath: overrides?.mdPath ?? BOARD_IDS.mdPath,
    column: overrides?.column ?? BOARD_IDS.backlog,
    jiraKey: overrides?.jiraKey ?? null,
    assignee: overrides?.assignee ?? null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  });

  if (overrides?.id && overrides.id !== created.id) {
    const task = store.tasks.find((t) => t.id === created.id);
    if (task) {
      task.id = overrides.id;
    }
  }

  const found = store.tasks.find((t) => t.title === (overrides?.title ?? BOARD_IDS.title));
  if (!found) { throw new Error('Task not found after creation'); }
  return found;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MoveTaskUseCase', () => {
  let store: FakeBoardStore;
  let skillRunner: FakeSkillRunner;
  let useCase: MoveTaskUseCase;

  beforeEach(() => {
    store = new FakeBoardStore();
    skillRunner = new FakeSkillRunner();
    useCase = new MoveTaskUseCase(store, skillRunner);
  });

  describe('execute — happy path', () => {
    it('moves a task to a valid system column and returns updated task data', async () => {
      seedStandardPipeline(store);
      const task = await seedTask(store);

      const output = await useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.inProgress });

      expect(output.task.column).toBe(BOARD_IDS.inProgress);
      expect(output.task.id).toBe(task.id);
      expect(output.task.title).toBe(BOARD_IDS.title);
    });

    it('persists the column change in the store', async () => {
      seedStandardPipeline(store);
      const task = await seedTask(store);

      await useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.inProgress });

      const stored = store.tasks.find((t) => t.id === task.id);
      expect(stored?.column).toBe(BOARD_IDS.inProgress);
    });

    it('returns skillTriggered: false when target is a system column', async () => {
      seedStandardPipeline(store);
      const task = await seedTask(store);

      const output = await useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.done });

      expect(output.skillTriggered).toBe(false);
    });

    it('moves a task from in-progress back to backlog', async () => {
      seedStandardPipeline(store);
      const task = await seedTask(store, { column: BOARD_IDS.inProgress });

      const output = await useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.backlog });

      expect(output.task.column).toBe(BOARD_IDS.backlog);
    });

    it('preserves mdPath, jiraKey, and assignee on the returned task', async () => {
      seedStandardPipeline(store);
      const task = await seedTask(store, { jiraKey: TEST_IDS.issueKey, assignee: 'alice' });

      const output = await useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.inProgress });

      expect(output.task.mdPath).toBe(BOARD_IDS.mdPath);
      expect(output.task.jiraKey).toBe(TEST_IDS.issueKey);
      expect(output.task.assignee).toBe('alice');
    });

    it('updates the updatedAt timestamp on the returned task', async () => {
      seedStandardPipeline(store);
      const task = await seedTask(store);
      const before = task.updatedAt;

      const output = await useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.done });

      expect(output.task.updatedAt).not.toBe(before);
    });
  });

  describe('execute — skill column', () => {
    it('triggers skill runner when target column is of type skill', async () => {
      seedSkillPipeline(store);
      const task = await seedTask(store);

      const output = await useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.skillCol });

      expect(output.skillTriggered).toBe(true);
    });

    it('executes the skill with the task mdPath as argument', async () => {
      seedSkillPipeline(store);
      const task = await seedTask(store);

      await useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.skillCol });

      expect(skillRunner.executedSkills).toHaveLength(1);
      expect(skillRunner.executedSkills[0]?.name).toBe(BOARD_IDS.skillCol);
      expect(skillRunner.executedSkills[0]?.args).toContain(BOARD_IDS.mdPath);
    });

    it('streams skill output via onSkillOutput callback', async () => {
      seedSkillPipeline(store);
      const task = await seedTask(store);
      skillRunner.setOutput('review complete');

      const chunks: string[] = [];
      await useCase.execute(
        { taskId: task.id, targetColumn: BOARD_IDS.skillCol },
        (chunk) => { chunks.push(chunk); },
      );

      expect(chunks).toContain('review complete');
    });

    it('returns skillTriggered: false when skill runner is unavailable', async () => {
      seedSkillPipeline(store);
      skillRunner.setAvailable(false);
      const task = await seedTask(store);

      const output = await useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.skillCol });

      expect(output.skillTriggered).toBe(false);
      expect(skillRunner.executedSkills).toHaveLength(0);
    });

    it('does not invoke onSkillOutput when runner is unavailable', async () => {
      seedSkillPipeline(store);
      skillRunner.setAvailable(false);
      const task = await seedTask(store);

      const chunks: string[] = [];
      await useCase.execute(
        { taskId: task.id, targetColumn: BOARD_IDS.skillCol },
        (chunk) => { chunks.push(chunk); },
      );

      expect(chunks).toHaveLength(0);
    });

    it('still persists the column change even when skill runner is unavailable', async () => {
      seedSkillPipeline(store);
      skillRunner.setAvailable(false);
      const task = await seedTask(store);

      await useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.skillCol });

      const stored = store.tasks.find((t) => t.id === task.id);
      expect(stored?.column).toBe(BOARD_IDS.skillCol);
    });

    it('works without an onSkillOutput callback on a skill column', async () => {
      seedSkillPipeline(store);
      const task = await seedTask(store);

      await expect(
        useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.skillCol }),
      ).resolves.not.toThrow();
    });
  });

  describe('execute — error handling', () => {
    it('throws when taskId does not exist in the store', async () => {
      seedStandardPipeline(store);

      await expect(
        useCase.execute({ taskId: 'non-existent-id', targetColumn: BOARD_IDS.inProgress }),
      ).rejects.toThrow('Task not found: non-existent-id');
    });

    it('throws when targetColumn does not exist in the pipeline', async () => {
      seedStandardPipeline(store);
      const task = await seedTask(store);

      await expect(
        useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.unknownCol }),
      ).rejects.toThrow(`Column not found: ${BOARD_IDS.unknownCol}`);
    });

    it('error message for missing task includes the provided taskId', async () => {
      seedStandardPipeline(store);
      const missingId = 'missing-task-xyz';

      await expect(
        useCase.execute({ taskId: missingId, targetColumn: BOARD_IDS.backlog }),
      ).rejects.toThrow(missingId);
    });

    it('error message for missing column includes the provided column name', async () => {
      seedStandardPipeline(store);
      const task = await seedTask(store);

      await expect(
        useCase.execute({ taskId: task.id, targetColumn: BOARD_IDS.unknownCol }),
      ).rejects.toThrow(BOARD_IDS.unknownCol);
    });
  });

  describe('execute — multiple tasks', () => {
    it('moves only the requested task, leaving others unchanged', async () => {
      seedStandardPipeline(store);
      const task1 = await seedTask(store, { title: BOARD_IDS.title });
      const task2 = await seedTask(store, { title: BOARD_IDS.title2, mdPath: BOARD_IDS.mdPath2 });

      await useCase.execute({ taskId: task1.id, targetColumn: BOARD_IDS.inProgress });

      const stored2 = store.tasks.find((t) => t.id === task2.id);
      expect(stored2?.column).toBe(BOARD_IDS.backlog);
    });

    it('can move both tasks independently to different columns', async () => {
      seedStandardPipeline(store);
      const task1 = await seedTask(store, { title: BOARD_IDS.title });
      const task2 = await seedTask(store, { title: BOARD_IDS.title2, mdPath: BOARD_IDS.mdPath2 });

      const out1 = await useCase.execute({ taskId: task1.id, targetColumn: BOARD_IDS.inProgress });
      const out2 = await useCase.execute({ taskId: task2.id, targetColumn: BOARD_IDS.done });

      expect(out1.task.column).toBe(BOARD_IDS.inProgress);
      expect(out2.task.column).toBe(BOARD_IDS.done);
    });
  });
});
