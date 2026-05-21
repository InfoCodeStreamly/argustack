import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import {
  loadWorkspace,
  createCodeAdapters,
  textResponse,
  errorResponse,
  ANNOTATIONS,
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
  workspaceId: string,
): Promise<string | null> {
  const byId = await adapters.storage.getProjectById(workspaceId);
  return byId ? byId.id : null;
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
      title: 'Semantic code search',
      description: 'Semantic search over indexed code chunks for a workspace.',
      inputSchema: {
        workspace_id: z.string().optional().describe('Workspace id or name (defaults to active workspace)'),
        query: z.string().describe('Natural-language query'),
        layer: z.enum(LAYER_VALUES).optional(),
        kind: z.enum(KIND_VALUES).optional(),
        top_k: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, query, layer, kind, top_k: topK }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const adapters = await createCodeAdapters(ws.workspaceId);
      if (!adapters) {
        return errorResponse('Code intelligence not configured. Check NEO4J_URI/QDRANT_URL/VOYAGE_API_KEY in ~/.argustack/config.env');
      }
      const projectId = await resolveProjectId(adapters, ws.workspaceId);
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
      title: 'Find similar code',
      description: 'Find code chunks semantically similar to a given symbol.',
      inputSchema: {
        workspace_id: z.string().optional().describe('Workspace id or name'),
        qualified_name: z.string(),
        top_k: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, qualified_name: qualifiedName, top_k: topK }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const adapters = await createCodeAdapters(ws.workspaceId);
      if (!adapters) { return errorResponse('Code intelligence not configured.'); }
      const projectId = await resolveProjectId(adapters, ws.workspaceId);
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
