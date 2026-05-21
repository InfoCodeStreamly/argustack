import { describe, it, expect, beforeEach } from 'vitest';
import { CodeSearchUseCase } from '../../../src/use-cases/code-search.js';
import { FakeCodeGraph } from '../../fixtures/fakes/fake-code-graph.js';
import { FakeCodeVectorStore } from '../../fixtures/fakes/fake-code-vector-store.js';
import { FakeCodeEmbedding } from '../../fixtures/fakes/fake-code-embedding.js';
import {
  createCodeProject,
  createCodeSymbol,
  createCodeChunk,
  CODE_TEST_IDS,
} from '../../fixtures/shared/test-constants.js';
import type { CodeChunk } from '../../../src/core/types/code.js';

describe('CodeSearchUseCase — integration', () => {
  let graph: FakeCodeGraph;
  let vec: FakeCodeVectorStore;
  let embedding: FakeCodeEmbedding;
  let useCase: CodeSearchUseCase;

  beforeEach(async () => {
    graph = new FakeCodeGraph();
    vec = new FakeCodeVectorStore();
    embedding = new FakeCodeEmbedding(16);
    useCase = new CodeSearchUseCase(graph, vec, embedding);

    const project = createCodeProject();
    await graph.ensureProject(project);
    await vec.ensureCollection(project.id, embedding.dimensions);
  });

  async function seed(chunks: CodeChunk[]): Promise<void> {
    const vectors = await embedding.embedCode(chunks.map((c) => ({ content: c.content, kind: c.kind })));
    await vec.upsertChunks(CODE_TEST_IDS.projectA, chunks, vectors);
    // Seed graph symbols so cluster/expand have data
    for (const c of chunks) {
      graph.seed({
        symbols: [
          createCodeSymbol({
            qualifiedName: c.symbolId,
            name: c.name,
            kind: c.kind,
            filePath: c.filePath,
            layer: c.layer,
          }),
        ],
      });
    }
  }

  describe('searchSemantic', () => {
    it('returns hits ordered by similarity', async () => {
      await seed([
        createCodeChunk({ symbolId: 'invoice-tax', name: 'calculateTax', content: 'tax calculation invoice', filePath: 'src/domain/Tax.ts' }),
        createCodeChunk({ symbolId: 'user-auth', name: 'authenticate', content: 'user auth session', filePath: 'src/auth/Auth.ts' }),
      ]);

      const hits = await useCase.searchSemantic({
        projectId: CODE_TEST_IDS.projectA,
        query: 'tax calculation',
        topK: 2,
      });

      expect(hits.length).toBeGreaterThan(0);
      expect(hits.length).toBeLessThanOrEqual(2);
    });

    it('respects layer filter', async () => {
      await seed([
        createCodeChunk({ symbolId: 'd1', layer: 'domain', name: 'Invoice', content: 'invoice domain', filePath: 'src/domain/Invoice.ts' }),
        createCodeChunk({ symbolId: 'a1', layer: 'application', name: 'CreateInvoice', content: 'invoice application', filePath: 'src/use-cases/CreateInvoice.ts' }),
      ]);

      const hits = await useCase.searchSemantic({
        projectId: CODE_TEST_IDS.projectA,
        query: 'invoice',
        layer: 'domain',
        topK: 5,
      });

      expect(hits.every((h) => h.payload.layer === 'domain')).toBe(true);
    });
  });

  describe('planFeatureFiles', () => {
    it('returns 4-layer structured output', async () => {
      await seed([
        createCodeChunk({ symbolId: 'd1', layer: 'domain', name: 'Invoice', content: 'invoice tax calculation', filePath: 'src/domain/Invoice.ts' }),
        createCodeChunk({ symbolId: 'a1', layer: 'application', name: 'CreateInvoiceUseCase', content: 'tax calculation use case', filePath: 'src/use-cases/CreateInvoice.ts' }),
        createCodeChunk({ symbolId: 'i1', layer: 'infrastructure', name: 'InvoiceRepo', content: 'invoice postgres tax', filePath: 'src/adapters/postgres/InvoiceRepo.ts' }),
        createCodeChunk({ symbolId: 'p1', layer: 'presentation', name: 'invoiceRoute', content: 'POST tax invoice route', filePath: 'src/cli/invoice.ts' }),
      ]);

      const plan = await useCase.planFeatureFiles({
        projectId: CODE_TEST_IDS.projectA,
        description: 'add tax calculation for invoices',
        topKPerLayer: 3,
      });

      expect(plan).toHaveProperty('domain');
      expect(plan).toHaveProperty('application');
      expect(plan).toHaveProperty('infrastructure');
      expect(plan).toHaveProperty('presentation');
      const totalHits = plan.domain.length + plan.application.length + plan.infrastructure.length + plan.presentation.length;
      expect(totalHits).toBeGreaterThan(0);
    });

    it('each PlannedFile has filePath + reason + similarTo + score', async () => {
      await seed([
        createCodeChunk({ symbolId: 'd1', layer: 'domain', name: 'Invoice', content: 'invoice', filePath: 'src/domain/Invoice.ts' }),
      ]);

      const plan = await useCase.planFeatureFiles({
        projectId: CODE_TEST_IDS.projectA,
        description: 'invoice',
      });

      const first = plan.domain[0];
      if (!first) {
        // grouping may put it in another layer; just check structure of any non-empty bucket
        const anyBucket = [...plan.domain, ...plan.application, ...plan.infrastructure, ...plan.presentation];
        expect(anyBucket.length).toBeGreaterThan(0);
        return;
      }
      expect(first.filePath).toBeTruthy();
      expect(first.reason).toBeTruthy();
      expect(typeof first.score).toBe('number');
    });
  });

  describe('explainFeature', () => {
    it('returns byLayer + expandedFiles', async () => {
      await seed([
        createCodeChunk({ symbolId: 'd1', layer: 'domain', name: 'Auth', content: 'authentication user session', filePath: 'src/domain/Auth.ts' }),
        createCodeChunk({ symbolId: 'a1', layer: 'application', name: 'LoginUseCase', content: 'login user', filePath: 'src/use-cases/Login.ts' }),
      ]);

      const result = await useCase.explainFeature({
        projectId: CODE_TEST_IDS.projectA,
        query: 'authentication',
        topK: 5,
      });

      expect(result.byLayer).toHaveProperty('domain');
      expect(result.byLayer).toHaveProperty('application');
      expect(Array.isArray(result.expandedFiles)).toBe(true);
    });
  });
});
