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
}
