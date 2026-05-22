import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import type { ICodeGraph } from '../core/ports/code-graph.js';
import type { ICodeVectorStore } from '../core/ports/code-vector-store.js';
import type { ICodeParser } from '../core/ports/code-parser.js';
import type { ICodeEmbedding } from '../core/ports/code-embedding.js';
import type { ICodeMetaStore } from '../core/ports/code-meta.js';
import type {
  CodeProject,
  CodeFile,
  CodeFileHash,
  CodeSymbol,
  CodeImport,
  CodeCallEdge,
  IndexStats,
  IndexJobType,
} from '../core/types/code.js';
import { detectLayer } from './layer-detector.js';
import { discoverFiles } from './file-discovery.js';
import { hashFile } from './hash.js';
import { symbolsToChunks } from './chunker.js';
import { SymbolResolver } from './resolver.js';
import { LspSymbolResolver } from './lsp-resolver.js';
import type { ILspClient } from '../core/ports/lsp-client.js';

const EMBED_BATCH = 64;

export interface IndexerOptions {
  project: CodeProject;
  parser: ICodeParser;
  graph: ICodeGraph;
  vec: ICodeVectorStore;
  embedding: ICodeEmbedding;
  meta: ICodeMetaStore;
  lsp?: ILspClient;
}

export interface IndexProjectOptions {
  full?: boolean;
  onProgress?: (event: IndexProgress) => void;
}

export type IndexProgress =
  | { type: 'started'; total?: number }
  | { type: 'fileIndexed'; relPath: string; index: number; total: number }
  | { type: 'fileSkipped'; relPath: string }
  | { type: 'completed'; stats: IndexStats };

export class CodeIndexer {
  constructor(private readonly opts: IndexerOptions) {}

  async indexProject(options: IndexProjectOptions = {}): Promise<IndexStats> {
    const jobType: IndexJobType = options.full === true ? 'full' : 'incremental';
    const jobId = await this.opts.meta.startIndexJob(this.opts.project.id, jobType);
    const startedAt = Date.now();
    const t = (msg: string): void => {
      console.error(`[${String(Date.now() - startedAt)}ms] ${msg}`);
    };
    t('indexProject started');
    options.onProgress?.({ type: 'started' });

    try {
      t('fetching stored hashes...');
      const stored = options.full === true
        ? new Map<string, string>()
        : await this.opts.meta.getFileHashes(this.opts.project.id);
      t(`got ${String(stored.size)} stored hashes`);

      const discoveryOpts = this.opts.project.excludes !== undefined
        ? { extraExcludes: this.opts.project.excludes }
        : {};
      const discovered: { absPath: string; relPath: string; language: CodeFile['language'] }[] = [];
      t('discovering files...');
      for await (const file of discoverFiles(this.opts.project.root, discoveryOpts)) {
        discovered.push(file);
      }
      t(`discovered ${String(discovered.length)} files`);

      const fileRecords: CodeFile[] = [];
      const allSymbols: CodeSymbol[] = [];
      const allImports: CodeImport[] = [];
      const rawParsedByFile = new Map<string, Awaited<ReturnType<ICodeParser['parseFile']>>>();
      const newHashes: CodeFileHash[] = [];
      let symbolsCreated = 0;
      let chunksCreated = 0;
      let edgesCreated = 0;

      t('parsing files...');
      for (let i = 0; i < discovered.length; i++) {
        const file = discovered[i];
        if (file === undefined) {continue;}
        if (i % 50 === 0) {t(`parse progress ${String(i)}/${String(discovered.length)} — ${file.relPath}`);}
        const source = await readFile(file.absPath, 'utf8');
        const hash = hashFile(source);
        if (options.full !== true && stored.get(file.relPath) === hash) {
          options.onProgress?.({ type: 'fileSkipped', relPath: file.relPath });
          continue;
        }
        const parsed = await this.opts.parser.parseFile(file.absPath, source, file.language);
        rawParsedByFile.set(file.relPath, parsed);

        const layer = detectLayer(file.relPath, this.opts.project.layerConfig ?? {});
        const symbols: CodeSymbol[] = parsed.symbols.map((s) => ({
          ...s,
          projectId: this.opts.project.id,
          layer,
        }));
        allSymbols.push(...symbols);

        for (const imp of parsed.imports) {
          allImports.push({ ...imp, projectId: this.opts.project.id });
        }

        fileRecords.push({
          projectId: this.opts.project.id,
          path: file.relPath,
          language: file.language,
          layer,
          hash,
        });
        newHashes.push({ path: file.relPath, hash });
        symbolsCreated += symbols.length;
        options.onProgress?.({
          type: 'fileIndexed',
          relPath: file.relPath,
          index: i + 1,
          total: discovered.length,
        });
      }

      t(`parsing done: ${String(symbolsCreated)} symbols, ${String(allImports.length)} imports`);

      t('resolving calls...');
      const heuristic = new SymbolResolver(allSymbols);
      const lspResolver = this.opts.lsp !== undefined
        ? new LspSymbolResolver(
            this.opts.lsp,
            this.opts.project.root,
            allSymbols,
            (parsed) => heuristic.resolveCalls(this.opts.project.id, parsed),
          )
        : null;
      const allCalls: CodeCallEdge[] = [];

      t('writing files to Neo4j...');
      await this.opts.graph.upsertFiles(this.opts.project.id, fileRecords);
      t('files written');

      let resolvedCount = 0;
      for (const [relPath, parsed] of rawParsedByFile) {
        const edges = lspResolver !== null
          ? await lspResolver.resolveCalls(this.opts.project.id, parsed)
          : heuristic.resolveCalls(this.opts.project.id, parsed);
        allCalls.push(...edges);
        edgesCreated += edges.length;
        const fileSymbols = allSymbols.filter((s) => s.filePath === relPath);
        await this.opts.graph.replaceFileSymbols(
          this.opts.project.id,
          relPath,
          fileSymbols,
        );
        resolvedCount += 1;
        if (resolvedCount % 50 === 0) {t(`graph progress ${String(resolvedCount)}/${String(rawParsedByFile.size)}`);}
      }
      t('symbol upserts done');

      await this.opts.graph.upsertImports(allImports);
      t('imports upserted');
      await this.opts.graph.upsertCalls(allCalls);
      t('calls upserted');
      edgesCreated += allImports.length;

      let embeddingTokens = 0;
      for (const [relPath, parsed] of rawParsedByFile) {
        const source = await readFile(toAbs(this.opts.project.root, relPath), 'utf8');
        const layer = detectLayer(relPath, this.opts.project.layerConfig ?? {});
        const chunks = symbolsToChunks({
          projectId: this.opts.project.id,
          filePath: relPath,
          layer,
          fileSource: source,
          symbols: parsed.symbols.map((s) => ({
            ...s,
            projectId: this.opts.project.id,
            layer,
          })),
        });
        if (chunks.length === 0) {continue;}
        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
          const batch = chunks.slice(i, i + EMBED_BATCH);
          const vectors = await this.opts.embedding.embedCode(
            batch.map((c) => ({ content: c.content, kind: c.kind })),
          );
          await this.opts.vec.upsertChunks(this.opts.project.id, batch, vectors);
          chunksCreated += batch.length;
          embeddingTokens += batch.reduce((sum, c) => sum + estimateTokens(c.content), 0);
        }
      }

      await this.opts.meta.upsertFileHashes(this.opts.project.id, newHashes);

      const stats: IndexStats = {
        filesIndexed: newHashes.length,
        symbolsCreated,
        edgesCreated,
        chunksCreated,
        embeddingTokens,
        durationMs: Date.now() - startedAt,
      };
      await this.opts.meta.completeIndexJob(jobId, stats);
      options.onProgress?.({ type: 'completed', stats });
      return stats;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.opts.meta.failIndexJob(jobId, message);
      throw error;
    }
  }

  async indexFile(absPath: string): Promise<void> {
    const relPath = relative(this.opts.project.root, absPath).split(sep).join('/');
    const source = await readFile(absPath, 'utf8');
    const hash = hashFile(source);
    const language = guessLanguage(absPath);
    if (language === null) {return;}
    const parsed = await this.opts.parser.parseFile(absPath, source, language);
    const layer = detectLayer(relPath, this.opts.project.layerConfig ?? {});

    const symbols: CodeSymbol[] = parsed.symbols.map((s) => ({
      ...s,
      projectId: this.opts.project.id,
      layer,
    }));

    await this.opts.graph.upsertFiles(this.opts.project.id, [
      {
        projectId: this.opts.project.id,
        path: relPath,
        language,
        layer,
        hash,
      },
    ]);
    await this.opts.graph.replaceFileSymbols(this.opts.project.id, relPath, symbols);
    const imports = parsed.imports.map((i) => ({ ...i, projectId: this.opts.project.id }));
    await this.opts.graph.upsertImports(imports);

    await this.opts.vec.deleteByFile(this.opts.project.id, relPath);
    const chunks = symbolsToChunks({
      projectId: this.opts.project.id,
      filePath: relPath,
      layer,
      fileSource: source,
      symbols,
    });
    if (chunks.length > 0) {
      const vectors = await this.opts.embedding.embedCode(
        chunks.map((c) => ({ content: c.content, kind: c.kind })),
      );
      await this.opts.vec.upsertChunks(this.opts.project.id, chunks, vectors);
    }

    await this.opts.meta.upsertFileHashes(this.opts.project.id, [{ path: relPath, hash }]);
  }

  async removeFile(absPath: string): Promise<void> {
    const relPath = relative(this.opts.project.root, absPath).split(sep).join('/');
    await this.opts.graph.deleteFile(this.opts.project.id, relPath);
    await this.opts.vec.deleteByFile(this.opts.project.id, relPath);
  }
}

function toAbs(root: string, relPath: string): string {
  return `${root.replace(/\/$/, '')}/${relPath}`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function guessLanguage(absPath: string): CodeFile['language'] | null {
  const lower = absPath.toLowerCase();
  if (lower.endsWith('.tsx')) {return 'tsx';}
  if (lower.endsWith('.jsx')) {return 'jsx';}
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return 'typescript';
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return 'javascript';
  }
  return null;
}
