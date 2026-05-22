import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import {
  loadWorkspace,
  createCodeAdapters,
  textResponse,
  errorResponse,
  workspaceNotFoundResponse,
  ANNOTATIONS,
} from '../helpers.js';
import type { CodeAdapters } from '../helpers.js';
import { CodeSearchUseCase } from '../../use-cases/code-search.js';
import type { PlannedFile } from '../../core/types/code.js';

const workspaceIdParam = z.string().optional().describe('Workspace id or name (defaults to active workspace)');

async function resolveProjectId(
  adapters: CodeAdapters,
  workspaceId: string,
): Promise<string | null> {
  const byId = await adapters.storage.getProjectById(workspaceId);
  return byId !== null ? byId.id : null;
}

function capitalize(s: string): string {
  if (s.length === 0) { return s; }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatPlannedSection(layer: string, items: PlannedFile[]): string {
  if (items.length === 0) {
    return `### ${layer}\n_no candidates_`;
  }
  const lines = items.map(
    (f) => `- \`${f.filePath}\` — ${f.reason}${f.similarTo !== undefined && f.similarTo.length > 0 ? ` (similar to: ${f.similarTo})` : ''}`,
  );
  return `### ${layer}\n${lines.join('\n')}`;
}

export function registerCodeHybridTools(server: McpServer): void {
  server.registerTool(
    'explain_feature',
    {
      title: 'Explain feature',
      description: 'Explain how a feature works using the workspace code graph + vectors.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        query: z.string(),
        top_k: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, query, top_k: topK }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const adapters = await createCodeAdapters(ws.workspaceId);
      if (adapters === null) { return errorResponse('Code intelligence not configured.'); }
      const projectId = await resolveProjectId(adapters, ws.workspaceId);
      if (projectId === null) { return errorResponse('Project not registered for this workspace.'); }

      const useCase = new CodeSearchUseCase(
        adapters.graph, adapters.vec, adapters.embedding, adapters.chatLlm,
      );
      const input: Parameters<CodeSearchUseCase['explainFeature']>[0] = { projectId, query };
      if (topK !== undefined) { input.topK = topK; }
      const result = await useCase.explainFeature(input);

      const sections: string[] = [`# Feature explanation: "${query}"`, ''];
      if (result.hypotheticalDoc !== null) {
        sections.push('<details><summary>HyDE query expansion (LLM-generated probe)</summary>', '', '```', result.hypotheticalDoc, '```', '</details>', '');
      }

      const layers: ('domain' | 'application' | 'infrastructure' | 'presentation')[] = [
        'domain', 'application', 'infrastructure', 'presentation',
      ];
      let hasAny = false;
      for (const layer of layers) {
        const buckets = result.byLayer[layer];
        if (buckets.length === 0) { continue; }
        hasAny = true;
        sections.push(`## ${capitalize(layer)} (${String(buckets.length)} files)`);
        for (const b of buckets) {
          const symbolList = b.symbols.slice(0, 3).map((s) => `${s.payload.name}:${String(s.payload.startLine)}`).join(', ');
          sections.push(`- \`${b.filePath}\` — ${symbolList}`);
          const snippet = b.symbols[0]?.payload.content;
          if (snippet !== undefined && snippet.length > 0) {
            const trimmed = snippet.split('\n').slice(0, 6).join('\n');
            sections.push('  ```ts');
            for (const line of trimmed.split('\n')) {
              sections.push(`  ${line}`);
            }
            sections.push('  ```');
          }
        }
        sections.push('');
      }
      const unclassified = result.byLayer.unclassified;
      if (unclassified.length > 0) {
        sections.push(`## Other (${String(unclassified.length)} files)`);
        for (const b of unclassified) {
          sections.push(`- \`${b.filePath}\``);
        }
        sections.push('');
      }
      if (!hasAny && unclassified.length === 0) {
        sections.push('_No relevant code found. Try rephrasing or use `find_symbol`/`search_semantic`._');
      }
      if (result.expandedFiles.length > 0) {
        sections.push('## Graph-expanded files (2 hops away)');
        for (const f of result.expandedFiles.slice(0, 20)) {
          sections.push(`- \`${f}\``);
        }
      }
      return textResponse(sections.join('\n'));
    },
  );

  server.registerTool(
    'plan_feature_files',
    {
      title: 'Plan feature files',
      description: 'Returns layered file plan (domain/application/infra/presentation) for a feature description.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        description: z.string(),
        top_k_per_layer: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, description, top_k_per_layer: topKPerLayer }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const adapters = await createCodeAdapters(ws.workspaceId);
      if (adapters === null) { return errorResponse('Code intelligence not configured.'); }
      const projectId = await resolveProjectId(adapters, ws.workspaceId);
      if (projectId === null) { return errorResponse('Project not registered for this workspace.'); }

      const useCase = new CodeSearchUseCase(adapters.graph, adapters.vec, adapters.embedding);
      const input: Parameters<CodeSearchUseCase['planFeatureFiles']>[0] = { projectId, description };
      if (topKPerLayer !== undefined) { input.topKPerLayer = topKPerLayer; }
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
