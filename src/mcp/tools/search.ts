import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { IssueRow } from '../types.js';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  getErrorMessage,
  str,
} from '../helpers.js';

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    'hybrid_search',
    {
      description: 'Hybrid search across issues combining full-text keyword matching and semantic vector similarity using Reciprocal Rank Fusion. Works without embeddings (text-only fallback). For best results, run "argustack embed" first.',
      inputSchema: {
        query: z.string().describe('Natural language search query (e.g. "authentication timeout problems")'),
        limit: z.number().optional().describe('Max results (default: 10)'),
        threshold: z.number().optional().describe('Minimum similarity score 0-1 for vector results (default: 0.5)'),
      },
    },
    async ({ query, limit, threshold }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);

      try {
        let queryVector: number[] | null = null;

        const apiKey = process.env['OPENAI_API_KEY'];
        if (apiKey) {
          const { OpenAIEmbeddingProvider } = await import('../../adapters/openai/index.js');
          const embeddingProvider = new OpenAIEmbeddingProvider({ apiKey });
          const vectors = await embeddingProvider.embed([query]);
          queryVector = vectors[0] ?? null;
        }

        const results = await storage.hybridSearch(
          query,
          queryVector,
          limit ?? 10,
          threshold ?? 0.5,
        );

        if (results.length === 0) {
          await storage.close();
          const mode = queryVector ? 'hybrid (text + semantic)' : 'text-only';
          return textResponse(`No issues found for "${query}" (${mode} search).`);
        }

        const issueKeys = results.map((r) => r.issueKey);
        const placeholders = issueKeys.map((_, i) => `$${String(i + 1)}`).join(',');
        const issuesResult = await storage.query(
          `SELECT issue_key, summary, status, assignee, issue_type FROM issues WHERE issue_key IN (${placeholders})`,
          issueKeys,
        );

        await storage.close();

        const issueMap = new Map<string, Record<string, unknown>>();
        for (const row of issuesResult.rows) {
          const r = row as { issue_key: string };
          issueMap.set(r.issue_key, row);
        }

        const mode = queryVector ? 'hybrid' : 'text-only';
        const lines = results.map((r) => {
          const issue = issueMap.get(r.issueKey) as IssueRow | undefined;
          const scoreStr = (r.score * 100).toFixed(1);
          if (issue) {
            return `${r.issueKey} [${str(issue.status)}] ${str(issue.summary)} (${scoreStr}% | ${r.source})`;
          }
          return `${r.issueKey} (${scoreStr}% | ${r.source})`;
        });

        return textResponse([`Search: "${query}" (${mode}, ${String(results.length)} results):`, '', ...lines].join('\n'));
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Search failed: ${getErrorMessage(err)}`);
      }
    },
  );
}
