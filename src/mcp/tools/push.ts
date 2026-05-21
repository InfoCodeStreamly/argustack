import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  getErrorMessage,
  ANNOTATIONS,
} from '../helpers.js';
import { JiraProvider } from '../../adapters/jira/index.js';
import { PushUseCase } from '../../use-cases/push.js';
import { updateMdFrontmatter } from '../../adapters/board/md-parser.js';
import { loadHubConfig } from '../../workspace/hub-config.js';

const workspaceIdParam = z.string().optional().describe('Workspace id or name (defaults to active workspace)');

function hasMarkdownFormatting(text: string): boolean {
  if (text.length < 30) { return true; }
  const markers = [
    /^#{1,6}\s/m, /^[-*]\s/m, /^\d+\.\s/m, /\*\*.+?\*\*/, /\*.+?\*/,
    /`.+?`/, /^>/m, /\[.+?\]\(.+?\)/, /^\|.+\|$/m, /^```/m, /^---+$/m,
  ];
  return markers.some((r) => r.test(text));
}

export function registerPushTools(server: McpServer): void {
  server.registerTool(
    'create_issue',
    {
      title: 'Create local issue',
      description: 'Create a NEW issue in the workspace local DB (source=local). Use `push` to send to Jira.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        summary: z.string().describe('Issue title (required)'),
        description: z.string().optional().describe('MUST be Markdown. Headings, lists, bold, code.'),
        project_key: z.string().optional().describe('Jira project key (defaults to first in workspace.settings.jiraProjectKeys)'),
        issue_type: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        assignee: z.string().optional(),
        parent_key: z.string().optional(),
        labels: z.array(z.string()).optional(),
        components: z.array(z.string()).optional(),
      },
      annotations: ANNOTATIONS.LOCAL_WRITE,
    },
    async ({ workspace_id: workspaceIdInput, summary, description: rawDesc, project_key: projectKeyParam, issue_type: issueType, status, priority, assignee, parent_key: parentKey, labels, components }) => {
      const description = rawDesc?.replaceAll('\\n', '\n');
      if (description !== undefined && !hasMarkdownFormatting(description)) {
        return errorResponse('REJECTED: description must use MARKDOWN formatting.');
      }

      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      const projectKey = projectKeyParam ?? ws.workspace.settings?.jiraProjectKeys?.[0];
      if (!projectKey) {
        return errorResponse(`No project_key provided and no jiraProjectKeys bound to workspace "${workspaceId}".`);
      }

      try {
        await storage.initialize();
        const now = new Date().toISOString();
        const issueKey = `LOCAL-${String(Date.now())}`;

        await storage.saveBatch(workspaceId, {
          issues: [{
            key: issueKey,
            id: '',
            projectKey,
            summary,
            description: description ?? null,
            issueType: issueType ?? null,
            status: status ?? null,
            statusCategory: null,
            priority: priority ?? null,
            resolution: null,
            assignee: assignee ?? null,
            assigneeId: null,
            reporter: null,
            reporterId: null,
            created: now,
            updated: now,
            resolved: null,
            dueDate: null,
            labels: labels ?? [],
            components: components ?? [],
            fixVersions: [],
            parentKey: parentKey ?? null,
            sprint: null,
            storyPoints: null,
            originalEstimate: null,
            remainingEstimate: null,
            timeSpent: null,
            customFields: {},
            rawJson: {},
            source: 'local',
          }],
          comments: [], changelogs: [], worklogs: [], links: [],
        });

        return textResponse(`Created local issue: ${issueKey}\nProject: ${projectKey}\nSummary: ${summary}\n\nUse 'push' to send to Jira.`);
      } catch (err) {
        return errorResponse(`Failed to create issue: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'push',
    {
      title: 'Push to Jira',
      description: 'Push issues to Jira. mode=create: send new local issues. mode=updates: send locally modified.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        mode: z.enum(['create', 'updates']).optional(),
      },
      annotations: ANNOTATIONS.REMOTE_WRITE,
    },
    async ({ workspace_id: workspaceIdInput, mode }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const hub = loadHubConfig();
      if (!hub.credentials.jiraUrl || !hub.credentials.jiraEmail || !hub.credentials.jiraApiToken) {
        return errorResponse('Jira credentials missing in ~/.argustack/config.env.');
      }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const jira = new JiraProvider({
          host: hub.credentials.jiraUrl,
          email: hub.credentials.jiraEmail,
          apiToken: hub.credentials.jiraApiToken,
        });
        const useCase = new PushUseCase(jira, storage);

        if (mode === 'updates') {
          const progressLines: string[] = [];
          const result = await useCase.executeUpdates(workspaceId, { onProgress: (msg) => progressLines.push(msg) });
          if (result.updated.length === 0 && result.errors === 0) {
            return textResponse('No locally modified issues to push.');
          }
          const lines = result.updated.map((item) => `✓ ${item.key} — ${item.summary}`);
          const errorLines = progressLines.filter((l) => l.includes('Failed')).map((l) => `✗ ${l.trim()}`);
          return textResponse([
            `Push updates: ${String(result.updated.length)} updated, ${String(result.errors)} error(s)`,
            '',
            ...lines,
            ...errorLines,
          ].join('\n'));
        }

        const result = await useCase.execute(workspaceId);
        for (const item of result.created) {
          if (item.mdPath) { updateMdFrontmatter(item.mdPath, { jiraKey: item.newKey }); }
        }
        if (result.created.length === 0) {
          return textResponse('No local issues to push.');
        }
        const lines = result.created.map((item) => `${item.newKey} (was ${item.oldKey})`);
        const summary = `Pushed ${String(result.created.length)} issue(s) to Jira:\n${lines.join('\n')}`;
        return textResponse(result.errors > 0 ? `${summary}\n\n${String(result.errors)} error(s) occurred.` : summary);
      } catch (err) {
        return errorResponse(`Push failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'update_issue',
    {
      title: 'Update local issue',
      description: 'Update an issue in the workspace local DB. Use `push --updates` to send to Jira.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        issue_key: z.string().describe('Issue key'),
        summary: z.string().optional(),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        assignee: z.string().optional(),
        labels: z.array(z.string()).optional(),
        components: z.array(z.string()).optional(),
        story_points: z.number().optional(),
      },
      annotations: ANNOTATIONS.LOCAL_WRITE,
    },
    async ({ workspace_id: workspaceIdInput, issue_key: issueKey, summary, description: rawDescription, status, priority, assignee, labels, components, story_points: storyPoints }) => {
      const description = rawDescription?.replaceAll('\\n', '\n');
      if (description !== undefined && !hasMarkdownFormatting(description)) {
        return errorResponse('REJECTED: description must use MARKDOWN formatting.');
      }

      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const fields: Record<string, unknown> = {};
        if (summary !== undefined) { fields['summary'] = summary; }
        if (description !== undefined) { fields['description'] = description; }
        if (status !== undefined) { fields['status'] = status; }
        if (priority !== undefined) { fields['priority'] = priority; }
        if (assignee !== undefined) { fields['assignee'] = assignee; }
        if (labels !== undefined) { fields['labels'] = labels; }
        if (components !== undefined) { fields['components'] = components; }
        if (storyPoints !== undefined) { fields['storyPoints'] = storyPoints; }

        await storage.updateIssueFields(workspaceId, issueKey, fields);
        return textResponse(`Updated ${issueKey}: ${Object.keys(fields).join(', ')}\n\nMarked as locally modified. Use 'push --updates' to send to Jira.`);
      } catch (err) {
        return errorResponse(`Failed to update ${issueKey}: ${getErrorMessage(err)}`);
      }
    },
  );
}
