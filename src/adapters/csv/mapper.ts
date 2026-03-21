import type {
  Issue,
  IssueComment,
  IssueWorklog,
  IssueLink,
} from '../../core/types/index.js';
import type { CsvSchema } from './parser.js';
import { parseJiraDate } from './parser.js';

export interface CsvRowResult {
  issue: Issue;
  comments: IssueComment[];
  worklogs: IssueWorklog[];
  links: IssueLink[];
}

function cell(row: string[], index: number | undefined): string | null {
  if (index === undefined) {
    return null;
  }
  const value = row[index]?.trim() ?? '';
  return value === '' ? null : value;
}

function cellStr(row: string[], index: number | undefined): string {
  return cell(row, index) ?? '';
}

export function mapCsvRow(row: string[], schema: CsvSchema): CsvRowResult {
  const sf = schema.standardFields;

  const issueKey = cellStr(row, sf.get('Issue key'));
  const projectKey = issueKey.split('-')[0] ?? '';

  const issue: Issue = {
    key: issueKey,
    id: cellStr(row, sf.get('Issue id')),
    projectKey,
    summary: cellStr(row, sf.get('Summary')),
    description: cell(row, sf.get('Description')),
    issueType: cell(row, sf.get('Issue Type')),
    status: cell(row, sf.get('Status')),
    statusCategory: cell(row, sf.get('Status Category')),
    priority: cell(row, sf.get('Priority')),
    resolution: cell(row, sf.get('Resolution')),
    assignee: cell(row, sf.get('Assignee')),
    reporter: cell(row, sf.get('Reporter')),
    created: parseJiraDate(cell(row, sf.get('Created'))),
    updated: parseJiraDate(cell(row, sf.get('Updated'))),
    resolved: parseJiraDate(cell(row, sf.get('Resolved'))),
    dueDate: cell(row, sf.get('Due date')),
    labels: extractRepeated(row, schema, 'Labels'),
    components: extractRepeated(row, schema, 'Components'),
    fixVersions: extractRepeated(row, schema, 'Fix versions'),
    parentKey: cell(row, sf.get('Parent key')),
    sprint: null,
    storyPoints: parseFloat(cell(row, sf.get('Original estimate')) ?? '') || null,
    customFields: extractCustomFields(row, schema),
    rawJson: buildRawJson(row, schema),
  };

  const comments = extractComments(issueKey, row, schema);
  const worklogs = extractWorklogs(issueKey, row, schema);
  const links = extractLinks(issueKey, row, schema);

  return { issue, comments, worklogs, links };
}

function extractRepeated(row: string[], schema: CsvSchema, name: string): string[] {
  const group = schema.repeatedGroups.get(name);
  if (!group) {
    return [];
  }
  const result: string[] = [];
  for (let i = group.startIndex; i < group.startIndex + group.count; i++) {
    const value = row[i]?.trim();
    if (value) {
      result.push(value);
    }
  }
  return result;
}

function extractCustomFields(row: string[], schema: CsvSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const cf of schema.customFields) {
    const value = cell(row, cf.columnIndex);
    if (value !== null) {
      result[cf.name] = value;
    }
  }
  return result;
}

function buildRawJson(row: string[], schema: CsvSchema): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [name, index] of schema.standardFields) {
    raw[name] = cell(row, index);
  }
  for (const cf of schema.customFields) {
    raw[`Custom field (${cf.name})`] = cell(row, cf.columnIndex);
  }
  return raw;
}

/**
 * Jira CSV comment format: `timestamp;user_id;comment_text`
 * Split on first 2 semicolons — comment body may contain semicolons.
 */
function extractComments(issueKey: string, row: string[], schema: CsvSchema): IssueComment[] {
  const group = schema.repeatedGroups.get('Comment');
  if (!group) {
    return [];
  }
  const result: IssueComment[] = [];
  for (let i = group.startIndex; i < group.startIndex + group.count; i++) {
    const raw = row[i]?.trim();
    if (!raw) {
      continue;
    }
    const firstSemi = raw.indexOf(';');
    if (firstSemi === -1) {
      continue;
    }
    const secondSemi = raw.indexOf(';', firstSemi + 1);
    if (secondSemi === -1) {
      continue;
    }

    const timestamp = raw.slice(0, firstSemi);
    const author = raw.slice(firstSemi + 1, secondSemi);
    const body = raw.slice(secondSemi + 1);

    result.push({
      issueKey,
      commentId: `csv-${issueKey}-comment-${i}`,
      author: author || null,
      body: body || null,
      created: parseJiraDate(timestamp),
      updated: null,
    });
  }
  return result;
}

/**
 * Jira CSV worklog format: `description;timestamp;user;minutes`
 * Minutes × 60 = seconds.
 */
function extractWorklogs(issueKey: string, row: string[], schema: CsvSchema): IssueWorklog[] {
  const group = schema.repeatedGroups.get('Log Work');
  if (!group) {
    return [];
  }
  const result: IssueWorklog[] = [];
  for (let i = group.startIndex; i < group.startIndex + group.count; i++) {
    const raw = row[i]?.trim();
    if (!raw) {
      continue;
    }
    const parts = raw.split(';');
    if (parts.length < 4) {
      continue;
    }

    const description = parts[0] ?? '';
    const timestamp = parts[1] ?? '';
    const author = parts[2] ?? '';
    const minutesStr = parts[parts.length - 1] ?? '0';
    const minutes = parseInt(minutesStr, 10);

    result.push({
      issueKey,
      author: author || null,
      timeSpent: isNaN(minutes) ? null : `${minutes}m`,
      timeSpentSeconds: isNaN(minutes) ? null : minutes * 60,
      comment: description || null,
      started: parseJiraDate(timestamp),
    });
  }
  return result;
}

function extractLinks(issueKey: string, row: string[], schema: CsvSchema): IssueLink[] {
  const result: IssueLink[] = [];
  for (const link of schema.issueLinks) {
    const targetKey = row[link.columnIndex]?.trim();
    if (!targetKey) {
      continue;
    }
    if (link.direction === 'outward') {
      result.push({
        sourceKey: issueKey,
        targetKey,
        linkType: link.linkType,
        direction: 'outward',
      });
    } else {
      result.push({
        sourceKey: targetKey,
        targetKey: issueKey,
        linkType: link.linkType,
        direction: 'inward',
      });
    }
  }
  return result;
}
