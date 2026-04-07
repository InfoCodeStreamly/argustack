import type { ISourceProvider } from '../../core/ports/source-provider.js';
import type { Issue, IssueBatch, Project } from '../../core/types/index.js';
import type { ProxyConfig } from '../../core/types/proxy-config.js';
import { ProxyClient } from './client.js';
import { mapProxyIssue } from './mapper.js';

const PAGE_SIZE = 50;
const ENRICH_CONCURRENCY = 5;
const ENRICH_MAX_RETRIES = 3;
const ENRICH_RETRY_DELAY_MS = 2000;
const DEFAULT_SEARCH_FIELDS = 'summary,status,issuetype,priority,assignee,reporter,created,updated,labels,components,fixVersions,parent,resolution,resolutiondate,duedate,sprint,story_points';

export class ProxyJiraProvider implements ISourceProvider {
  readonly name = 'Jira (Proxy)';
  private readonly client: ProxyClient;
  private readonly config: ProxyConfig;
  private readonly issueTypes: string[];

  constructor(config: ProxyConfig, issueTypes?: string[]) {
    this.config = config;
    this.client = new ProxyClient(config);
    this.issueTypes = issueTypes ?? [];
  }

  private buildJqlFilter(projectKey: string, since?: string): string {
    let jql = `project = "${projectKey}"`;
    if (this.issueTypes.length > 0) {
      const types = this.issueTypes.map((t) => `"${t}"`).join(', ');
      jql += ` AND issuetype in (${types})`;
    }
    if (since) {
      jql += ` AND updated >= "${since}"`;
    }
    return jql;
  }

  async getProjects(): Promise<Project[]> {
    const ep = this.config.endpoints.projects;
    const data = await this.client.fetch(ep.path, { maxResults: '200' }) as Record<string, unknown>;

    const values = (data['values'] ?? data['projects'] ?? data) as unknown[];
    if (!Array.isArray(values)) {
      return [];
    }

    return values.map((p) => {
      const proj = p as Record<string, unknown>;
      const key = typeof proj['key'] === 'string' ? proj['key'] : '';
      const name = typeof proj['name'] === 'string' ? proj['name'] : '';
      const result: Project = { key, name };
      if (typeof proj['id'] === 'string' || typeof proj['id'] === 'number') {
        result.id = String(proj['id']);
      }
      return result;
    });
  }

  async getIssueCount(projectKey: string, since?: string): Promise<number> {
    const ep = this.config.endpoints.search;
    const jql = this.buildJqlFilter(projectKey, since);

    const data = await this.client.fetch(ep.path, {
      jql,
      maxResults: '0',
      fields: 'summary',
    }) as Record<string, unknown>;

    if (typeof data['total'] === 'number') {
      return data['total'];
    }

    const issues = data['issues'] as unknown[] | undefined;
    return Array.isArray(issues) ? issues.length : 0;
  }

  async *pullIssues(projectKey: string, since?: string): AsyncGenerator<IssueBatch> {
    const ep = this.config.endpoints.search;
    const jql = `${this.buildJqlFilter(projectKey, since)} ORDER BY updated ASC`;

    let startAt = 0;
    let nextPageToken: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params: Record<string, string> = {
        jql,
        maxResults: String(PAGE_SIZE),
        fields: DEFAULT_SEARCH_FIELDS,
      };

      if (nextPageToken) {
        params['nextPageToken'] = nextPageToken;
      } else {
        params['startAt'] = String(startAt);
      }

      const data = await this.client.fetch(ep.path, params) as Record<string, unknown>;

      const issues = data['issues'] as unknown[];
      if (!Array.isArray(issues) || issues.length === 0) {
        break;
      }

      const batch: IssueBatch = {
        issues: [],
        comments: [],
        changelogs: [],
        worklogs: [],
        links: [],
      };

      for (const rawIssue of issues) {
        const issueData = rawIssue as Record<string, unknown>;
        batch.issues.push(mapProxyIssue(issueData, this.config.response_mapping));
      }

      await this.enrichDescriptions(batch.issues);

      yield batch;

      nextPageToken = typeof data['nextPageToken'] === 'string' ? data['nextPageToken'] : undefined;
      const isLast = data['isLast'];

      if (isLast === true || !nextPageToken) {
        const total = typeof data['total'] === 'number' ? data['total'] : Infinity;
        startAt += issues.length;
        if (startAt >= total && !nextPageToken) {
          hasMore = false;
        } else if (!nextPageToken) {
          hasMore = false;
        }
      }
    }
  }

  private async enrichDescriptions(issues: Issue[]): Promise<void> {
    let pending = issues.filter((i) => !i.description);
    if (pending.length === 0) {
      return;
    }

    const ep = this.config.endpoints.issue;

    for (let retry = 0; retry <= ENRICH_MAX_RETRIES && pending.length > 0; retry++) {
      if (retry > 0) {
        await new Promise((r) => setTimeout(r, ENRICH_RETRY_DELAY_MS * retry));
      }

      const failed: Issue[] = [];

      for (let i = 0; i < pending.length; i += ENRICH_CONCURRENCY) {
        const chunk = pending.slice(i, i + ENRICH_CONCURRENCY);
        await Promise.allSettled(
          chunk.map(async (issue) => {
            try {
              const path = ep.path.replace('{key}', issue.key);
              const data = await this.client.fetch(path) as Record<string, unknown>;

              if (typeof data['error'] === 'string') {
                failed.push(issue);
                return;
              }

              const fields = data['fields'] as Record<string, unknown> | undefined;
              if (fields?.['description'] !== undefined) {
                const desc = fields['description'];
                issue.description = typeof desc === 'string' ? desc : (desc !== null ? JSON.stringify(desc) : null);
              }
            } catch {
              failed.push(issue);
            }
          }),
        );
      }

      pending = failed;
    }
  }
}
