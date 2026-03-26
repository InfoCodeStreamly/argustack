import { TaskTitle } from './task-title.value-object.js';
import { BoardColumn } from './board-column.value-object.js';
import type { Pipeline } from './pipeline.value-object.js';
import type { BoardTaskData } from '../types/board.js';

export class BoardTaskEntity {
  readonly id: string;
  readonly title: TaskTitle;
  readonly mdPath: string;
  readonly column: string;
  readonly jiraKey: string | null;
  readonly assignee: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;

  private constructor(data: BoardTaskData) {
    this.id = data.id;
    this.title = new TaskTitle(data.title);
    this.mdPath = data.mdPath;
    this.column = data.column;
    this.jiraKey = data.jiraKey ?? null;
    this.assignee = data.assignee ?? null;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static create(data: BoardTaskData): BoardTaskEntity {
    return new BoardTaskEntity(data);
  }

  moveTo(targetColumn: BoardColumn, pipeline: Pipeline): BoardTaskEntity {
    if (!pipeline.canMoveTo(
      new BoardColumn(this.column, 'skill'),
      targetColumn,
    )) {
      throw new Error(`Cannot move to column "${targetColumn.name}"`);
    }

    return new BoardTaskEntity({
      ...this.toData(),
      column: targetColumn.name,
      updatedAt: new Date().toISOString(),
    });
  }

  get currentColumn(): string {
    return this.column;
  }

  toData(): BoardTaskData {
    return {
      id: this.id,
      title: this.title.toString(),
      mdPath: this.mdPath,
      column: this.column,
      jiraKey: this.jiraKey,
      assignee: this.assignee,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
