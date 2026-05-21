import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import {
  loadWorkspace,
  createCodeAdapters,
  textResponse,
  errorResponse,
} from '../helpers.js';
import type { CodeAdapters } from '../helpers.js';
import { CodeSearchUseCase } from '../../use-cases/code-search.js';
import type { SemanticHit } from '../../core/types/code.js';

const KIND_VALUES = [
  'function',
  'class',
  'method',
  'interface',
  'type',
  'enum',
  'const',
  'component',
] as const;
const LAYER_VALUES = ['domain', 'application', 'infrastructure', 'presentation'] as const;

async function resolveProjectId(
  adapters: CodeAdapters,
  explicitId: string | undefined,
): Promise<string | null> {
  if (explicitId) {
    const byId = await adapters.storage.getProjectById(explicitId);
    return byId ? byId.id : null;
  }
  const byRoot = await adapters.storage.getProjectByRoot(process.cwd());
  return byRoot ? byRoot.id : null;
}

function formatHit(hit: SemanticHit & { rerankScore?: number }): string {
  const score = hit.rerankScore !== undefined ? hit.rerankScore.toFixed(3) : hit.score.toFixed(3);
  const layer = hit.payload.layer ? `[${hit.payload.layer}] ` : '';
  return `- **${hit.payload.name}** (${hit.payload.kind}) ${layer}— ${hit.payload.filePath}:${String(hit.payload.startLine)} _(score: ${score})_`;
}

export function registerCodeSearchTools(server: McpServer): void {
  server.registerTool(
    'search_semantic',
    {
      description:
        'Semantic search over indexed code chunks. Embeds your query with voyage-code-3 and finds top matches by intent (not keyword). Returns file/lines/layer/preview.',
      inputSchema: {
        query: z.string().describe('Natural-language query (e.g. "tax calculation", "auth middleware")'),
        layer: z.enum(LAYER_VALUES).optional(),
        kind: z.enum(KIND_VALUES).optional(),
        top_k: z.number().optional().describe('Default 10'),
        project_id: z.string().optional(),
      },
    },
    async ({ query, layer, kind, top_k: topK, project_id: projectIdInput }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }
      const adapters = await createCodeAdapters(ws.root);
      if (!adapters) {
        return errorResponse(
          'Code intelligence not configured. Set NEO4J_URI, QDRANT_URL, VOYAGE_API_KEY in workspace .env',
        );
      }
      const projectId = await resolveProjectId(adapters, projectIdInput);
      if (!projectId) {
        return errorResponse('Project not registered. Run `argustack code register --name <name>`.');
      }
      const useCase = new CodeSearchUseCase(adapters.graph, adapters.vec, adapters.embedding);
      const input: Parameters<CodeSearchUseCase['searchSemantic']>[0] = { projectId, query };
      if (layer) {
        input.layer = layer;
      }
      if (kind) {
        input.kind = kind;
      }
      if (topK !== undefined) {
        input.topK = topK;
      }
      const hits = await useCase.searchSemantic(input);
      if (hits.length === 0) {
        return textResponse(`No semantic matches for "${query}".`);
      }
      return textResponse(
        `# Semantic matches for "${query}"\n\n${hits.map(formatHit).join('\n')}`,
      );
    },
  );

  server.registerTool(
    'find_similar_code',
    {
      description: 'Find code chunks semantically similar to a given symbol (by qualified name).',
      inputSchema: {
        qualified_name: z.string(),
        top_k: z.number().optional(),
        project_id: z.string().optional(),
      },
    },
    async ({ qualified_name: qualifiedName, top_k: topK, project_id: projectIdInput }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }
      const adapters = await createCodeAdapters(ws.root);
      if (!adapters) {
        return errorResponse('Code intelligence not configured.');
      }
      const projectId = await resolveProjectId(adapters, projectIdInput);
      if (!projectId) {
        return errorResponse('Project not registered.');
      }
      const hits = await adapters.vec.findSimilar(projectId, qualifiedName, topK ?? 10);
      if (hits.length === 0) {
        return textResponse(`No similar chunks for ${qualifiedName}.`);
      }
      return textResponse(
        `# Similar to ${qualifiedName}\n\n${hits.map(formatHit).join('\n')}`,
      );
    },
  );
}
