import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { IssueRow, CommitRow, PrRow } from '../types.js';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  getErrorMessage,
  str,
} from '../helpers.js';

export function registerQueryTools(server: McpServer): void {
  server.registerTool(
    'query_issues',
    {
      description: 'Query Jira issues in local database. Use "search" for text search, filters (project, status, assignee) for structured queries, or "sql" for complex queries. For natural language search prefer hybrid_search. If search returns 0 results, try ILIKE in sql param: WHERE summary ILIKE \'%keyword%\'.',
      inputSchema: {
        search: z.string().optional().describe('Full-text search query (e.g. "payment bug", "template recipients")'),
        project: z.string().optional().describe('Filter by project key (e.g. "PROJ")'),
        status: z.string().optional().describe('Filter by status (e.g. "Open", "In Progress", "Done")'),
        assignee: z.string().optional().describe('Filter by assignee display name'),
        issue_type: z.string().optional().describe('Filter by issue type (e.g. "Bug", "Story", "Task")'),
        limit: z.number().optional().describe('Max results to return (default: 50)'),
        sql: z.string().optional().describe('Raw SQL query for advanced queries. Table: issues. Use for complex analysis.'),
      },
    },
    async ({ search, project, status, assignee, issue_type: issueType, limit, sql }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);

      try {
        const maxResults = limit ?? 50;

        let sqlQuery: string;
        let params: unknown[];
        const conditions: string[] = [];

        if (sql) {
          sqlQuery = sql;
          params = [];
        } else {
          params = [];
          let paramIdx = 1;

          if (search) {
            conditions.push(`search_vector @@ plainto_tsquery('english', $${String(paramIdx)})`);
            params.push(search);
            paramIdx++;
          }

          if (project) {
            conditions.push(`project_key = $${String(paramIdx)}`);
            params.push(project.toUpperCase());
            paramIdx++;
          }

          if (status) {
            conditions.push(`status ILIKE $${String(paramIdx)}`);
            params.push(status);
            paramIdx++;
          }

          if (assignee) {
            conditions.push(`assignee ILIKE $${String(paramIdx)}`);
            params.push(`%${assignee}%`);
            paramIdx++;
          }

          if (issueType) {
            conditions.push(`issue_type ILIKE $${String(paramIdx)}`);
            params.push(issueType);
            paramIdx++;
          }

          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

          sqlQuery = `
            SELECT issue_key, summary, status, priority, assignee, issue_type,
                   project_key, created, updated
            FROM issues
            ${where}
            ORDER BY updated DESC NULLS LAST
            LIMIT ${String(maxResults)}
          `;
        }

        let result = await storage.query(sqlQuery, params);

        if (result.rows.length === 0 && search && !sql) {
          const ilikeCond = `(summary ILIKE $1 OR description ILIKE $1)`;
          const otherConds = params.length > 1
            ? ` AND ${conditions.slice(1).join(' AND ')}`
            : '';
          const fallbackSql = `
            SELECT issue_key, summary, status, priority, assignee, issue_type,
                   project_key, created, updated
            FROM issues
            WHERE ${ilikeCond}${otherConds}
            ORDER BY updated DESC NULLS LAST
            LIMIT ${String(maxResults)}
          `;
          const fallbackParams = [`%${search}%`, ...params.slice(1)];
          result = await storage.query(fallbackSql, fallbackParams);
        }

        await storage.close();

        if (result.rows.length === 0) {
          return textResponse('No issues found matching your criteria.');
        }

        const lines = result.rows.map((row: Record<string, unknown>) => {
          const typed = row as unknown as IssueRow;
          if (typed.issue_key) {
            return `${typed.issue_key} [${str(typed.status) || '?'}] ${str(typed.summary)} (${str(typed.assignee) || 'unassigned'})`;
          }
          return JSON.stringify(row);
        });

        return textResponse([
          `Found ${String(result.rows.length)} results:`,
          '',
          ...lines,
        ].join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    'query_commits',
    {
      description: 'Query Git commits in local database. Use "search" for text search in commit messages, filters (author, since, until) for structured queries, or "sql" for complex queries. Requires Git sync. For commits related to a specific Jira issue use issue_commits instead.',
      inputSchema: {
        search: z.string().optional().describe('Full-text search in commit messages (e.g. "fix login", "PROJ-123")'),
        author: z.string().optional().describe('Filter by author name'),
        since: z.string().optional().describe('Commits after this date (YYYY-MM-DD)'),
        until: z.string().optional().describe('Commits before this date (YYYY-MM-DD)'),
        file_path: z.string().optional().describe('Filter by changed file path (e.g. "src/auth/login.ts")'),
        repo_path: z.string().optional().describe('Filter by repository path (substring match)'),
        limit: z.number().optional().describe('Max results (default: 50)'),
        sql: z.string().optional().describe('Raw SQL query. Tables: commits, commit_files, commit_issue_refs'),
      },
    },
    async ({ search, author, since, until, file_path: filePath, repo_path: repoPath, limit, sql }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);

      try {
        const maxResults = limit ?? 50;
        let sqlQuery: string;
        let params: unknown[];

        if (sql) {
          sqlQuery = sql;
          params = [];
        } else {
          const conditions: string[] = [];
          params = [];
          let paramIdx = 1;
          let needJoin = false;

          if (search) {
            conditions.push(`c.search_vector @@ plainto_tsquery('english', $${String(paramIdx)})`);
            params.push(search);
            paramIdx++;
          }

          if (author) {
            conditions.push(`c.author ILIKE $${String(paramIdx)}`);
            params.push(`%${author}%`);
            paramIdx++;
          }

          if (since) {
            conditions.push(`c.committed_at >= $${String(paramIdx)}`);
            params.push(since);
            paramIdx++;
          }

          if (until) {
            conditions.push(`c.committed_at <= $${String(paramIdx)}`);
            params.push(until);
            paramIdx++;
          }

          if (filePath) {
            needJoin = true;
            conditions.push(`cf.file_path ILIKE $${String(paramIdx)}`);
            params.push(`%${filePath}%`);
            paramIdx++;
          }

          if (repoPath) {
            conditions.push(`c.repo_path ILIKE $${String(paramIdx)}`);
            params.push(`%${repoPath}%`);
            paramIdx++;
          }

          const from = needJoin
            ? 'commits c JOIN commit_files cf ON c.hash = cf.commit_hash'
            : 'commits c';
          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

          sqlQuery = `
            SELECT DISTINCT c.hash, c.message, c.author, c.email, c.committed_at, c.repo_path
            FROM ${from}
            ${where}
            ORDER BY c.committed_at DESC NULLS LAST
            LIMIT ${String(maxResults)}
          `;
        }

        const result = await storage.query(sqlQuery, params);
        await storage.close();

        if (result.rows.length === 0) {
          return textResponse('No commits found matching your criteria.');
        }

        const lines = result.rows.map((row: Record<string, unknown>) => {
          const typed = row as unknown as CommitRow;
          if (typed.hash) {
            const shortHash = typed.hash.substring(0, 7);
            const date = typed.committed_at ? str(typed.committed_at).substring(0, 10) : '?';
            return `${shortHash} ${date} ${str(typed.author)}: ${str(typed.message).split('\n')[0]}`;
          }
          return JSON.stringify(row);
        });

        return textResponse([`Found ${String(result.rows.length)} commits:`, '', ...lines].join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    'query_prs',
    {
      description: 'Query GitHub pull requests in local database. Use "search" for text search in PR titles, filters (state, author, base) for structured queries, or "sql" for complex queries. Requires GitHub sync. For PRs related to a specific Jira issue use issue_prs instead.',
      inputSchema: {
        search: z.string().optional().describe('Full-text search in PR title and body'),
        state: z.string().optional().describe('Filter by state: open, closed, merged'),
        author: z.string().optional().describe('Filter by PR author'),
        base_ref: z.string().optional().describe('Filter by base branch (e.g. "main")'),
        since: z.string().optional().describe('PRs updated since date (YYYY-MM-DD)'),
        limit: z.number().optional().describe('Max results (default: 50)'),
        sql: z.string().optional().describe('Raw SQL. Tables: pull_requests, pr_reviews, pr_comments, pr_files, pr_issue_refs'),
      },
    },
    async ({ search, state, author, base_ref: baseRef, since, limit, sql }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);

      try {
        const maxResults = limit ?? 50;
        let sqlQuery: string;
        let params: unknown[];

        if (sql) {
          sqlQuery = sql;
          params = [];
        } else {
          const conditions: string[] = [];
          params = [];
          let paramIdx = 1;

          if (search) {
            conditions.push(`search_vector @@ plainto_tsquery('english', $${String(paramIdx)})`);
            params.push(search);
            paramIdx++;
          }
          if (state) {
            conditions.push(`state = $${String(paramIdx)}`);
            params.push(state.toLowerCase());
            paramIdx++;
          }
          if (author) {
            conditions.push(`author ILIKE $${String(paramIdx)}`);
            params.push(`%${author}%`);
            paramIdx++;
          }
          if (baseRef) {
            conditions.push(`base_ref = $${String(paramIdx)}`);
            params.push(baseRef);
            paramIdx++;
          }
          if (since) {
            conditions.push(`updated_at >= $${String(paramIdx)}`);
            params.push(since);
            paramIdx++;
          }

          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          sqlQuery = `
            SELECT number, title, state, author, created_at, updated_at, merged_at,
                   base_ref, additions, deletions
            FROM pull_requests
            ${where}
            ORDER BY updated_at DESC NULLS LAST
            LIMIT ${String(maxResults)}
          `;
        }

        const result = await storage.query(sqlQuery, params);
        await storage.close();

        if (result.rows.length === 0) {
          return textResponse('No pull requests found. Run "argustack sync git" with GITHUB_TOKEN configured.');
        }

        const lines = result.rows.map((row: Record<string, unknown>) => {
          const typed = row as unknown as PrRow;
          if (typed.number) {
            const date = typed.merged_at ? str(typed.merged_at).substring(0, 10) : str(typed.updated_at ?? '').substring(0, 10);
            return `#${str(typed.number)} [${str(typed.state)}] ${str(typed.title)} by ${str(typed.author)} (${date}) +${str(typed.additions)}/-${str(typed.deletions)}`;
          }
          return JSON.stringify(row);
        });

        return textResponse([`Found ${String(result.rows.length)} pull requests:`, '', ...lines].join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    'query_releases',
    {
      description: 'List GitHub releases — tags, dates, release notes. Use for "when was this shipped?" or "what was in the last release?" questions. Requires GitHub sync with releases enabled.',
      inputSchema: {
        search: z.string().optional().describe('Full-text search in release name/body'),
        limit: z.number().optional().describe('Max results (default: 20)'),
      },
    },
    async ({ search, limit }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);

      try {
        const maxResults = limit ?? 20;
        let sqlQuery: string;
        const params: unknown[] = [];

        if (search) {
          sqlQuery = `
            SELECT tag_name, name, author, published_at, draft, prerelease
            FROM releases
            WHERE search_vector @@ plainto_tsquery('english', $1)
            ORDER BY published_at DESC NULLS LAST
            LIMIT ${String(maxResults)}
          `;
          params.push(search);
        } else {
          sqlQuery = `
            SELECT tag_name, name, author, published_at, draft, prerelease
            FROM releases
            ORDER BY published_at DESC NULLS LAST
            LIMIT ${String(maxResults)}
          `;
        }

        const result = await storage.query(sqlQuery, params);
        await storage.close();

        if (result.rows.length === 0) {
          return textResponse('No releases found. Run "argustack sync git" with GITHUB_TOKEN.');
        }

        const lines = result.rows.map((row: Record<string, unknown>) => {
          const r = row as { tag_name?: string; name?: string; author?: string; published_at?: string; draft?: boolean; prerelease?: boolean };
          const flags = [r.draft ? 'draft' : '', r.prerelease ? 'pre' : ''].filter(Boolean).join(',');
          const date = str(r.published_at ?? '').substring(0, 10);
          return `${str(r.tag_name)} — ${str(r.name) || '(no name)'} by ${str(r.author)} (${date})${flags ? ` [${flags}]` : ''}`;
        });

        return textResponse([`Found ${String(result.rows.length)} releases:`, '', ...lines].join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    }
  );
}
