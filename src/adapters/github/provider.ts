import type { Octokit } from 'octokit';
import type { IGitHubProvider } from '../../core/ports/github-provider.js';
import type { GitHubBatch, Release } from '../../core/types/github.js';
import { createGitHubClient, type GitHubCredentials } from './client.js';
import {
  mapPullRequest,
  mapReview,
  mapReviewComment,
  mapPrFile,
  mapRelease,
  extractPrIssueRefs,
} from './mapper.js';

const BATCH_SIZE = 50;

export class GitHubProvider implements IGitHubProvider {
  readonly name = 'GitHub API';
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly repoFullName: string;

  constructor(creds: GitHubCredentials) {
    this.octokit = createGitHubClient(creds.token);
    this.owner = creds.owner;
    this.repo = creds.repo;
    this.repoFullName = `${creds.owner}/${creds.repo}`;
  }

  async *pullPullRequests(since?: Date): AsyncGenerator<GitHubBatch> {
    const batch: GitHubBatch = {
      pullRequests: [],
      reviews: [],
      comments: [],
      files: [],
      issueRefs: [],
    };

    const iterator = this.octokit.paginate.iterator(
      this.octokit.rest.pulls.list,
      {
        owner: this.owner,
        repo: this.repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
      },
    );

    for await (const response of iterator) {
      for (const rawPr of response.data) {
        const updatedAt = new Date(rawPr.updated_at);
        if (since && updatedAt < since) {
          if (batch.pullRequests.length > 0) {
            yield batch;
          }
          return;
        }

        const pr = mapPullRequest(
          rawPr as unknown as Record<string, unknown>,
          this.repoFullName,
        );
        batch.pullRequests.push(pr);

        const [reviews, reviewComments, files] = await Promise.all([
          this.fetchReviews(pr.number),
          this.fetchReviewComments(pr.number),
          this.fetchFiles(pr.number),
        ]);

        batch.reviews.push(...reviews);
        batch.comments.push(...reviewComments);
        batch.files.push(...files);

        const refs = extractPrIssueRefs(
          pr.number,
          this.repoFullName,
          pr.title,
          pr.body,
        );
        batch.issueRefs.push(...refs);

        if (batch.pullRequests.length >= BATCH_SIZE) {
          yield batch;
          batch.pullRequests = [];
          batch.reviews = [];
          batch.comments = [];
          batch.files = [];
          batch.issueRefs = [];
        }
      }
    }

    if (batch.pullRequests.length > 0) {
      yield batch;
    }
  }

  async pullReleases(): Promise<Release[]> {
    const releases = await this.octokit.paginate(
      this.octokit.rest.repos.listReleases,
      { owner: this.owner, repo: this.repo, per_page: 100 },
    );

    return releases.map((raw) =>
      mapRelease(raw as unknown as Record<string, unknown>, this.repoFullName),
    );
  }

  private async fetchReviews(prNumber: number) {
    const reviews = await this.octokit.paginate(
      this.octokit.rest.pulls.listReviews,
      { owner: this.owner, repo: this.repo, pull_number: prNumber, per_page: 100 },
    );
    return reviews.map((r) =>
      mapReview(r as unknown as Record<string, unknown>, prNumber, this.repoFullName),
    );
  }

  private async fetchReviewComments(prNumber: number) {
    const comments = await this.octokit.paginate(
      this.octokit.rest.pulls.listReviewComments,
      { owner: this.owner, repo: this.repo, pull_number: prNumber, per_page: 100 },
    );
    return comments.map((c) =>
      mapReviewComment(c as unknown as Record<string, unknown>, prNumber, this.repoFullName),
    );
  }

  private async fetchFiles(prNumber: number) {
    const files = await this.octokit.paginate(
      this.octokit.rest.pulls.listFiles,
      { owner: this.owner, repo: this.repo, pull_number: prNumber, per_page: 100 },
    );
    return files.map((f) =>
      mapPrFile(f as unknown as Record<string, unknown>, prNumber, this.repoFullName),
    );
  }
}
