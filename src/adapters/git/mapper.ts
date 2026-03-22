import type { Commit, CommitFile, CommitIssueRef } from '../../core/types/git.js';
import type { Commit as EsGitCommit, DiffDelta } from 'es-git';

const FILE_STATUS_MAP: Record<string, CommitFile['status']> = {
  Added: 'added',
  Modified: 'modified',
  Deleted: 'deleted',
  Renamed: 'renamed',
};

export function mapCommit(esCommit: EsGitCommit, repoPath: string): Commit {
  const author = esCommit.author();
  return {
    hash: esCommit.id(),
    message: esCommit.message(),
    author: author.name,
    email: author.email,
    committedAt: esCommit.time().toISOString(),
    parents: [],
    repoPath,
  };
}

export function mapDiffDelta(
  delta: DiffDelta,
  commitHash: string,
  additions: number,
  deletions: number,
): CommitFile {
  const rawStatus = delta.status();
  return {
    commitHash,
    filePath: (rawStatus === 'Deleted' ? delta.oldFile().path() : delta.newFile().path()) ?? '',
    status: FILE_STATUS_MAP[rawStatus] ?? 'modified',
    additions,
    deletions,
  };
}

/**
 * Extract issue references from a commit message.
 * Matches patterns like: PROJ-123, PROJ-45, ABC-1
 * Returns unique keys, uppercased.
 */
export function extractIssueRefs(commitHash: string, message: string): CommitIssueRef[] {
  const pattern = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
  const keys = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    const key = match[1];
    if (key) {
      const [prefix, num] = key.toUpperCase().split('-');
      keys.add(`${prefix}-${String(Number(num))}`);
    }
  }

  return [...keys].map((issueKey) => ({ commitHash, issueKey }));
}
