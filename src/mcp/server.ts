#!/usr/bin/env node

/**
 * Argustack MCP Server
 *
 * Exposes Argustack capabilities as MCP tools for Claude Desktop / Claude Code.
 * Runs on stdio transport — add to claude_desktop_config.json to use.
 *
 * Architecture:
 *   MCP Server is a driving adapter (like cli/index.ts).
 *   Tools are split by domain: workspace, query, issue, search, estimate.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerWorkspaceTools } from './tools/workspace.js';
import { registerQueryTools } from './tools/query.js';
import { registerIssueTools } from './tools/issue.js';
import { registerSearchTools } from './tools/search.js';
import { registerEstimateTools } from './tools/estimate.js';
import { registerDatabaseTools } from './tools/database.js';
import { registerPushTools } from './tools/push.js';
import { registerGraphTools } from './tools/graph.js';
import { registerCodeGraphTools } from './tools/code-graph.js';
import { registerCodeSearchTools } from './tools/code-search.js';
import { registerCodeHybridTools } from './tools/code-hybrid.js';

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

function loadPackageVersion(): string {
  try {
    const pkgPath = resolve(mcpPackageRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) {
      return pkg.version;
    }
  } catch {
    /* fall through */
  }
  return '0.0.0';
}

const iconDataUri = loadIconDataUri();

const INSTRUCTIONS = `Argustack hub gives you ground-truth project data: Jira issues, Git commits, GitHub PRs, optional external app DB, knowledge graph, and code intelligence (Neo4j call graph + Qdrant semantic vectors).

Workspace model
- The hub stores many workspaces in one Postgres database (every row carries workspace_id).
- Resolution order for the workspace_id parameter: explicit arg > ARGUSTACK_WORKSPACE_ID env > active workspace pointer > single workspace auto-pick.
- Call list_workspaces to see what is registered; switch_workspace sets the active one for subsequent tools.

Read-only vs write tools
- query_*, get_*, find_*, *_stats, *_timeline, *_search, db_query, explain_feature, plan_feature_files — safe, read-only, no side effects.
- create_issue, update_issue, push, pull_jira, build_business_graph, add_relationship, add_observation — write or sync. Confirm intent before invoking.

Source readiness
- Jira tools (query_issues, pull_jira, push, create_issue, update_issue, list_projects) need JIRA_* credentials in ~/.argustack/config.env. If absent, the tool will respond with isError.
- Git/GitHub tools work as long as the workspace has bindings; use workspace_info to inspect them.
- db_* tools need an external DB bound to the workspace via 'argustack add db'.
- Code intelligence tools (find_symbol, search_semantic, explain_feature, ...) need a registered code project — see 'argustack add code'.

Recommended flow
1. list_workspaces / switch_workspace, or pass workspace_id explicitly.
2. workspace_info to see which sources are bound.
3. Then call query_*, search_*, get_* or specialized analyses (impact_analysis, estimate, root_cause_analysis).

Errors come back inside the tool result with isError: true so you can read the message and self-correct.`;

export const server = new McpServer({
  name: 'Argustack',
  title: 'Argustack',
  version: loadPackageVersion(),
  ...(iconDataUri !== null && iconDataUri.length > 0 ? {
    icons: [{
      src: iconDataUri,
      mimeType: 'image/png',
      sizes: ['any'],
    }],
  } : {}),
}, {
  instructions: INSTRUCTIONS,
});

registerWorkspaceTools(server);
registerQueryTools(server);
registerIssueTools(server);
registerSearchTools(server);
registerEstimateTools(server);
registerDatabaseTools(server);
registerPushTools(server);
registerGraphTools(server);
registerCodeGraphTools(server);
registerCodeSearchTools(server);
registerCodeHybridTools(server);

export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Argustack MCP server running on stdio');
}

const mainArg = typeof process !== 'undefined' ? process.argv[1] : undefined;
const isDirectRun =
  mainArg !== undefined &&
  (mainArg.endsWith('/mcp/server.js') || mainArg.endsWith('/mcp/server.ts'));

if (isDirectRun) {
  startMcpServer().catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
