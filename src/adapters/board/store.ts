import type { IBoardStore } from '../../core/ports/board-store.js';
import type { BoardTaskData } from '../../core/types/board.js';
import type { PipelineConfig } from '../../core/board/pipeline.value-object.js';
import { rowToTaskData, type SqliteTaskRow } from './mapper.js';
import { parseMdFile } from './md-parser.js';
import { randomUUID } from 'node:crypto';
import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

interface SqlJsDb {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  close(): void;
}

export class SqlJsBoardStore implements IBoardStore {
  private db: SqlJsDb | null = null;
  private readonly workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  async initialize(): Promise<void> {
    const sqlJsModule = await import('sql.js');
    const initFn = sqlJsModule.default as unknown as () => Promise<{ Database: new () => SqlJsDb }>;
    const SQL = await initFn();
    this.db = new SQL.Database();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS board_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        md_path TEXT NOT NULL UNIQUE,
        column_name TEXT NOT NULL DEFAULT 'backlog',
        jira_key TEXT,
        assignee TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS board_pipeline (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        config_json TEXT NOT NULL
      )
    `);
  }

  private getDb(): SqlJsDb {
    if (!this.db) {
      throw new Error('BoardStore not initialized. Call initialize() first.');
    }
    return this.db;
  }

  private queryAll(sql: string, params?: unknown[]): SqliteTaskRow[] {
    const db = this.getDb();
    if (params?.length) {
      db.run('SELECT 1', []);
    }
    const result = db.exec(sql);
    if (!result[0]) {
      return [];
    }
    const { columns, values } = result[0];
    return values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj as unknown as SqliteTaskRow;
    });
  }

  getAllTasks(): Promise<BoardTaskData[]> {
    const rows = this.queryAll('SELECT * FROM board_tasks ORDER BY created_at');
    return Promise.resolve(rows.map(rowToTaskData));
  }

  getTasksByColumn(column: string): Promise<BoardTaskData[]> {
    const db = this.getDb();
    db.run('CREATE TEMP TABLE IF NOT EXISTS _param (v TEXT)');
    db.run('DELETE FROM _param');
    db.run('INSERT INTO _param VALUES (?)', [column]);
    const rows = this.queryAll(
      'SELECT bt.* FROM board_tasks bt, _param p WHERE bt.column_name = p.v ORDER BY bt.created_at',
    );
    return Promise.resolve(rows.map(rowToTaskData));
  }

  createTask(task: Omit<BoardTaskData, 'id'>): Promise<BoardTaskData> {
    const id = randomUUID();
    const db = this.getDb();
    db.run(
      `INSERT INTO board_tasks (id, title, md_path, column_name, jira_key, assignee, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, task.title, task.mdPath, task.column, task.jiraKey, task.assignee, task.createdAt, task.updatedAt],
    );
    return Promise.resolve({ id, ...task });
  }

  updateTask(id: string, fields: Partial<BoardTaskData>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title); }
    if (fields.column !== undefined) { sets.push('column_name = ?'); values.push(fields.column); }
    if (fields.jiraKey !== undefined) { sets.push('jira_key = ?'); values.push(fields.jiraKey); }
    if (fields.assignee !== undefined) { sets.push('assignee = ?'); values.push(fields.assignee); }

    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const db = this.getDb();
    db.run(`UPDATE board_tasks SET ${sets.join(', ')} WHERE id = ?`, values);
    return Promise.resolve();
  }

  deleteTask(id: string): Promise<void> {
    this.getDb().run('DELETE FROM board_tasks WHERE id = ?', [id]);
    return Promise.resolve();
  }

  async syncFromFiles(tasksDir: string): Promise<void> {
    const folders = ['Backlog', 'ToDo', 'Done'];
    const folderToColumn: Record<string, string> = {
      Backlog: 'backlog',
      ToDo: 'backlog',
      Done: 'done',
    };

    for (const folder of folders) {
      const dir = join(tasksDir, folder);
      if (!existsSync(dir)) { continue; }

      let files: string[];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.md'));
      } catch { continue; }

      for (const file of files) {
        const filePath = join(dir, file);
        const relPath = relative(this.workspaceDir, filePath);

        const db = this.getDb();
        db.run('CREATE TEMP TABLE IF NOT EXISTS _path_param (v TEXT)');
        db.run('DELETE FROM _path_param');
        db.run('INSERT INTO _path_param VALUES (?)', [relPath]);
        const existing = this.queryAll(
          'SELECT bt.* FROM board_tasks bt, _path_param p WHERE bt.md_path = p.v',
        );

        if (existing.length > 0) { continue; }

        const parsed = parseMdFile(filePath);
        const now = new Date().toISOString();

        await this.createTask({
          title: parsed.title,
          mdPath: relPath,
          column: parsed.frontmatter.column ?? folderToColumn[folder] ?? 'backlog',
          jiraKey: parsed.frontmatter.jiraKey ?? null,
          assignee: parsed.frontmatter.assignee ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  loadPipeline(): Promise<PipelineConfig> {
    const result = this.getDb().exec('SELECT config_json FROM board_pipeline WHERE id = 1');
    const raw = result[0]?.values[0]?.[0];
    if (typeof raw === 'string') {
      return Promise.resolve(JSON.parse(raw) as PipelineConfig);
    }
    return Promise.resolve({
      columns: [
        { name: 'backlog', displayName: 'Backlog', type: 'system' },
        { name: 'done', displayName: 'Done', type: 'system' },
      ],
      port: 5002,
    });
  }

  savePipeline(config: PipelineConfig): Promise<void> {
    const json = JSON.stringify(config);
    this.getDb().run(
      `INSERT OR REPLACE INTO board_pipeline (id, config_json) VALUES (1, ?)`,
      [json],
    );
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.db?.close();
    this.db = null;
    return Promise.resolve();
  }
}
