import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

export function registerPushTools(server: McpServer): void {
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
      const storage = new PostgresStorage({
        host: process.env['DB_HOST'] ?? 'localhost',
        port: parseInt(process.env['DB_PORT'] ?? '5434', 10),
        database: process.env['DB_NAME'] ?? 'argustack',
        user: process.env['DB_USER'] ?? 'argustack',
        password: process.env['DB_PASSWORD'] ?? 'argustack_local',
      });

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
