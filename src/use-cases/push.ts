import type { ISourceProvider } from '../core/ports/source-provider.js';
import type { IStorage } from '../core/ports/storage.js';

function noop(_message: string): void { /* intentional */ }

export interface CreatedIssue {
  oldKey: string;
  newKey: string;
  mdPath: string | null;
}

export interface PushResult {
  created: CreatedIssue[];
  errors: number;
}

export interface UpdatedIssue {
  key: string;
  summary: string;
}

export interface PushUpdateResult {
  updated: UpdatedIssue[];
  conflicts: string[];
  errors: number;
}

export interface PushOptions {
  onProgress?: (message: string) => void;
}

export class PushUseCase {
  constructor(
    private readonly source: ISourceProvider,
    private readonly storage: IStorage,
  ) {}

  async execute(options: PushOptions = {}): Promise<PushResult> {
    const log = options.onProgress ?? noop;

    if (!this.source.createIssue) {
      throw new Error(`Source '${this.source.name}' does not support creating issues`);
    }

    const localIssues = await this.storage.getLocalIssues();
    log(`Found ${String(localIssues.length)} local issue(s) to push`);

    const created: CreatedIssue[] = [];
    let errors = 0;

    for (const issue of localIssues) {
      try {
        const newKey = await this.source.createIssue(issue);
        await this.storage.updateIssueSource(newKey, 'jira');
        const mdPath = (issue.rawJson['mdPath'] as string | undefined) ?? null;
        created.push({ oldKey: issue.key, newKey, mdPath });
        log(`  Created ${newKey} — ${issue.summary}`);
      } catch (err: unknown) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        log(`  Failed: ${issue.summary} — ${msg}`);
      }
    }

    return { created, errors };
  }

  async executeUpdates(options: PushOptions = {}): Promise<PushUpdateResult> {
    const log = options.onProgress ?? noop;

    if (!this.source.updateIssue) {
      throw new Error(`Source '${this.source.name}' does not support updating issues`);
    }

    const modified = await this.storage.getModifiedIssues();
    log(`Found ${String(modified.length)} locally modified issue(s) to push`);

    const updated: UpdatedIssue[] = [];
    const conflicts: string[] = [];
    let errors = 0;

    for (const issue of modified) {
      try {
        await this.source.updateIssue(issue.key, issue);
        await this.storage.clearModifiedFlag(issue.key);
        updated.push({ key: issue.key, summary: issue.summary });
        log(`  Updated ${issue.key} — ${issue.summary}`);
      } catch (err: unknown) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        log(`  Failed: ${issue.key} — ${msg}`);
      }
    }

    return { updated, conflicts, errors };
  }
}
