import type {
  PullRequest,
  PullRequestReview,
  PullRequestComment,
  PullRequestFile,
  PullRequestIssueRef,
  Release,
} from '../../core/types/github.js';

const PR_FILE_STATUS_MAP: Record<string, PullRequestFile['status']> = {
  added: 'added',
  modified: 'modified',
  removed: 'removed',
  renamed: 'renamed',
};

export function mapPullRequest(
  raw: Record<string, unknown>,
  repoFullName: string,
): PullRequest {
  const user = raw['user'] as Record<string, unknown> | null;
  const head = raw['head'] as Record<string, unknown>;
  const base = raw['base'] as Record<string, unknown>;
  const labels = raw['labels'] as Record<string, unknown>[] | undefined;
  const requestedReviewers = raw['requested_reviewers'] as Record<string, unknown>[] | undefined;

  const mergedAt = raw['merged_at'] as string | null;
  let state: PullRequest['state'];
  if (mergedAt) {
    state = 'merged';
  } else if (raw['state'] === 'closed') {
    state = 'closed';
  } else {
    state = 'open';
  }

  return {
    number: raw['number'] as number,
    repoFullName,
    title: raw['title'] as string,
    body: (raw['body'] as string | null) ?? null,
    state,
    author: (user?.['login'] as string | null) ?? null,
    createdAt: raw['created_at'] as string,
    updatedAt: raw['updated_at'] as string,
    mergedAt,
    closedAt: (raw['closed_at'] as string | null) ?? null,
    mergeCommitSha: (raw['merge_commit_sha'] as string | null) ?? null,
    headRef: head['ref'] as string,
    baseRef: base['ref'] as string,
    labels: labels?.map((l) => l['name'] as string) ?? [],
    reviewers: requestedReviewers?.map((r) => r['login'] as string) ?? [],
    additions: (raw['additions'] as number | undefined) ?? 0,
    deletions: (raw['deletions'] as number | undefined) ?? 0,
    changedFiles: (raw['changed_files'] as number | undefined) ?? 0,
    rawJson: raw,
  };
}

export function mapReview(
  raw: Record<string, unknown>,
  prNumber: number,
  repoFullName: string,
): PullRequestReview {
  const user = raw['user'] as Record<string, unknown> | null;
  return {
    prNumber,
    repoFullName,
    reviewId: raw['id'] as number,
    reviewer: (user?.['login'] as string | null) ?? null,
    state: raw['state'] as string,
    body: (raw['body'] as string | null) ?? null,
    submittedAt: (raw['submitted_at'] as string | null) ?? null,
  };
}

export function mapReviewComment(
  raw: Record<string, unknown>,
  prNumber: number,
  repoFullName: string,
): PullRequestComment {
  const user = raw['user'] as Record<string, unknown> | null;
  return {
    prNumber,
    repoFullName,
    commentId: raw['id'] as number,
    author: (user?.['login'] as string | null) ?? null,
    body: (raw['body'] as string | null) ?? null,
    path: (raw['path'] as string | null) ?? null,
    line: (raw['line'] as number | null) ?? null,
    createdAt: (raw['created_at'] as string | null) ?? null,
    updatedAt: (raw['updated_at'] as string | null) ?? null,
  };
}

export function mapPrFile(
  raw: Record<string, unknown>,
  prNumber: number,
  repoFullName: string,
): PullRequestFile {
  const rawStatus = raw['status'] as string;
  return {
    prNumber,
    repoFullName,
    filePath: raw['filename'] as string,
    status: PR_FILE_STATUS_MAP[rawStatus] ?? 'modified',
    additions: (raw['additions'] as number | undefined) ?? 0,
    deletions: (raw['deletions'] as number | undefined) ?? 0,
  };
}

export function mapRelease(
  raw: Record<string, unknown>,
  repoFullName: string,
): Release {
  const author = raw['author'] as Record<string, unknown> | null;
  return {
    id: raw['id'] as number,
    repoFullName,
    tagName: raw['tag_name'] as string,
    name: (raw['name'] as string | null) ?? null,
    body: (raw['body'] as string | null) ?? null,
    author: (author?.['login'] as string | null) ?? null,
    draft: (raw['draft'] as boolean | undefined) ?? false,
    prerelease: (raw['prerelease'] as boolean | undefined) ?? false,
    createdAt: raw['created_at'] as string,
    publishedAt: (raw['published_at'] as string | null) ?? null,
    rawJson: raw,
  };
}

/**
 * Extract issue references from PR title and body.
 * Matches Jira-style keys: PAP-123, PROJ-45
 */
export function extractPrIssueRefs(
  prNumber: number,
  repoFullName: string,
  title: string,
  body: string | null,
): PullRequestIssueRef[] {
  const pattern = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
  const keys = new Set<string>();
  const text = body ? `${title} ${body}` : title;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const key = match[1];
    if (key) {
      keys.add(key.toUpperCase());
    }
  }

  return [...keys].map((issueKey) => ({ prNumber, repoFullName, issueKey }));
}
