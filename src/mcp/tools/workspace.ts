import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { SOURCE_META } from '../../core/types/index.js';
import {
  loadWorkspace,
  createAdapters,
  getEnabledSources,
  switchWorkspace,
  listSiblingWorkspaces,
  textResponse,
  errorResponse,
  getErrorMessage,
} from '../helpers.js';
import { registerWorkspace } from '../../workspace/registry.js';

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    'workspace_info',
    {
      description: 'Get current workspace status: name, root path, creation date, enabled sources (Jira/Git/GitHub/Database) and their order. Use to verify setup or check what data is available. Related: list_workspaces, switch_workspace.',
    },
    () => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`No Argustack workspace found.\n\nDiagnostic: ${ws.reason}\n\nRun \`argustack init\` to create one.`);
      }

      const enabled = getEnabledSources(ws.config);
      const sourceInfo = enabled.map(
        (s) => `  • ${SOURCE_META[s].label}: ${SOURCE_META[s].description}`
      );

      const nameLine = ws.config.name
        ? `Argustack Workspace: ${ws.config.name} (active)`
        : 'Argustack Workspace (active)';

      const text = [
        nameLine,
        `Root: ${ws.root}`,
        `Created: ${ws.config.createdAt}`,
        ``,
        `Configured sources (${String(enabled.length)}):`,
        ...(sourceInfo.length > 0 ? sourceInfo : ['  (none)']),
        ``,
        `Source order: ${enabled.map((s) => SOURCE_META[s].label).join(' → ') || 'none'}`,
      ].join('\n');

      return textResponse(text);
    }
  );

  server.registerTool(
    'list_projects',
    {
      description: 'List all Jira projects available in the configured Jira instance',
    },
    async () => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { source } = await createAdapters(ws.root);
      if (!source) {
        return errorResponse('Jira is not configured. Add credentials to .env.');
      }

      try {
        const projects = await source.getProjects();
        const lines = projects.map(
          (p) => `  ${p.key} — ${p.name}`
        );
        return textResponse(`Found ${String(projects.length)} Jira projects:\n${lines.join('\n')}`);
      } catch (err: unknown) {
        return errorResponse(`Failed to list projects: ${getErrorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    'switch_workspace',
    {
      description: 'Switch active workspace. All subsequent queries will use the new workspace database and .env credentials. Use list_workspaces first to see available names. Related: list_workspaces, workspace_info.',
      inputSchema: {
        name: z.string().describe('Workspace name to switch to (e.g. "beautybooking", "paperlink")'),
      },
    },
    async ({ name }) => {
      const result = await switchWorkspace(name);
      if (!result.ok) {
        return errorResponse(result.reason);
      }

      const enabled = getEnabledSources(result.config);
      const sources = enabled.map((s) => SOURCE_META[s].label).join(', ') || 'none';

      return textResponse(
        `Switched to workspace: ${result.config.name ?? name}\n` +
        `Root: ${result.root}\n` +
        `Sources: ${sources}`
      );
    }
  );

  server.registerTool(
    'list_workspaces',
    {
      description: 'List all Argustack workspaces (local + global registry). Shows name, enabled sources, and which is active (●). Use before switch_workspace to find available names. Related: switch_workspace, workspace_info.',
    },
    () => {
      const ws = loadWorkspace();
      if (ws.ok) {
        registerWorkspace(ws.root, ws.config.name);
      }

      const workspaces = listSiblingWorkspaces();

      if (workspaces.length === 0) {
        return textResponse('No workspaces found. Run `argustack init <name>` to create one.');
      }

      const lines = workspaces.map((w) => {
        const sources = w.sources.map((s) => SOURCE_META[s].label).join(', ') || 'no sources';
        const marker = w.active ? ' (active)' : '';
        return `  ${w.active ? '●' : '○'} ${w.name}${marker} — ${sources}`;
      });

      return textResponse(`Workspaces (${String(workspaces.length)}):\n${lines.join('\n')}`);
    }
  );

  server.registerTool(
    'pull_jira',
    {
      description: 'Sync Jira issues into local database. Fetches issues with all fields, comments, changelogs, worklogs, links. Supports incremental sync (only new/updated). Input: project (optional, e.g. "PAP"), since (optional date YYYY-MM-DD). Requires Jira credentials in .env.',
      inputSchema: {
        project: z.string().optional().describe('Specific project key (e.g. "PROJ"). Omit to pull all configured projects.'),
        since: z.string().optional().describe('Pull issues updated since this date (YYYY-MM-DD). Omit for auto-incremental.'),
      },
    },
    async ({ project, since }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { source, storage } = await createAdapters(ws.root);
      if (!source) {
        return errorResponse('Jira is not configured.');
      }

      try {
        const { PullUseCase } = await import('../../use-cases/pull.js');
        const pullUseCase = new PullUseCase(source, storage);

        const progressLines: string[] = [];

        const results = await pullUseCase.execute({
          ...(project ? { projectKey: project } : {}),
          ...(since ? { since } : {}),
          onProgress: (msg) => progressLines.push(msg),
        });

        await storage.close();

        const summary = results.map(
          (r) =>
            `${r.projectKey}: ${String(r.issuesCount)} issues, ${String(r.commentsCount)} comments, ${String(r.changelogsCount)} changelogs, ${String(r.worklogsCount)} worklogs, ${String(r.linksCount)} links`
        );

        return textResponse([
          'Pull complete!',
          '',
          ...summary,
          '',
          `Progress log:`,
          ...progressLines,
        ].join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Pull failed: ${getErrorMessage(err)}`);
      }
    }
  );
}
