import { confirm, password } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import type { InitFlags, GitHubSetupResult } from './types.js';
import { getErrorMsg } from './types.js';

export async function setupGithubInteractive(
  existingToken?: string,
  existingRepos?: string[],
): Promise<GitHubSetupResult | null> {
  console.log('');
  console.log(chalk.bold('  GitHub setup'));
  console.log(chalk.dim('  Connect to GitHub API for PRs, reviews, and releases.\n'));

  if (existingToken && existingRepos && existingRepos.length > 0) {
    const repoToUse = existingRepos[0] ?? '';
    const [owner = '', repo = ''] = repoToUse.split('/');

    if (existingRepos.length === 1) {
      console.log(chalk.green(`  Auto-configured from Git step: ${repoToUse}`));
    } else {
      console.log(chalk.dim(`  Repos from Git step: ${existingRepos.join(', ')}`));
      console.log(chalk.green(`  Using first repo for GitHub PRs: ${repoToUse}`));
    }

    return {
      githubToken: existingToken.trim(),
      githubOwner: owner,
      githubRepo: repo,
    };
  }

  let githubToken: string;

  if (existingToken) {
    console.log(chalk.green('  Using GitHub token from Git clone step.'));
    githubToken = existingToken;
  } else {
    console.log(chalk.dim('  Generate token: Settings → Developer settings → Personal access tokens'));
    githubToken = await password({
      message: 'GitHub token (PAT):',
      mask: '*',
      validate: (val): string | true => {
        if (!val.trim()) {
          return 'Token is required';
        }
        return true;
      },
    });
  }

  const spinner = ora('Fetching accessible repositories...').start();
  let repos: { full_name: string; isPrivate: boolean; description: string | null }[];

  try {
    const { Octokit } = await import('octokit');
    const octokit = new Octokit({ auth: githubToken.trim() });
    const result = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    });
    repos = result.data.map((r) => ({
      full_name: r.full_name,
      isPrivate: r.private,
      description: r.description,
    }));
    spinner.succeed(`Found ${repos.length} accessible repositories`);
  } catch (err: unknown) {
    spinner.fail('Failed to fetch repositories');
    console.log(chalk.red(`  Error: ${getErrorMsg(err)}`));
    console.log(chalk.dim('  You can add GitHub token to .env later.'));

    const skip = await confirm({ message: 'Skip GitHub for now?', default: true });
    if (skip) {
      return null;
    }
    return setupGithubInteractive(existingToken);
  }

  if (repos.length === 0) {
    console.log(chalk.yellow('  No repositories accessible with this token.'));
    console.log(chalk.dim('  Make sure the token has access to at least one repository.'));
    return null;
  }

  const { select } = await import('@inquirer/prompts');
  const selectedRepo = await select<string>({
    message: 'Select repository:',
    choices: repos.map((r) => ({
      value: r.full_name,
      name: `${r.full_name} ${r.isPrivate ? '(private)' : '(public)'}`,
      ...(r.description ? { description: r.description } : {}),
    })),
  });

  const [owner = '', repo = ''] = selectedRepo.split('/');
  console.log(chalk.green(`  GitHub configured: ${selectedRepo}`));

  return {
    githubToken: githubToken.trim(),
    githubOwner: owner,
    githubRepo: repo,
  };
}

export function setupGithubFromFlags(flags: InitFlags): GitHubSetupResult | null {
  if (!flags.githubToken || !flags.githubOwner || !flags.githubRepo) {
    throw new Error('GitHub requires: --github-token, --github-owner, --github-repo');
  }
  return {
    githubToken: flags.githubToken,
    githubOwner: flags.githubOwner,
    githubRepo: flags.githubRepo,
  };
}
