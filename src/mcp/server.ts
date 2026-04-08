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

registerWorkspaceTools(server);
registerQueryTools(server);
registerIssueTools(server);
registerSearchTools(server);
registerEstimateTools(server);
registerDatabaseTools(server);
registerPushTools(server);
registerGraphTools(server);

export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Argustack MCP server running on stdio');
}

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
