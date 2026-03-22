import type { Command } from 'commander';
import chalk from 'chalk';
import { requireWorkspace } from '../workspace/resolver.js';
import {
  readConfig,
  writeConfig,
  addSource,
  enableSource,
  disableSource,
  getEnabledSources,
  createEmptyConfig,
} from '../workspace/config.js';
import type { SourceType } from '../core/types/index.js';
import { SOURCE_META, ALL_SOURCES } from '../core/types/index.js';

function loadConfig(workspaceRoot: string) {
  return readConfig(workspaceRoot) ?? createEmptyConfig();
}

function validateSourceArg(sourceName: string): SourceType {
  const source = sourceName.toLowerCase() as SourceType;
  if (!ALL_SOURCES.includes(source)) {
    console.log(chalk.red(`\n  Unknown source: ${sourceName}`));
    console.log(chalk.dim(`  Available: ${ALL_SOURCES.join(', ')}`));
    process.exit(1);
  }
  return source;
}

/**
 * Register `argustack source` parent command with subcommands:
 *   source list     — show all sources + status
 *   source add      — first-time setup + enable
 *   source enable   — re-enable a disabled source
 *   source disable  — soft-disable (keeps credentials)
 */
export function registerSourceCommands(program: Command): void {
  const sourceCmd = program
    .command('source')
    .description('Manage data sources');

  sourceCmd
    .command('list')
    .description('Show configured data sources')
    .action(() => {
      const root = requireWorkspace();
      const config = loadConfig(root);
      const enabled = getEnabledSources(config);

      console.log('');
      console.log(chalk.bold('  Data sources:'));
      console.log('');

      for (const source of ALL_SOURCES) {
        const meta = SOURCE_META[source];
        const cfg = config.sources[source];
        const isEnabled = cfg?.enabled === true;

        if (isEnabled) {
          console.log(`  ${chalk.green('✓')} ${chalk.bold(meta.label)} — ${meta.description}`);
          console.log(chalk.dim(`    Added: ${cfg.addedAt}`));
        } else if (cfg?.disabledAt) {
          console.log(`  ${chalk.yellow('⏸')} ${chalk.dim(meta.label)} — ${chalk.dim('disabled')}`);
          console.log(chalk.dim(`    Re-enable: ${chalk.cyan(`argustack source enable ${source}`)}`));
        } else {
          console.log(`  ${chalk.dim('○')} ${chalk.dim(meta.label)} — ${chalk.dim(meta.description)}`);
        }
      }

      console.log('');

      if (enabled.length > 1) {
        console.log(chalk.dim(`  Sync order: ${enabled.map((s) => SOURCE_META[s].label).join(' → ')}`));
        console.log('');
      }

      const unconfigured = ALL_SOURCES.filter((s) => !config.sources[s]);
      if (unconfigured.length > 0) {
        console.log(chalk.dim('  Add sources:'));
        for (const s of unconfigured) {
          console.log(`  ${chalk.cyan(`argustack source add ${s}`)}`);
        }
        console.log('');
      }
    });

  sourceCmd
    .command('add <type>')
    .description('Add a data source (jira, git, db)')
    .action((sourceName: string) => {
      const source = validateSourceArg(sourceName);
      const root = requireWorkspace();
      let config = loadConfig(root);

      if (config.sources[source]?.enabled) {
        console.log(chalk.yellow(`\n  ${SOURCE_META[source].label} is already enabled.`));
        return;
      }

      console.log('');
      console.log(chalk.bold(`  Adding ${SOURCE_META[source].label}...`));

      console.log(chalk.dim(`  (Interactive setup — coming soon)`));
      console.log(chalk.dim(`  For now, edit .env manually.`));

      config = addSource(config, source);
      writeConfig(root, config);

      console.log(chalk.green(`\n  ✓ ${SOURCE_META[source].label} added.`));
      console.log(chalk.dim(`  Sync data: ${chalk.cyan(`argustack sync ${source}`)}`));
    });

  sourceCmd
    .command('enable <type>')
    .description('Re-enable a disabled source')
    .action((sourceName: string) => {
      const source = validateSourceArg(sourceName);
      const root = requireWorkspace();
      let config = loadConfig(root);

      if (config.sources[source]?.enabled) {
        console.log(chalk.yellow(`\n  ${SOURCE_META[source].label} is already enabled.`));
        return;
      }

      if (!config.sources[source]) {
        console.log(chalk.red(`\n  ${SOURCE_META[source].label} was never added.`));
        console.log(chalk.dim(`  Use: ${chalk.cyan(`argustack source add ${source}`)}`));
        return;
      }

      config = enableSource(config, source);
      writeConfig(root, config);

      console.log(chalk.green(`\n  ✓ ${SOURCE_META[source].label} re-enabled.`));
      console.log(chalk.dim(`  Sync data: ${chalk.cyan(`argustack sync ${source}`)}`));
    });

  sourceCmd
    .command('disable <type>')
    .description('Disable a source (keeps credentials)')
    .action((sourceName: string) => {
      const source = validateSourceArg(sourceName);
      const root = requireWorkspace();
      let config = loadConfig(root);

      if (!config.sources[source]?.enabled) {
        console.log(chalk.yellow(`\n  ${SOURCE_META[source].label} is not currently enabled.`));
        return;
      }

      config = disableSource(config, source);
      writeConfig(root, config);

      console.log(chalk.green(`\n  ⏸ ${SOURCE_META[source].label} disabled.`));
      console.log(chalk.dim('  Credentials remain in .env — delete manually if needed.'));
      console.log(chalk.dim(`  Re-enable: ${chalk.cyan(`argustack source enable ${source}`)}`));
    });
}
