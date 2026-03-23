import { confirm, password, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import type { InitFlags, JiraSetupResult } from './types.js';
import { extractJiraBaseUrl, getErrorMsg } from './types.js';

async function testJiraConnection(
  url: string, email: string, token: string,
): Promise<string[]> {
  const { Version3Client } = await import('jira.js');
  const client = new Version3Client({
    host: url,
    authentication: { basic: { email, apiToken: token } },
  });
  const result = await client.projects.searchProjects({ maxResults: 200 });
  return result.values.map((p) => p.key);
}

export async function setupJiraInteractive(): Promise<JiraSetupResult | null> {
  console.log('');
  console.log(chalk.bold('  Jira setup'));
  console.log(chalk.dim('  Connect to your Jira instance.'));
  console.log(chalk.dim('  Example: https://your-team.atlassian.net\n'));

  const jiraUrlRaw = await password({
    message: 'Jira URL:',
    mask: '*',
    validate: (val): string | true => {
      if (!val.trim()) {
        return 'Jira URL is required';
      }
      if (!val.startsWith('https://')) {
        return 'Must start with https://';
      }
      return true;
    },
  });

  const jiraUrl = extractJiraBaseUrl(jiraUrlRaw);

  const jiraEmail = await password({
    message: 'Email:',
    mask: '*',
    validate: (val): string | true => {
      if (!val.includes('@')) {
        return 'Must be a valid email';
      }
      return true;
    },
  });

  let jiraToken: string;
  let availableProjects: string[];

  for (;;) {
    jiraToken = await password({
      message: 'API Token:',
      mask: '*',
      validate: (val): string | true => {
        if (!val.trim()) {
          return 'Token is required';
        }
        return true;
      },
    });

    const spinner = ora('Testing Jira connection...').start();

    try {
      availableProjects = await testJiraConnection(jiraUrl, jiraEmail, jiraToken);
    } catch (err: unknown) {
      spinner.fail('Connection failed');
      console.log(chalk.red(`  Error: ${getErrorMsg(err)}`));
      console.log(chalk.dim('  Check URL, email, token. Generate token:'));
      console.log(chalk.dim('  https://id.atlassian.com/manage-profile/security/api-tokens'));

      const retry = await confirm({ message: 'Try again?', default: true });
      if (retry) {
        continue;
      }
      const skip = await confirm({ message: 'Skip Jira for now?', default: false });
      if (skip) {
        return null;
      }
      return setupJiraInteractive();
    }

    if (availableProjects.length === 0) {
      spinner.warn('Connected, but found 0 projects. Token may have limited permissions.');
      console.log(chalk.yellow('  Your token works but has no project access.'));
      console.log(chalk.dim('  This usually means the token was pasted incorrectly or has restricted scopes.'));

      const retry = await confirm({ message: 'Re-enter token?', default: true });
      if (retry) {
        continue;
      }
    } else {
      spinner.succeed(
        `Connected! Found ${availableProjects.length} projects: ${availableProjects.join(', ')}`
      );
    }

    break;
  }

  const jiraProjects = await checkbox<string>({
    message: 'Select projects to pull:',
    choices: availableProjects.map((key) => ({
      value: key,
      name: key,
    })),
  });

  if (jiraProjects.length === 0) {
    console.log(chalk.yellow('  No projects selected.'));
    return null;
  }

  return { jiraUrl, jiraEmail, jiraToken, jiraProjects };
}

export async function setupJiraFromFlags(flags: InitFlags): Promise<JiraSetupResult | null> {
  if (!flags.jiraUrl || !flags.jiraEmail || !flags.jiraToken) {
    throw new Error('Jira requires: --jira-url, --jira-email, --jira-token');
  }

  const spinner = ora('Testing Jira connection...').start();

  try {
    const availableProjects = await testJiraConnection(
      extractJiraBaseUrl(flags.jiraUrl), flags.jiraEmail, flags.jiraToken,
    );
    spinner.succeed(
      `Connected! Found ${availableProjects.length} projects: ${availableProjects.join(', ')}`
    );

    let jiraProjects: string[];
    if (!flags.jiraProjects || flags.jiraProjects.toLowerCase() === 'all') {
      jiraProjects = availableProjects;
    } else {
      jiraProjects = flags.jiraProjects.split(',').map((p) => p.trim().toUpperCase());
    }

    return {
      jiraUrl: flags.jiraUrl,
      jiraEmail: flags.jiraEmail,
      jiraToken: flags.jiraToken,
      jiraProjects,
    };
  } catch (err: unknown) {
    spinner.fail('Connection failed');
    throw new Error(`Jira connection failed: ${getErrorMsg(err)}`, { cause: err });
  }
}
