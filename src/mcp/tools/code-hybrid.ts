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
import type { PlannedFile } from '../../core/types/code.js';

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

function formatPlannedSection(layer: string, items: PlannedFile[]): string {
  if (items.length === 0) {
    return `### ${layer}\n_no candidates_`;
  }
  const lines = items.map(
    (f) =>
      `- \`${f.filePath}\` — ${f.reason}${f.similarTo ? ` (similar to: ${f.similarTo})` : ''}`,
  );
  return `### ${layer}\n${lines.join('\n')}`;
}

export function registerCodeHybridTools(server: McpServer): void {
  server.registerTool(
    'explain_feature',
    {
      description:
        'Explain how a feature works: 4-stage pipeline (semantic search → graph expand → rerank → cluster by layer). Returns layered code map for the topic.',
      inputSchema: {
        query: z.string().describe('Feature or behavior description'),
        top_k: z.number().optional(),
        project_id: z.string().optional(),
      },
    },
    async ({ query, top_k: topK, project_id: projectIdInput }) => {
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
      const useCase = new CodeSearchUseCase(adapters.graph, adapters.vec, adapters.embedding);
      const input: Parameters<CodeSearchUseCase['explainFeature']>[0] = {
        projectId,
        query,
      };
      if (topK !== undefined) {
        input.topK = topK;
      }
      const result = await useCase.explainFeature(input);

      const sections: string[] = [`# Feature explanation: "${query}"`, ''];
      const layers: ('domain' | 'application' | 'infrastructure' | 'presentation')[] = [
        'domain',
        'application',
        'infrastructure',
        'presentation',
      ];
      for (const layer of layers) {
        const hits = result.byLayer[layer];
        if (hits.length === 0) {
          continue;
        }
        sections.push(`## ${layer}`);
        for (const h of hits) {
          sections.push(`- ${h.payload.name} (${h.payload.kind}) — ${h.payload.filePath}:${String(h.payload.startLine)}`);
        }
        sections.push('');
      }
      if (result.expandedFiles.length > 0) {
        sections.push('## Graph-expanded files');
        for (const f of result.expandedFiles.slice(0, 20)) {
          sections.push(`- ${f}`);
        }
      }
      return textResponse(sections.join('\n'));
    },
  );

  server.registerTool(
    'plan_feature_files',
    {
      description:
        'Killer feature for /create-technical-plan: returns a layered list of files (domain/application/infrastructure/presentation) Claude should consider when planning a new feature. Combines semantic match + graph neighborhood.',
      inputSchema: {
        description: z.string().describe('Feature description'),
        top_k_per_layer: z.number().optional().describe('Default 5'),
        project_id: z.string().optional(),
      },
    },
    async ({ description, top_k_per_layer: topKPerLayer, project_id: projectIdInput }) => {
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
      const useCase = new CodeSearchUseCase(adapters.graph, adapters.vec, adapters.embedding);
      const input: Parameters<CodeSearchUseCase['planFeatureFiles']>[0] = {
        projectId,
        description,
      };
      if (topKPerLayer !== undefined) {
        input.topKPerLayer = topKPerLayer;
      }
      const plan = await useCase.planFeatureFiles(input);
      const text = [
        `# Plan files for: "${description}"`,
        '',
        formatPlannedSection('Domain', plan.domain),
        '',
        formatPlannedSection('Application', plan.application),
        '',
        formatPlannedSection('Infrastructure', plan.infrastructure),
        '',
        formatPlannedSection('Presentation', plan.presentation),
      ].join('\n');
      return textResponse(text);
    },
  );
}
