import { input, confirm, checkbox } from '@inquirer/prompts';
import { password } from '@inquirer/prompts';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { InitFlags, GitSetupResult } from './types.js';
import { resolvePath, getErrorMsg } from './types.js';

function gitCloneWithProgress(url: string, targetPath: string, spinner: Ora): Promise<void> {
  return new Promise<void>((res, rej) => {
    const proc = spawn('git', ['clone', '--progress', url, targetPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.env['HOME'],
    });

    const repoName = url.split('/').pop()?.replace(/\.git$/, '') ?? 'repo';

    proc.stderr.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      const match = /(\w[\w\s]+?):\s+(\d+)%\s+\((\d+)\/(\d+)\)/.exec(line);
      if (match) {
        const [, phase, pct] = match;
        spinner.text = `Cloning ${repoName}: ${phase?.trim()} ${pct}%`;
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        res();
      } else {
        rej(new Error(`git clone exited with code ${String(code)}`));
      }
    });

    proc.on('error', rej);
  });
}

async function collectGitRepoLocal(): Promise<string | null> {
  const rawPath = await input({
    message: 'Path to local repo:',
    validate: (val): string | true => {
      const trimmed = val.trim();
      if (!trimmed) {
        return 'Path is required';
      }
      const resolved = resolvePath(trimmed);
      if (!existsSync(join(resolved, '.git'))) {
        return `Not a git repository: ${resolved} (no .git/ directory)`;
      }
      return true;
    },
  });
  return resolvePath(rawPath);
}

async function collectGitRepoGithub(): Promise<{ paths: string[]; token: string; repos: string[] }> {
  const githubToken = await password({
    message: 'GitHub token (PAT):',
    mask: '*',
    validate: (val): string | true => {
      if (!val.trim()) {
        return 'Token is required';
      }
      return true;
    },
  });

  const spinner = ora('Fetching accessible repositories...').start();
  let repos: { full_name: string; clone_url: string; isPrivate: boolean; description: string | null }[];

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
      clone_url: r.clone_url,
      isPrivate: r.private,
      description: r.description,
    }));
    spinner.succeed(`Found ${repos.length} repositories`);
  } catch (err: unknown) {
    spinner.fail('Failed to fetch repositories');
    console.log(chalk.red(`  Error: ${getErrorMsg(err)}`));
    return { paths: [], token: githubToken.trim(), repos: [] };
  }

  if (repos.length === 0) {
    console.log(chalk.yellow('  No repositories accessible with this token.'));
    return { paths: [], token: githubToken.trim(), repos: [] };
  }

  const selectedRepos = await checkbox<{ cloneUrl: string; fullName: string }>({
    message: 'Select repositories to clone:',
    choices: repos.map((r) => ({
      value: { cloneUrl: r.clone_url, fullName: r.full_name },
      name: `${r.full_name} ${r.isPrivate ? '(private)' : '(public)'}`,
      ...(r.description ? { description: r.description } : {}),
    })),
  });

  if (selectedRepos.length === 0) {
    console.log(chalk.yellow('  No repositories selected.'));
    return { paths: [], token: githubToken.trim(), repos: [] };
  }

  const clonedPaths: string[] = [];
  const clonedRepos: string[] = [];
  for (const { cloneUrl, fullName } of selectedRepos) {
    const repoName = cloneUrl.split('/').pop()?.replace(/\.git$/, '') ?? 'repo';
    const defaultPath = resolve(repoName);
    const cloneDir = await input({
      message: `Clone ${repoName} into directory:`,
      default: defaultPath,
    });

    const targetPath = resolvePath(cloneDir);
    const cloneSpinner = ora(`Cloning ${repoName}...`).start();

    try {
      await gitCloneWithProgress(cloneUrl, targetPath, cloneSpinner);
      cloneSpinner.succeed(`Cloned to ${targetPath}`);
      clonedPaths.push(targetPath);
      clonedRepos.push(fullName);
    } catch (err: unknown) {
      cloneSpinner.fail(`Failed to clone ${repoName}`);
      console.log(chalk.red(`  Error: ${getErrorMsg(err)}`));
    }
  }

  return { paths: clonedPaths, token: githubToken.trim(), repos: clonedRepos };
}

async function collectGitRepoUrl(): Promise<string | null> {
  const repoUrl = await input({
    message: 'Repository URL (HTTPS):',
    validate: (val): string | true => {
      const trimmed = val.trim();
      if (!trimmed) {
        return 'URL is required';
      }
      if (!trimmed.startsWith('https://') && !trimmed.startsWith('git@')) {
        return 'Must start with https:// or git@';
      }
      return true;
    },
  });

  const defaultDir = repoUrl.trim().split('/').pop()?.replace(/\.git$/, '') ?? 'repo';
  const defaultPath = resolve(defaultDir);
  const cloneDir = await input({
    message: 'Clone into directory:',
    default: defaultPath,
  });

  const targetPath = resolvePath(cloneDir);
  const spinner = ora(`Cloning ${repoUrl.trim()}...`).start();

  try {
    await gitCloneWithProgress(repoUrl.trim(), targetPath, spinner);
    spinner.succeed(`Cloned to ${targetPath}`);
    return targetPath;
  } catch (err: unknown) {
    spinner.fail('Clone failed');
    console.log(chalk.red(`  Error: ${getErrorMsg(err)}`));
    console.log(chalk.dim('  Check URL and network. Make sure git is installed.'));
    return null;
  }
}

export async function setupGitInteractive(): Promise<GitSetupResult | null> {
  console.log('');
  console.log(chalk.bold('  Git setup'));
  console.log(chalk.dim('  Connect to Git repositories.\n'));

  const { select } = await import('@inquirer/prompts');
  const gitRepoPaths: string[] = [];
  let savedGithubToken: string | undefined;
  const savedGithubRepos: string[] = [];

  let addMore = true;
  while (addMore) {
    const mode = await select<'local' | 'github' | 'clone'>({
      message: gitRepoPaths.length === 0
        ? 'Where is your Git repository?'
        : 'Add another Git repository:',
      choices: [
        {
          value: 'local' as const,
          name: 'Local path',
          description:
            'The repo is already downloaded to your computer. ' +
            'You just point to the folder where it lives (e.g. ~/projects/my-app). ' +
            'Nothing is downloaded — Argustack reads commit history directly from disk',
        },
        {
          value: 'github' as const,
          name: 'Clone from GitHub',
          description:
            'You have a GitHub account with access to the repo. ' +
            'Enter your GitHub token — Argustack will show all repos you have access to, ' +
            'you pick the ones you need, and they download automatically',
        },
        {
          value: 'clone' as const,
          name: 'Clone from URL',
          description:
            'You have a direct link to the repo (from GitHub, GitLab, Bitbucket, or any git server). ' +
            'Paste the URL and Argustack will download the repo for you. ' +
            'Use this if your repo is not on GitHub or you prefer to paste the link manually',
        },
      ],
    });

    if (mode === 'local') {
      const path = await collectGitRepoLocal();
      if (path) {
        gitRepoPaths.push(path);
      }
    } else if (mode === 'github') {
      const result = await collectGitRepoGithub();
      gitRepoPaths.push(...result.paths);
      savedGithubToken = result.token;
      savedGithubRepos.push(...result.repos);
    } else {
      const path = await collectGitRepoUrl();
      if (path) {
        gitRepoPaths.push(path);
      }
    }

    if (gitRepoPaths.length === 0) {
      const skip = await confirm({ message: 'Skip Git for now?', default: true });
      if (skip) {
        return null;
      }
      continue;
    }

    addMore = await confirm({ message: 'Add another Git repository?', default: false });
  }

  if (gitRepoPaths.length === 0) {
    return null;
  }

  for (const p of gitRepoPaths) {
    console.log(chalk.green(`  Git source configured: ${p}`));
  }

  return {
    gitRepoPaths,
    ...(savedGithubToken ? { githubToken: savedGithubToken } : {}),
    ...(savedGithubRepos.length > 0 ? { githubRepos: savedGithubRepos } : {}),
  };
}

export function setupGitFromFlags(flags: InitFlags): GitSetupResult | null {
  if (!flags.gitRepo) {
    throw new Error('Git requires: --git-repo');
  }
  const paths = flags.gitRepo.split(',').map((p) => p.trim()).filter(Boolean);
  return { gitRepoPaths: paths };
}
