import { openRepository } from 'es-git';
import type { Repository, Tree } from 'es-git';
import type { IGitProvider } from '../../core/ports/git-provider.js';
import type { CommitBatch, GitRef } from '../../core/types/git.js';
import { mapCommit, mapDiffDelta, extractIssueRefs } from './mapper.js';

const BATCH_SIZE = 100;

function getPerFileStats(
  repo: Repository,
  parentTree: Tree | null,
  commitTree: Tree,
  filePath: string,
): { additions: number; deletions: number } {
  try {
    const fileDiff = repo.diffTreeToTree(parentTree, commitTree, {
      pathspecs: [filePath],
      disablePathspecMatch: true,
    });
    const stats = fileDiff.stats();
    return { additions: Number(stats.insertions), deletions: Number(stats.deletions) };
  } catch {
    return { additions: 0, deletions: 0 };
  }
}

export class GitProvider implements IGitProvider {
  readonly name = 'Git (local)';

  constructor(private readonly repoPath: string) {}

  async getCommitCount(since?: Date): Promise<number> {
    const repo = await openRepository(this.repoPath);
    const revwalk = repo.revwalk().pushHead();
    let count = 0;

    let sha = revwalk.next();
    while (sha !== null) {
      if (since) {
        const commitDate = repo.getCommit(sha).time();
        if (commitDate < since) {
          break;
        }
      }
      count++;
      sha = revwalk.next();
    }

    return count;
  }

  async *pullCommits(since?: Date): AsyncGenerator<CommitBatch> {
    const repo = await openRepository(this.repoPath);
    const revwalk = repo.revwalk().pushHead();

    let batch: CommitBatch = { commits: [], files: [], issueRefs: [] };

    let sha = revwalk.next();
    while (sha !== null) {
      const esCommit = repo.getCommit(sha);
      const commitDate = esCommit.time();

      if (since && commitDate < since) {
        break;
      }

      const commit = mapCommit(esCommit, this.repoPath);
      batch.commits.push(commit);

      const commitTree = esCommit.tree();

      const parentSha = revwalk.next();
      const parentTree = parentSha !== null
        ? repo.getCommit(parentSha).tree()
        : null;

      try {
        const diff = repo.diffTreeToTree(parentTree, commitTree);
        const deltas = diff.deltas();
        let deltaResult = deltas.next();

        while (!deltaResult.done) {
          const delta = deltaResult.value;
          const rawStatus = delta.status();
          const filePath = (rawStatus === 'Deleted' ? delta.oldFile().path() : delta.newFile().path()) ?? '';
          const stat = getPerFileStats(repo, parentTree, commitTree, filePath);

          batch.files.push(mapDiffDelta(delta, sha, stat.additions, stat.deletions));
          deltaResult = deltas.next();
        }
      } catch { /* diff unavailable */ }

      const refs = extractIssueRefs(sha, commit.message);
      batch.issueRefs.push(...refs);

      if (batch.commits.length >= BATCH_SIZE) {
        yield batch;
        batch = { commits: [], files: [], issueRefs: [] };
      }

      sha = parentSha;
    }

    if (batch.commits.length > 0) {
      yield batch;
    }
  }

  async getBranches(): Promise<GitRef[]> {
    const repo = await openRepository(this.repoPath);
    const refs: GitRef[] = [];

    const branches = repo.branches({ type: 'Local' });
    let branchResult = branches.next();
    while (!branchResult.done) {
      refs.push({
        name: branchResult.value.name,
        type: 'branch',
        hash: '',
      });
      branchResult = branches.next();
    }

    return refs;
  }

  async getTags(): Promise<GitRef[]> {
    const repo = await openRepository(this.repoPath);
    const refs: GitRef[] = [];

    repo.tagForeach((oid, name) => {
      refs.push({
        name: name.replace('refs/tags/', ''),
        type: 'tag',
        hash: oid,
      });
      return true;
    });

    return refs;
  }
}
