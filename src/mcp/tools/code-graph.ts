import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import {
  loadWorkspace,
  createCodeAdapters,
  textResponse,
  errorResponse,
} from '../helpers.js';
import type { CodeAdapters } from '../helpers.js';
import type { CodeSymbol, CodeFile, CodeLayer } from '../../core/types/code.js';

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

function formatSymbol(s: CodeSymbol): string {
  const layer = s.layer ? ` [${s.layer}]` : '';
  return `- **${s.qualifiedName}** (${s.kind})${layer} — ${s.filePath}:${String(s.startLine)}`;
}

function formatFile(f: CodeFile): string {
  const layer = f.layer ? ` [${f.layer}]` : '';
  return `- ${f.path}${layer}`;
}

async function runWithAdapters<T>(
  fn: (adapters: CodeAdapters) => Promise<T>,
): Promise<T | { error: string }> {
  const ws = loadWorkspace();
  if (!ws.ok) {
    return { error: `Workspace not found: ${ws.reason}` };
  }
  const adapters = await createCodeAdapters(ws.root);
  if (!adapters) {
    return {
      error:
        'Code intelligence not configured. Set NEO4J_URI, QDRANT_URL, VOYAGE_API_KEY in workspace .env',
    };
  }
  return fn(adapters);
}

export function registerCodeGraphTools(server: McpServer): void {
  server.registerTool(
    'find_symbol',
    {
      description:
        'Find symbols (functions/classes/methods/interfaces/types) by name fragment. Returns file path + line. Use to locate code without grep.',
      inputSchema: {
        query: z.string().describe('Symbol name fragment, case-insensitive'),
        kind: z.enum(KIND_VALUES).optional().describe('Filter by kind'),
        layer: z.enum(LAYER_VALUES).optional().describe('Filter by architecture layer'),
        limit: z.number().optional().describe('Max results (default 25)'),
        project_id: z.string().optional().describe('Project id (default: auto-detect from CWD)'),
      },
    },
    async ({ query, kind, layer, limit, project_id: projectIdInput }) => {
      const result = await runWithAdapters(async (adapters) => {
        const projectId = await resolveProjectId(adapters, projectIdInput);
        if (!projectId) {return { error: 'Project not registered. Run `argustack code register --name <name>`.' };}
        const findOpts: Parameters<CodeAdapters['graph']['findSymbol']>[0] = {
          projectId,
          query,
        };
        if (kind) {findOpts.kind = kind;}
        if (layer) {findOpts.layer = layer;}
        if (limit !== undefined) {findOpts.limit = limit;}
        const symbols = await adapters.graph.findSymbol(findOpts);
        if (symbols.length === 0) {
          return { text: `No symbols matching "${query}".` };
        }
        return {
          text: `# Symbols matching "${query}"\n\n${symbols.map(formatSymbol).join('\n')}`,
        };
      });
      if ('error' in result) {return errorResponse(result.error);}
      return textResponse(result.text);
    },
  );

  server.registerTool(
    'get_dependencies',
    {
      description:
        'Return files that the given file imports (transitively). Use to understand downstream impact.',
      inputSchema: {
        file: z.string().describe('File path relative to project root'),
        depth: z.number().optional().describe('Traversal depth (default 2)'),
        project_id: z.string().optional(),
      },
    },
    async ({ file, depth, project_id: projectIdInput }) => {
      const result = await runWithAdapters(async (adapters) => {
        const projectId = await resolveProjectId(adapters, projectIdInput);
        if (!projectId) {return { error: 'Project not registered.' };}
        const files = await adapters.graph.getDependencies(projectId, file, depth ?? 2);
        if (files.length === 0) {return { text: `${file} has no resolved imports.` };}
        return { text: `# Dependencies of ${file}\n\n${files.map(formatFile).join('\n')}` };
      });
      if ('error' in result) {return errorResponse(result.error);}
      return textResponse(result.text);
    },
  );

  server.registerTool(
    'get_dependents',
    {
      description: 'Return files that import the given file (upstream).',
      inputSchema: {
        file: z.string(),
        depth: z.number().optional(),
        project_id: z.string().optional(),
      },
    },
    async ({ file, depth, project_id: projectIdInput }) => {
      const result = await runWithAdapters(async (adapters) => {
        const projectId = await resolveProjectId(adapters, projectIdInput);
        if (!projectId) {return { error: 'Project not registered.' };}
        const files = await adapters.graph.getDependents(projectId, file, depth ?? 2);
        if (files.length === 0) {return { text: `${file} has no resolved dependents.` };}
        return { text: `# Dependents of ${file}\n\n${files.map(formatFile).join('\n')}` };
      });
      if ('error' in result) {return errorResponse(result.error);}
      return textResponse(result.text);
    },
  );

  server.registerTool(
    'get_callers',
    {
      description: 'Return symbols that call the given qualified name (transitively).',
      inputSchema: {
        qualified_name: z.string(),
        depth: z.number().optional(),
        project_id: z.string().optional(),
      },
    },
    async ({ qualified_name: qualifiedName, depth, project_id: projectIdInput }) => {
      const result = await runWithAdapters(async (adapters) => {
        const projectId = await resolveProjectId(adapters, projectIdInput);
        if (!projectId) {return { error: 'Project not registered.' };}
        const symbols = await adapters.graph.getCallers(projectId, qualifiedName, depth ?? 3);
        if (symbols.length === 0) {return { text: `No callers found for ${qualifiedName}.` };}
        return { text: `# Callers of ${qualifiedName}\n\n${symbols.map(formatSymbol).join('\n')}` };
      });
      if ('error' in result) {return errorResponse(result.error);}
      return textResponse(result.text);
    },
  );

  server.registerTool(
    'get_callees',
    {
      description: 'Return symbols called by the given qualified name (transitively).',
      inputSchema: {
        qualified_name: z.string(),
        depth: z.number().optional(),
        project_id: z.string().optional(),
      },
    },
    async ({ qualified_name: qualifiedName, depth, project_id: projectIdInput }) => {
      const result = await runWithAdapters(async (adapters) => {
        const projectId = await resolveProjectId(adapters, projectIdInput);
        if (!projectId) {return { error: 'Project not registered.' };}
        const symbols = await adapters.graph.getCallees(projectId, qualifiedName, depth ?? 3);
        if (symbols.length === 0) {return { text: `${qualifiedName} calls nothing tracked.` };}
        return { text: `# Callees of ${qualifiedName}\n\n${symbols.map(formatSymbol).join('\n')}` };
      });
      if ('error' in result) {return errorResponse(result.error);}
      return textResponse(result.text);
    },
  );

  server.registerTool(
    'get_call_path',
    {
      description: 'Find shortest CALLS path between two qualified names. Returns ordered list of symbols.',
      inputSchema: {
        from: z.string(),
        to: z.string(),
        project_id: z.string().optional(),
      },
    },
    async ({ from, to, project_id: projectIdInput }) => {
      const result = await runWithAdapters(async (adapters) => {
        const projectId = await resolveProjectId(adapters, projectIdInput);
        if (!projectId) {return { error: 'Project not registered.' };}
        const path = await adapters.graph.getCallPath(projectId, from, to);
        if (!path) {return { text: `No call path from ${from} → ${to}.` };}
        return {
          text: `# Call path: ${from} → ${to}\n\n${path.map((s, i) => `${String(i + 1)}. ${formatSymbol(s)}`).join('\n')}`,
        };
      });
      if ('error' in result) {return errorResponse(result.error);}
      return textResponse(result.text);
    },
  );

  server.registerTool(
    'find_arch_violations',
    {
      description:
        'Find Clean Architecture violations: domain → infra/presentation, application → presentation. Returns the violating call edges.',
      inputSchema: { project_id: z.string().optional() },
    },
    async ({ project_id: projectIdInput }) => {
      const result = await runWithAdapters(async (adapters) => {
        const projectId = await resolveProjectId(adapters, projectIdInput);
        if (!projectId) {return { error: 'Project not registered.' };}
        const violations = await adapters.graph.findArchViolations(projectId);
        if (violations.length === 0) {return { text: 'No architecture violations detected.' };}
        const lines = violations.map((v) => `- ${v.fromQn} → ${v.toQn} (count: ${String(v.count)})`);
        return { text: `# Architecture violations (${String(violations.length)})\n\n${lines.join('\n')}` };
      });
      if ('error' in result) {return errorResponse(result.error);}
      return textResponse(result.text);
    },
  );

  server.registerTool(
    'find_unused_exports',
    {
      description: 'Find exported symbols with no incoming references (no callers, no implementations, no extensions). Candidates for deletion.',
      inputSchema: { project_id: z.string().optional() },
    },
    async ({ project_id: projectIdInput }) => {
      const result = await runWithAdapters(async (adapters) => {
        const projectId = await resolveProjectId(adapters, projectIdInput);
        if (!projectId) {return { error: 'Project not registered.' };}
        const symbols = await adapters.graph.findUnusedExports(projectId);
        if (symbols.length === 0) {return { text: 'No unused exports.' };}
        return { text: `# Unused exports\n\n${symbols.map(formatSymbol).join('\n')}` };
      });
      if ('error' in result) {return errorResponse(result.error);}
      return textResponse(result.text);
    },
  );

  server.registerTool(
    'get_implementers',
    {
      description: 'Return classes that implement the given interface (qualified name).',
      inputSchema: {
        interface_qualified_name: z.string(),
        project_id: z.string().optional(),
      },
    },
    async ({ interface_qualified_name: interfaceQualifiedName, project_id: projectIdInput }) => {
      const result = await runWithAdapters(async (adapters) => {
        const projectId = await resolveProjectId(adapters, projectIdInput);
        if (!projectId) {return { error: 'Project not registered.' };}
        const symbols = await adapters.graph.getImplementers(projectId, interfaceQualifiedName);
        if (symbols.length === 0) {return { text: `No implementers of ${interfaceQualifiedName}.` };}
        return { text: `# Implementers of ${interfaceQualifiedName}\n\n${symbols.map(formatSymbol).join('\n')}` };
      });
      if ('error' in result) {return errorResponse(result.error);}
      return textResponse(result.text);
    },
  );

  server.registerTool(
    'get_layer_symbols',
    {
      description: 'Return all symbols in a given architecture layer (domain/application/infrastructure/presentation).',
      inputSchema: {
        layer: z.enum(LAYER_VALUES),
        project_id: z.string().optional(),
      },
    },
    async ({ layer, project_id: projectIdInput }) => {
      const result = await runWithAdapters(async (adapters) => {
        const projectId = await resolveProjectId(adapters, projectIdInput);
        if (!projectId) {return { error: 'Project not registered.' };}
        const symbols = await adapters.graph.getLayerSymbols(projectId, layer as CodeLayer);
        if (symbols.length === 0) {return { text: `No symbols in layer ${layer}.` };}
        return { text: `# Symbols in layer '${layer}' (${String(symbols.length)})\n\n${symbols.slice(0, 100).map(formatSymbol).join('\n')}` };
      });
      if ('error' in result) {return errorResponse(result.error);}
      return textResponse(result.text);
    },
  );
}
