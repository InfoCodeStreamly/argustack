import type { PullRequest } from '../../../src/core/types/index.js';
import { createPullRequest } from '../shared/test-constants.js';

export class PullRequestBuilder {
  private readonly overrides: Partial<PullRequest> = {};

  withNumber(number: number): this {
    this.overrides.number = number;
    return this;
  }

  withRepoFullName(repoFullName: string): this {
    this.overrides.repoFullName = repoFullName;
    return this;
  }

  withTitle(title: string): this {
    this.overrides.title = title;
    return this;
  }

  withBody(body: string | null): this {
    this.overrides.body = body;
    return this;
  }

  withState(state: string): this {
    this.overrides.state = state;
    return this;
  }

  withAuthor(author: string): this {
    this.overrides.author = author;
    return this;
  }

  withMergedAt(mergedAt: string | null): this {
    this.overrides.mergedAt = mergedAt;
    return this;
  }

  withClosedAt(closedAt: string | null): this {
    this.overrides.closedAt = closedAt;
    return this;
  }

  withHeadRef(headRef: string): this {
    this.overrides.headRef = headRef;
    return this;
  }

  withBaseRef(baseRef: string): this {
    this.overrides.baseRef = baseRef;
    return this;
  }

  withLabels(labels: string[]): this {
    this.overrides.labels = labels;
    return this;
  }

  withReviewers(reviewers: string[]): this {
    this.overrides.reviewers = reviewers;
    return this;
  }

  withAdditions(additions: number): this {
    this.overrides.additions = additions;
    return this;
  }

  withDeletions(deletions: number): this {
    this.overrides.deletions = deletions;
    return this;
  }

  /** Preset: Open PR */
  open(): this {
    this.overrides.state = 'open';
    this.overrides.mergedAt = null;
    this.overrides.closedAt = null;
    return this;
  }

  /** Preset: Merged PR */
  merged(): this {
    this.overrides.state = 'merged';
    this.overrides.mergedAt = '2025-01-12T14:00:00Z';
    this.overrides.closedAt = '2025-01-12T14:00:00Z';
    return this;
  }

  /** Preset: Closed (not merged) PR */
  closed(): this {
    this.overrides.state = 'closed';
    this.overrides.mergedAt = null;
    this.overrides.closedAt = '2025-01-12T14:00:00Z';
    return this;
  }

  /** Preset: Draft PR */
  draft(): this {
    this.overrides.state = 'open';
    this.overrides.labels = ['draft'];
    return this;
  }

  build(): PullRequest {
    return createPullRequest(this.overrides);
  }
}
