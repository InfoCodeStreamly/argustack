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
    'semantic_search',
    {
      description: 'Semantic vector similarity search across issues. Uses AI embeddings to find issues by meaning, not just keywords. Requires embeddings generated first ("argustack embed").',
      inputSchema: {
        query: z.string().describe('Natural language search query (e.g. "authentication timeout problems")'),
        limit: z.number().optional().describe('Max results (default: 10)'),
        threshold: z.number().optional().describe('Minimum similarity score 0-1 (default: 0.5)'),
      },
    },
    async ({ query, limit, threshold }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);

      try {
        const apiKey = process.env['OPENAI_API_KEY'];
        if (!apiKey) {
          await storage.close();
          return errorResponse('OPENAI_API_KEY not configured. Add it to .env and run "argustack embed" first.');
        }

        const { OpenAIEmbeddingProvider } = await import('../../adapters/openai/index.js');
        const embeddingProvider = new OpenAIEmbeddingProvider({ apiKey });

        const vectors = await embeddingProvider.embed([query]);
        const queryVector = vectors[0];

        if (!queryVector) {
          await storage.close();
          return errorResponse('Failed to generate embedding for query.');
        }

        const results = await storage.semanticSearch(
          queryVector,
          limit ?? 10,
          threshold ?? 0.5,
        );

        if (results.length === 0) {
          await storage.close();
          return textResponse('No similar issues found. Make sure embeddings are generated ("argustack embed").');
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

        const lines = results.map((r) => {
          const issue = issueMap.get(r.issueKey) as IssueRow | undefined;
          const sim = (r.similarity * 100).toFixed(1);
          if (issue) {
            return `${r.issueKey} [${str(issue.status)}] ${str(issue.summary)} (${sim}% match)`;
          }
          return `${r.issueKey} (${sim}% match)`;
        });

        return textResponse([`Semantic search: "${query}" (${String(results.length)} results):`, '', ...lines].join('\n'));
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Search failed: ${getErrorMessage(err)}`);
      }
    },
  );
}
