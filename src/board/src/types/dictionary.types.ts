export interface BoardDict {
  title: string;
  subtitle: string;
  warning: {
    noClaude: string;
  };
  column: {
    skill: string;
    system: string;
    emptyState: string;
    dropHint: string;
  };
  card: {
    jiraPrefix: string;
    assignedTo: string;
    noAssignee: string;
    createdAt: string;
    runningSkill: string;
    skillComplete: string;
    skillFailed: string;
    viewFile: string;
  };
  actions: {
    addTask: string;
    importFromJira: string;
    refresh: string;
    settings: string;
  };
  status: {
    connected: string;
    disconnected: string;
    reconnecting: string;
  };
}

export interface CommonDict {
  actions: {
    save: string;
    cancel: string;
    delete: string;
    close: string;
    confirm: string;
    retry: string;
  };
  status: {
    loading: string;
    error: string;
    empty: string;
    saving: string;
  };
  time: {
    justNow: string;
    minutesAgo: string;
    hoursAgo: string;
    daysAgo: string;
  };
}

export interface DictionaryResult {
  board: BoardDict;
  common: CommonDict;
}
