#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import chalk from 'chalk';
import { registerSourceCommands } from './sources.js';
import { registerSyncCommand } from './sync.js';
import { registerStatusCommand } from './status.js';
import { registerMcpCommands } from './mcp-install.js';
import { registerEmbedCommand } from './embed.js';
import { registerPushCommand } from './push.js';
import { registerWorkspaceCommands } from './workspace/index.js';
import { registerAddCommands } from './add/index.js';
import { registerGraphCommand } from './graph.js';
import { registerCodeCommands } from './code.js';
import { registerBoardCommand } from './board.js';
import { registerMigrateCommand } from './migrate-to-hub.js';
import { runInit } from './init/index.js';
import type { InitFlags } from './init/index.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

const program = new Command();

program
  .name('argustack')
  .description('Multi-tenant project analysis hub — Jira + Git + GitHub + DB + Code')
  .version(version);

program
  .command('init')
  .description('Bootstrap the Argustack hub on this machine')
  .argument('[name]', 'Optional first workspace name (deprecated — prefer `argustack workspace add`)')
  .option('--skip-docker', 'Skip `docker compose up` (assumes hub containers already running)')
  .option('--skip-first-workspace', 'Do not prompt for a first workspace')
  .option('--skip-llm', 'Skip code intelligence / LLM setup')
  .option('--name <name>', 'Workspace name (required with --no-interactive)')
  .option('--no-interactive', 'Non-interactive mode (no prompts)')
  .action(async (name: string | undefined, options: unknown) => {
    try {
      const flags = options as InitFlags;
      if (name !== undefined && name.length > 0) {
        flags.name = name;
      }
      await runInit(flags);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'ExitPromptError') {
        console.log('\n  Cancelled.');
        process.exit(0);
      }
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

registerWorkspaceCommands(program);
registerAddCommands(program);
registerSourceCommands(program);
registerSyncCommand(program);
registerStatusCommand(program);
registerEmbedCommand(program);
registerPushCommand(program);
registerGraphCommand(program);
registerCodeCommands(program);
registerBoardCommand(program);
registerMigrateCommand(program);

program
  .command('workspaces')
  .description('Deprecated alias for `argustack workspace list`')
  .action(() => {
    console.log(chalk.yellow('  `argustack workspaces` is deprecated. Use `argustack workspace list`.\n'));
    program.parseAsync(['workspace', 'list'], { from: 'user' }).catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
  });

const mcpCmd = program
  .command('mcp')
  .description('MCP server for Claude Desktop / Claude Code');

registerMcpCommands(mcpCmd);

program.parse();
