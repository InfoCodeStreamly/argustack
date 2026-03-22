import type { Version3Models } from 'jira.js';
import type {
  Issue,
  IssueComment,
  IssueChangelog,
  IssueWorklog,
  IssueLink,
} from '../../core/types/index.js';

type JiraIssue = Version3Models.Issue;

/**
 * jira.js types mark many fields as non-null, but the real Jira API
 * returns null for unset fields. This type reflects actual API behavior.
 */
type NullableFields = {
  [K in keyof Version3Models.Fields]: Version3Models.Fields[K] | null;
};

interface AdfNode {
  readonly type: string;
  readonly text?: string;
  readonly content?: readonly AdfNode[];
}

/**
 * Map raw Jira API response to core Issue type.
 * Field names are stored as-is from Jira — no renaming.
 */
export function mapJiraIssue(raw: JiraIssue): Issue {
  const fields: NullableFields = raw.fields;

  const standardFieldKeys = new Set([
    'summary', 'description', 'issuetype', 'status', 'priority',
    'resolution', 'assignee', 'reporter', 'created', 'updated',
    'resolutiondate', 'duedate', 'labels', 'components', 'fixVersions',
    'parent', 'sprint', 'story_points', 'customfield_10016',
    'timeoriginalestimate', 'timeestimate', 'timespent',
  ]);

  const customFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('customfield_') && !standardFieldKeys.has(key)) {
      customFields[key] = value;
    }
  }

  return {
    key: raw.key,
    id: raw.id,
    projectKey: raw.key.split('-')[0] ?? '',
    summary: fields.summary ?? '',
    description: extractText(fields.description),
    issueType: (fields.issuetype ?? fields.issueType)?.name ?? null,
    status: fields.status?.name ?? null,
    statusCategory: fields.status?.statusCategory?.name ?? null,
    priority: fields.priority?.name ?? null,
    resolution: fields.resolution?.name ?? null,
    assignee: fields.assignee?.displayName ?? null,
    assigneeId: fields.assignee?.accountId ?? null,
    reporter: fields.reporter?.displayName ?? null,
    reporterId: fields.reporter?.accountId ?? null,
    created: fields.created,
    updated: fields.updated,
    resolved: fields.resolutiondate ?? null,
    dueDate: fields.duedate ?? null,
    labels: fields.labels ?? [],
    components: (fields.components ?? []).map((c) => c.name).filter((n): n is string => n !== undefined),
    fixVersions: (fields.fixVersions ?? []).map((v) => v.name),
    parentKey: fields.parent?.key ?? null,
    sprint: extractSprint(fields),
    storyPoints: extractStoryPoints(fields),
    originalEstimate: extractTimeField(fields, 'timeoriginalestimate'),
    remainingEstimate: extractTimeField(fields, 'timeestimate'),
    timeSpent: extractTimeField(fields, 'timespent'),
    customFields,
    rawJson: raw as unknown as Record<string, unknown>,
  };
}

export function mapJiraComments(issueKey: string, raw: JiraIssue): IssueComment[] {
  const fields: NullableFields = raw.fields;
  const comments = fields.comment?.comments ?? [];
  return comments.map((c) => ({
    issueKey,
    commentId: c.id ?? '',
    author: c.author?.displayName ?? null,
    body: extractText(c.body),
    created: c.created ?? null,
    updated: c.updated ?? null,
  }));
}

export function mapJiraChangelogs(issueKey: string, raw: JiraIssue): IssueChangelog[] {
  const histories = raw.changelog?.histories ?? [];
  const result: IssueChangelog[] = [];

  for (const history of histories) {
    for (const item of history.items ?? []) {
      result.push({
        issueKey,
        author: history.author?.displayName ?? null,
        field: item.field ?? '',
        fromValue: item.fromString ?? null,
        toValue: item.toString ?? null,
        changedAt: history.created ?? null,
      });
    }
  }

  return result;
}

export function mapJiraWorklogs(issueKey: string, raw: JiraIssue): IssueWorklog[] {
  const fields: NullableFields = raw.fields;
  const worklogs = fields.worklog?.worklogs ?? [];
  return worklogs.map((w) => ({
    issueKey,
    author: w.author?.displayName ?? null,
    timeSpent: w.timeSpent ?? null,
    timeSpentSeconds: w.timeSpentSeconds ?? null,
    comment: extractText(w.comment),
    started: w.started ?? null,
  }));
}

export function mapJiraLinks(issueKey: string, raw: JiraIssue): IssueLink[] {
  const fields: NullableFields = raw.fields;
  const links = fields.issuelinks ?? [];
  const result: IssueLink[] = [];

  for (const link of links) {
    if (link.outwardIssue) {
      result.push({
        sourceKey: issueKey,
        targetKey: link.outwardIssue.key ?? '',
        linkType: link.type?.name ?? 'Related',
        direction: 'outward',
      });
    }
    if (link.inwardIssue) {
      result.push({
        sourceKey: link.inwardIssue.key ?? '',
        targetKey: issueKey,
        linkType: link.type?.name ?? 'Related',
        direction: 'inward',
      });
    }
  }

  return result;
}

/**
 * Extract plain text from Jira ADF (Atlassian Document Format) or string.
 */
function extractText(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }

  if (isAdfNode(value)) {
    return extractAdfText(value);
  }

  return JSON.stringify(value);
}

function isAdfNode(value: unknown): value is AdfNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as AdfNode).type === 'string'
  );
}

function extractAdfText(node: AdfNode): string {
  if (node.type === 'text') {
    return node.text ?? '';
  }
  if (Array.isArray(node.content)) {
    return node.content.map(extractAdfText).join('');
  }
  return '';
}

/**
 * Extract sprint name from various Jira sprint field formats.
 */
function extractSprint(fields: NullableFields): string | null {
  const sprint: unknown = fields['sprint'];
  if (!sprint) {
    return null;
  }
  if (typeof sprint === 'string') {
    return sprint;
  }
  if (typeof sprint === 'object' && 'name' in sprint) {
    return (sprint as { name: string }).name;
  }
  return null;
}

/**
 * Extract story points from standard or custom field.
 */
function extractSeconds(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractTimeField(fields: NullableFields, key: string): number | null {
  return extractSeconds((fields as Record<string, unknown>)[key]);
}

function extractStoryPoints(fields: NullableFields): number | null {
  const storyPoints: unknown = fields['story_points'] ?? fields['customfield_10016'];
  if (typeof storyPoints === 'number') {
    return storyPoints;
  }
  return null;
}
