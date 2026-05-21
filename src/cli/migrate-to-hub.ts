import type { Command } from 'commander';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { loadHubConfig, hubDir } from '../workspace/hub-config.js';
import { listLegacyWorkspaces } from '../workspace/registry.js';
import { MigrateToHubUseCase, type LegacyWorkspaceInfo } from '../use-cases/migrate-to-hub.js';

interface Options {
  dryRun?: boolean;
  keepLegacy?: boolean;
  allowConflicts?: boolean;
  rename?: string[];
}

function parseRenameFlags(values: string[] | undefined): Record<string, string> {
  if (!values) { return {}; }
  const map: Record<string, string> = {};
  for (const v of values) {
    const eq = v.indexOf('=');
    if (eq > 0) {
      map[v.slice(0, eq)] = v.slice(eq + 1);
    }
  }
  return map;
}

function workspaceSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function registerMigrateCommand(program: Command): void {
  program
    .command('migrate-to-hub')
    .description('Migrate legacy per-workspace Postgres stacks into the hub (idempotent)')
    .option('--dry-run', 'Report what would happen, do not write')
    .option('--keep-legacy', 'Do not write .hub-migrated marker')
    .option('--allow-conflicts', 'Continue migration even when issue_key/commit hash collisions are detected')
    .option('--rename <pairs...>', 'Rename legacy workspace ids: --rename old=new old2=new2')
    .action(async (options: Options) => {
      const hub = loadHubConfig();
      const legacyEntries = listLegacyWorkspaces();
      if (legacyEntries.length === 0) {
        console.log(chalk.yellow('  No legacy workspaces found in ~/.argustack/workspaces.json'));
        return;
      }

      const rename = parseRenameFlags(options.rename);
      const targets: LegacyWorkspaceInfo[] = legacyEntries.map((entry) => ({
        id: workspaceSlug(entry.name),
        name: entry.name,
        path: entry.path,
      }));

      console.log(chalk.bold('\n  Argustack migrate-to-hub'));
      console.log(chalk.dim(`  hub: ${hub.db.host}:${String(hub.db.port)}/${hub.db.database}`));
      console.log(chalk.dim(`  legacy workspaces: ${String(legacyEntries.length)}\n`));

      const { PostgresWorkspaceStore, createPool } = await import('../adapters/postgres/index.js');
      const hubPool = createPool(hub.db);
      const hubStore = new PostgresWorkspaceStore(hubPool);
      try {
        await hubStore.initialize();
        const useCase = new MigrateToHubUseCase(hubPool, hubStore);

        const logDir = join(hubDir(), 'migrations');
        if (!existsSync(logDir)) { mkdirSync(logDir, { recursive: true }); }
        const logFile = join(logDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
        const logLines: string[] = [];

        const result = await useCase.execute(targets, {
          ...(options.dryRun ? { dryRun: true } : {}),
          ...(options.keepLegacy ? { keepLegacy: true } : {}),
          ...(options.allowConflicts ? { allowConflicts: true } : {}),
          rename,
          onProgress: (msg) => {
            console.log(msg);
            logLines.push(msg);
          },
        });

        if (logLines.length > 0) {
          writeFileSync(logFile, logLines.join('\n') + '\n');
          console.log(chalk.dim(`\n  Log: ${logFile}`));
        }

        console.log('');
        console.log(chalk.bold('  Summary:'));
        console.log(`    migrated: ${result.migrated.join(', ') || '(none)'}`);
        if (result.skipped.length > 0) {
          console.log(chalk.yellow(`    skipped:  ${result.skipped.join(', ')}`));
        }
        if (result.mismatches.length > 0) {
          console.log(chalk.yellow(`    count mismatches in ${String(result.mismatches.length)} workspace(s)`));
        }
        console.log('');
      } finally {
        await hubPool.end();
      }
    });
}
