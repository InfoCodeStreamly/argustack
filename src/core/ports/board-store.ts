import type { BoardTaskData } from '../types/board.js';
import type { PipelineConfig } from '../board/pipeline.value-object.js';

export interface IBoardStore {
  initialize(): Promise<void>;
  getAllTasks(): Promise<BoardTaskData[]>;
  getTasksByColumn(column: string): Promise<BoardTaskData[]>;
  createTask(task: Omit<BoardTaskData, 'id'>): Promise<BoardTaskData>;
  updateTask(id: string, fields: Partial<BoardTaskData>): Promise<void>;
  deleteTask(id: string): Promise<void>;
  syncFromFiles(tasksDir: string): Promise<void>;
  loadPipeline(): Promise<PipelineConfig>;
  savePipeline(config: PipelineConfig): Promise<void>;
  close(): Promise<void>;
}
