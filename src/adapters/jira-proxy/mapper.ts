import type { Issue } from '../../core/types/issue.js';
import type { ProxyFieldMapping } from '../../core/types/proxy-config.js';

const DEFAULT_MAPPING: ProxyFieldMapping = {
  issue_key: 'key',
  summary: 'fields.summary',
  description: 'fields.description',
  status: 'fields.status.name',
  status_category: 'fields.status.statusCategory.name',
  issue_type: 'fields.issuetype.name',
  priority: 'fields.priority.name',
  resolution: 'fields.resolution.name',
  assignee: 'fields.assignee.displayName',
  assignee_id: 'fields.assignee.accountId',
  reporter: 'fields.reporter.displayName',
  reporter_id: 'fields.reporter.accountId',
  created: 'fields.created',
  updated: 'fields.updated',
  resolved: 'fields.resolutiondate',
  due_date: 'fields.duedate',
  labels: 'fields.labels',
  components: 'fields.components[].name',
  fix_versions: 'fields.fixVersions[].name',
  parent_key: 'fields.parent.key',
  sprint: 'fields.sprint.name',
  story_points: 'fields.story_points',
};

export function mapProxyIssue(raw: Record<string, unknown>, mapping?: ProxyFieldMapping): Issue {
  const m = mapping ?? DEFAULT_MAPPING;

  const issueKey = resolveString(raw, m['issue_key'] ?? 'key') ?? '';
  const projectKey = issueKey.split('-')[0] ?? '';

  return {
    key: issueKey,
    id: resolveString(raw, 'id') ?? '',
    projectKey,
    summary: resolveString(raw, m['summary'] ?? 'fields.summary') ?? '',
    description: resolveString(raw, m['description'] ?? 'fields.description'),
    issueType: resolveString(raw, m['issue_type'] ?? 'fields.issuetype.name'),
    status: resolveString(raw, m['status'] ?? 'fields.status.name'),
    statusCategory: resolveString(raw, m['status_category'] ?? 'fields.status.statusCategory.name'),
    priority: resolveString(raw, m['priority'] ?? 'fields.priority.name'),
    resolution: resolveString(raw, m['resolution'] ?? 'fields.resolution.name'),
    assignee: resolveString(raw, m['assignee'] ?? 'fields.assignee.displayName'),
    assigneeId: resolveString(raw, m['assignee_id'] ?? 'fields.assignee.accountId'),
    reporter: resolveString(raw, m['reporter'] ?? 'fields.reporter.displayName'),
    reporterId: resolveString(raw, m['reporter_id'] ?? 'fields.reporter.accountId'),
    created: resolveString(raw, m['created'] ?? 'fields.created'),
    updated: resolveString(raw, m['updated'] ?? 'fields.updated'),
    resolved: resolveString(raw, m['resolved'] ?? 'fields.resolutiondate'),
    dueDate: resolveString(raw, m['due_date'] ?? 'fields.duedate'),
    labels: resolveStringArray(raw, m['labels'] ?? 'fields.labels'),
    components: resolveStringArray(raw, m['components'] ?? 'fields.components[].name'),
    fixVersions: resolveStringArray(raw, m['fix_versions'] ?? 'fields.fixVersions[].name'),
    parentKey: resolveString(raw, m['parent_key'] ?? 'fields.parent.key'),
    sprint: resolveString(raw, m['sprint'] ?? 'fields.sprint.name'),
    storyPoints: resolveNumber(raw, m['story_points'] ?? 'fields.story_points'),
    originalEstimate: null,
    remainingEstimate: null,
    timeSpent: null,
    customFields: {},
    rawJson: raw,
    source: 'jira',
  };
}

export function resolvePath(obj: unknown, path: string): unknown {
  if (!path || obj === null || obj === undefined) {
    return undefined;
  }

  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (part.endsWith('[]')) {
      const arrayKey = part.slice(0, -2);
      const arr = (current as Record<string, unknown>)[arrayKey];
      if (!Array.isArray(arr)) {
        return undefined;
      }
      const remaining = parts.slice(parts.indexOf(part) + 1).join('.');
      if (remaining) {
        return arr.map((item) => resolvePath(item, remaining)).filter((v) => v !== undefined);
      }
      return arr;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function resolveString(obj: unknown, path: string): string | null {
  const value = resolvePath(obj, path);
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function resolveNumber(obj: unknown, path: string): number | null {
  const value = resolvePath(obj, path);
  if (typeof value === 'number') {
    return value;
  }
  return null;
}

function resolveStringArray(obj: unknown, path: string): string[] {
  const value = resolvePath(obj, path);
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return [];
}
