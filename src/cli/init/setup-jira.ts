import { confirm, password, checkbox, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import type { InitFlags, JiraSetupResult, ProxySetupResult } from './types.js';
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

export interface JiraSetupOutput {
  jira: JiraSetupResult | null;
  proxy: ProxySetupResult | null;
}

export async function setupJiraInteractive(): Promise<JiraSetupOutput> {
  console.log('');
  console.log(chalk.bold('  Jira setup'));

  const connectionType = await select({
    message: 'How do you connect to Jira?',
    choices: [
      { value: 'direct' as const, name: 'Direct API', description: 'Connect directly with URL + email + API token' },
      { value: 'proxy' as const, name: 'Through proxy', description: 'Connect through a company proxy/gateway' },
    ],
  });

  if (connectionType === 'proxy') {
    const proxyResult = await setupJiraProxyInteractive();
    return { jira: null, proxy: proxyResult };
  }

  const jiraResult = await setupJiraDirectInteractive();
  return { jira: jiraResult, proxy: null };
}

async function setupJiraDirectInteractive(): Promise<JiraSetupResult | null> {
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
      return setupJiraDirectInteractive();
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

  const issueTypes = await selectIssueTypes(async () => {
    const { Version3Client } = await import('jira.js');
    const client = new Version3Client({
      host: jiraUrl,
      authentication: { basic: { email: jiraEmail, apiToken: jiraToken } },
    });
    const types = await client.issueTypes.getIssueAllTypes();
    return types.map((t) => t.name).filter((n): n is string => n !== undefined);
  });

  return { jiraUrl, jiraEmail, jiraToken, jiraProjects, ...(issueTypes ? { issueTypes } : {}) };
}

async function setupJiraProxyInteractive(): Promise<ProxySetupResult | null> {
  console.log(chalk.dim('  Connect through your company Jira proxy.'));
  console.log(chalk.dim('  Example: https://proxy.company.com/service/jira\n'));

  let proxyUrl: string;
  let proxyToken: string;
  let availableProjects: string[];

  for (;;) {
    const proxyUrlRaw = await password({
      message: 'Proxy URL:',
      mask: '*',
      validate: (val): string | true => {
        if (!val.trim()) {
          return 'Proxy URL is required';
        }
        if (!val.startsWith('https://')) {
          return 'Must start with https://';
        }
        return true;
      },
    });

    proxyUrl = proxyUrlRaw.trim().replace(/\/+$/, '');

    proxyToken = await password({
      message: 'Service token:',
      mask: '*',
      validate: (val): string | true => {
        if (!val.trim()) {
          return 'Token is required';
        }
        return true;
      },
    });

    const spinner = ora('Testing proxy connection...').start();

    try {
      availableProjects = await testProxyConnection(proxyUrl, proxyToken);
    } catch (err: unknown) {
      spinner.fail('Connection failed');
      console.log(chalk.red(`  Error: ${getErrorMsg(err)}`));
      console.log(chalk.dim('  Check proxy URL and service token.'));

      const retry = await confirm({ message: 'Try again?', default: true });
      if (retry) {
        continue;
      }
      const skip = await confirm({ message: 'Skip Jira for now?', default: false });
      if (skip) {
        return null;
      }
      return setupJiraProxyInteractive();
    }

    if (availableProjects.length === 0) {
      spinner.warn('Connected, but found 0 projects. Token may have limited permissions.');

      const retry = await confirm({ message: 'Re-enter token?', default: true });
      if (retry) {
        continue;
      }
    } else {
      spinner.succeed(
        `Connected! Found ${String(availableProjects.length)} projects: ${availableProjects.join(', ')}`
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

  const issueTypes = await selectIssueTypes(async () => {
    const { ProxyClient, buildDefaultProxyConfig } = await import('../../adapters/jira-proxy/index.js');
    const config = buildDefaultProxyConfig(proxyUrl);
    process.env[config.auth.service_token_env] = proxyToken;
    const client = new ProxyClient(config);

    const data = await client.fetch('/issuetype') as unknown[];
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((t) => (t as Record<string, unknown>)['name'])
      .filter((n): n is string => typeof n === 'string');
  });

  return { proxyUrl, proxyToken, jiraProjects, ...(issueTypes ? { issueTypes } : {}) };
}

async function selectIssueTypes(fetchTypes: () => Promise<string[]>): Promise<string[] | undefined> {
  const spinner = ora('Fetching issue types...').start();

  let types: string[];
  try {
    types = await fetchTypes();
    const unique = [...new Set(types)].sort();
    types = unique;
  } catch {
    spinner.warn('Could not fetch issue types — all types will be synced');
    return undefined;
  }

  if (types.length === 0) {
    spinner.warn('No issue types found — all types will be synced');
    return undefined;
  }

  spinner.succeed(`Found ${String(types.length)} issue types`);

  const selected = await checkbox<string>({
    message: 'Which issue types to sync?',
    choices: types.map((t) => ({
      value: t,
      name: t,
      checked: true,
    })),
  });

  if (selected.length === 0) {
    console.log(chalk.yellow('  No types selected — all types will be synced'));
    return undefined;
  }

  if (selected.length === types.length) {
    return undefined;
  }

  return selected;
}

async function testProxyConnection(proxyUrl: string, token: string): Promise<string[]> {
  const { ProxyClient, buildDefaultProxyConfig } = await import('../../adapters/jira-proxy/index.js');
  const config = buildDefaultProxyConfig(proxyUrl);

  process.env[config.auth.service_token_env] = token;
  const client = new ProxyClient(config);

  await client.authenticate();

  const data = await client.fetch(config.endpoints.projects.path, { maxResults: '200' }) as Record<string, unknown>;
  const values = (data['values'] ?? data['projects'] ?? data) as unknown[];
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((p) => {
      const proj = p as Record<string, unknown>;
      return typeof proj['key'] === 'string' ? proj['key'] : '';
    })
    .filter(Boolean);
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
