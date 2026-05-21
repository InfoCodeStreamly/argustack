import type { Command } from 'commander';
import chalk from 'chalk';
import type { DbEngine, DbSourceConfig } from '../../core/types/index.js';
import { appendToListSetting, openHubStore, resolveWorkspaceFlag } from './shared.js';

interface Options {
  workspace?: string;
  name?: string;
  engine?: string;
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  database?: string;
  schema?: string;
}

const ENGINES: readonly DbEngine[] = ['postgresql', 'mysql', 'mssql', 'sqlite', 'oracledb'];

function assertEngine(value: string): asserts value is DbEngine {
  if (!ENGINES.includes(value as DbEngine)) {
    throw new Error(`Unknown engine "${value}". Available: ${ENGINES.join(', ')}.`);
  }
}

export function registerDbCommand(group: Command): void {
  group
    .command('db')
    .description('Bind a read-only project database to a workspace')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .requiredOption('--name <name>', 'Source label (e.g. "prod-replica")')
    .requiredOption('--engine <engine>', `Engine: ${ENGINES.join('|')}`)
    .requiredOption('--host <host>', 'DB host')
    .requiredOption('--port <port>', 'DB port')
    .requiredOption('--user <user>', 'DB user')
    .requiredOption('--password <password>', 'DB password')
    .requiredOption('--database <database>', 'DB name')
    .option('--schema <schema>', 'Schema (Postgres only)')
    .action(async (opts: Options) => {
      const engine = opts.engine ?? '';
      assertEngine(engine);

      const config: DbSourceConfig = {
        name: opts.name ?? '',
        engine,
        host: opts.host ?? '',
        port: Number(opts.port ?? '5432'),
        user: opts.user ?? '',
        password: opts.password ?? '',
        database: opts.database ?? '',
        ...(opts.schema ? { schema: opts.schema } : {}),
      };

      const { store, close } = await openHubStore();
      try {
        const workspaceId = await resolveWorkspaceFlag(store, opts.workspace);
        await appendToListSetting(store, workspaceId, 'dbConfigs', [config]);
        console.log(chalk.green(`  ● added db source "${config.name}" (${config.engine}) to workspace "${workspaceId}"`));
      } finally {
        await close();
      }
    });
}
