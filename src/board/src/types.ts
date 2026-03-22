export interface BoardTask {
  id: string;
  title: string;
  mdPath: string;
  column: string;
  jiraKey: string | null;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineColumn {
  name: string;
  displayName: string;
  type: 'system' | 'skill';
}

export interface PipelineConfig {
  columns: PipelineColumn[];
  port: number;
}

export interface SkillInfo {
  name: string;
  description: string;
  source: string;
}

export interface BoardData {
  tasks: BoardTask[];
  pipeline: PipelineConfig;
  skills: SkillInfo[];
  claudeAvailable: boolean;
}

export interface SkillOutputEvent {
  type: 'output';
  chunk: string;
}

export interface SkillDoneEvent {
  type: 'done';
  task: BoardTask;
  skillTriggered: boolean;
}

export interface SkillErrorEvent {
  type: 'error';
  message: string;
}

export type SkillEvent = SkillOutputEvent | SkillDoneEvent | SkillErrorEvent;
