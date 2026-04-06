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
      description: 'Create an issue in Argustack local database (source=local). Agent reads task content, determines fields, passes what it can. Only summary is required. Use push tool after to send to Jira.',
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
      description: 'Push local board tasks to Jira. Creates Stories for tasks with source=local in the Argustack database. Updates .md frontmatter with the new Jira key.',
      inputSchema: {},
    },
    async () => {
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
}
