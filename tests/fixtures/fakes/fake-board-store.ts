import type { IBoardStore } from '../../../src/core/ports/board-store.js';
import type { BoardTaskData } from '../../../src/core/types/board.js';
import type { PipelineConfig } from '../../../src/core/board/pipeline.value-object.js';
import { randomUUID } from 'node:crypto';

export class FakeBoardStore implements IBoardStore {
  readonly tasks: BoardTaskData[] = [];
  pipeline: PipelineConfig = {
    columns: [
      { name: 'backlog', displayName: 'Backlog', type: 'system' },
      { name: 'done', displayName: 'Done', type: 'system' },
    ],
    port: 5002,
  };

  async initialize(): Promise<void> {
    return Promise.resolve();
  }

  async getAllTasks(): Promise<BoardTaskData[]> {
    return Promise.resolve([...this.tasks]);
  }

  async getTasksByColumn(column: string): Promise<BoardTaskData[]> {
    return Promise.resolve(this.tasks.filter((t) => t.column === column));
  }

  async createTask(task: Omit<BoardTaskData, 'id'>): Promise<BoardTaskData> {
    const created = { id: randomUUID(), ...task };
    this.tasks.push(created);
    return Promise.resolve(created);
  }

  async updateTask(id: string, fields: Partial<BoardTaskData>): Promise<void> {
    const task = this.tasks.find((t) => t.id === id);
    if (task !== undefined) {
      Object.assign(task, fields, { updatedAt: new Date().toISOString() });
    }
    return Promise.resolve();
  }

  async deleteTask(id: string): Promise<void> {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx >= 0) { this.tasks.splice(idx, 1); }
    return Promise.resolve();
  }

  async syncFromFiles(_tasksDir: string): Promise<void> {
    return Promise.resolve();
  }

  async loadPipeline(): Promise<PipelineConfig> {
    return Promise.resolve(this.pipeline);
  }

  async savePipeline(config: PipelineConfig): Promise<void> {
    this.pipeline = config;
    return Promise.resolve();
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}
