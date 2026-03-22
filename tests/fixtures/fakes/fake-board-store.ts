import type { IBoardStore } from '../../../src/core/ports/board-store.js';
import type { BoardTaskData } from '../../../src/core/types/board.js';
import type { PipelineConfig } from '../../../src/core/board/pipeline.value-object.js';
import { randomUUID } from 'node:crypto';

export class FakeBoardStore implements IBoardStore {
  readonly tasks: BoardTaskData[] = [];
  pipeline: PipelineConfig = {
    columns: [
      { name: 'backlog', type: 'system' },
      { name: 'done', type: 'system' },
    ],
    port: 5002,
  };

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  getAllTasks(): Promise<BoardTaskData[]> {
    return Promise.resolve([...this.tasks]);
  }

  getTasksByColumn(column: string): Promise<BoardTaskData[]> {
    return Promise.resolve(this.tasks.filter((t) => t.column === column));
  }

  createTask(task: Omit<BoardTaskData, 'id'>): Promise<BoardTaskData> {
    const created = { id: randomUUID(), ...task };
    this.tasks.push(created);
    return Promise.resolve(created);
  }

  updateTask(id: string, fields: Partial<BoardTaskData>): Promise<void> {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      Object.assign(task, fields, { updatedAt: new Date().toISOString() });
    }
    return Promise.resolve();
  }

  deleteTask(id: string): Promise<void> {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx >= 0) { this.tasks.splice(idx, 1); }
    return Promise.resolve();
  }

  syncFromFiles(_tasksDir: string): Promise<void> {
    return Promise.resolve();
  }

  loadPipeline(): Promise<PipelineConfig> {
    return Promise.resolve(this.pipeline);
  }

  savePipeline(config: PipelineConfig): Promise<void> {
    this.pipeline = config;
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
