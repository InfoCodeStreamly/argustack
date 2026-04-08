import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import dotenv from 'dotenv';
import {
  loadWorkspace,
  textResponse,
  errorResponse,
  getErrorMessage,
} from '../helpers.js';
import { JiraProvider } from '../../adapters/jira/index.js';
import { PostgresStorage } from '../../adapters/postgres/index.js';
import { PushUseCase } from '../../use-cases/push.js';
import { updateMdFrontmatter } from '../../adapters/board/md-parser.js';

function createStorage(): PostgresStorage {
  return new PostgresStorage({
    host: process.env['DB_HOST'] ?? 'localhost',
    port: parseInt(process.env['DB_PORT'] ?? '5434', 10),
    database: process.env['DB_NAME'] ?? 'argustack',
    user: process.env['DB_USER'] ?? 'argustack',
    password: process.env['DB_PASSWORD'] ?? 'argustack_local',
  });
}

export function registerPushTools(server: McpServer): void {
  server.registerTool(
    'create_issue',
    {
      description: 'Create a NEW issue in local Argustack database (source=local). Only summary is required, all other fields optional. Returns local key. NEXT STEP: call push(mode=create) to send to Jira and get real Jira key. All changes LOCAL ONLY until pushed. Related: update_issue (for existing), push.',
      inputSchema: {
        summary: z.string().describe('Issue title (required)'),
        description: z.string().optional().describe('Full description / requirements / acceptance criteria'),
        project_key: z.string().optional().describe('Jira project key (e.g. PAP). Defaults to first project in JIRA_PROJECTS env'),
        issue_type: z.string().optional().describe('Issue type (Story, Bug, Task, or localized name)'),
        status: z.string().optional().describe('Status name'),
        priority: z.string().optional().describe('Priority name'),
        assignee: z.string().optional().describe('Assignee display name'),
        parent_key: z.string().optional().describe('Parent issue or epic key (e.g. PAP-165)'),
        labels: z.array(z.string()).optional().describe('Labels'),
        components: z.array(z.string()).optional().describe('Component names'),
      },
    },
    async ({ summary, description, project_key: projectKeyParam, issue_type: issueType, status, priority, assignee, parent_key: parentKey, labels, components }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      dotenv.config({ path: `${ws.root}/.env`, quiet: true });

      const projectKey = projectKeyParam ?? process.env['JIRA_PROJECTS']?.split(',')[0]?.trim();
      if (!projectKey) {
        return errorResponse('No project_key provided and no JIRA_PROJECTS in .env');
      }

      const storage = createStorage();
      try {
        await storage.initialize();

        const now = new Date().toISOString();
        const issueKey = `LOCAL-${String(Date.now())}`;

        await storage.saveBatch({
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
          comments: [],
          changelogs: [],
          worklogs: [],
          links: [],
        });

        await storage.close();
        return textResponse(`Created local issue: ${issueKey}\nProject: ${projectKey}\nSummary: ${summary}\n\nUse 'push' tool to send to Jira.`);
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Failed to create issue: ${getErrorMessage(err)}`);
      }
    },
  );
  server.registerTool(
    'push',
    {
      description: 'Push issues to Jira. Default (mode=create): sends NEW local issues (source=local) to Jira, returns new Jira keys. With mode=updates: sends locally MODIFIED issues (changed via update_issue) to Jira. Requires Jira credentials in .env. Related: create_issue → push(create), update_issue → push(updates).',
      inputSchema: {
        mode: z.enum(['create', 'updates']).optional().describe('create (default) = push new local issues. updates = push locally modified issues to Jira.'),
      },
    },
    async ({ mode }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      dotenv.config({ path: `${ws.root}/.env`, quiet: true });

      const jiraUrl = process.env['JIRA_URL'];
      const jiraEmail = process.env['JIRA_EMAIL'];
      const jiraToken = process.env['JIRA_API_TOKEN'];

      if (!jiraUrl || !jiraEmail || !jiraToken) {
        return errorResponse('Jira credentials not configured. Set JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env');
      }

      const jira = new JiraProvider({ host: jiraUrl, email: jiraEmail, apiToken: jiraToken });
      const storage = createStorage();

      try {
        await storage.initialize();
        const useCase = new PushUseCase(jira, storage);

        if (mode === 'updates') {
          const progressLines: string[] = [];
          const result = await useCase.executeUpdates({
            onProgress: (msg) => progressLines.push(msg),
          });
          await storage.close();

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

        const result = await useCase.execute();

        for (const item of result.created) {
          if (item.mdPath) {
            updateMdFrontmatter(item.mdPath, { jiraKey: item.newKey });
          }
        }

        await storage.close();

        if (result.created.length === 0) {
          return textResponse('No local issues to push. All issues already synced with Jira.');
        }

        const lines = result.created.map((item) => `${item.newKey} (was ${item.oldKey})`);
        const summary = `Pushed ${String(result.created.length)} issue(s) to Jira:\n${lines.join('\n')}`;
        return textResponse(result.errors > 0 ? `${summary}\n\n${String(result.errors)} error(s) occurred.` : summary);
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Push failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'update_issue',
    {
      description: 'Update fields of an existing issue in the local Argustack database. Changes are LOCAL ONLY until you call push(mode="updates") to send them to Jira. Useful for: filling missing descriptions, correcting statuses, enriching data after sync. Jira is SSOT — next sync overwrites local changes unless pushed first.',
      inputSchema: {
        issue_key: z.string().describe('Issue key (e.g. "ORG-123")'),
        summary: z.string().optional().describe('New summary/title'),
        description: z.string().optional().describe('New description'),
        status: z.string().optional().describe('New status'),
        priority: z.string().optional().describe('New priority'),
        assignee: z.string().optional().describe('New assignee display name'),
        labels: z.array(z.string()).optional().describe('New labels (replaces existing)'),
        components: z.array(z.string()).optional().describe('New components (replaces existing)'),
        story_points: z.number().optional().describe('New story points'),
      },
    },
    async ({ issue_key: issueKey, summary, description, status, priority, assignee, labels, components, story_points: storyPoints }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      dotenv.config({ path: `${ws.root}/.env`, quiet: true });
      const storage = createStorage();

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

        await storage.updateIssueFields(issueKey, fields);
        await storage.close();

        const updatedFields = Object.keys(fields).join(', ');
        return textResponse(`Updated ${issueKey}: ${updatedFields}\n\nMarked as locally modified. Use 'push --updates' to send to Jira.`);
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Failed to update ${issueKey}: ${getErrorMessage(err)}`);
      }
    },
  );
}
