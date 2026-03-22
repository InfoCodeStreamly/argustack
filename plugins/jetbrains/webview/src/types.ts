export interface Card {
  id: string;
  title: string;
  mdPath: string;
  column: string;
  epic: string;
  jiraKey: string | null;
  assignee: string | null;
  executionState: string | null;
  sessionName: string | null;
  updatedAt: string | null;
}

export interface Column {
  name: string;
  type: 'system' | 'skill';
  displayName: string;
}

export interface Workflow {
  name: string;
  skills: string[];
}

export interface BoardSettings {
  jiraProjectKey: string | null;
  doneFilterValue: number;
  doneFilterUnit: string;
}

export interface Epic {
  name: string;
}

export interface BoardState {
  cards: Card[];
  columns: Column[];
  epics: Epic[];
  workflows: Workflow[];
  settings: BoardSettings;
  activeEpicFilter: string | null;
  activeWorkflow: string | null;
  allSkills: string[];
  claudeAvailable: boolean;
  jiraConfigured: boolean;
}

export type ExecutionState = 'IDLE' | 'RUNNING' | 'DONE' | 'ERROR' | 'INTERRUPTED';

export type BridgeMessage =
  | { type: 'moveCard'; cardId: string; targetColumn: string }
  | { type: 'createCard'; title: string; epic: string }
  | { type: 'deleteCard'; cardId: string }
  | { type: 'runSkill'; cardId: string; skillName: string }
  | { type: 'setWorkflow'; workflowName: string | null }
  | { type: 'createWorkflow'; name: string; skills: string[] }
  | { type: 'updateWorkflow'; name: string; newName: string; skills: string[] }
  | { type: 'deleteWorkflow'; name: string }
  | { type: 'reorderColumns'; columnNames: string[] }
  | { type: 'updateSettings'; jiraProjectKey?: string | null; doneFilterValue?: number; doneFilterUnit?: string }
  | { type: 'createJiraIssue'; cardId: string }
  | { type: 'openFile'; cardId: string }
  | { type: 'resumeSession'; cardId: string }
  | { type: 'changeEpic'; cardId: string; targetEpic: string }
  | { type: 'createEpic'; name: string }
  | { type: 'filterEpic'; epicName: string | null }
  | { type: 'requestBoardState' };

export type BridgeResponse =
  | { type: 'boardStateUpdate'; cards: Card[]; columns: Column[]; epics: Epic[]; workflows: Workflow[]; settings: BoardSettings; allSkills: string[]; activeEpicFilter: string | null; activeWorkflow: string | null; claudeAvailable: boolean; jiraConfigured: boolean }
  | { type: 'executionStateChanged'; cardId: string; state: ExecutionState }
  | { type: 'error'; message: string };

declare global {
  interface Window {
    sendToPlugin?: (message: string) => void;
    receiveFromPlugin?: (payload: string) => void;
  }
}
