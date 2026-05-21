import { EventEmitter } from 'node:events';
import chokidar, { type FSWatcher } from 'chokidar';
import type { CodeIndexer } from './indexer.js';

const DEBOUNCE_MS = 500;
const SUPPORTED_EXT = /\.(?:m|c)?(?:t|j)sx?$/;
const IGNORED_PATTERNS = [
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])\.git([/\\]|$)/,
  /(^|[/\\])\.next([/\\]|$)/,
  /(^|[/\\])dist([/\\]|$)/,
  /(^|[/\\])\.argustack([/\\]|$)/,
  /\.swp$/,
  /\.tmp$/,
  /~$/,
];

export interface CodeWatcherEvents {
  started: () => void;
  ready: () => void;
  'fileIndexed': (relPath: string) => void;
  'fileRemoved': (relPath: string) => void;
  error: (err: Error) => void;
}

export interface CodeWatcherOptions {
  root: string;
  indexer: CodeIndexer;
  debounceMs?: number;
}

export class CodeWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly debounce: number;

  constructor(private readonly opts: CodeWatcherOptions) {
    super();
    this.debounce = opts.debounceMs ?? DEBOUNCE_MS;
  }

  start(): void {
    if (this.watcher) {return;}
    const watcher = chokidar.watch(this.opts.root, {
      ignored: (path) => IGNORED_PATTERNS.some((p) => p.test(path)),
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });

    watcher.on('add', (path) => { this.queueIndex(path); });
    watcher.on('change', (path) => { this.queueIndex(path); });
    watcher.on('unlink', (path) => { this.queueRemove(path); });
    watcher.on('error', (err) => this.emit('error', err));
    watcher.on('ready', () => this.emit('ready'));

    this.watcher = watcher;
    this.emit('started');
  }

  async stop(): Promise<void> {
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private queueIndex(path: string): void {
    if (!SUPPORTED_EXT.test(path)) {return;}
    this.schedule(path, async () => {
      try {
        await this.opts.indexer.indexFile(path);
        this.emit('fileIndexed', path);
      } catch (error) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private queueRemove(path: string): void {
    if (!SUPPORTED_EXT.test(path)) {return;}
    this.schedule(path, async () => {
      try {
        await this.opts.indexer.removeFile(path);
        this.emit('fileRemoved', path);
      } catch (error) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private schedule(path: string, fn: () => Promise<void>): void {
    const existing = this.pending.get(path);
    if (existing) {clearTimeout(existing);}
    const timer = setTimeout(() => {
      this.pending.delete(path);
      void fn();
    }, this.debounce);
    this.pending.set(path, timer);
  }
}
