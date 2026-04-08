import type { Version3Client, Version3Parameters as Parameters } from 'jira.js';
import type { ISourceProvider } from '../../core/ports/source-provider.js';
import type { Issue, IssueBatch, Project } from '../../core/types/index.js';
import { createJiraClient, type JiraCredentials } from './client.js';
import {
  mapJiraIssue,
  mapJiraComments,
  mapJiraChangelogs,
  mapJiraWorklogs,
  mapJiraLinks,
} from './mapper.js';
import { markdownToAdf } from '../../workspace/adf.js';

const PAGE_SIZE = 50;

/**
 * Jira adapter — implements ISourceProvider.
 *
 * Pulls all issues with ALL fields from Jira REST API v3 (Enhanced Search).
 * Uses token-based pagination, expands changelog, stores raw JSON as-is.
 *
 * jira.js v5 migration: uses searchForIssuesUsingJqlEnhancedSearch
 * which returns nextPageToken instead of startAt/total.
 */
export class JiraProvider implements ISourceProvider {
  readonly name = 'Jira';
  private readonly client: Version3Client;
  private readonly issueTypeIds: string[];

  constructor(creds: JiraCredentials, issueTypeIds?: string[]) {
    this.client = createJiraClient(creds);
    this.issueTypeIds = issueTypeIds ?? [];
  }

  private buildJqlFilter(projectKey: string, since?: string): string {
    let jql = `project = "${projectKey}"`;
    if (this.issueTypeIds.length > 0) {
      const allNumeric = this.issueTypeIds.every((v) => /^\d+$/.test(v));
      const values = allNumeric
        ? this.issueTypeIds.join(', ')
        : this.issueTypeIds.map((t) => `"${t}"`).join(', ');
      jql += ` AND issuetype in (${values})`;
    }
    if (since) {
      jql += ` AND updated >= "${since}"`;
    }
    return jql;
  }

  async getProjects(): Promise<Project[]> {
    const result = await this.client.projects.searchProjects({ maxResults: 200 });
    return result.values.map((p) => ({
      key: p.key,
      name: p.name,
      id: p.id,
    }));
  }

  async createIssue(issue: Issue): Promise<string> {
    const fields: Parameters.CreateIssue['fields'] = {
      project: { key: issue.projectKey },
      summary: issue.summary,
      issuetype: { name: issue.issueType ?? 'Story' },
    };
    if (issue.description) {
      (fields as Record<string, unknown>)['description'] = markdownToAdf(issue.description);
    }
    if (issue.parentKey) {
      fields.parent = { key: issue.parentKey };
    }
    const result = await this.client.issues.createIssue({ fields });
    return result.key;
  }

  async updateIssue(issueKey: string, fields: Partial<Issue>): Promise<void> {
    const update: Record<string, unknown> = {};
    if (fields.summary !== undefined) {
      update['summary'] = fields.summary;
    }
    if (fields.description !== undefined) {
      update['description'] = fields.description
        ? markdownToAdf(fields.description)
        : null;
    }
    if (fields.priority !== undefined) {
      update['priority'] = fields.priority ? { name: fields.priority } : null;
    }
    if (fields.assignee !== undefined) {
      update['assignee'] = fields.assignee ? { accountId: fields.assigneeId ?? fields.assignee } : null;
    }
    if (fields.labels !== undefined) {
      update['labels'] = fields.labels;
    }
    if (fields.components !== undefined) {
      update['components'] = fields.components.map((name) => ({ name }));
    }
    if (fields.storyPoints !== undefined) {
      update['story_points'] = fields.storyPoints;
    }
    await this.client.issues.editIssue({ issueIdOrKey: issueKey, fields: update });
  }

  async getIssueCount(projectKey: string, since?: string): Promise<number> {
    const jql = this.buildJqlFilter(projectKey, since);
    const result = await this.client.issueSearch.countIssues({ jql });
    return result.count ?? 0;
  }

  async *pullIssues(projectKey: string, since?: string): AsyncGenerator<IssueBatch> {
    const jql = `${this.buildJqlFilter(projectKey, since)} ORDER BY updated ASC`;

    let pageToken: string | undefined = undefined;

    do {
      const searchParams: Parameters.SearchForIssuesUsingJqlEnhancedSearch = {
        jql,
        maxResults: PAGE_SIZE,
        fields: ['*all'],
        expand: 'changelog',
      };
      if (pageToken) {
        searchParams.nextPageToken = pageToken;
      }

      const response = await this.client.issueSearch.searchForIssuesUsingJqlEnhancedSearch(searchParams);

      const issues = response.issues ?? [];

      if (issues.length === 0) {
        break;
      }

      const batch: IssueBatch = {
        issues: [],
        comments: [],
        changelogs: [],
        worklogs: [],
        links: [],
      };

      for (const raw of issues) {
        batch.issues.push(mapJiraIssue(raw));
        batch.comments.push(...mapJiraComments(raw.key, raw));
        batch.changelogs.push(...mapJiraChangelogs(raw.key, raw));
        batch.worklogs.push(...mapJiraWorklogs(raw.key, raw));
        batch.links.push(...mapJiraLinks(raw.key, raw));
      }

      yield batch;

      pageToken = response.nextPageToken ?? undefined;
    } while (pageToken);
  }
}
