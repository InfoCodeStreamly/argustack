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
      limit: z.number().optional().describe('Max results (default: 50)'),
      sql: z.string().optional().describe('Raw SQL query. Tables: commits, commit_files, commit_issue_refs'),
    },
  },
  async ({ search, author, since, until, file_path: filePath, limit, sql }) => {
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
          const date = typed.committed_at ? typed.committed_at.substring(0, 10) : '?';
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
      const commitsResult = await storage.query(
        `SELECT c.hash, c.message, c.author, c.committed_at
         FROM commits c
         JOIN commit_issue_refs r ON c.hash = r.commit_hash
         WHERE r.issue_key = $1
         ORDER BY c.committed_at DESC`,
        [issueKey.toUpperCase()]
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
    },
  },
  async ({ since, author }) => {
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

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const [total, byAuthor, hotFiles, issueRefCount] = await Promise.all([
        storage.query(`SELECT COUNT(*) as count FROM commits ${where}`, params),
        storage.query(`SELECT author, COUNT(*) as count FROM commits ${where} GROUP BY author ORDER BY count DESC LIMIT 15`, params),
        storage.query(
          `SELECT cf.file_path, COUNT(*) as changes
           FROM commit_files cf
           JOIN commits c ON cf.commit_hash = c.hash
           ${where ? where.replace(/committed_at/g, 'c.committed_at').replace(/author/g, 'c.author') : ''}
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
