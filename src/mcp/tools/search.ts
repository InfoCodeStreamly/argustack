import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { IssueRow } from '../types.js';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  workspaceNotFoundResponse,
  getErrorMessage,
  str,
  hasText,
  ANNOTATIONS,
} from '../helpers.js';
import { loadHubConfig } from '../../workspace/hub-config.js';

const workspaceIdParam = z.string().optional().describe('Workspace id or name (defaults to active workspace)');

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    'hybrid_search',
    {
      title: 'Hybrid issue search',
      description: 'Semantic + full-text search across issues in a workspace. Falls back to text-only if no OPENAI_API_KEY.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        query: z.string().describe('Natural language search query'),
        limit: z.number().optional().describe('Max results (default 10)'),
        threshold: z.number().optional().describe('Minimum similarity 0-1 (default 0.5)'),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, query, limit, threshold }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        let queryVector: number[] | null = null;
        const apiKey = loadHubConfig().embedding.openaiApiKey;
        if (hasText(apiKey)) {
          const { OpenAIEmbeddingProvider } = await import('../../adapters/openai/index.js');
          const embeddingProvider = new OpenAIEmbeddingProvider({ apiKey });
          const vectors = await embeddingProvider.embed([query]);
          queryVector = vectors[0] ?? null;
        }

        const results = await storage.hybridSearch(workspaceId, query, queryVector, limit ?? 10, threshold ?? 0.5);

        if (results.length === 0) {
          const mode = queryVector !== null ? 'hybrid (text + semantic)' : 'text-only';
          return textResponse(`No issues found for "${query}" (${mode} search) in workspace ${workspaceId}.`);
        }

        const issueKeys = results.map((r) => r.issueKey);
        const placeholders = issueKeys.map((_, i) => `$${String(i + 2)}`).join(',');
        const issuesResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT issue_key, summary, status, assignee, issue_type FROM issues
           WHERE workspace_id = $1 AND issue_key IN (${placeholders})`,
          issueKeys,
        );

        const issueMap = new Map<string, Record<string, unknown>>();
        for (const row of issuesResult.rows) {
          const r = row as { issue_key: string };
          issueMap.set(r.issue_key, row);
        }

        const mode = queryVector !== null ? 'hybrid' : 'text-only';
        const lines = results.map((r) => {
          const issue = issueMap.get(r.issueKey) as IssueRow | undefined;
          const scoreStr = (r.score * 100).toFixed(1);
          if (issue !== undefined) {
            return `${r.issueKey} [${str(issue.status)}] ${str(issue.summary)} (${scoreStr}% | ${r.source})`;
          }
          return `${r.issueKey} (${scoreStr}% | ${r.source})`;
        });
        return textResponse([`Search: "${query}" (${mode}, ${String(results.length)} results in ${workspaceId}):`, '', ...lines].join('\n'));
      } catch (err) {
        return errorResponse(`Search failed: ${getErrorMessage(err)}`);
      }
    },
  );
}
