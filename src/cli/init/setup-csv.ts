import { input } from '@inquirer/prompts';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import type { InitFlags, CsvSetupResult } from './types.js';
import { resolvePath } from './types.js';

async function promptCsvPath(): Promise<string> {
  const raw = await input({
    message: 'Path to Jira CSV file:',
    validate: (val): string | true => {
      if (!val.trim()) {
        return 'CSV file path is required';
      }
      return true;
    },
  });
  return resolvePath(raw);
}

export async function setupCsvInteractive(): Promise<CsvSetupResult> {
  console.log('');
  console.log(chalk.bold('  Jira CSV Import setup'));
  console.log(chalk.dim('  Import issues from a Jira CSV export file.\n'));

  const cwd = process.cwd();
  const csvFiles = readdirSync(cwd).filter((f) => f.toLowerCase().endsWith('.csv'));

  let csvFilePath: string;

  if (csvFiles.length > 0) {
    const { select } = await import('@inquirer/prompts');
    const MANUAL_ENTRY = '__manual__';
    const selected = await select<string>({
      message: csvFiles.length === 1
        ? `Found CSV file in current directory:`
        : `Found ${csvFiles.length} CSV files in current directory:`,
      choices: [
        ...csvFiles.map((f) => ({ value: join(cwd, f), name: f })),
        { value: MANUAL_ENTRY, name: 'Enter path manually…' },
      ],
    });
    csvFilePath = selected === MANUAL_ENTRY ? await promptCsvPath() : selected;
  } else {
    csvFilePath = await promptCsvPath();
  }

  const resolved = resolve(csvFilePath);
  console.log(chalk.green(`  CSV file: ${resolved}`));

  return { csvFilePath: resolved };
}

export function setupCsvFromFlags(flags: InitFlags): CsvSetupResult | null {
  if (!flags.csvFile) {
    throw new Error('CSV requires: --csv-file');
  }
  return { csvFilePath: flags.csvFile };
}
