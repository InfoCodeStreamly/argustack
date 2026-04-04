import { input, password } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import type { InitFlags, DbSetupResult } from './types.js';
import { maskHost } from './types.js';

const ENGINE_BY_PROTOCOL: Record<string, string> = {
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mysql: 'mysql',
  mariadb: 'mysql',
  mssql: 'mssql',
  sqlserver: 'mssql',
  sqlite: 'sqlite',
  oracle: 'oracledb',
};

const ENGINE_BY_PORT: Record<number, string> = {
  5432: 'postgresql',
  3306: 'mysql',
  1433: 'mssql',
  1521: 'oracledb',
};

function parseConnectionString(raw: string): DbSetupResult | null {
  try {
    const url = new URL(raw);
    const protocol = url.protocol.replace(/:$/, '').toLowerCase();
    const engine = ENGINE_BY_PROTOCOL[protocol];
    if (!engine) {
      return null;
    }

    return {
      targetDbEngine: engine,
      targetDbHost: url.hostname || 'localhost',
      targetDbPort: url.port ? parseInt(url.port, 10) : 5432,
      targetDbUser: decodeURIComponent(url.username || ''),
      targetDbPassword: decodeURIComponent(url.password || ''),
      targetDbName: url.pathname.replace(/^\//, '') || '',
    };
  } catch {
    return null;
  }
}

async function tryConnect(result: DbSetupResult): Promise<boolean> {
  const origWarn = console.warn;
  const origError = console.error;
  try {
    console.warn = () => { /* suppress knex driver noise */ };
    console.error = () => { /* suppress knex driver noise */ };
    const knex = (await import('knex')).default;
    const db = knex({
      client: result.targetDbEngine === 'postgresql' ? 'pg' : result.targetDbEngine,
      connection: {
        host: result.targetDbHost,
        port: result.targetDbPort,
        user: result.targetDbUser,
        password: result.targetDbPassword,
        database: result.targetDbName,
        ssl: result.targetDbHost !== 'localhost' && result.targetDbHost !== '127.0.0.1'
          ? { rejectUnauthorized: false }
          : false,
      },
    });
    await db.raw('SELECT 1');
    await db.destroy();
    return true;
  } catch {
    return false;
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
}

async function autoDetectEngine(host: string, port: number, user: string, pass: string, dbName: string): Promise<DbSetupResult | null> {
  const engines = ENGINE_BY_PORT[port]
    ? [ENGINE_BY_PORT[port], ...Object.values(ENGINE_BY_PORT).filter((e) => e !== ENGINE_BY_PORT[port])]
    : Object.values(ENGINE_BY_PORT);

  for (const engine of engines) {
    const result: DbSetupResult = {
      targetDbEngine: engine,
      targetDbHost: host,
      targetDbPort: port,
      targetDbUser: user,
      targetDbPassword: pass,
      targetDbName: dbName,
    };
    if (await tryConnect(result)) {
      return result;
    }
  }
  return null;
}

export async function setupDbInteractive(): Promise<DbSetupResult | null> {
  console.log('');
  console.log(chalk.bold('  Database setup'));
  console.log(chalk.dim('  Connect your project\'s database so Claude can explore its structure'));
  console.log(chalk.dim('  and run read-only queries. Argustack detects the database type automatically.\n'));
  console.log(chalk.dim('  Paste a connection string or enter credentials manually.'));
  console.log(chalk.dim('  Example: postgresql://user:pass@host:5432/mydb\n'));

  const connStr = await password({
    message: 'Connection string (or press Enter to type manually):',
    mask: '*',
  });

  if (connStr.trim()) {
    const parsed = parseConnectionString(connStr.trim());
    if (!parsed) {
      console.log(chalk.red('  Could not parse connection string.'));
      console.log(chalk.dim('  Expected format: engine://user:password@host:port/database'));
      return setupDbManual();
    }

    const spinner = ora(`Connecting to ${parsed.targetDbEngine}...`).start();
    if (await tryConnect(parsed)) {
      spinner.succeed(`Connected! ${parsed.targetDbEngine} at ${maskHost(parsed.targetDbHost)}:${String(parsed.targetDbPort)}`);
      return parsed;
    }
    spinner.fail('Connection failed');
    console.log(chalk.dim('  Check your connection string and try again.'));
    return setupDbManual();
  }

  return setupDbManual();
}

async function setupDbManual(): Promise<DbSetupResult | null> {
  console.log(chalk.dim('\n  Enter connection details (check your hosting dashboard or ask your developer):'));

  const targetDbHost = await input({ message: 'Host:', default: 'localhost' });
  const targetDbPortStr = await input({ message: 'Port:', default: '5432' });
  const targetDbPort = parseInt(targetDbPortStr, 10);
  const targetDbUser = await input({
    message: 'Username:',
    validate: (val): string | true => val.trim() ? true : 'Username is required',
  });
  const targetDbPassword = await password({ message: 'Password:' });
  const targetDbName = await input({
    message: 'Database name:',
    validate: (val): string | true => val.trim() ? true : 'Database name is required',
  });

  const spinner = ora('Detecting database type and connecting...').start();
  const detected = await autoDetectEngine(targetDbHost, targetDbPort, targetDbUser, targetDbPassword, targetDbName);

  if (detected) {
    spinner.succeed(`Connected! Detected ${detected.targetDbEngine} at ${maskHost(targetDbHost)}:${String(targetDbPort)}`);
    return detected;
  }

  spinner.fail('Could not connect to any supported database');
  console.log(chalk.dim('  Check credentials and make sure the database is accessible from this machine.'));
  return null;
}

export function setupDbFromFlags(flags: InitFlags): DbSetupResult | null {
  if (!flags.targetDbHost || !flags.targetDbUser || !flags.targetDbName) {
    throw new Error('Database requires: --target-db-host, --target-db-user, --target-db-name');
  }
  return {
    targetDbEngine: flags.targetDbEngine ?? 'postgresql',
    targetDbHost: flags.targetDbHost,
    targetDbPort: parseInt(flags.targetDbPort ?? '5432', 10),
    targetDbUser: flags.targetDbUser,
    targetDbPassword: flags.targetDbPassword ?? '',
    targetDbName: flags.targetDbName,
  };
}
