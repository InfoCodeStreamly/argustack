import type { BoardTaskData } from '../../core/types/board.js';

export interface SqliteTaskRow {
  id: string;
  title: string;
  md_path: string;
  column_name: string;
  jira_key: string | null;
  assignee: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToTaskData(row: SqliteTaskRow): BoardTaskData {
  return {
    id: row.id,
    title: row.title,
    mdPath: row.md_path,
    column: row.column_name,
    jiraKey: row.jira_key,
    assignee: row.assignee,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function taskDataToRow(task: BoardTaskData): SqliteTaskRow {
  return {
    id: task.id,
    title: task.title,
    md_path: task.mdPath,
    column_name: task.column,
    jira_key: task.jiraKey,
    assignee: task.assignee,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}
