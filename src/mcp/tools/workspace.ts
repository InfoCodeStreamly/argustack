import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { SOURCE_META } from '../../core/types/index.js';
import {
  loadWorkspace,
  createAdapters,
  switchWorkspace,
  getWorkspaceStore,
  textResponse,
  errorResponse,
  getErrorMessage,
  ANNOTATIONS,
} from '../helpers.js';
import { readWorkspaceConfigFromHub } from '../../workspace/config.js';
import { getActiveWorkspaceId } from '../../workspace/active-workspace.js';

const workspaceIdParam = z.string().optional().describe('Workspace id or name (defaults to active workspace)');

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    'workspace_info',
    {
      title: 'Workspace info',
      description: 'Show the active (or selected) workspace: id, name, bindings, last activity.',
      inputSchema: {
        workspace_id: workspaceIdParam,
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const settings = ws.workspace.settings ?? {};

      const lines = [
        `Argustack Hub Workspace`,
        `Name:        ${ws.workspace.name}`,
        `Id:          ${ws.workspace.id}`,
        `Last active: ${ws.workspace.lastActiveAt ?? 'never'}`,
        '',
        `Jira projects:  ${(settings.jiraProjectKeys ?? []).join(', ') || '(none)'}`,
        `Git repos:      ${(settings.gitRepoPaths ?? []).join(', ') || '(none)'}`,
        `GitHub repos:   ${(settings.githubRepos ?? []).map((r) => `${r.owner}/${r.repo}`).join(', ') || '(none)'}`,
        `CSV files:      ${(settings.csvFilePaths ?? []).map((c) => c.path).join(', ') || '(none)'}`,
        `External DBs:   ${(settings.dbConfigs ?? []).map((d) => d.name).join(', ') || '(none)'}`,
      ];
      return textResponse(lines.join('\n'));
    },
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List Jira projects',
      description: 'List Jira projects available with the configured credentials.',
      inputSchema: {
        workspace_id: workspaceIdParam,
      },
      annotations: ANNOTATIONS.REMOTE_READ,
    },
    async ({ workspace_id: workspaceIdInput }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const { source } = await createAdapters(ws.workspaceId);
      if (!source) {
        return errorResponse('Jira is not configured. Add credentials with `argustack add jira --url ... --email ... --token ...`.');
      }
      try {
        const projects = await source.getProjects();
        const lines = projects.map((p) => `  ${p.key} — ${p.name}`);
        return textResponse(`Found ${String(projects.length)} Jira projects:\n${lines.join('\n')}`);
      } catch (err) {
        return errorResponse(`Failed to list projects: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'switch_workspace',
    {
      title: 'Switch active workspace',
      description: 'Set the active workspace (writes ~/.argustack/active-workspace.json).',
      inputSchema: {
        name: z.string().describe('Workspace id or name to switch to'),
      },
      annotations: ANNOTATIONS.LOCAL_WRITE,
    },
    async ({ name }) => {
      const result = await switchWorkspace(name);
      if (!result.ok) { return errorResponse(result.reason); }
      const settings = result.workspace.settings ?? {};
      const enabled: string[] = [];
      if ((settings.jiraProjectKeys?.length ?? 0) > 0) { enabled.push(SOURCE_META.jira.label); }
      if ((settings.gitRepoPaths?.length ?? 0) > 0) { enabled.push(SOURCE_META.git.label); }
      if ((settings.githubRepos?.length ?? 0) > 0) { enabled.push(SOURCE_META.github.label); }
      if ((settings.csvFilePaths?.length ?? 0) > 0) { enabled.push(SOURCE_META.csv.label); }
      if ((settings.dbConfigs?.length ?? 0) > 0) { enabled.push(SOURCE_META.db.label); }
      return textResponse(
        `Switched to workspace: ${result.workspace.name} [${result.workspace.id}]\n` +
        `Sources: ${enabled.join(', ') || 'none'}`,
      );
    },
  );

  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description: 'List all workspaces registered in the hub. Marks the active one with ●.',
      outputSchema: {
        workspaces: z.array(z.object({
          id: z.string(),
          name: z.string(),
          active: z.boolean(),
          sources: z.array(z.string()),
        })),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async () => {
      try {
        const store = await getWorkspaceStore();
        const all = await store.list();
        if (all.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No workspaces in the hub. Run `argustack workspace add <name>` to create one.' }],
            structuredContent: { workspaces: [] },
          };
        }
        const activeId = getActiveWorkspaceId();
        const structured = await Promise.all(all.map(async (w) => {
          const cfg = await readWorkspaceConfigFromHub(w.id, store);
          const sources = (cfg?.order ?? []).map((s) => SOURCE_META[s].label);
          return { id: w.id, name: w.name, active: w.id === activeId, sources };
        }));
        const lines = structured.map((w) => {
          const marker = w.active ? '●' : '○';
          const suffix = w.active ? ' (active)' : '';
          return `  ${marker} ${w.name}${suffix} [${w.id}] — ${w.sources.join(', ') || 'no sources'}`;
        });
        return {
          content: [{ type: 'text' as const, text: `Workspaces (${String(all.length)}):\n${lines.join('\n')}` }],
          structuredContent: { workspaces: structured },
        };
      } catch (err) {
        return errorResponse(`list_workspaces failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'pull_jira',
    {
      title: 'Pull Jira issues',
      description: 'Pull Jira issues into the workspace database (incremental by default).',
      inputSchema: {
        workspace_id: workspaceIdParam,
        project: z.string().optional(),
        since: z.string().optional(),
      },
      annotations: ANNOTATIONS.REMOTE_WRITE,
    },
    async ({ workspace_id: workspaceIdInput, project, since }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const { source, storage, workspaceId } = await createAdapters(ws.workspaceId);
      if (!source) { return errorResponse('Jira is not configured.'); }

      try {
        const { PullUseCase } = await import('../../use-cases/pull.js');
        const pullUseCase = new PullUseCase(source, storage);
        const progressLines: string[] = [];
        const results = await pullUseCase.execute(workspaceId, {
          ...(project ? { projectKey: project } : {}),
          ...(since ? { since } : {}),
          onProgress: (msg) => progressLines.push(msg),
        });

        const summary = results.map((r) =>
          `${r.projectKey}: ${String(r.issuesCount)} issues, ${String(r.commentsCount)} comments, ${String(r.changelogsCount)} changelogs, ${String(r.worklogsCount)} worklogs, ${String(r.linksCount)} links`,
        );
        return textResponse(['Pull complete!', '', ...summary, '', 'Progress log:', ...progressLines].join('\n'));
      } catch (err) {
        return errorResponse(`Pull failed: ${getErrorMessage(err)}`);
      }
    },
  );
}
