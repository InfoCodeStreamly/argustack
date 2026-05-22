import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { IssueRow, CommitRow, PrRow } from '../types.js';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  workspaceNotFoundResponse,
  getErrorMessage,
  str,
  strOr,
  hasText,
  ANNOTATIONS,
} from '../helpers.js';

const workspaceIdParam = z.string().optional().describe('Workspace id or name (defaults to active workspace)');

export function registerQueryTools(server: McpServer): void {
  server.registerTool(
    'query_issues',
    {
      title: 'Query Jira issues',
      description: 'Query Jira issues in the active workspace. Use "search" for text, filters (project/status/assignee/issue_type) for structured queries.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        search: z.string().optional().describe('Full-text search query'),
        project: z.string().optional().describe('Filter by project key'),
        status: z.string().optional().describe('Filter by status'),
        assignee: z.string().optional().describe('Filter by assignee display name'),
        issue_type: z.string().optional().describe('Filter by issue type'),
        limit: z.number().optional().describe('Max results (default 50)'),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, search, project, status, assignee, issue_type: issueType, limit }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        const maxResults = limit ?? 50;
        const conditions: string[] = ['workspace_id = $1'];
        const params: unknown[] = [];
        let paramIdx = 2;

        if (hasText(search)) {
          conditions.push(`search_vector @@ plainto_tsquery('english', $${String(paramIdx)})`);
          params.push(search);
          paramIdx++;
        }
        if (hasText(project)) {
          conditions.push(`project_key = $${String(paramIdx)}`);
          params.push(project.toUpperCase());
          paramIdx++;
        }
        if (hasText(status)) {
          conditions.push(`status ILIKE $${String(paramIdx)}`);
          params.push(status);
          paramIdx++;
        }
        if (hasText(assignee)) {
          conditions.push(`assignee ILIKE $${String(paramIdx)}`);
          params.push(`%${assignee}%`);
          paramIdx++;
        }
        if (hasText(issueType)) {
          conditions.push(`issue_type ILIKE $${String(paramIdx)}`);
          params.push(issueType);
          paramIdx++;
        }

        const sqlQuery = `
          SELECT issue_key, summary, status, priority, assignee, issue_type, project_key, created, updated
          FROM issues
          WHERE ${conditions.join(' AND ')}
          ORDER BY updated DESC NULLS LAST
          LIMIT ${String(maxResults)}
        `;

        const result = await storage.queryForWorkspace(workspaceId, sqlQuery, params);

        if (result.rows.length === 0) {
          return textResponse('No issues found matching your criteria.');
        }
        const lines = result.rows.map((row: Record<string, unknown>) => {
          const typed = row as unknown as IssueRow;
          return `${str(typed.issue_key)} [${strOr(typed.status, '?')}] ${str(typed.summary)} (${strOr(typed.assignee, 'unassigned')})`;
        });
        return textResponse([`Found ${String(result.rows.length)} results:`, '', ...lines].join('\n'));
      } catch (err) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'query_commits',
    {
      title: 'Query Git commits',
      description: 'Query Git commits in the active workspace.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        search: z.string().optional(),
        author: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        file_path: z.string().optional(),
        repo_path: z.string().optional(),
        limit: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, search, author, since, until, file_path: filePath, repo_path: repoPath, limit }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        const maxResults = limit ?? 50;
        const conditions: string[] = ['c.workspace_id = $1'];
        const params: unknown[] = [];
        let paramIdx = 2;
        let needJoin = false;

        if (hasText(search)) { conditions.push(`c.search_vector @@ plainto_tsquery('english', $${String(paramIdx)})`); params.push(search); paramIdx++; }
        if (hasText(author)) { conditions.push(`c.author ILIKE $${String(paramIdx)}`); params.push(`%${author}%`); paramIdx++; }
        if (hasText(since)) { conditions.push(`c.committed_at >= $${String(paramIdx)}`); params.push(since); paramIdx++; }
        if (hasText(until)) { conditions.push(`c.committed_at <= $${String(paramIdx)}`); params.push(until); paramIdx++; }
        if (hasText(filePath)) {
          needJoin = true;
          conditions.push(`cf.file_path ILIKE $${String(paramIdx)}`);
          params.push(`%${filePath}%`);
          paramIdx++;
        }
        if (hasText(repoPath)) { conditions.push(`c.repo_path ILIKE $${String(paramIdx)}`); params.push(`%${repoPath}%`); paramIdx++; }

        const from = needJoin
          ? 'commits c JOIN commit_files cf ON cf.workspace_id = c.workspace_id AND cf.commit_hash = c.hash'
          : 'commits c';

        const sqlQuery = `
          SELECT DISTINCT c.hash, c.message, c.author, c.email, c.committed_at, c.repo_path
          FROM ${from}
          WHERE ${conditions.join(' AND ')}
          ORDER BY c.committed_at DESC NULLS LAST
          LIMIT ${String(maxResults)}
        `;
        const result = await storage.queryForWorkspace(workspaceId, sqlQuery, params);

        if (result.rows.length === 0) { return textResponse('No commits found matching your criteria.'); }
        const lines = result.rows.map((row: Record<string, unknown>) => {
          const typed = row as unknown as CommitRow;
          const shortHash = (typed.hash ?? '').substring(0, 7);
          const date = hasText(typed.committed_at) ? str(typed.committed_at).substring(0, 10) : '?';
          return `${shortHash} ${date} ${str(typed.author)}: ${str(typed.message).split('\n')[0]}`;
        });
        return textResponse([`Found ${String(result.rows.length)} commits:`, '', ...lines].join('\n'));
      } catch (err) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'query_prs',
    {
      title: 'Query GitHub pull requests',
      description: 'Query GitHub PRs in the active workspace.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        search: z.string().optional(),
        state: z.string().optional(),
        author: z.string().optional(),
        base_ref: z.string().optional(),
        since: z.string().optional(),
        limit: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, search, state, author, base_ref: baseRef, since, limit }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        const maxResults = limit ?? 50;
        const conditions: string[] = ['workspace_id = $1'];
        const params: unknown[] = [];
        let paramIdx = 2;

        if (hasText(search)) { conditions.push(`search_vector @@ plainto_tsquery('english', $${String(paramIdx)})`); params.push(search); paramIdx++; }
        if (hasText(state)) { conditions.push(`state = $${String(paramIdx)}`); params.push(state.toLowerCase()); paramIdx++; }
        if (hasText(author)) { conditions.push(`author ILIKE $${String(paramIdx)}`); params.push(`%${author}%`); paramIdx++; }
        if (hasText(baseRef)) { conditions.push(`base_ref = $${String(paramIdx)}`); params.push(baseRef); paramIdx++; }
        if (hasText(since)) { conditions.push(`updated_at >= $${String(paramIdx)}`); params.push(since); paramIdx++; }

        const sqlQuery = `
          SELECT number, title, state, author, created_at, updated_at, merged_at, base_ref, additions, deletions
          FROM pull_requests
          WHERE ${conditions.join(' AND ')}
          ORDER BY updated_at DESC NULLS LAST
          LIMIT ${String(maxResults)}
        `;
        const result = await storage.queryForWorkspace(workspaceId, sqlQuery, params);

        if (result.rows.length === 0) { return textResponse('No pull requests found.'); }
        const lines = result.rows.map((row: Record<string, unknown>) => {
          const typed = row as unknown as PrRow;
          const date = hasText(typed.merged_at) ? str(typed.merged_at).substring(0, 10) : str(typed.updated_at ?? '').substring(0, 10);
          return `#${str(typed.number)} [${str(typed.state)}] ${str(typed.title)} by ${str(typed.author)} (${date}) +${str(typed.additions)}/-${str(typed.deletions)}`;
        });
        return textResponse([`Found ${String(result.rows.length)} pull requests:`, '', ...lines].join('\n'));
      } catch (err) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'query_releases',
    {
      title: 'Query GitHub releases',
      description: 'List GitHub releases for the active workspace.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        search: z.string().optional(),
        limit: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, search, limit }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        const maxResults = limit ?? 20;
        const conditions: string[] = ['workspace_id = $1'];
        const params: unknown[] = [];
        if (hasText(search)) {
          conditions.push(`search_vector @@ plainto_tsquery('english', $2)`);
          params.push(search);
        }
        const sqlQuery = `
          SELECT tag_name, name, author, published_at, draft, prerelease
          FROM releases
          WHERE ${conditions.join(' AND ')}
          ORDER BY published_at DESC NULLS LAST
          LIMIT ${String(maxResults)}
        `;
        const result = await storage.queryForWorkspace(workspaceId, sqlQuery, params);

        if (result.rows.length === 0) { return textResponse('No releases found.'); }
        const lines = result.rows.map((row: Record<string, unknown>) => {
          const r = row as { tag_name?: string; name?: string; author?: string; published_at?: string; draft?: boolean; prerelease?: boolean };
          const flags = [r.draft === true ? 'draft' : '', r.prerelease === true ? 'pre' : ''].filter((s) => s.length > 0).join(',');
          const date = str(r.published_at ?? '').substring(0, 10);
          return `${str(r.tag_name)} — ${strOr(r.name, '(no name)')} by ${str(r.author)} (${date})${flags.length > 0 ? ` [${flags}]` : ''}`;
        });
        return textResponse([`Found ${String(result.rows.length)} releases:`, '', ...lines].join('\n'));
      } catch (err) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    },
  );
}
