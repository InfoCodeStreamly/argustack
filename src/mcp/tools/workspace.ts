import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { SOURCE_META } from '../../core/types/index.js';
import {
  loadWorkspace,
  createAdapters,
  getEnabledSources,
  textResponse,
  errorResponse,
  getErrorMessage,
} from '../helpers.js';

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    'workspace_info',
    {
      description: 'Get information about the current Argustack workspace — configured sources, paths, database connection',
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

      const text = [
        `Argustack Workspace`,
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
    'pull_jira',
    {
      description: 'Pull all issues from Jira into Argustack PostgreSQL database. Supports incremental pulls (only new/updated issues). Use project parameter to pull a specific project.',
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
