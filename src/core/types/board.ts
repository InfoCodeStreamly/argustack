export type SkillExecutionStatus = 'running' | 'done' | 'error';

export interface BoardTaskData {
  id: string;
  title: string;
  mdPath: string;
  column: string;
  jiraKey: string | null;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillExecutionData {
  id: string;
  taskId: string;
  skillName: string;
  status: SkillExecutionStatus;
  output: string;
  startedAt: string;
  finishedAt: string | null;
}
