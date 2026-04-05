import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Issue, IssueBatch } from '../../core/types/index.js';
import { parseMdFile } from './md-parser.js';

const STATUS_DIRS = ['Backlog', 'InProgress', 'Done'];

export function scanBoardTasks(tasksDir: string, projectKey: string): IssueBatch {
  const issues: Issue[] = [];

  for (const status of STATUS_DIRS) {
    const statusDir = join(tasksDir, status);
    if (!isDir(statusDir)) { continue; }

    const epicDirs = readdirSync(statusDir).filter((d) => isDir(join(statusDir, d)));
    for (const epicName of epicDirs) {
      const epicDir = join(statusDir, epicName);
      const mdFiles = readdirSync(epicDir).filter((f) => f.endsWith('.md'));

      for (const mdFile of mdFiles) {
        const filePath = join(epicDir, mdFile);
        const issue = mdFileToIssue(filePath, projectKey, epicName, status);
        if (issue) {
          issues.push(issue);
        }
      }
    }
  }

  return { issues, comments: [], changelogs: [], worklogs: [], links: [] };
}

function mdFileToIssue(
  filePath: string,
  projectKey: string,
  epicName: string,
  status: string,
): Issue | null {
  const parsed = parseMdFile(filePath);
  const jiraKey = fmStr(parsed.frontmatter, 'jiraKey');
  const hasRealKey = jiraKey !== null && !jiraKey.includes('NEXT');

  return {
    key: hasRealKey ? jiraKey : `LOCAL-${String(Date.now())}`,
    id: '',
    projectKey,
    summary: parsed.title,
    description: parsed.body.trim() || null,
    issueType: 'Story',
    status: statusToJiraStatus(status),
    statusCategory: null,
    priority: null,
    resolution: null,
    assignee: fmStr(parsed.frontmatter, 'assignee'),
    assigneeId: null,
    reporter: null,
    reporterId: null,
    created: fmStr(parsed.frontmatter, 'createdAt'),
    updated: fmStr(parsed.frontmatter, 'createdAt'),
    resolved: null,
    dueDate: null,
    labels: [],
    components: [],
    fixVersions: [],
    parentKey: epicName !== 'Uncategorized' ? epicName : null,
    sprint: null,
    storyPoints: null,
    originalEstimate: null,
    remainingEstimate: null,
    timeSpent: null,
    customFields: {},
    rawJson: { mdPath: filePath },
    source: hasRealKey ? 'jira' : 'local',
  };
}

function statusToJiraStatus(status: string): string {
  switch (status) {
    case 'Done': return 'Done';
    case 'InProgress': return 'In Progress';
    default: return 'To Do';
  }
}

function fmStr(fm: Record<string, unknown>, key: string): string | null {
  const val = fm[key];
  return typeof val === 'string' ? val : null;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
