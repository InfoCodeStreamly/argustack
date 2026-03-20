import { Octokit } from 'octokit';

export interface GitHubCredentials {
  token: string;
  owner: string;
  repo: string;
}

export function createGitHubClient(token: string): Octokit {
  return new Octokit({ auth: token });
}
