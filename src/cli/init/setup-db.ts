import { input, password } from '@inquirer/prompts';
import chalk from 'chalk';
import type { InitFlags, DbSetupResult } from './types.js';
import { validatePort } from './types.js';

export async function setupDbInteractive(): Promise<DbSetupResult | null> {
  console.log('');
  console.log(chalk.bold('  Database setup'));
  console.log(chalk.dim('  Connect to the project database you want to analyze.\n'));
  console.log(chalk.dim('  (This is the TARGET database, not Argustack internal DB)\n'));

  const targetDbHost = await input({ message: 'DB Host:', default: 'localhost' });
  const targetDbPortStr = await input({
    message: 'DB Port:', default: '5432',
    validate: (val): string | true => validatePort(val),
  });
  const targetDbUser = await input({ message: 'DB User:' });
  const targetDbPassword = await password({ message: 'DB Password:' });
  const targetDbName = await input({ message: 'DB Name:' });

  const targetDbPort = parseInt(targetDbPortStr, 10);
  console.log(chalk.green(`  Database configured: ${targetDbUser}@${targetDbHost}:${targetDbPort}/${targetDbName}`));

  return { targetDbHost, targetDbPort, targetDbUser, targetDbPassword, targetDbName };
}

export function setupDbFromFlags(flags: InitFlags): DbSetupResult | null {
  if (!flags.targetDbHost || !flags.targetDbUser || !flags.targetDbName) {
    throw new Error('Database requires: --target-db-host, --target-db-user, --target-db-name');
  }
  return {
    targetDbHost: flags.targetDbHost,
    targetDbPort: parseInt(flags.targetDbPort ?? '5432', 10),
    targetDbUser: flags.targetDbUser,
    targetDbPassword: flags.targetDbPassword ?? '',
    targetDbName: flags.targetDbName,
  };
}
