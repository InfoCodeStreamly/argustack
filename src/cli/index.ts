#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { registerSourceCommands } from './sources.js';
import { registerSyncCommand } from './sync.js';
import { registerStatusCommand } from './status.js';
import { registerMcpCommands } from './mcp-install.js';
import { registerEmbedCommand } from './embed.js';
import { runInit } from './init/index.js';
import type { InitFlags } from './init/index.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

const program = new Command();

program
  .name('argustack')
  .description('Project analysis platform — Jira + Git + DB')
  .version(version);

program
  .command('init')
  .description('Create a new Argustack workspace')
  .option('-d, --dir <path>', 'Workspace directory')
  .option('-s, --source <sources>', 'Comma-separated sources: jira,git,github,db')
  .option('--jira-url <url>', 'Jira instance URL')
  .option('--jira-email <email>', 'Jira user email')
  .option('--jira-token <token>', 'Jira API token')
  .option('--jira-projects <keys>', 'Comma-separated project keys (or "all")')
  .option('--git-repo <paths>', 'Git repository paths, comma-separated')
  .option('--github-token <token>', 'GitHub personal access token')
  .option('--github-owner <owner>', 'GitHub repository owner')
  .option('--github-repo <repo>', 'GitHub repository name')
  .option('--target-db-engine <engine>', 'Target DB engine (postgresql, mysql, mssql, sqlite, oracledb)')
  .option('--target-db-host <host>', 'Target DB host')
  .option('--target-db-port <port>', 'Target DB port')
  .option('--target-db-user <user>', 'Target DB user')
  .option('--target-db-password <password>', 'Target DB password')
  .option('--target-db-name <name>', 'Target DB name')
  .option('--csv-file <path>', 'Path to Jira CSV export file')
  .option('--db-port <port>', 'Argustack PostgreSQL port', '5434')
  .option('--pgweb-port <port>', 'pgweb UI port', '8086')
  .option('--no-interactive', 'Run without prompts (all values from flags)')
  .action(async (options: unknown) => {
    try {
      await runInit(options as InitFlags);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'ExitPromptError') {
        console.log('\n  Cancelled.');
        process.exit(0);
      }
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

registerSourceCommands(program);

registerSyncCommand(program);

registerStatusCommand(program);

registerEmbedCommand(program);

const mcpCmd = program
  .command('mcp')
  .description('MCP server for Claude Desktop / Claude Code');

registerMcpCommands(mcpCmd);

program.parse();
