import type { ICodeGraph } from '../core/ports/code-graph.js';
import type { ICodeVectorStore } from '../core/ports/code-vector-store.js';
import type { ICodeParser } from '../core/ports/code-parser.js';
import type { ICodeEmbedding } from '../core/ports/code-embedding.js';
import type { ICodeMetaStore } from '../core/ports/code-meta.js';
import type { CodeProject } from '../core/types/code.js';
import { CodeIndexer, CodeWatcher } from '../code-intel/index.js';

export interface WatchCodeInput {
  project: CodeProject;
  signal?: AbortSignal;
  onEvent?: (event: WatchEvent) => void;
}

export type WatchEvent =
  | { type: 'ready' }
  | { type: 'fileIndexed'; path: string }
  | { type: 'fileRemoved'; path: string }
  | { type: 'error'; error: Error };

export class WatchCodeUseCase {
  constructor(
    private readonly parser: ICodeParser,
    private readonly graph: ICodeGraph,
    private readonly vec: ICodeVectorStore,
    private readonly embedding: ICodeEmbedding,
    private readonly meta: ICodeMetaStore,
  ) {}

  async start(input: WatchCodeInput): Promise<void> {
    const acquired = await this.meta.tryAcquireLock(input.project.id);
    if (!acquired) {
      throw new Error(`Another job is running for project '${input.project.id}'`);
    }
    const indexer = new CodeIndexer({
      project: input.project,
      parser: this.parser,
      graph: this.graph,
      vec: this.vec,
      embedding: this.embedding,
      meta: this.meta,
    });
    const watcher = new CodeWatcher({ root: input.project.root, indexer });
    watcher.on('ready', () => input.onEvent?.({ type: 'ready' }));
    watcher.on('fileIndexed', (path: string) =>
      input.onEvent?.({ type: 'fileIndexed', path }),
    );
    watcher.on('fileRemoved', (path: string) =>
      input.onEvent?.({ type: 'fileRemoved', path }),
    );
    watcher.on('error', (error: Error) => input.onEvent?.({ type: 'error', error }));
    watcher.start();

    return new Promise<void>((resolve) => {
      const cleanup = (): void => {
        void (async () => {
          await watcher.stop();
          await this.meta.releaseLock(input.project.id);
          resolve();
        })();
      };
      if (input.signal !== undefined) {
        if (input.signal.aborted) {
          cleanup();
          return;
        }
        input.signal.addEventListener('abort', cleanup, { once: true });
      }
    });
  }
}
