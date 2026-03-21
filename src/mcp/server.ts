#!/usr/bin/env node

/**
 * Argustack MCP Server
 *
 * Exposes Argustack capabilities as MCP tools for Claude Desktop / Claude Code.
 * Runs on stdio transport — add to claude_desktop_config.json to use.
 *
 * Architecture:
 *   MCP Server → same Use Cases / Adapters as CLI
 *   This is just another composition root (like cli/index.ts).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { findWorkspaceRoot } from '../workspace/resolver.js';
import { readConfig, getEnabledSources } from '../workspace/config.js';
import type { WorkspaceConfig } from '../core/types/index.js';
import { SOURCE_META } from '../core/types/index.js';
import type { ISourceProvider } from '../core/ports/source-provider.js';
import type { IStorage } from '../core/ports/storage.js';

// ─── Result row interfaces ───────────────────────────────────────────────────

/** Row shape returned by the query_issues SELECT */
interface IssueRow {
  issue_key?: string;
  summary?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  issue_type?: string;
  project_key?: string;
  created?: string;
  updated?: string;
}

/** Full issue row from SELECT * */
interface FullIssueRow {
  issue_key: string;
  summary: string;
  issue_type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  created?: string;
  updated?: string;
  labels?: string[];
  components?: string[];
  parent_key?: string;
  description?: string;
  custom_fields?: Record<string, unknown>;
}

/** Comment row shape */
interface CommentRow {
  author?: string;
  body?: string;
  created?: string;
}

/** Changelog row shape */
interface ChangelogRow {
  author?: string;
  field?: string;
  from_value?: string;
  to_value?: string;
  changed_at?: string;
}

/** Aggregate count row (for issue_stats) */
interface CountRow {
  count: string;
}

/** Status count row */
interface StatusCountRow extends CountRow {
  status?: string;
}

/** Issue type count row */
interface TypeCountRow extends CountRow {
  issue_type?: string;
}

/** Project count row */
interface ProjectCountRow extends CountRow {
  project_key?: string;
}

/** Assignee count row */
interface AssigneeCountRow extends CountRow {
  assignee?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract error message from an unknown catch value */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Safely coerce an unknown value to string for template expressions */
function str(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  // Objects, arrays, symbols, functions — use JSON for a meaningful representation
  return JSON.stringify(value);
}

/** Workspace load result — either success or diagnostic failure */
type WorkspaceResult =
  | { ok: true; root: string; config: WorkspaceConfig }
  | { ok: false; reason: string };

/** Load workspace context with diagnostic info on failure */
function loadWorkspace(): WorkspaceResult {
  const envVar = process.env['ARGUSTACK_WORKSPACE'];
  const root = findWorkspaceRoot();

  if (!root) {
    const hint = envVar
      ? `ARGUSTACK_WORKSPACE is set to "${envVar}" but no .argustack/ marker found there or in parent directories.`
      : 'No ARGUSTACK_WORKSPACE env var set and no .argustack/ found from cwd.';
    return { ok: false, reason: hint };
  }

  const config = readConfig(root);
  if (!config) {
    return {
      ok: false,
      reason: `Workspace found at ${root} but .argustack/config.json is missing or invalid. Run "argustack init".`,
    };
  }

  return { ok: true, root, config };
}

/** Load .env and create adapters lazily */
async function createAdapters(workspaceRoot: string): Promise<{
  source: ISourceProvider | null;
  storage: IStorage;
}> {
  dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

  const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

  let source: ISourceProvider | null = null;

  if (JIRA_URL && JIRA_EMAIL && JIRA_API_TOKEN) {
    const { JiraProvider } = await import('../adapters/jira/index.js');
    source = new JiraProvider({
      host: JIRA_URL,
      email: JIRA_EMAIL,
      apiToken: JIRA_API_TOKEN,
    });
  }

  const { PostgresStorage } = await import('../adapters/postgres/index.js');
  const storage: IStorage = new PostgresStorage({
    host: DB_HOST ?? 'localhost',
    port: parseInt(DB_PORT ?? '5434', 10),
    user: DB_USER ?? 'argustack',
    password: DB_PASSWORD ?? 'argustack_local',
    database: DB_NAME ?? 'argustack',
  });

  return { source, storage };
}

// ─── Icon ────────────────────────────────────────────────────────────────────

const mcpFilename = fileURLToPath(import.meta.url);
const mcpPackageRoot = resolve(dirname(mcpFilename), '..', '..');

function loadIconDataUri(): string | null {
  const iconPath = resolve(mcpPackageRoot, 'assets', 'icon-64.png');
  if (!existsSync(iconPath)) {
    return null;
  }
  const buf = readFileSync(iconPath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const iconDataUri = loadIconDataUri();

// ─── Server ───────────────────────────────────────────────────────────────────

/** MCP server instance — exported for testing via InMemoryTransport */
export const server = new McpServer({
  name: 'Argustack',
  title: 'Argustack',
  version: '0.1.0',
  ...(iconDataUri ? {
    icons: [{
      src: iconDataUri,
      mimeType: 'image/png',
      sizes: ['any'],
    }],
  } : {}),
});

// ─── Tool: workspace_info ─────────────────────────────────────────────────────

server.registerTool(
  'workspace_info',
  {
    description: 'Get information about the current Argustack workspace — configured sources, paths, database connection',
  },
  () => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{
          type: 'text' as const,
          text: `No Argustack workspace found.\n\nDiagnostic: ${ws.reason}\n\nRun \`argustack init\` to create one.`,
        }],
        isError: true,
      };
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

    return { content: [{ type: 'text' as const, text }] };
  }
);

// ─── Tool: list_projects ──────────────────────────────────────────────────────

server.registerTool(
  'list_projects',
  {
    description: 'List all Jira projects available in the configured Jira instance',
  },
  async () => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { source } = await createAdapters(ws.root);
    if (!source) {
      return {
        content: [{ type: 'text' as const, text: 'Jira is not configured. Add credentials to .env.' }],
        isError: true,
      };
    }

    try {
      const projects = await source.getProjects();
      const lines = projects.map(
        (p) => `  ${p.key} — ${p.name}`
      );
      return {
        content: [{
          type: 'text' as const,
          text: `Found ${String(projects.length)} Jira projects:\n${lines.join('\n')}`,
        }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Failed to list projects: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: pull_jira ──────────────────────────────────────────────────────────

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
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { source, storage } = await createAdapters(ws.root);
    if (!source) {
      return {
        content: [{ type: 'text' as const, text: 'Jira is not configured.' }],
        isError: true,
      };
    }

    try {
      const { PullUseCase } = await import('../use-cases/pull.js');
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

      return {
        content: [{
          type: 'text' as const,
          text: [
            'Pull complete!',
            '',
            ...summary,
            '',
            `Progress log:`,
            ...progressLines,
          ].join('\n'),
        }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Pull failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: query_issues ───────────────────────────────────────────────────────

server.registerTool(
  'query_issues',
  {
    description: 'Search and query Jira issues stored in the local Argustack database. Supports full-text search, filtering by project/status/assignee, and SQL for complex queries.',
    inputSchema: {
      search: z.string().optional().describe('Full-text search query (e.g. "payment bug", "template recipients")'),
      project: z.string().optional().describe('Filter by project key (e.g. "PROJ")'),
      status: z.string().optional().describe('Filter by status (e.g. "Open", "In Progress", "Done")'),
      assignee: z.string().optional().describe('Filter by assignee display name'),
      issue_type: z.string().optional().describe('Filter by issue type (e.g. "Bug", "Story", "Task")'),
      limit: z.number().optional().describe('Max results to return (default: 50)'),
      sql: z.string().optional().describe('Raw SQL query for advanced queries. Table: issues. Use for complex analysis.'),
    },
  },
  async ({ search, project, status, assignee, issue_type: issueType, limit, sql }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);

    try {
      const maxResults = limit ?? 50;

      let sqlQuery: string;
      let params: unknown[];

      if (sql) {
        // Raw SQL mode — for power users / Claude
        sqlQuery = sql;
        params = [];
      } else {
        // Build query from filters
        const conditions: string[] = [];
        params = [];
        let paramIdx = 1;

        if (search) {
          conditions.push(`search_vector @@ plainto_tsquery('english', $${String(paramIdx)})`);
          params.push(search);
          paramIdx++;
        }

        if (project) {
          conditions.push(`project_key = $${String(paramIdx)}`);
          params.push(project.toUpperCase());
          paramIdx++;
        }

        if (status) {
          conditions.push(`status ILIKE $${String(paramIdx)}`);
          params.push(status);
          paramIdx++;
        }

        if (assignee) {
          conditions.push(`assignee ILIKE $${String(paramIdx)}`);
          params.push(`%${assignee}%`);
          paramIdx++;
        }

        if (issueType) {
          conditions.push(`issue_type ILIKE $${String(paramIdx)}`);
          params.push(issueType);
          paramIdx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // LIMIT is safe — maxResults is always a number from z.number() or default 50
        sqlQuery = `
          SELECT issue_key, summary, status, priority, assignee, issue_type,
                 project_key, created, updated
          FROM issues
          ${where}
          ORDER BY updated DESC NULLS LAST
          LIMIT ${String(maxResults)}
        `;
      }

      const result = await storage.query(sqlQuery, params);
      await storage.close();

      if (result.rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No issues found matching your criteria.' }],
        };
      }

      // Format results
      const lines = result.rows.map((row: Record<string, unknown>) => {
        const typed = row as unknown as IssueRow;
        if (typed.issue_key) {
          return `${typed.issue_key} [${str(typed.status) || '?'}] ${str(typed.summary)} (${str(typed.assignee) || 'unassigned'})`;
        }
        // For raw SQL, just stringify the row
        return JSON.stringify(row);
      });

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Found ${String(result.rows.length)} results:`,
            '',
            ...lines,
          ].join('\n'),
        }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Query failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_issue ──────────────────────────────────────────────────────────

server.registerTool(
  'get_issue',
  {
    description: 'Get full details of a specific issue by key, including description, comments, changelogs, and all custom fields.',
    inputSchema: {
      issue_key: z.string().describe('Issue key (e.g. "PROJ-123")'),
    },
  },
  async ({ issue_key: issueKey }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);

    try {
      // Get issue
      const issueResult = await storage.query(
        `SELECT * FROM issues WHERE issue_key = $1`,
        [issueKey.toUpperCase()]
      );

      if (issueResult.rows.length === 0) {
        await storage.close();
        return {
          content: [{ type: 'text' as const, text: `Issue ${issueKey} not found in local database.` }],
          isError: true,
        };
      }

      const issue = issueResult.rows[0] as unknown as FullIssueRow;

      // Get comments
      const commentsResult = await storage.query(
        `SELECT author, body, created FROM issue_comments WHERE issue_key = $1 ORDER BY created`,
        [issueKey.toUpperCase()]
      );

      // Get changelogs
      const changelogsResult = await storage.query(
        `SELECT author, field, from_value, to_value, changed_at
         FROM issue_changelogs WHERE issue_key = $1 ORDER BY changed_at DESC LIMIT 20`,
        [issueKey.toUpperCase()]
      );

      await storage.close();

      // Format output
      const sections: string[] = [];

      sections.push(`# ${str(issue.issue_key)}: ${str(issue.summary)}`);
      sections.push('');
      sections.push(`Type: ${str(issue.issue_type) || 'N/A'} | Status: ${str(issue.status) || 'N/A'} | Priority: ${str(issue.priority) || 'N/A'}`);
      sections.push(`Assignee: ${str(issue.assignee) || 'Unassigned'} | Reporter: ${str(issue.reporter) || 'N/A'}`);
      sections.push(`Created: ${str(issue.created) || 'N/A'} | Updated: ${str(issue.updated) || 'N/A'}`);

      if (Array.isArray(issue.labels) && issue.labels.length > 0) {
        sections.push(`Labels: ${issue.labels.join(', ')}`);
      }
      if (Array.isArray(issue.components) && issue.components.length > 0) {
        sections.push(`Components: ${issue.components.join(', ')}`);
      }
      if (issue.parent_key) {
        sections.push(`Parent: ${issue.parent_key}`);
      }

      sections.push('');
      sections.push('## Description');
      sections.push(str(issue.description) || '(no description)');

      if (issue.custom_fields && Object.keys(issue.custom_fields).length > 0) {
        sections.push('');
        sections.push('## Custom Fields');
        for (const [key, value] of Object.entries(issue.custom_fields)) {
          if (value !== null && value !== undefined) {
            sections.push(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : str(value)}`);
          }
        }
      }

      if (commentsResult.rows.length > 0) {
        sections.push('');
        sections.push(`## Comments (${String(commentsResult.rows.length)})`);
        for (const rawComment of commentsResult.rows) {
          const c = rawComment as unknown as CommentRow;
          sections.push(`--- ${str(c.author)} (${str(c.created)}) ---`);
          sections.push(str(c.body) || '(empty)');
          sections.push('');
        }
      }

      if (changelogsResult.rows.length > 0) {
        sections.push('');
        sections.push(`## Recent Changes (${String(changelogsResult.rows.length)})`);
        for (const rawChangelog of changelogsResult.rows) {
          const ch = rawChangelog as unknown as ChangelogRow;
          sections.push(`  ${str(ch.changed_at)}: ${str(ch.author)} changed ${str(ch.field)}: "${str(ch.from_value)}" → "${str(ch.to_value)}"`);
        }
      }

      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Failed to get issue: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: issue_stats ────────────────────────────────────────────────────────

server.registerTool(
  'issue_stats',
  {
    description: 'Get aggregate statistics about issues in the database — counts by status, type, project, assignee. Useful for project health overview.',
    inputSchema: {
      project: z.string().optional().describe('Filter stats by project key'),
    },
  },
  async ({ project }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);

    try {
      // Use parameterized query to prevent SQL injection
      const filterClause = project ? `WHERE project_key = $1` : '';
      const filterParams: unknown[] = project ? [project.toUpperCase()] : [];

      const [total, byStatus, byType, byProject, byAssignee] = await Promise.all([
        storage.query(`SELECT COUNT(*) as count FROM issues ${filterClause}`, filterParams),
        storage.query(`SELECT status, COUNT(*) as count FROM issues ${filterClause} GROUP BY status ORDER BY count DESC`, filterParams),
        storage.query(`SELECT issue_type, COUNT(*) as count FROM issues ${filterClause} GROUP BY issue_type ORDER BY count DESC`, filterParams),
        storage.query(`SELECT project_key, COUNT(*) as count FROM issues ${filterClause} GROUP BY project_key ORDER BY count DESC`, filterParams),
        storage.query(`SELECT assignee, COUNT(*) as count FROM issues ${filterClause} GROUP BY assignee ORDER BY count DESC LIMIT 15`, filterParams),
      ]);

      await storage.close();

      const sections: string[] = [];
      const totalRow = total.rows[0] as unknown as CountRow | undefined;
      sections.push(`# Issue Statistics${project ? ` (${project})` : ''}`);
      sections.push(`Total issues: ${str(totalRow?.count)}`);

      sections.push('');
      sections.push('## By Status');
      for (const rawRow of byStatus.rows) {
        const r = rawRow as unknown as StatusCountRow;
        sections.push(`  ${str(r.status) || 'null'}: ${str(r.count)}`);
      }

      sections.push('');
      sections.push('## By Type');
      for (const rawRow of byType.rows) {
        const r = rawRow as unknown as TypeCountRow;
        sections.push(`  ${str(r.issue_type) || 'null'}: ${str(r.count)}`);
      }

      if (!project) {
        sections.push('');
        sections.push('## By Project');
        for (const rawRow of byProject.rows) {
          const r = rawRow as unknown as ProjectCountRow;
          sections.push(`  ${str(r.project_key)}: ${str(r.count)}`);
        }
      }

      sections.push('');
      sections.push('## Top Assignees');
      for (const rawRow of byAssignee.rows) {
        const r = rawRow as unknown as AssigneeCountRow;
        sections.push(`  ${str(r.assignee) || 'Unassigned'}: ${str(r.count)}`);
      }

      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Stats query failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: query_commits ──────────────────────────────────────────────────────

/** Commit row from query */
interface CommitRow {
  hash?: string;
  message?: string;
  author?: string;
  email?: string;
  committed_at?: string;
  repo_path?: string;
}

server.registerTool(
  'query_commits',
  {
    description: 'Search and query Git commits stored in the local database. Supports full-text search, filtering by author/date, and raw SQL.',
    inputSchema: {
      search: z.string().optional().describe('Full-text search in commit messages (e.g. "fix login", "PAP-123")'),
      author: z.string().optional().describe('Filter by author name'),
      since: z.string().optional().describe('Commits after this date (YYYY-MM-DD)'),
      until: z.string().optional().describe('Commits before this date (YYYY-MM-DD)'),
      file_path: z.string().optional().describe('Filter by changed file path (e.g. "src/auth/login.ts")'),
      repo_path: z.string().optional().describe('Filter by repository path (substring match)'),
      limit: z.number().optional().describe('Max results (default: 50)'),
      sql: z.string().optional().describe('Raw SQL query. Tables: commits, commit_files, commit_issue_refs'),
    },
  },
  async ({ search, author, since, until, file_path: filePath, repo_path: repoPath, limit, sql }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);

    try {
      const maxResults = limit ?? 50;
      let sqlQuery: string;
      let params: unknown[];

      if (sql) {
        sqlQuery = sql;
        params = [];
      } else {
        const conditions: string[] = [];
        params = [];
        let paramIdx = 1;
        let needJoin = false;

        if (search) {
          conditions.push(`c.search_vector @@ plainto_tsquery('english', $${String(paramIdx)})`);
          params.push(search);
          paramIdx++;
        }

        if (author) {
          conditions.push(`c.author ILIKE $${String(paramIdx)}`);
          params.push(`%${author}%`);
          paramIdx++;
        }

        if (since) {
          conditions.push(`c.committed_at >= $${String(paramIdx)}`);
          params.push(since);
          paramIdx++;
        }

        if (until) {
          conditions.push(`c.committed_at <= $${String(paramIdx)}`);
          params.push(until);
          paramIdx++;
        }

        if (filePath) {
          needJoin = true;
          conditions.push(`cf.file_path ILIKE $${String(paramIdx)}`);
          params.push(`%${filePath}%`);
          paramIdx++;
        }

        if (repoPath) {
          conditions.push(`c.repo_path ILIKE $${String(paramIdx)}`);
          params.push(`%${repoPath}%`);
          paramIdx++;
        }

        const from = needJoin
          ? 'commits c JOIN commit_files cf ON c.hash = cf.commit_hash'
          : 'commits c';
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        sqlQuery = `
          SELECT DISTINCT c.hash, c.message, c.author, c.email, c.committed_at, c.repo_path
          FROM ${from}
          ${where}
          ORDER BY c.committed_at DESC NULLS LAST
          LIMIT ${String(maxResults)}
        `;
      }

      const result = await storage.query(sqlQuery, params);
      await storage.close();

      if (result.rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No commits found matching your criteria.' }],
        };
      }

      const lines = result.rows.map((row: Record<string, unknown>) => {
        const typed = row as unknown as CommitRow;
        if (typed.hash) {
          const shortHash = typed.hash.substring(0, 7);
          const date = typed.committed_at ? str(typed.committed_at).substring(0, 10) : '?';
          return `${shortHash} ${date} ${str(typed.author)}: ${str(typed.message).split('\n')[0]}`;
        }
        return JSON.stringify(row);
      });

      return {
        content: [{
          type: 'text' as const,
          text: [`Found ${String(result.rows.length)} commits:`, '', ...lines].join('\n'),
        }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Query failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: issue_commits ──────────────────────────────────────────────────────

server.registerTool(
  'issue_commits',
  {
    description: 'Cross-reference: find all Git commits that mention a Jira issue key. Shows what code was actually changed for a ticket.',
    inputSchema: {
      issue_key: z.string().describe('Issue key (e.g. "PAP-123")'),
      repo_path: z.string().optional().describe('Filter by repository path (substring match)'),
    },
  },
  async ({ issue_key: issueKey, repo_path: repoPath }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);

    try {
      const repoFilter = repoPath ? `AND c.repo_path ILIKE $2` : '';
      const commitsParams: unknown[] = [issueKey.toUpperCase()];
      if (repoPath) {
        commitsParams.push(`%${repoPath}%`);
      }

      const commitsResult = await storage.query(
        `SELECT c.hash, c.message, c.author, c.committed_at, c.repo_path
         FROM commits c
         JOIN commit_issue_refs r ON c.hash = r.commit_hash
         WHERE r.issue_key = $1 ${repoFilter}
         ORDER BY c.committed_at DESC`,
        commitsParams
      );

      if (commitsResult.rows.length === 0) {
        await storage.close();
        return {
          content: [{
            type: 'text' as const,
            text: `No commits found mentioning ${issueKey}. Make sure you've run "argustack sync git".`,
          }],
        };
      }

      const sections: string[] = [];
      sections.push(`# Commits for ${issueKey} (${String(commitsResult.rows.length)})`);
      sections.push('');

      for (const rawRow of commitsResult.rows) {
        const row = rawRow as unknown as CommitRow;
        const shortHash = (row.hash ?? '').substring(0, 7);

        sections.push(`## ${shortHash} — ${str(row.author)} (${str(row.committed_at).substring(0, 10)})`);
        sections.push(str(row.message));

        const filesResult = await storage.query(
          `SELECT file_path, status, additions, deletions FROM commit_files WHERE commit_hash = $1`,
          [row.hash]
        );

        if (filesResult.rows.length > 0) {
          sections.push('Files:');
          for (const f of filesResult.rows) {
            const file = f as { file_path?: string; status?: string; additions?: number; deletions?: number };
            sections.push(`  ${str(file.status)} ${str(file.file_path)} (+${str(file.additions)} -${str(file.deletions)})`);
          }
        }
        sections.push('');
      }

      await storage.close();

      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Query failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: commit_stats ───────────────────────────────────────────────────────

server.registerTool(
  'commit_stats',
  {
    description: 'Aggregate statistics about Git commits — total count, top authors, most changed files, commits per day.',
    inputSchema: {
      since: z.string().optional().describe('Stats from this date (YYYY-MM-DD)'),
      author: z.string().optional().describe('Filter stats by author name'),
      repo_path: z.string().optional().describe('Filter by repository path (substring match)'),
    },
  },
  async ({ since, author, repo_path: repoPath }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);

    try {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (since) {
        conditions.push(`committed_at >= $${String(paramIdx)}`);
        params.push(since);
        paramIdx++;
      }
      if (author) {
        conditions.push(`author ILIKE $${String(paramIdx)}`);
        params.push(`%${author}%`);
        paramIdx++;
      }
      if (repoPath) {
        conditions.push(`repo_path ILIKE $${String(paramIdx)}`);
        params.push(`%${repoPath}%`);
        paramIdx++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const [total, byAuthor, hotFiles, issueRefCount] = await Promise.all([
        storage.query(`SELECT COUNT(*) as count FROM commits ${where}`, params),
        storage.query(`SELECT author, COUNT(*) as count FROM commits ${where} GROUP BY author ORDER BY count DESC LIMIT 15`, params),
        storage.query(
          `SELECT cf.file_path, COUNT(*) as changes
           FROM commit_files cf
           JOIN commits c ON cf.commit_hash = c.hash
           ${where ? where.replace(/committed_at/g, 'c.committed_at').replace(/author/g, 'c.author').replace(/repo_path/g, 'c.repo_path') : ''}
           GROUP BY cf.file_path ORDER BY changes DESC LIMIT 15`,
          params
        ),
        storage.query(`SELECT COUNT(DISTINCT issue_key) as count FROM commit_issue_refs`, []),
      ]);

      await storage.close();

      const sections: string[] = [];
      const totalRow = total.rows[0] as unknown as CountRow | undefined;
      const refsRow = issueRefCount.rows[0] as unknown as CountRow | undefined;

      sections.push(`# Git Statistics${since ? ` (since ${since})` : ''}${author ? ` (author: ${author})` : ''}`);
      sections.push(`Total commits: ${str(totalRow?.count)}`);
      sections.push(`Linked issue keys: ${str(refsRow?.count)}`);

      sections.push('');
      sections.push('## Top Authors');
      for (const rawRow of byAuthor.rows) {
        const r = rawRow as { author?: string; count?: string };
        sections.push(`  ${str(r.author) || 'unknown'}: ${str(r.count)}`);
      }

      sections.push('');
      sections.push('## Most Changed Files');
      for (const rawRow of hotFiles.rows) {
        const r = rawRow as { file_path?: string; changes?: string };
        sections.push(`  ${str(r.file_path)}: ${str(r.changes)} changes`);
      }

      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Stats failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: query_prs ──────────────────────────────────────────────────────────

interface PrRow {
  number?: number;
  title?: string;
  state?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  merged_at?: string;
  base_ref?: string;
  additions?: number;
  deletions?: number;
}

server.registerTool(
  'query_prs',
  {
    description: 'Search GitHub pull requests stored in the local database. Supports full-text search, filtering by state/author/base branch, and raw SQL.',
    inputSchema: {
      search: z.string().optional().describe('Full-text search in PR title and body'),
      state: z.string().optional().describe('Filter by state: open, closed, merged'),
      author: z.string().optional().describe('Filter by PR author'),
      base_ref: z.string().optional().describe('Filter by base branch (e.g. "main")'),
      since: z.string().optional().describe('PRs updated since date (YYYY-MM-DD)'),
      limit: z.number().optional().describe('Max results (default: 50)'),
      sql: z.string().optional().describe('Raw SQL. Tables: pull_requests, pr_reviews, pr_comments, pr_files, pr_issue_refs'),
    },
  },
  async ({ search, state, author, base_ref: baseRef, since, limit, sql }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);

    try {
      const maxResults = limit ?? 50;
      let sqlQuery: string;
      let params: unknown[];

      if (sql) {
        sqlQuery = sql;
        params = [];
      } else {
        const conditions: string[] = [];
        params = [];
        let paramIdx = 1;

        if (search) {
          conditions.push(`search_vector @@ plainto_tsquery('english', $${String(paramIdx)})`);
          params.push(search);
          paramIdx++;
        }
        if (state) {
          conditions.push(`state = $${String(paramIdx)}`);
          params.push(state.toLowerCase());
          paramIdx++;
        }
        if (author) {
          conditions.push(`author ILIKE $${String(paramIdx)}`);
          params.push(`%${author}%`);
          paramIdx++;
        }
        if (baseRef) {
          conditions.push(`base_ref = $${String(paramIdx)}`);
          params.push(baseRef);
          paramIdx++;
        }
        if (since) {
          conditions.push(`updated_at >= $${String(paramIdx)}`);
          params.push(since);
          paramIdx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        sqlQuery = `
          SELECT number, title, state, author, created_at, updated_at, merged_at,
                 base_ref, additions, deletions
          FROM pull_requests
          ${where}
          ORDER BY updated_at DESC NULLS LAST
          LIMIT ${String(maxResults)}
        `;
      }

      const result = await storage.query(sqlQuery, params);
      await storage.close();

      if (result.rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No pull requests found. Run "argustack sync git" with GITHUB_TOKEN configured.' }],
        };
      }

      const lines = result.rows.map((row: Record<string, unknown>) => {
        const typed = row as unknown as PrRow;
        if (typed.number) {
          const date = typed.merged_at ? str(typed.merged_at).substring(0, 10) : str(typed.updated_at ?? '').substring(0, 10);
          return `#${str(typed.number)} [${str(typed.state)}] ${str(typed.title)} by ${str(typed.author)} (${date}) +${str(typed.additions)}/-${str(typed.deletions)}`;
        }
        return JSON.stringify(row);
      });

      return {
        content: [{
          type: 'text' as const,
          text: [`Found ${String(result.rows.length)} pull requests:`, '', ...lines].join('\n'),
        }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Query failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: issue_prs ──────────────────────────────────────────────────────────

server.registerTool(
  'issue_prs',
  {
    description: 'Cross-reference: find all GitHub pull requests that mention a Jira issue key. Shows which PRs implemented a ticket.',
    inputSchema: {
      issue_key: z.string().describe('Issue key (e.g. "PAP-123")'),
    },
  },
  async ({ issue_key: issueKey }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);

    try {
      const prsResult = await storage.query(
        `SELECT p.number, p.title, p.state, p.author, p.created_at, p.merged_at,
                p.additions, p.deletions, p.base_ref, p.head_ref
         FROM pull_requests p
         JOIN pr_issue_refs r ON p.repo_full_name = r.repo_full_name AND p.number = r.pr_number
         WHERE r.issue_key = $1
         ORDER BY p.created_at DESC`,
        [issueKey.toUpperCase()]
      );

      if (prsResult.rows.length === 0) {
        await storage.close();
        return {
          content: [{
            type: 'text' as const,
            text: `No PRs found mentioning ${issueKey}. Make sure GitHub sync is configured.`,
          }],
        };
      }

      const sections: string[] = [];
      sections.push(`# Pull Requests for ${issueKey} (${String(prsResult.rows.length)})`);
      sections.push('');

      for (const rawRow of prsResult.rows) {
        const pr = rawRow as unknown as PrRow & { head_ref?: string };
        sections.push(`## #${str(pr.number)} — ${str(pr.title)}`);
        sections.push(`State: ${str(pr.state)} | Author: ${str(pr.author)} | ${str(pr.base_ref)} ← ${str(pr.head_ref)}`);
        sections.push(`+${str(pr.additions)} -${str(pr.deletions)} | Created: ${str(pr.created_at ?? '').substring(0, 10)}${pr.merged_at ? ` | Merged: ${str(pr.merged_at).substring(0, 10)}` : ''}`);

        const reviewsResult = await storage.query(
          `SELECT reviewer, state, submitted_at FROM pr_reviews
           WHERE repo_full_name = (SELECT repo_full_name FROM pull_requests WHERE number = $1 LIMIT 1) AND pr_number = $1
           ORDER BY submitted_at`,
          [pr.number]
        );

        if (reviewsResult.rows.length > 0) {
          sections.push('Reviews:');
          for (const r of reviewsResult.rows) {
            const review = r as { reviewer?: string; state?: string; submitted_at?: string };
            sections.push(`  ${str(review.reviewer)}: ${str(review.state)} (${str(review.submitted_at ?? '').substring(0, 10)})`);
          }
        }

        sections.push('');
      }

      await storage.close();

      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Query failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: issue_timeline ─────────────────────────────────────────────────────

interface TimelineEvent {
  date: string;
  type: 'created' | 'changelog' | 'commit' | 'pr_opened' | 'pr_reviewed' | 'pr_merged';
  text: string;
}

server.registerTool(
  'issue_timeline',
  {
    description: 'Full cross-source timeline for a Jira issue: changelog events, Git commits, GitHub PRs with reviews — all in chronological order. Combines get_issue + issue_commits + issue_prs into a single view.',
    inputSchema: {
      issue_key: z.string().describe('Issue key (e.g. "PAP-123")'),
    },
  },
  async ({ issue_key: issueKey }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);
    const key = issueKey.toUpperCase();

    try {
      // 5 parallel queries
      const [issueResult, changelogsResult, commitsResult, prsResult, commitFilesResult] = await Promise.all([
        storage.query(
          `SELECT issue_key, summary, status, issue_type, assignee, reporter, created, updated, resolved FROM issues WHERE issue_key = $1`,
          [key]
        ),
        storage.query(
          `SELECT author, field, from_value, to_value, changed_at FROM issue_changelogs WHERE issue_key = $1 ORDER BY changed_at`,
          [key]
        ),
        storage.query(
          `SELECT c.hash, c.message, c.author, c.email, c.committed_at
           FROM commits c JOIN commit_issue_refs r ON c.hash = r.commit_hash
           WHERE r.issue_key = $1 ORDER BY c.committed_at`,
          [key]
        ),
        storage.query(
          `SELECT p.number, p.title, p.state, p.author, p.created_at, p.merged_at, p.base_ref,
                  p.additions, p.deletions, p.repo_full_name
           FROM pull_requests p JOIN pr_issue_refs r ON p.repo_full_name = r.repo_full_name AND p.number = r.pr_number
           WHERE r.issue_key = $1 ORDER BY p.created_at`,
          [key]
        ),
        storage.query(
          `SELECT cf.commit_hash, cf.file_path, cf.status, cf.additions, cf.deletions
           FROM commit_files cf JOIN commit_issue_refs r ON cf.commit_hash = r.commit_hash
           WHERE r.issue_key = $1`,
          [key]
        ),
      ]);

      if (issueResult.rows.length === 0) {
        await storage.close();
        return {
          content: [{ type: 'text' as const, text: `Issue ${key} not found.` }],
        };
      }

      const issue = issueResult.rows[0] as {
        issue_key: string; summary: string; status?: string; issue_type?: string;
        assignee?: string; reporter?: string; created?: string; updated?: string; resolved?: string;
      };

      // Fetch reviews for found PRs
      const prRows = prsResult.rows as {
        number: number; title?: string; state?: string; author?: string;
        created_at?: string; merged_at?: string; base_ref?: string;
        additions?: number; deletions?: number; repo_full_name?: string;
      }[];

      const reviewsByPr = new Map<number, { reviewer?: string; state?: string; submitted_at?: string }[]>();
      for (const pr of prRows) {
        const reviewsResult = await storage.query(
          `SELECT reviewer, state, submitted_at FROM pr_reviews WHERE repo_full_name = $1 AND pr_number = $2 ORDER BY submitted_at`,
          [pr.repo_full_name, pr.number]
        );
        reviewsByPr.set(pr.number, reviewsResult.rows as { reviewer?: string; state?: string; submitted_at?: string }[]);
      }

      await storage.close();

      // Build file map for commits
      const filesByCommit = new Map<string, { file_path?: string; status?: string; additions?: number; deletions?: number }[]>();
      for (const f of commitFilesResult.rows as { commit_hash: string; file_path?: string; status?: string; additions?: number; deletions?: number }[]) {
        const arr = filesByCommit.get(f.commit_hash) ?? [];
        arr.push(f);
        filesByCommit.set(f.commit_hash, arr);
      }

      // Build timeline events
      const events: TimelineEvent[] = [];

      // Issue created
      if (issue.created) {
        events.push({ date: issue.created, type: 'created', text: 'Issue created' });
      }

      // Changelogs
      for (const raw of changelogsResult.rows) {
        const ch = raw as ChangelogRow;
        if (ch.changed_at) {
          events.push({
            date: ch.changed_at,
            type: 'changelog',
            text: `${str(ch.author)} changed ${str(ch.field)}: "${str(ch.from_value)}" → "${str(ch.to_value)}"`,
          });
        }
      }

      // Commits
      for (const raw of commitsResult.rows) {
        const c = raw as { hash: string; message?: string; author?: string; committed_at?: string };
        if (c.committed_at) {
          const firstLine = (c.message ?? '').split('\n')[0];
          events.push({
            date: c.committed_at,
            type: 'commit',
            text: `Commit ${c.hash.substring(0, 7)} — "${firstLine}" (${str(c.author)})`,
          });
        }
      }

      // PRs opened + merged
      for (const pr of prRows) {
        if (pr.created_at) {
          events.push({
            date: pr.created_at,
            type: 'pr_opened',
            text: `PR #${String(pr.number)} opened — "${str(pr.title)}" (${str(pr.author)})`,
          });
        }
        // Reviews
        const reviews = reviewsByPr.get(pr.number) ?? [];
        for (const r of reviews) {
          if (r.submitted_at) {
            events.push({
              date: r.submitted_at,
              type: 'pr_reviewed',
              text: `PR #${String(pr.number)} reviewed — ${str(r.state)} (${str(r.reviewer)})`,
            });
          }
        }
        if (pr.merged_at) {
          events.push({
            date: pr.merged_at,
            type: 'pr_merged',
            text: `PR #${String(pr.number)} merged into ${str(pr.base_ref)}`,
          });
        }
      }

      // Sort chronologically
      events.sort((a, b) => a.date.localeCompare(b.date));

      // Format output
      const sections: string[] = [];

      sections.push(`=== ISSUE: ${key} ===`);
      sections.push(`Summary: ${str(issue.summary)}`);
      sections.push(`Status: ${str(issue.status)} | Type: ${str(issue.issue_type)} | Assignee: ${str(issue.assignee)}`);
      sections.push(`Created: ${str(issue.created ?? '').substring(0, 10)} | Resolved: ${str(issue.resolved ?? '').substring(0, 10) || 'n/a'}`);
      sections.push('');

      // Timeline
      sections.push(`--- TIMELINE (${String(events.length)} events) ---`);
      for (const ev of events) {
        sections.push(`[${ev.date.substring(0, 10)}] ${ev.text}`);
      }
      sections.push('');

      // Commits summary
      const commitRows = commitsResult.rows as { hash: string; message?: string; author?: string }[];
      if (commitRows.length > 0) {
        sections.push(`--- COMMITS (${String(commitRows.length)}) ---`);
        for (const c of commitRows) {
          const firstLine = (c.message ?? '').split('\n')[0];
          const files = filesByCommit.get(c.hash) ?? [];
          const adds = files.reduce((s, f) => s + (f.additions ?? 0), 0);
          const dels = files.reduce((s, f) => s + (f.deletions ?? 0), 0);
          sections.push(`${c.hash.substring(0, 7)} — ${firstLine} (+${String(adds)}/-${String(dels)}, ${String(files.length)} files)`);
        }
        sections.push('');
      }

      // PRs summary
      if (prRows.length > 0) {
        sections.push(`--- PULL REQUESTS (${String(prRows.length)}) ---`);
        for (const pr of prRows) {
          const reviews = reviewsByPr.get(pr.number) ?? [];
          const approvals = reviews.filter((r) => r.state === 'APPROVED').map((r) => str(r.reviewer));
          const reviewInfo = approvals.length > 0 ? ` (${approvals.join(', ')} approved)` : '';
          sections.push(`#${String(pr.number)} — ${str(pr.title)} [${str(pr.state)}]${reviewInfo}`);
        }
        sections.push('');
      }

      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Query failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: query_releases ─────────────────────────────────────────────────────

server.registerTool(
  'query_releases',
  {
    description: 'List GitHub releases for the repository. Useful for understanding release cadence and what was shipped.',
    inputSchema: {
      search: z.string().optional().describe('Full-text search in release name/body'),
      limit: z.number().optional().describe('Max results (default: 20)'),
    },
  },
  async ({ search, limit }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);

    try {
      const maxResults = limit ?? 20;
      let sqlQuery: string;
      const params: unknown[] = [];

      if (search) {
        sqlQuery = `
          SELECT tag_name, name, author, published_at, draft, prerelease
          FROM releases
          WHERE search_vector @@ plainto_tsquery('english', $1)
          ORDER BY published_at DESC NULLS LAST
          LIMIT ${String(maxResults)}
        `;
        params.push(search);
      } else {
        sqlQuery = `
          SELECT tag_name, name, author, published_at, draft, prerelease
          FROM releases
          ORDER BY published_at DESC NULLS LAST
          LIMIT ${String(maxResults)}
        `;
      }

      const result = await storage.query(sqlQuery, params);
      await storage.close();

      if (result.rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No releases found. Run "argustack sync git" with GITHUB_TOKEN.' }],
        };
      }

      const lines = result.rows.map((row: Record<string, unknown>) => {
        const r = row as { tag_name?: string; name?: string; author?: string; published_at?: string; draft?: boolean; prerelease?: boolean };
        const flags = [r.draft ? 'draft' : '', r.prerelease ? 'pre' : ''].filter(Boolean).join(',');
        const date = str(r.published_at ?? '').substring(0, 10);
        return `${str(r.tag_name)} — ${str(r.name) || '(no name)'} by ${str(r.author)} (${date})${flags ? ` [${flags}]` : ''}`;
      });

      return {
        content: [{
          type: 'text' as const,
          text: [`Found ${String(result.rows.length)} releases:`, '', ...lines].join('\n'),
        }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Query failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: semantic_search ────────────────────────────────────────────────────

server.registerTool(
  'semantic_search',
  {
    description: 'Semantic vector similarity search across issues. Uses AI embeddings to find issues by meaning, not just keywords. Requires embeddings generated first ("argustack embed").',
    inputSchema: {
      query: z.string().describe('Natural language search query (e.g. "authentication timeout problems")'),
      limit: z.number().optional().describe('Max results (default: 10)'),
      threshold: z.number().optional().describe('Minimum similarity score 0-1 (default: 0.5)'),
    },
  },
  async ({ query, limit, threshold }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);

    try {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) {
        await storage.close();
        return {
          content: [{
            type: 'text' as const,
            text: 'OPENAI_API_KEY not configured. Add it to .env and run "argustack embed" first.',
          }],
          isError: true,
        };
      }

      const { OpenAIEmbeddingProvider } = await import('../adapters/openai/index.js');
      const embeddingProvider = new OpenAIEmbeddingProvider({ apiKey });

      const vectors = await embeddingProvider.embed([query]);
      const queryVector = vectors[0];

      if (!queryVector) {
        await storage.close();
        return {
          content: [{ type: 'text' as const, text: 'Failed to generate embedding for query.' }],
          isError: true,
        };
      }

      const results = await storage.semanticSearch(
        queryVector,
        limit ?? 10,
        threshold ?? 0.5,
      );

      if (results.length === 0) {
        await storage.close();
        return {
          content: [{
            type: 'text' as const,
            text: 'No similar issues found. Make sure embeddings are generated ("argustack embed").',
          }],
        };
      }

      const issueKeys = results.map((r) => r.issueKey);
      const placeholders = issueKeys.map((_, i) => `$${String(i + 1)}`).join(',');
      const issuesResult = await storage.query(
        `SELECT issue_key, summary, status, assignee, issue_type FROM issues WHERE issue_key IN (${placeholders})`,
        issueKeys,
      );

      await storage.close();

      const issueMap = new Map<string, Record<string, unknown>>();
      for (const row of issuesResult.rows) {
        const r = row as { issue_key: string };
        issueMap.set(r.issue_key, row);
      }

      const lines = results.map((r) => {
        const issue = issueMap.get(r.issueKey) as IssueRow | undefined;
        const sim = (r.similarity * 100).toFixed(1);
        if (issue) {
          return `${r.issueKey} [${str(issue.status)}] ${str(issue.summary)} (${sim}% match)`;
        }
        return `${r.issueKey} (${sim}% match)`;
      });

      return {
        content: [{
          type: 'text' as const,
          text: [`Semantic search: "${query}" (${String(results.length)} results):`, '', ...lines].join('\n'),
        }],
      };
    } catch (err: unknown) {
      await storage.close();
      return {
        content: [{ type: 'text' as const, text: `Search failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ─── Tool 15: estimate ────────────────────────────────────────────────────────

interface EstimateSimilarRow {
  issue_key: string;
  summary: string;
  issue_type: string;
  status: string;
  assignee: string | null;
  created: string;
  resolved: string | null;
  parent_key: string | null;
  story_points: number | null;
  rank: number;
}

interface EstimateWorklogRow {
  issue_key: string;
  author: string;
  total_seconds: string;
}

interface EstimateCommitRow {
  issue_key: string;
  commits: string;
  authors: string;
  total_additions: string;
  total_deletions: string;
  first_commit: string | null;
  last_commit: string | null;
}

interface EstimateBugRow {
  bug_key: string;
  summary: string;
  resolved: string | null;
  created: string;
}

interface EstimateRawRow {
  issue_key: string;
  original_estimate: string | null;
  time_spent: string | null;
  aggregate_time: string | null;
}

server.registerTool(
  'estimate',
  {
    description: 'Predict effort for a new task based on historical data. Finds similar completed tasks, analyzes cycle times, worklogs per developer, bug aftermath, estimate accuracy. Two key inputs: WHAT (task description) and WHO (developer).',
    inputSchema: {
      description: z.string().describe('Description of the new task (e.g. "Stripe payment integration with subscriptions")'),
      assignee: z.string().optional().describe('Developer name to predict for. If omitted, shows all developers who worked on similar tasks'),
      limit: z.number().optional().describe('Number of similar tasks to analyze (default: 10)'),
    },
  },
  async ({ description, assignee, limit }) => {
    const ws = loadWorkspace();
    if (!ws.ok) {
      return {
        content: [{ type: 'text' as const, text: `Workspace not found: ${ws.reason}` }],
        isError: true,
      };
    }

    const { storage } = await createAdapters(ws.root);
    try {
      const maxResults = limit ?? 10;

      // 1. Find similar DONE issues via full-text search + status_category
      const similarResult = await storage.query(
        `SELECT issue_key, summary, issue_type, status, assignee, created, resolved,
                parent_key, story_points,
                ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
         FROM issues
         WHERE search_vector @@ plainto_tsquery('english', $1)
           AND status_category = 'Done'
         ORDER BY rank DESC
         LIMIT $2`,
        [description, maxResults],
      );

      const similar = similarResult.rows as unknown as EstimateSimilarRow[];

      if (similar.length === 0) {
        await storage.close();
        return {
          content: [{ type: 'text' as const, text: `No similar completed tasks found for: "${description}"\n\nTry broader terms or different keywords.` }],
        };
      }

      const issueKeys = similar.map((r) => r.issue_key);
      const keysParam = issueKeys.map((_, i) => `$${String(i + 1)}`).join(',');

      // 2. Worklogs per developer per issue
      const worklogsResult = await storage.query(
        `SELECT issue_key, author, SUM(time_spent_seconds) as total_seconds
         FROM issue_worklogs
         WHERE issue_key IN (${keysParam})
         GROUP BY issue_key, author`,
        issueKeys,
      );
      const worklogs = worklogsResult.rows as unknown as EstimateWorklogRow[];

      // 3. Real developer — first assignee from changelogs (the person who started working)
      const devChangelogResult = await storage.query(
        `SELECT DISTINCT ON (issue_key) issue_key, to_value as dev_assignee
         FROM issue_changelogs
         WHERE issue_key IN (${keysParam})
           AND field = 'assignee'
           AND to_value IS NOT NULL
           AND to_value != ''
         ORDER BY issue_key, changed_at`,
        issueKeys,
      );
      const devChangelogs = devChangelogResult.rows as unknown as { issue_key: string; dev_assignee: string }[];
      const realDevMap = new Map<string, string>();
      for (const d of devChangelogs) {
        realDevMap.set(d.issue_key, d.dev_assignee);
      }

      // 4. Commits linked to these issues — with real coding time (first → last commit)
      const commitsResult = await storage.query(
        `SELECT r.issue_key,
                COUNT(*) as commits,
                STRING_AGG(DISTINCT c.author, ', ') as authors,
                SUM(cf_agg.additions) as total_additions,
                SUM(cf_agg.deletions) as total_deletions,
                MIN(c.author_date) as first_commit,
                MAX(c.author_date) as last_commit
         FROM commit_issue_refs r
         JOIN commits c ON r.commit_hash = c.hash
         LEFT JOIN (
           SELECT commit_hash, SUM(additions) as additions, SUM(deletions) as deletions
           FROM commit_files GROUP BY commit_hash
         ) cf_agg ON c.hash = cf_agg.commit_hash
         WHERE r.issue_key IN (${keysParam})
         GROUP BY r.issue_key`,
        issueKeys,
      );
      const commitData = commitsResult.rows as unknown as EstimateCommitRow[];

      // 5. Related issues — children (subtasks, bugs) + linked issues
      const childrenResult = await storage.query(
        `SELECT i.parent_key as related_to, i.issue_key as bug_key, i.summary, i.issue_type, i.resolved, i.created
         FROM issues i
         WHERE i.parent_key IN (${keysParam})
           AND i.issue_key NOT IN (${keysParam})`,
        [...issueKeys, ...issueKeys],
      );
      const linkedResult = await storage.query(
        `SELECT il.source_key as related_to, i.issue_key as bug_key, i.summary, i.issue_type, i.resolved, i.created
         FROM issue_links il
         JOIN issues i ON i.issue_key = il.target_key
         WHERE il.source_key IN (${keysParam})
           AND i.issue_key NOT IN (${keysParam})`,
        [...issueKeys, ...issueKeys],
      );
      const bugs = [
        ...(childrenResult.rows as unknown as (EstimateBugRow & { related_to: string; issue_type: string })[]),
        ...(linkedResult.rows as unknown as (EstimateBugRow & { related_to: string; issue_type: string })[]),
      ];

      // 6. Original estimates from raw_json
      const rawEstimates = await storage.query(
        `SELECT issue_key,
                raw_json->'fields'->>'timeoriginalestimate' as original_estimate,
                raw_json->'fields'->>'timespent' as time_spent,
                raw_json->'fields'->>'aggregatetimespent' as aggregate_time
         FROM issues
         WHERE issue_key IN (${keysParam})`,
        issueKeys,
      );
      const estimates = rawEstimates.rows as unknown as EstimateRawRow[];

      await storage.close();

      // ─── Build report ───

      const sections: string[] = [];
      sections.push(`# Estimate Prediction`);
      sections.push(`Query: "${description}"${assignee ? ` | Developer: ${assignee}` : ''}`);
      sections.push(`Based on ${String(similar.length)} similar completed tasks\n`);

      // Index data by issue_key
      const worklogMap = new Map<string, EstimateWorklogRow[]>();
      for (const w of worklogs) {
        const arr = worklogMap.get(w.issue_key) ?? [];
        arr.push(w);
        worklogMap.set(w.issue_key, arr);
      }

      const commitMap = new Map<string, EstimateCommitRow>();
      for (const c of commitData) {
        commitMap.set(c.issue_key, c);
      }

      const estimateMap = new Map<string, EstimateRawRow>();
      for (const e of estimates) {
        estimateMap.set(e.issue_key, e);
      }

      const bugMap = new Map<string, (EstimateBugRow & { related_to: string; issue_type: string })[]>();
      for (const b of bugs) {
        const arr = bugMap.get(b.related_to) ?? [];
        arr.push(b);
        bugMap.set(b.related_to, arr);
      }

      // ─── Per-issue breakdown ───
      sections.push('## Similar Tasks\n');

      let totalCycleHours = 0;
      let totalCodingHours = 0;
      let totalWorklogHours = 0;
      let totalBugs = 0;
      let validCycleCount = 0;
      let validCodingCount = 0;
      const developerStats = new Map<string, { tasks: number; cycleHours: number; codingHours: number; bugs: number; commits: number }>();

      for (const issue of similar) {
        const cycleHours = issue.resolved
          ? (new Date(issue.resolved).getTime() - new Date(issue.created).getTime()) / 3600000
          : null;

        if (cycleHours !== null) {
          totalCycleHours += cycleHours;
          validCycleCount++;
        }

        const issueWorklogs = worklogMap.get(issue.issue_key) ?? [];
        const issueCommits = commitMap.get(issue.issue_key);
        const issueBugs = bugMap.get(issue.issue_key) ?? [];
        const issueEstimate = estimateMap.get(issue.issue_key);

        // Real coding time from commits
        const codingHours = (issueCommits?.first_commit && issueCommits.last_commit)
          ? (new Date(issueCommits.last_commit).getTime() - new Date(issueCommits.first_commit).getTime()) / 3600000
          : null;

        if (codingHours !== null && codingHours > 0) {
          totalCodingHours += codingHours;
          validCodingCount++;
        }

        const worklogHours = issueWorklogs.reduce((sum, w) => sum + Number(w.total_seconds), 0) / 3600;
        totalWorklogHours += worklogHours;
        totalBugs += issueBugs.length;

        // Track developer stats — priority: changelog assignee → worklogs → commits → current assignee
        const realDev = realDevMap.get(issue.issue_key);
        const devName = realDev ?? (issueWorklogs.length > 0 ? issueWorklogs[0]?.author : null) ?? issueCommits?.authors ?? issue.assignee ?? 'unknown';
        if (devName) {
          const stats = developerStats.get(devName) ?? { tasks: 0, cycleHours: 0, codingHours: 0, bugs: 0, commits: 0 };
          stats.tasks++;
          stats.cycleHours += cycleHours ?? 0;
          stats.codingHours += codingHours ?? 0;
          stats.bugs += issueBugs.length;
          stats.commits += Number(issueCommits?.commits ?? 0);
          developerStats.set(devName, stats);
        }

        const originalEst = issueEstimate?.original_estimate ? `${String(Math.round(Number(issueEstimate.original_estimate) / 3600))}h est` : '';
        const actualTime = issueEstimate?.time_spent ? `${String(Math.round(Number(issueEstimate.time_spent) / 3600))}h actual` : '';
        const cycleStr = cycleHours !== null ? `${cycleHours.toFixed(1)}h cycle` : 'open';
        const codingStr = codingHours !== null && codingHours > 0 ? ` | ${codingHours.toFixed(1)}h coding` : '';

        sections.push(`### ${issue.issue_key}: ${issue.summary}`);
        sections.push(`Type: ${issue.issue_type} | Dev: ${devName} | ${cycleStr}${codingStr}`);
        if (originalEst || actualTime) {
          sections.push(`Estimate: ${[originalEst, actualTime].filter(Boolean).join(' → ')}`);
        }
        if (issueCommits) {
          sections.push(`Code: ${issueCommits.commits} commits, +${issueCommits.total_additions}/-${issueCommits.total_deletions} lines (${issueCommits.authors})`);
        }
        if (issueWorklogs.length > 0) {
          const wlLines = issueWorklogs.map((w) => `  ${w.author}: ${(Number(w.total_seconds) / 3600).toFixed(1)}h`);
          sections.push(`Worklogs:\n${wlLines.join('\n')}`);
        }
        if (issueBugs.length > 0) {
          const bugLines = issueBugs.map((b) => `  ${b.bug_key} [${b.issue_type}] ${b.summary}`);
          sections.push(`Related issues (${String(issueBugs.length)}):\n${bugLines.join('\n')}`);
        }
        sections.push('');
      }

      // ─── Aggregate prediction ───
      sections.push('## Prediction\n');

      const avgCycle = validCycleCount > 0 ? totalCycleHours / validCycleCount : 0;
      const avgCoding = validCodingCount > 0 ? totalCodingHours / validCodingCount : 0;
      const avgBugs = similar.length > 0 ? totalBugs / similar.length : 0;

      // Best effort time: coding > worklogs > cycle
      const bestTimeSource = avgCoding > 0 ? { label: 'coding time (commits)', hours: avgCoding }
        : totalWorklogHours > 0 ? { label: 'logged time (worklogs)', hours: totalWorklogHours / similar.length }
        : { label: 'cycle time (created→resolved)', hours: avgCycle };

      sections.push(`Average ${bestTimeSource.label}: ${bestTimeSource.hours.toFixed(1)}h (${(bestTimeSource.hours / 8).toFixed(1)} working days)`);
      if (avgCoding > 0 && avgCycle > 0) {
        sections.push(`Cycle time (includes waiting/review): ${avgCycle.toFixed(1)}h — coding was ${((avgCoding / avgCycle) * 100).toFixed(0)}% of it`);
      }
      sections.push(`Bug rate: ${avgBugs.toFixed(1)} bugs per task`);

      // ─── Developer breakdown ───
      if (developerStats.size > 0) {
        sections.push('\n## Developer Profiles\n');
        for (const [dev, stats] of developerStats) {
          if (assignee && !dev.toLowerCase().includes(assignee.toLowerCase())) {
            continue;
          }
          const avgDevCoding = stats.tasks > 0 ? stats.codingHours / stats.tasks : 0;
          const avgDevCycle = stats.tasks > 0 ? stats.cycleHours / stats.tasks : 0;
          const devBestHours = avgDevCoding > 0 ? avgDevCoding : avgDevCycle;
          const bugRate = stats.tasks > 0 ? stats.bugs / stats.tasks : 0;
          sections.push(`**${dev}**: ${String(stats.tasks)} similar tasks, avg ${devBestHours.toFixed(1)}h (${(devBestHours / 8).toFixed(1)}d), ${bugRate.toFixed(1)} bugs/task, ${String(stats.commits)} commits`);
        }
      }

      // ─── Final estimate ───
      sections.push('\n## Recommended Estimate\n');
      const bufferMultiplier = 1.3;
      const predictedHours = bestTimeSource.hours * bufferMultiplier;
      sections.push(`Base: ${bestTimeSource.hours.toFixed(0)}h + 30% buffer = **${predictedHours.toFixed(0)}h (${(predictedHours / 8).toFixed(1)} working days)**`);
      if (avgBugs > 0.5) {
        sections.push(`⚠ High bug rate (${avgBugs.toFixed(1)}/task) — consider additional buffer`);
      }

      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
      };
    } catch (err: unknown) {
      await storage.close();
      return {
        content: [{ type: 'text' as const, text: `Estimate failed: ${getErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ─── Start ────────────────────────────────────────────────────────────────────

export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // IMPORTANT: use console.error, not console.log — stdout is for JSON-RPC
  console.error('Argustack MCP server running on stdio');
}

// Allow direct execution: node dist/mcp/server.js
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/mcp/server.js') || process.argv[1].endsWith('/mcp/server.ts'));

if (isDirectRun) {
  startMcpServer().catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
