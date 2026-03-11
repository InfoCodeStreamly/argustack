import type { Command } from 'commander';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { requireWorkspace } from '../workspace/resolver.js';
import { readConfig, getEnabledSources } from '../workspace/config.js';
import { ALL_SOURCES, SOURCE_META } from '../core/types/index.js';
import { PostgresStorage } from '../adapters/postgres/index.js';

interface IssueCountRow {
  readonly source: string;
  readonly cnt: string;
}

/**
 * Register `argustack status` command — workspace overview.
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show workspace overview: sources, last sync, issue counts')
    .action(async () => {
      try {
        const workspaceRoot = requireWorkspace();
        const config = readConfig(workspaceRoot);

        if (!config) {
          console.log(chalk.red('\n  No config found. Run: argustack init'));
          process.exit(1);
        }

        const enabled = getEnabledSources(config);

        console.log('');
        console.log(chalk.bold('  Argustack Workspace'));
        console.log('');
        console.log(chalk.bold('  Sources:'));

        // Try to get issue counts from DB if available
        const issueCounts = new Map<string, number>();
        let storageAvailable = false;

        if (enabled.length > 0) {
          try {
            dotenv.config({ path: `${workspaceRoot}/.env` });
            const storage = new PostgresStorage({
              host: process.env['DB_HOST'] ?? 'localhost',
              port: parseInt(process.env['DB_PORT'] ?? '5434', 10),
              user: process.env['DB_USER'] ?? 'argustack',
              password: process.env['DB_PASSWORD'] ?? 'argustack_local',
              database: process.env['DB_NAME'] ?? 'argustack',
            });

            try {
              const result = await storage.query(
                `SELECT 'jira' as source, COUNT(*)::text as cnt FROM issues`,
                [],
              );
              for (const row of result.rows) {
                const typed = row as unknown as IssueCountRow;
                issueCounts.set(typed.source, parseInt(typed.cnt, 10));
              }
              storageAvailable = true;
            } finally {
              await storage.close();
            }
          } catch {
            // DB not available — skip counts
          }
        }

        for (const source of ALL_SOURCES) {
          const meta = SOURCE_META[source];
          const cfg = config.sources[source];
          const isEnabled = cfg?.enabled === true;

          if (isEnabled) {
            const count = issueCounts.get(source);
            const countStr = count !== undefined
              ? chalk.dim(`  ${String(count)} issues`)
              : '';
            console.log(`    ${chalk.green('✓')} ${chalk.bold(meta.label)}${countStr}`);
          } else if (cfg?.disabledAt) {
            console.log(`    ${chalk.yellow('⏸')} ${chalk.dim(meta.label)} — disabled`);
          } else {
            console.log(`    ${chalk.dim('○')} ${chalk.dim(meta.label)} — not configured`);
          }
        }

        console.log('');

        if (storageAvailable) {
          console.log(`  ${chalk.bold('Storage:')} PostgreSQL`);
        } else if (enabled.length > 0) {
          console.log(`  ${chalk.bold('Storage:')} ${chalk.yellow('not connected')}`);
        }

        console.log('');

        if (enabled.length === 0) {
          console.log(chalk.dim('  Get started: argustack source add jira'));
          console.log('');
        }
      } catch (err: unknown) {
        console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });
}
