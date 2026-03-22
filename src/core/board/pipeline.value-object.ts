import { BoardColumn, type ColumnType } from './board-column.value-object.js';

export interface PipelineColumnConfig {
  name: string;
  displayName: string;
  type: ColumnType;
}

export interface PipelineConfig {
  columns: PipelineColumnConfig[];
  port: number;
}

export class Pipeline {
  private readonly columns: readonly BoardColumn[];

  private constructor(columns: BoardColumn[]) {
    this.columns = Object.freeze(columns);
  }

  static fromConfig(config: PipelineConfig, availableSkills: string[]): Pipeline {
    const columns = config.columns.map((c) => new BoardColumn(c.name, c.type));

    for (const skill of availableSkills) {
      const exists = columns.some((c) => c.name === skill);
      if (!exists) {
        columns.splice(columns.length - 1, 0, new BoardColumn(skill, 'skill'));
      }
    }

    return new Pipeline(columns);
  }

  canMoveTo(_from: BoardColumn, to: BoardColumn): boolean {
    return this.columns.some((c) => c.equals(to));
  }

  getNextColumn(current: BoardColumn): BoardColumn | null {
    const idx = this.columns.findIndex((c) => c.equals(current));
    if (idx === -1 || idx >= this.columns.length - 1) {
      return null;
    }
    return this.columns[idx + 1] ?? null;
  }

  getColumns(): readonly BoardColumn[] {
    return this.columns;
  }

  findColumn(name: string): BoardColumn | null {
    return this.columns.find((c) => c.name === name) ?? null;
  }

  reorder(newOrder: string[]): Pipeline {
    const reordered: BoardColumn[] = [];
    for (const name of newOrder) {
      const col = this.columns.find((c) => c.name === name);
      if (col) {
        reordered.push(col);
      }
    }
    return new Pipeline(reordered);
  }

  toConfig(port: number): PipelineConfig {
    return {
      columns: this.columns.map((c) => ({ name: c.name, displayName: c.displayName, type: c.type })),
      port,
    };
  }
}
